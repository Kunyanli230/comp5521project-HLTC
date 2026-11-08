// Local-only integration: two independent RPC chains, real HTTP requests and mined transactions.
// Test signers exist only on the local Hardhat nodes; no public transaction or MetaMask is automated.
import assert from "node:assert/strict";
import net from "node:net";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { ethers } from "ethers";
import { createCoordinator } from "../../scripts/lib/webCoordinator.mjs";
import { createApiServer } from "../../scripts/serveFrontend.mjs";
import runtime from "../../scripts/lib/runtime.js";

const require = createRequire(import.meta.url);
const cbor = require("cbor");
export async function main() {
  const children = [], chains = {};
  const deploymentWarnings = [];
  let server;
  let checks = 0;
  const pass = () => { checks++; };
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function port() {
    const listener = net.createServer();
    await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
    const value = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    return value;
  }

  try {
    for (const [asset, chainId, name] of [["rain", 11155111, "ERC20HTLC"], ["eth", 421614, "ETHHTLC"]]) {
      const localPort = await port();
      const child = spawn(process.execPath, [require.resolve("hardhat/internal/cli/cli.js"), "node",
        "--hostname", "127.0.0.1", "--port", String(localPort)], {
        cwd: runtime.ROOT, env: { ...process.env, HTLC_LOCAL_CHAIN_ID: String(chainId) },
        stdio: "ignore", windowsHide: true
      });
      children.push(child);
      const request = new ethers.FetchRequest("http://127.0.0.1:" + localPort);
      request.timeout = 1000;
      const provider = new ethers.JsonRpcProvider(request, undefined, { cacheTimeout: -1 });
      provider.pollingInterval = 50;
      const chain = { provider, chainId, name: "Local " + asset, key: asset,
        contract: name, confirmations: 2, timeout: 15000, explorer: null };
      chains[asset] = chain;
      let ready = false;
      for (let attempt = 0; attempt < 150; attempt++) {
        if (child.exitCode !== null) throw new Error("Local node exited during startup.");
        try { ready = Number(await provider.send("eth_chainId", [])) === chainId; } catch { /* starting */ }
        if (ready) break;
        await pause(100);
      }
      assert(ready);
      chain.alice = await provider.getSigner(0);
      chain.bob = await provider.getSigner(1);
      const artifact = runtime.artifact(name);
      const deployed = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, chain.alice).deploy();
      await deployed.waitForDeployment();
      chain.address = deployed.target;
      chain.htlc = deployed.connect(provider);
      const bytes = Buffer.from((await provider.getCode(chain.address)).slice(2), "hex");
      const start = bytes.length - 2 - bytes.readUInt16BE(bytes.length - 2);
      const data = cbor.decodeFirstSync(bytes.subarray(start, -2));
      data.ipfs[2] ^= 1;
      const encoded = cbor.encode(data), length = Buffer.alloc(2);
      length.writeUInt16BE(encoded.length);
      await provider.send("hardhat_setCode", [chain.address,
        "0x" + Buffer.concat([bytes.subarray(0, start), encoded, length]).toString("hex")]);
      const checked = await runtime.assertCode(chain, chain.address, name);
      assert.equal(checked.match, "metadata-only");
      deploymentWarnings.push(checked.warning);
      pass();
    }
    const compiled = runtime.artifact("TestToken");
    const alice = await chains.rain.alice.getAddress(), bob = await chains.rain.bob.getAddress();
    const token = await new ethers.ContractFactory(compiled.abi, compiled.bytecode, chains.rain.alice)
      .deploy(alice, ethers.parseEther("100"));
    await token.waitForDeployment();
    server = createApiServer(createCoordinator(chains, token.target, undefined, [], deploymentWarnings));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = "http://127.0.0.1:" + server.address().port;
    async function call(route, body, headers = {}) {
      const response = await fetch(base + "/api/" + route, { method: "POST",
        headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      return value;
    }
    function draft() {
      const preimage = ethers.hexlify(ethers.randomBytes(32));
      return { preimage, setup: { schemaVersion: 1, type: "rain-eth-htlc-public", alice, bob,
        rainSwapId: ethers.hexlify(ethers.randomBytes(32)), ethSwapId: ethers.hexlify(ethers.randomBytes(32)),
        hashlock: ethers.keccak256(preimage), rainAmount: "1", ethAmount: "0.001",
        rainSeconds: "1200", ethSeconds: "300", rainChainId: 11155111, ethChainId: 421614,
        rainToken: token.target, rainHtlc: chains.rain.address, ethHtlc: chains.eth.address, ethClaimTxHash: "" } };
    }
    async function prepare(action, setup, extras = {}) {
      const actor = ["lock-eth", "claim-rain", "refund-eth"].includes(action) ? bob : alice;
      return call("prepare", { action, setup, actor, ...extras });
    }
    async function send(action, setup, extras = {}) {
      const plan = await prepare(action, setup, extras);
      const chain = chains[plan.asset];
      const signer = plan.sender === alice ? chain.alice : chain.bob;
      const tx = await signer.sendTransaction(plan.transaction);
      await tx.wait();
      await chain.provider.send("evm_mine", []);
      const result = await call("confirm", { action, setup, hash: tx.hash });
      assert.equal(result.status, "confirmed");
      pass();
      return tx.hash;
    }
    async function read(setup) { return call("snapshot", { lookup: setup, setup }); }

    const health = await (await fetch(base + "/api/health")).json();
    assert.equal(health.status, "ready");
    assert.deepEqual(health.deploymentWarnings, deploymentWarnings); pass();
    const first = draft();
    const initial = await read(first.setup);
    assert.equal(initial.workflow.lockRain, true);
    assert.deepEqual(initial.deploymentWarnings, deploymentWarnings); pass();
    await assert.rejects(call("prepare", { action: "send-arbitrary", setup: first.setup, actor: alice }), /Unsupported/); pass();
    await assert.rejects(call("snapshot", { lookup: first.setup }, { Origin: "https://foreign.example" }), /origin/); pass();
    await assert.rejects(read({ ...first.setup, rainHtlc: bob }), /deployed/); pass();
    await assert.rejects(prepare("lock-rain", first.setup), /allowance/); pass();
    await send("approve-rain", first.setup, { approvalAmount: "10" });
    const height = await chains.rain.provider.getBlockNumber();
    const candidate = await prepare("lock-rain", first.setup);
    assert.equal(candidate.value, "0");
    assert.equal(await chains.rain.provider.getBlockNumber(), height, "prepare must never mine or broadcast"); pass();
    await send("lock-rain", first.setup);
    await assert.rejects(prepare("lock-rain", first.setup), /already exists/); pass();
    await assert.rejects(prepare("lock-eth", { ...first.setup, rainAmount: "2" }), /mismatch/); pass();
    await assert.rejects(call("prepare", { action: "refund-rain", setup: first.setup, actor: bob }), /RefundNotReady/); pass();
    await send("lock-eth", first.setup);
    assert.equal((await read(first.setup)).workflow.claimEth, true); pass();
    await assert.rejects(prepare("claim-eth", first.setup, { preimage: ethers.ZeroHash }), /backup/); pass();
    const claimHash = await send("claim-eth", first.setup, { preimage: first.preimage });
    first.setup.ethClaimTxHash = claimHash;
    await assert.rejects(call("confirm", { action: "refund-eth", setup: first.setup, hash: claimHash }), /different operation/); pass();
    await send("claim-rain", first.setup);
    const complete = await read(first.setup);
    assert.equal(complete.workflow.phase, "Completed");
    assert.equal(await token.balanceOf(bob), ethers.parseEther("1")); pass();
    assert.equal(JSON.stringify(complete).includes(first.preimage), false, "snapshots never expose private or event-derived secrets"); pass();
    await assert.rejects(prepare("refund-rain", first.setup), /AlreadyCompleted/); pass();

    const second = draft();
    await send("lock-rain", second.setup);
    await send("lock-eth", second.setup);
    const locks = await read(second.setup);
    for (const asset of ["eth", "rain"]) {
      await chains[asset].provider.send("evm_setNextBlockTimestamp", [Number(locks[asset].swap.timelock)]);
      await chains[asset].provider.send("evm_mine", []);
    }
    await assert.rejects(call("prepare", { action: "refund-rain", setup: second.setup, actor: bob }), /designated/); pass();
    await send("refund-eth", second.setup);
    await send("refund-rain", second.setup);
    assert.equal((await read(second.setup)).workflow.phase, "Refunded"); pass();
    await assert.rejects(prepare("refund-eth", second.setup), /AlreadyCompleted/); pass();
    const readOnly = createCoordinator(chains, token.target, undefined, ["Deployment review required"]);
    const blockedSetup = draft().setup;
    const blocked = await readOnly.snapshot(blockedSetup, blockedSetup);
    assert.equal(blocked.workflow.phase, "Deployment review required");
    assert.equal(blocked.workflow.lockRain, false);
    assert.equal(blocked.workflow.claimEth, false);
    assert.equal(blocked.workflow.refundEth, false); pass();
    assert.equal((await readOnly.snapshot(second.setup, second.setup)).workflow.phase, "Refunded"); pass();
    await assert.rejects(readOnly.prepare({ action: "lock-rain", setup: draft().setup, actor: alice }), /Deployment review/); pass();
    console.log("PASS: " + checks + " local HTTP/coordinator checks, success and bilateral refund. No public transactions.");
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    runtime.close(chains);
    for (const child of children) {
      const stopped = new Promise((resolve) => child.exitCode !== null ? resolve() : child.once("exit", resolve));
      child.kill();
      await stopped;
    }
  }

}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
