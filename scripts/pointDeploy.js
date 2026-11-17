// Point-lock deployment and binding. Only public deployment data goes in these records.
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");
const { ROOT, contexts, close, readJson, writeJson, compareBytecode, assertChain, confirmed, errorMessage } = require("./lib/runtime");
const { pointArtifact } = require("./lib/pointProtocol");

const POINT_CONTRACTS = Object.freeze({ sepolia: "ERC20PointHTLC", arbitrumSepolia: "ETHPointHTLC" });
const POINT_DEPLOYMENTS = path.join(ROOT, "deployments", "point");

function deploymentFor(chain, directory) {
  if (!Object.hasOwn(POINT_CONTRACTS, chain.key)) throw new Error(chain.key + ": unknown point-lock network");
  const name = POINT_CONTRACTS[chain.key];
  const file = path.join(directory, chain.key + ".json");
  const record = readJson(file);
  if (record !== null && (record.chainId !== chain.chainId || record.contract !== name)) {
    throw new Error(chain.key + ": incompatible deployment record");
  }
  return { name, file, record };
}

async function checkCode(chain, address, name, compiled) {
  if (!ethers.isAddress(address)) throw new Error(name + " deployment check failed: invalid address");
  const actual = await chain.provider.getCode(address);
  const result = compareBytecode(actual, compiled.deployedBytecode);
  if (result.match === "mismatch") throw new Error(name + " deployment check failed: " + result.reason);
  if (result.match === "metadata-only") console.warn(chain.key + ": " + name + " compiler metadata differs");
}

async function deployPointChain(chain, options, directory = POINT_DEPLOYMENTS) {
  const { name, file, record } = deploymentFor(chain, directory);
  await assertChain(chain);
  if (record && record.status !== "confirmed") {
    const hash = record.transaction?.hash || "(transaction hash unavailable)";
    throw new Error(chain.key + ": unresolved deployment " + hash + "; inspect it before redeploying");
  }
  const compiled = pointArtifact(name);
  if (record) {
    await checkCode(chain, record.address, name, compiled);
    return record;
  }

  const deployer = await chain.alice.getAddress();
  const pending = {
    schemaVersion: 1, mode: "point-lock", network: chain.key, chainId: chain.chainId, contract: name,
    rpcEnv: chain.rpcEnv, explorer: chain.explorer, deployer,
    accounts: { alice: deployer, bob: await chain.bob.getAddress() },
    rainAddress: options.rainAddress, status: "pending", createdAt: new Date().toISOString(),
  };
  const factory = new ethers.ContractFactory(compiled.abi, compiled.bytecode, chain.alice);
  // Reserve before broadcasting so concurrent invocations cannot both deploy.
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(pending, null, 2) + "\n", { flag: "wx" });
  const contract = await factory.deploy();
  pending.address = await contract.getAddress();
  await confirmed(chain, contract.deploymentTransaction(), "Deploy " + name, (transaction) => {
    pending.transaction = transaction;
    writeJson(file, pending);
  });
  await checkCode(chain, pending.address, name, compiled);
  pending.status = "confirmed";
  writeJson(file, pending);
  console.log(chain.key + ": " + name + " at " + pending.address);
  return pending;
}

async function bindPointChain(chain, directory = POINT_DEPLOYMENTS) {
  const { name, record } = deploymentFor(chain, directory);
  if (record?.status !== "confirmed" || !ethers.isAddress(record.address)) {
    throw new Error(chain.key + ": deploy " + name + " first");
  }
  await assertChain(chain);
  const address = ethers.getAddress(record.address);
  const compiled = pointArtifact(name);
  await checkCode(chain, address, name, compiled);
  const htlc = new ethers.Contract(address, compiled.abi, chain.provider);
  return Object.assign(chain, { contract: name, address, htlc });
}

async function main() {
  const { chains, options } = await contexts(process.env, false);
  try {
    for (const chain of Object.values(chains)) {
      if (await chain.provider.getBalance(await chain.alice.getAddress()) === 0n) {
        throw new Error(chain.name + ": Alice needs test ETH for deployment gas");
      }
    }
    for (const chain of Object.values(chains)) await deployPointChain(chain, options);
  } finally {
    close(chains);
  }
}

if (require.main === module) main().catch((error) => { console.error(errorMessage(error)); process.exitCode = 1; });
module.exports = { POINT_CONTRACTS, POINT_DEPLOYMENTS, deployPointChain, bindPointChain };
