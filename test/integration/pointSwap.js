// Challenge Part: acceptance test for scripts/lib/pointProtocol.js on two independent local chains.
// Run: npx hardhat compile && node test/integration/pointSwap.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { ethers } = require("ethers");
const { artifact, close } = require("../../scripts/lib/runtime");
const { N, randomScalar, lockOf, pointOf } = require("../../scripts/lib/pointLock");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CHAINS = { sepolia: "ERC20PointHTLC", arbitrumSepolia: "ETHPointHTLC" };

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
function claimedScalar(chain, receipt) {
  return receipt.logs.map((log) => { try { return chain.htlc.interface.parseLog(log); } catch { return null; } })
    .find((event) => event?.name === "SwapClaimed").args.secret;
}
async function main() {
  // Required here so that `npx hardhat test` (which loads every file under test/) still runs before the coordinator exists.
  const { runPointSwap, pointArtifact } = require("../../scripts/lib/pointProtocol");
  const processes = [];
  const chains = {};
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rain-point-test-"));
  try {
    for (const [index, [key, contract]] of Object.entries(Object.entries(CHAINS))) {
      const chainId = 31337 + Number(index);
      const port = await freePort();
      const child = spawn(process.execPath, [require.resolve("hardhat/internal/cli/cli.js"), "node", "--hostname", "127.0.0.1", "--port", String(port)], {
        cwd: path.resolve(__dirname, "../.."), env: { ...process.env, HTLC_LOCAL_CHAIN_ID: String(chainId) },
        stdio: "ignore", windowsHide: true,
      });
      processes.push(child);
      const request = new ethers.FetchRequest(`http://127.0.0.1:${port}`);
      request.timeout = 1000;
      const provider = new ethers.JsonRpcProvider(request, undefined, { cacheTimeout: -1 });
      provider.pollingInterval = 50;
      const chain = { key, contract, chainId, name: `Local ${key}`, provider, explorer: null, confirmations: 1, timeout: 20000 };
      chains[key] = chain;
      let ready = false;
      for (let attempt = 0; attempt < 150; attempt++) {
        if (child.exitCode !== null) throw new Error("Local node exited during startup");
        try { ready = Number(await provider.send("eth_chainId", [])) === chainId; } catch { /* node starting */ }
        if (ready) break;
        await pause(100);
      }
      assert(ready, "Local node failed to start");
      chain.alice = new ethers.NonceManager(await provider.getSigner(0));
      chain.bob = new ethers.NonceManager(await provider.getSigner(1));
      const compiled = pointArtifact(contract);
      const deployed = await new ethers.ContractFactory(compiled.abi, compiled.bytecode, chain.alice).deploy();
      await deployed.waitForDeployment();
      chain.address = deployed.target;
      chain.htlc = new ethers.Contract(deployed.target, compiled.abi, provider);
    }
    const first = chains.sepolia;
    const second = chains.arbitrumSepolia;
    const bob = await first.bob.getAddress();
    const tokenArtifact = artifact("TestToken");
    const token = await new ethers.ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, first.alice)
      .deploy(await first.alice.getAddress(), ethers.parseUnits("1000", 18));
    await token.waitForDeployment();
    const options = { rainAddress: token.target, rainAmount: "100", ethAmount: "0.001", rainSeconds: 1200, ethSeconds: 600, minGap: 120, minWindow: 30 };
    const output = { runDir: path.join(directory, "runs"), secretDir: path.join(directory, "secrets") };
    const readRun = (id) => fs.readFileSync(path.join(output.runDir, `${id}.json`), "utf8");
    const incomplete = () => fs.readdirSync(output.runDir).map((file) => JSON.parse(fs.readFileSync(path.join(output.runDir, file))))
      .filter((run) => run.status === "incomplete");

    // 1. Successful swap.
    const otherHeight = await second.provider.getBlockNumber();
    const before = await token.balanceOf(bob);
    const report = await runPointSwap(chains, options, output);
    assert.equal(report.status, "completed");
    assert.equal(report.mode, "point-lock");
    assert.deepEqual(report.finalStatus, { rain: "Claimed", eth: "Claimed" });
    assert.deepEqual(report.transactions.map((tx) => tx.label), ["Approve Rain", "Lock Rain", "Lock ETH", "Alice claims ETH", "Bob claims Rain"]);
    assert(report.transactions.every((tx) => tx.status === "confirmed"));
    assert.equal(await token.balanceOf(bob) - before, ethers.parseUnits("100", 18));
    assert.equal(await token.balanceOf(first.address), 0n);
    assert.equal(await second.provider.getBalance(second.address), 0n);
    assert.equal(await second.provider.getBlockNumber() - otherHeight, 2, "only ETH lock and claim mine on chain B");

    // CH1: the two chains carry different locks, and the report matches the chain.
    const rainSwap = await first.htlc.swaps(report.rain.swapId);
    const ethSwap = await second.htlc.swaps(report.eth.swapId);
    assert.equal(rainSwap.pointLock, report.rain.pointLock);
    assert.equal(ethSwap.pointLock, report.eth.pointLock);
    assert.notEqual(rainSwap.pointLock, ethSwap.pointLock, "the two chains must not share a lock value");
    assert.notEqual(report.rain.swapId, report.eth.swapId);

    // CH2: the two claims publish different scalars that differ by the private blind.
    const hashOf = (label) => report.transactions.find((tx) => tx.label === label).hash;
    const t = claimedScalar(second, await second.provider.getTransactionReceipt(hashOf("Alice claims ETH")));
    const u = claimedScalar(first, await first.provider.getTransactionReceipt(hashOf("Bob claims Rain")));
    const saved = JSON.parse(fs.readFileSync(path.join(output.secretDir, `${report.runId}.json`)));
    assert.notEqual(t, u, "the two chains must not share a claim value");
    assert.equal(ethers.toBigInt(saved.secret), t, "the private record keeps Alice's scalar");
    assert.equal((t + ethers.toBigInt(saved.offer.blind)) % N, u, "Bob's scalar is t + r");
    assert.equal(lockOf(pointOf(t)), ethSwap.pointLock);
    assert.equal(lockOf(pointOf(u)), rainSwap.pointLock);
    assert.equal(fs.statSync(path.join(output.secretDir, `${report.runId}.json`)).mode & 0o777, 0o600);

    // The public report holds no private scalar: not t, not r, not t + r, in hex or decimal.
    const publicReport = readRun(report.runId).toLowerCase();
    for (const value of [t, ethers.toBigInt(saved.offer.blind), u]) {
      assert(!publicReport.includes(ethers.toBeHex(value, 32).slice(2)), "public run report must not contain a private scalar");
      assert(!publicReport.includes(value.toString()), "public run report must not contain a private scalar");
    }
    assert(!publicReport.includes(saved.offer.ethPoint.slice(4, 68)), "public run report must not contain the ETH point");
    assert(!("hashlock" in report));

    // 2. CH3 failure: Alice sends a wrong blind. Bob must stop before locking ETH.
    let beforeRejected = await second.provider.getBlockNumber();
    await assert.rejects(
      runPointSwap(chains, options, { ...output, sendOffer: (offer) => ({ ...offer, blind: ethers.toBeHex(randomScalar(), 32) }) }),
      /Point-lock offer rejected: token lock is not/);
    assert.equal(await second.provider.getBlockNumber(), beforeRejected, "a wrong blind must not lead to a counter-lock");
    let failed = incomplete();
    assert.equal(failed.length, 1);
    assert.deepEqual(failed[0].transactions.map((tx) => tx.label), ["Approve Rain", "Lock Rain"]);
    assert.equal(failed[0].eth.pointLock, undefined, "no ETH lock was agreed");
    const wrongBlindRun = failed[0];

    // 3. CH3 failure: the Rain lock Bob reads is unrelated to the offer.
    const original = first.htlc;
    const unrelated = lockOf(pointOf(randomScalar()));
    function tampered(contract) {
      return new Proxy(contract, { get(target, property) {
        if (property === "connect") return (signer) => tampered(target.connect(signer));
        if (property === "swaps") return async (id) => {
          const swap = await target.swaps(id);
          return { sender: swap.sender, receiver: swap.receiver, token: swap.token, amount: swap.amount,
            pointLock: unrelated, timelock: swap.timelock, status: swap.status };
        };
        return Reflect.get(target, property);
      } });
    }
    beforeRejected = await second.provider.getBlockNumber();
    first.htlc = tampered(original);
    await assert.rejects(runPointSwap(chains, options, output), /Point-lock offer rejected: token lock is not/);
    first.htlc = original;
    assert.equal(await second.provider.getBlockNumber(), beforeRejected, "an unrelated lock must not lead to a counter-lock");

    // 4. CH3 failure: Alice sends a scalar where the point belongs.
    beforeRejected = await second.provider.getBlockNumber();
    await assert.rejects(
      runPointSwap(chains, options, { ...output, sendOffer: (offer) => ({ ...offer, ethPoint: ethers.toBeHex(randomScalar(), 32) }) }),
      /Point-lock offer rejected: .*not a valid secp256k1 point/);
    assert.equal(await second.provider.getBlockNumber(), beforeRejected, "a malformed point must not lead to a counter-lock");
    failed = incomplete();
    assert.equal(failed.length, 3);
    for (const run of failed) {
      const secret = JSON.parse(fs.readFileSync(path.join(output.secretDir, `${run.runId}.json`)));
      const text = JSON.stringify(run).toLowerCase();
      assert(!text.includes(secret.secret.slice(2)) && !text.includes(secret.offer.blind.slice(2)), "failed run report must not leak scalars");
    }

    // Refunds are preserved: Alice recovers the Rain from a rejected run after its timelock.
    await first.provider.send("evm_setNextBlockTimestamp", [Math.max(...failed.map((run) => run.rain.timelock))]);
    await first.provider.send("evm_mine", []);
    for (const run of failed) await (await original.connect(first.alice).refund(run.rain.swapId)).wait();
    assert.equal((await original.swaps(wrongBlindRun.rain.swapId)).status, 3n);
    assert.equal(await token.balanceOf(original.target), 0n);
    console.log("PASS: point-lock swap on two chains; distinct locks and claim scalars; no private scalar in public reports; wrong blind, unrelated lock and malformed point rejected before the counter-lock; partial locks refunded.");
  } finally {
    close(chains);
    for (const child of processes) {
      const stopped = new Promise((resolve) => { if (child.exitCode !== null) resolve(); else child.once("exit", resolve); });
      child.kill();
      await stopped;
    }
    console.log(`Local-only test evidence: ${directory}`);
  }
}
if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
