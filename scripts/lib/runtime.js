// AI-assisted configuration, chain validation and confirmed-transaction helpers.
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");
const { decodeFirstSync } = require("cbor");
const networks = require("../../config/networks");
require("dotenv").config({ path: path.join(__dirname, "../../.env"), quiet: true });
const ROOT = path.resolve(__dirname, "../..");

function integer(env, name, fallback) {
  const value = Number(env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}
function settings(env = process.env) {
  const required = ["SEPOLIA_RPC_URL", "ARBITRUM_SEPOLIA_RPC_URL", "ALICE_PRIVATE_KEY", "BOB_PRIVATE_KEY", "RAIN_ADDRESS"];
  const missing = required.filter((key) => !env[key] || /YOUR_|PLACEHOLDER/.test(env[key]));
  if (missing.length) throw new Error(`Configure local .env: ${missing.join(", ")}`);
  for (const role of ["ALICE", "BOB"]) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(env[`${role}_PRIVATE_KEY`])) throw new Error(`${role}_PRIVATE_KEY must be a 0x-prefixed 32-byte key`);
  }
  if (!ethers.isAddress(env.RAIN_ADDRESS) || env.RAIN_ADDRESS === ethers.ZeroAddress) throw new Error("RAIN_ADDRESS must be a nonzero address");
  const result = {
    rainAddress: ethers.getAddress(env.RAIN_ADDRESS), rainAmount: env.RAIN_AMOUNT || "100", ethAmount: env.ETH_AMOUNT || "0.001",
    rainSeconds: integer(env, "RAIN_TIMELOCK_SECONDS", 7200), ethSeconds: integer(env, "ETH_TIMELOCK_SECONDS", 3600),
    minGap: integer(env, "MIN_TIMELOCK_GAP_SECONDS", 600), minWindow: integer(env, "MIN_CLAIM_WINDOW_SECONDS", 120),
    timeout: integer(env, "TX_TIMEOUT_MS", 300000),
  };
  if (result.rainSeconds < result.ethSeconds + result.minGap) throw new Error("Rain timelock must exceed ETH timelock by MIN_TIMELOCK_GAP_SECONDS");
  if (result.ethSeconds <= result.minWindow) throw new Error("ETH timelock must exceed MIN_CLAIM_WINDOW_SECONDS");
  return result;
}
function artifact(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts/contracts", `${name}.sol`, `${name}.json`)));
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n");
  fs.renameSync(`${file}.tmp`, file);
}
function readJson(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null; }
function errorMessage(error) {
  let message = String(error.shortMessage || error.message || error);
  for (const key of [process.env.ALICE_PRIVATE_KEY, process.env.BOB_PRIVATE_KEY]) if (key) message = message.split(key).join("[redacted]");
  return message.replace(/https?:\/\/[^\s"')]+/g, "[RPC URL redacted]");
}
async function assertChain(chain) {
  if (Number(await chain.provider.send("eth_chainId", [])) !== chain.chainId) throw new Error(`${chain.name}: unexpected RPC chain ID`);
}

// AI-assisted: 按 Solidity 尾部两字节长度定位并完整解码 CBOR，不按固定字符数截断。
// 只识别本项目使用的发布版 solc 元数据；未知字段/格式保守拒绝，不能用“忽略尾部”放行。
function splitSolidityMetadata(code) {
  const bytes = Buffer.from(code.slice(2), "hex");
  if (bytes.length < 4) throw new Error("missing Solidity metadata trailer");
  const length = bytes.readUInt16BE(bytes.length - 2);
  const start = bytes.length - 2 - length;
  if (length === 0 || start < 1 || bytes[start - 1] !== 0xfe) {
    throw new Error("invalid metadata length or missing compiler separator");
  }
  const encoded = bytes.subarray(start, bytes.length - 2);
  if ((encoded[0] >> 5) !== 5 || (encoded[0] & 31) === 31) throw new Error("expected a definite CBOR map");
  // 默认要求整段输入耗尽；拒绝重复键、尾随数据和过深嵌套。
  const metadata = decodeFirstSync(encoded, { required: true, preventDuplicateKeys: true, max_depth: 2 });
  const keys = Object.keys(metadata).sort();
  const hashKeys = keys.filter((key) => ["ipfs", "bzzr0", "bzzr1"].includes(key));
  if (Object.getPrototypeOf(metadata) !== Object.prototype ||
      keys.some((key) => !["ipfs", "bzzr0", "bzzr1", "solc", "experimental"].includes(key)) ||
      hashKeys.length !== 1 || !Buffer.isBuffer(metadata.solc) || metadata.solc.length !== 3 ||
      (Object.hasOwn(metadata, "experimental") && typeof metadata.experimental !== "boolean")) {
    throw new Error("unsupported Solidity metadata fields or compiler marker");
  }
  const hash = metadata[hashKeys[0]];
  if (!Buffer.isBuffer(hash) || (hashKeys[0] === "ipfs"
    ? hash.length !== 34 || hash[0] !== 0x12 || hash[1] !== 0x20
    : hash.length !== 32)) throw new Error("invalid metadata hash encoding");
  return { body: bytes.subarray(0, start),
    markers: JSON.stringify([keys, metadata.solc.toString("hex"), metadata.experimental]) };
}

// AI-assisted: 完整匹配优先；只允许元数据哈希变化，不宣称源码/编译配置完全相同。
function compareBytecode(actual, expected) {
  if (![actual, expected].every((value) => typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(value))) {
    return { match: "mismatch", reason: "invalid or empty runtime bytecode" };
  }
  if (actual.toLowerCase() === expected.toLowerCase()) return { match: "exact" };
  try {
    const deployed = splitSolidityMetadata(actual);
    const compiled = splitSolidityMetadata(expected);
    if (!deployed.body.equals(compiled.body)) return { match: "mismatch", reason: "executable bytecode differs" };
    if (deployed.markers !== compiled.markers) return { match: "mismatch", reason: "compiler or metadata markers differ" };
    return { match: "metadata-only" };
  } catch {
    return { match: "mismatch", reason: "metadata difference could not be reliably decoded" };
  }
}

async function assertCode(chain, address, contractName) {
  const code = await chain.provider.getCode(address);
  if (code === "0x") throw new Error(`${chain.name}: no contract at configured address`);
  if (!contractName) return { match: "present" };
  const result = compareBytecode(code, artifact(contractName).deployedBytecode);
  if (result.match === "mismatch") {
    const error = new Error(`${chain.name}: ${contractName} deployment check failed: ${result.reason}; review the Task A build and deployment`);
    error.code = "HTLC_CODE_MISMATCH";
    throw error;
  }
  if (result.match === "metadata-only") {
    result.warning = `${chain.name}: executable bytecode matches ${contractName}; compiler metadata differs. Full source/build identity is not verified.`;
    console.warn(result.warning);
  }
  return result;
}
async function contexts(env = process.env, deployed = true) {
  const options = settings(env);
  const chains = {};
  try {
    for (const [key, meta] of Object.entries(networks)) {
      const request = new ethers.FetchRequest(env[meta.rpcEnv]);
      request.timeout = 20000;
      const provider = new ethers.JsonRpcProvider(request, undefined, { cacheTimeout: -1 });
      const chain = { ...meta, key, provider, timeout: options.timeout,
        confirmations: integer(env, key === "sepolia" ? "SEPOLIA_CONFIRMATIONS" : "ARBITRUM_SEPOLIA_CONFIRMATIONS", 2),
      };
      chains[key] = chain;
      for (const role of ["alice", "bob"]) {
        const wallet = new ethers.Wallet(env[`${role.toUpperCase()}_PRIVATE_KEY`], provider);
        const expected = env[`${role.toUpperCase()}_ADDRESS`];
        if (expected && (!ethers.isAddress(expected) || ethers.getAddress(expected) !== wallet.address)) throw new Error(`${role.toUpperCase()}_ADDRESS does not match its private key`);
        chain[role] = new ethers.NonceManager(wallet);
      }
      if (await chain.alice.getAddress() === await chain.bob.getAddress()) throw new Error("Alice and Bob must be different accounts");
      await assertChain(chain);
      if (deployed) {
        const record = readJson(path.join(ROOT, "deployments", `${key}.json`));
        if (record && record.chainId !== meta.chainId) throw new Error(`${key}: deployment record has wrong chain ID`);
        chain.address = env[meta.addressEnv] || (record?.status === "confirmed" ? record.address : null);
        if (!chain.address || !ethers.isAddress(chain.address)) throw new Error(`Deploy ${meta.contract} first or configure ${meta.addressEnv}`);
        await assertCode(chain, chain.address, meta.contract);
        chain.htlc = new ethers.Contract(chain.address, artifact(meta.contract).abi, provider);
      }
    }
    await assertCode(chains.sepolia, options.rainAddress);
    return { chains, options };
  } catch (error) { close(chains); throw error; }
}
function close(chains) { for (const chain of Object.values(chains)) chain.provider.destroy(); }
function txUrl(chain, hash) { return chain.explorer ? `${chain.explorer}/tx/${hash}` : null; }
async function confirmed(chain, tx, label, journal = () => {}) {
  const entry = { label, network: chain.key, chainId: chain.chainId, hash: tx.hash, url: txUrl(chain, tx.hash), status: "pending" };
  journal(entry);
  console.log(`${label}: ${entry.url || tx.hash} (waiting for ${chain.confirmations} confirmation(s))`);
  const receipt = await tx.wait(chain.confirmations, chain.timeout);
  if (!receipt || receipt.status !== 1) throw new Error(`${label}: transaction did not succeed`);
  Object.assign(entry, { status: "confirmed", blockNumber: receipt.blockNumber, confirmations: chain.confirmations });
  journal(entry);
  return receipt;
}
function eventFrom(receipt, contract, name, swapId) {
  const found = receipt.logs.filter((log) => log.address.toLowerCase() === contract.target.toLowerCase()).map((log) => {
    try { return contract.interface.parseLog(log); } catch { return null; }
  }).filter((event) => event?.name === name && event.args.swapId === swapId);
  if (found.length !== 1) throw new Error(`Expected one ${name} event for the specified swap`);
  return found[0].args;
}
module.exports = { ROOT, integer, settings, artifact, writeJson, readJson, errorMessage, assertChain, assertCode, compareBytecode, contexts, close, confirmed, eventFrom, txUrl };
