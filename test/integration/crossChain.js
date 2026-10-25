// AI-assisted: exercise the production coordinator on two independent local chains.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { ethers } = require("ethers");
const networks = require("../../config/networks");
const { artifact, close } = require("../../scripts/lib/runtime");
const { deployChain } = require("../../scripts/deploy");
const { runSuccessfulSwap, verifyLock, assertTimelocks } = require("../../scripts/lib/protocol");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function main() {
  const processes = [];
  const chains = {};
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rain-htlc-test-"));
  try {
    for (const [index, [key, meta]] of Object.entries(Object.entries(networks))) {
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
      const chain = { ...meta, key, chainId, name: `Local ${key}`, provider, explorer: null, confirmations: 1, timeout: 20000 };
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
    }
    const tokenArtifact = artifact("TestToken");
    const token = await new ethers.ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, chains.sepolia.alice)
      .deploy(await chains.sepolia.alice.getAddress(), ethers.parseUnits("1000", 18));
    await token.waitForDeployment();
    const options = { rainAddress: token.target, rainAmount: "100", ethAmount: "0.001", rainSeconds: 1200, ethSeconds: 600, minGap: 120, minWindow: 30 };
    for (const chain of Object.values(chains)) {
      const record = await deployChain(chain, options, path.join(directory, "deployments"));
      chain.address = record.address;
      chain.htlc = new ethers.Contract(record.address, artifact(chain.contract).abi, chain.provider);
      assert.equal((await deployChain(chain, options, path.join(directory, "deployments"))).address, record.address);
    }
    const output = { runDir: path.join(directory, "runs"), secretDir: path.join(directory, "secrets") };
    assert.throws(() => assertTimelocks(1000, 950, 0, 0, options), /gap/);
    assert.throws(() => assertTimelocks(1200, 600, 1199, 599, options), /gap|window/);
    const otherHeight = await chains.arbitrumSepolia.provider.getBlockNumber();
    const tokenBalanceBefore = await token.balanceOf(await chains.sepolia.bob.getAddress());
    const report = await runSuccessfulSwap(chains, options, output);
    assert.equal(report.status, "completed");
    assert.deepEqual(report.finalStatus, { rain: "Claimed", eth: "Claimed" });
    assert.equal(report.transactions.length, 5);
    assert(report.transactions.every((tx) => tx.status === "confirmed" && tx.url === null));
    assert.equal(await token.balanceOf(await chains.sepolia.bob.getAddress()) - tokenBalanceBefore, ethers.parseUnits("100", 18));
    assert.equal(await chains.sepolia.provider.getBalance(chains.sepolia.address), 0n);
    assert.equal(await chains.arbitrumSepolia.provider.getBalance(chains.arbitrumSepolia.address), 0n);
    assert.equal(await chains.arbitrumSepolia.provider.getBlockNumber() - otherHeight, 2, "only ETH lock and claim mine on chain B");
    const secret = JSON.parse(fs.readFileSync(path.join(output.secretDir, `${report.runId}.json`)));
    const publicReport = fs.readFileSync(path.join(output.runDir, `${report.runId}.json`), "utf8");
    assert(!publicReport.includes(secret.preimage), "public run report must not contain the secret");
    const claimTx = report.transactions.find((tx) => tx.label === "Alice claims ETH");
    const receipt = await chains.arbitrumSepolia.provider.getTransactionReceipt(claimTx.hash);
    const event = receipt.logs.map((log) => { try { return chains.arbitrumSepolia.htlc.interface.parseLog(log); } catch { return null; } }).find((event) => event?.name === "SwapClaimed");
    assert.equal(event.args.preimage, secret.preimage, "secret must be recoverable from the claim event");
    await assert.rejects(verifyLock(chains.sepolia.htlc, report.rain.swapId, { amount: 1n }), /mismatch/);
    // A second run must allocate new swap IDs and complete against the same deployments.
    const repeated = await runSuccessfulSwap(chains, options, output);
    assert.notEqual(repeated.rain.swapId, report.rain.swapId);
    assert.equal(repeated.status, "completed");
    // Tamper with the first-chain read seen by Bob; the coordinator must stop
    // after the Rain lock, before Bob commits ETH or Alice exposes the secret.
    const original = chains.sepolia.htlc;
    function tampered(contract) {
      return new Proxy(contract, { get(target, property) {
        if (property === "connect") return (signer) => tampered(target.connect(signer));
        if (property === "swaps") return async (id) => {
          const swap = await target.swaps(id);
          return { sender: swap.sender, receiver: swap.receiver, token: swap.token, amount: swap.amount + 1n,
            hashlock: swap.hashlock, timelock: swap.timelock, status: swap.status };
        };
        return Reflect.get(target, property);
      } });
    }
    const beforeRejectedLock = await chains.arbitrumSepolia.provider.getBlockNumber();
    chains.sepolia.htlc = tampered(original);
    await assert.rejects(runSuccessfulSwap(chains, options, output), /Counterparty lock mismatch: amount/);
    chains.sepolia.htlc = original;
    assert.equal(await chains.arbitrumSepolia.provider.getBlockNumber(), beforeRejectedLock, "mismatch must not submit a counter-lock");
    const failed = fs.readdirSync(output.runDir).map((file) => JSON.parse(fs.readFileSync(path.join(output.runDir, file))))
      .find((run) => run.status === "incomplete");
    assert(failed);
    assert.deepEqual(failed.transactions.map((tx) => tx.label), ["Approve Rain", "Lock Rain"]);
    const failedSecret = JSON.parse(fs.readFileSync(path.join(output.secretDir, `${failed.runId}.json`)));
    assert(!JSON.stringify(failed).includes(failedSecret.preimage));
    await chains.sepolia.provider.send("evm_setNextBlockTimestamp", [failed.rain.timelock]);
    await chains.sepolia.provider.send("evm_mine", []);
    await (await original.connect(chains.sepolia.alice).refund(failed.rain.swapId)).wait();
    assert.equal((await original.swaps(failed.rain.swapId)).status, 3n);
    assert.equal(await token.balanceOf(original.target), 0n);
    console.log("PASS: independent chains, repeated confirmed swaps, event-derived secret, mismatch rejection before counter-lock, failure journal and refund of the partial lock.");
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
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
