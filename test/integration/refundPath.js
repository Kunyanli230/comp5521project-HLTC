// AI-assisted B3/B4 integration tests; setup adapted from crossChain.js.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { ethers } = require("ethers");
const networks = require("../../config/networks");
const { ROOT, artifact, close, errorMessage } = require("../../scripts/lib/runtime");
const { deployChain } = require("../../scripts/deploy");
const { runSuccessfulSwap } = require("../../scripts/lib/protocol");
const { readSide, findRevealedPreimage, pickSigner, refundIfAllowed, loadRun, makeJournal } = require("../../scripts/lib/recovery");
const { readStatus, printStatus } = require("../../scripts/status");
const { refundRun } = require("../../scripts/refund");
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
  fs.mkdirSync(path.join(ROOT, ".local"), { recursive: true });
  const directory = fs.mkdtempSync(path.join(ROOT, ".local/refund-test-"));
  try {
    for (const [index, [key, meta]] of Object.entries(Object.entries(networks))) {
      const chainId = 31337 + Number(index);
      const port = await freePort();
      const child = spawn(process.execPath, [require.resolve("hardhat/internal/cli/cli.js"), "node", "--hostname", "127.0.0.1", "--port", String(port)], {
        cwd: ROOT, env: { ...process.env, HTLC_LOCAL_CHAIN_ID: String(chainId) },
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
    const compiled = artifact("TestToken");
    const token = await new ethers.ContractFactory(compiled.abi, compiled.bytecode, chains.sepolia.alice)
      .deploy(await chains.sepolia.alice.getAddress(), ethers.parseUnits("1000", 18));
    await token.waitForDeployment();
    const options = { rainAddress: token.target, rainAmount: "100", ethAmount: "0.001", rainSeconds: 1200, ethSeconds: 600, minGap: 120, minWindow: 30 };
    for (const chain of Object.values(chains)) {
      const record = await deployChain(chain, options, path.join(directory, "deployments"));
      chain.address = record.address;
      chain.htlc = new ethers.Contract(record.address, artifact(chain.contract).abi, chain.provider);
    }
    const output = { runDir: path.join(directory, "runs"), secretDir: path.join(directory, "secrets"), stopAfterLocks: true };
    const alice = await chains.sepolia.alice.getAddress();
    const balanceBefore = await token.balanceOf(alice);
    const report = await runSuccessfulSwap(chains, options, output);
    assert.equal(report.status, "locked");
    assert.deepEqual(report.transactions.map((tx) => tx.label), ["Approve Rain", "Lock Rain", "Lock ETH"]);
    assert.equal((await chains.sepolia.htlc.swaps(report.rain.swapId)).status, 1n);
    assert.equal((await chains.arbitrumSepolia.htlc.swaps(report.eth.swapId)).status, 1n);
    const rain = chains.sepolia, eth = chains.arbitrumSepolia;
    const runFile = path.join(output.runDir, `${report.runId}.json`);
    const loaded = loadRun(runFile, chains);
    const journal = makeJournal(loaded.runFile, loaded.run);
    assert.equal(loaded.run.runId, report.runId);
    assert.throws(() => loadRun(runFile, { ...chains, sepolia: { ...rain, address: ethers.ZeroAddress } }), /deployment|部署/i);
    assert.equal((await pickSigner(eth, await eth.htlc.swaps(report.eth.swapId))).role, "bob");
    assert.equal((await pickSigner(rain, await rain.htlc.swaps(report.rain.swapId))).role, "alice");
    await assert.rejects(pickSigner(eth, { sender: await eth.provider.getSigner(2).then((signer) => signer.getAddress()) }), /sender/);
    const before = await eth.provider.getBlockNumber();
    const active = await readSide(eth, report.eth.swapId, options.minWindow);
    assert.equal(active.state, "CLAIMABLE");
    assert.equal(active.now, (await eth.provider.getBlock("latest")).timestamp);
    const runBeforeStatus = fs.readFileSync(runFile, "utf8");
    const initialStatus = await readStatus(chains, options, loaded.run);
    assert.equal(initialStatus.rain.state, "CLAIMABLE");
    assert.equal(initialStatus.eth.state, "CLAIMABLE");
    assert.equal(initialStatus.preimageKnown, false);
    assert.equal(initialStatus.preimage, null);
    assert.equal(fs.readFileSync(runFile, "utf8"), runBeforeStatus, "status must not write the record");
    assert.equal((await refundRun(chains, options, runFile, loaded.run, "auto")).exitCode, 2);
    const early = await refundIfAllowed(eth, report.eth.swapId, options.minWindow, journal);
    assert.equal(early.refunded, false);
    assert.match(early.reason, /RefundNotReady/);
    assert.equal((await refundIfAllowed(eth, ethers.id("missing"), options.minWindow, journal)).refunded, false);
    assert.equal(await eth.provider.getBlockNumber(), before, "early/missing refunds must not send a transaction");
    const fromBlock = report.transactions.find((tx) => tx.label === "Lock ETH").blockNumber;
    assert.equal(await findRevealedPreimage(eth, report.eth.swapId, fromBlock), null);

    await eth.provider.send("evm_setNextBlockTimestamp", [report.eth.timelock]);
    await eth.provider.send("evm_mine", []);
    const expiredBlock = await eth.provider.getBlock("latest");
    assert.equal((await readSide(eth, report.eth.swapId, options.minWindow)).remaining, 0);
    const auto = await refundRun(chains, options, runFile, loaded.run, "auto");
    assert.equal(auto.exitCode, 2, "Rain is still active although ETH is refundable");
    const ethRefund = auto.results.eth;
    assert.equal(ethRefund.refunded, true);
    assert.equal((await eth.htlc.swaps(report.eth.swapId)).status, 3n);
    const afterRefund = await eth.provider.getBlockNumber();
    assert.equal((await refundIfAllowed(eth, report.eth.swapId, options.minWindow, journal)).refunded, false);
    // A snapshot read can race a completion; the real contract's static call must stop it.
    const stale = { ...eth, provider: { getBlock: async () => expiredBlock } };
    const rejected = await refundIfAllowed(stale, report.eth.swapId, options.minWindow, journal);
    assert.equal(rejected.refunded, false);
    assert.match(rejected.reason, /AlreadyCompleted/);
    assert.equal(await eth.provider.getBlockNumber(), afterRefund, "duplicate and stale refunds must not send a transaction");
    const rainHeight = await rain.provider.getBlockNumber();
    assert.equal((await refundIfAllowed(rain, report.rain.swapId, options.minWindow, journal)).refunded, false);
    assert.equal(await rain.provider.getBlockNumber(), rainHeight);
    assert.equal(await findRevealedPreimage(eth, report.eth.swapId, fromBlock), null);

    await rain.provider.send("evm_setNextBlockTimestamp", [report.rain.timelock]);
    await rain.provider.send("evm_mine", []);
    const rainOutcome = await refundRun(chains, options, runFile, loaded.run, "rain");
    assert.equal(rainOutcome.exitCode, 0);
    assert.equal(rainOutcome.results.rain.refunded, true);
    assert.equal((await rain.htlc.swaps(report.rain.swapId)).status, 3n);
    assert.equal(await token.balanceOf(rain.address), 0n);
    assert.equal(await eth.provider.getBalance(eth.address), 0n);
    assert.equal(await token.balanceOf(alice), balanceBefore);
    const saved = JSON.parse(fs.readFileSync(runFile, "utf8"));
    assert.deepEqual(saved.recovery, { eth: "Refunded", rain: "Refunded" });
    const refunds = saved.transactions.filter((tx) => tx.label.startsWith("Refund "));
    assert.equal(refunds.length, 2, "pending entries must be updated, not duplicated");
    assert(refunds.every((tx) => tx.status === "confirmed"));
    assert(refunds.some((tx) => tx.hash === ethRefund.hash && tx.chainId === eth.chainId));

    const completed = await runSuccessfulSwap(chains, options, { ...output, stopAfterLocks: false });
    const claimFrom = completed.transactions.find((tx) => tx.label === "Lock ETH").blockNumber;
    const revealed = await findRevealedPreimage(eth, completed.eth.swapId, claimFrom);
    assert.equal(ethers.keccak256(revealed), completed.hashlock);
    const claimedHeight = await eth.provider.getBlockNumber();
    assert.equal((await refundIfAllowed(eth, completed.eth.swapId, options.minWindow, journal)).refunded, false);
    assert.equal(await eth.provider.getBlockNumber(), claimedHeight, "claimed locks must not be refunded");
    const completedStatus = await readStatus(chains, options, completed);
    const json = JSON.parse(JSON.stringify(completedStatus));
    assert.equal(json.preimage, revealed);
    assert.equal(ethers.keccak256(json.preimage), json.hashlock);
    printStatus(completedStatus);
    assert.equal(completedStatus.preimageKnown, true);
    assert.equal(completedStatus.rain.state, "CLAIMED");
    assert.deepEqual(completedStatus.rain.actions, []);
    assert.deepEqual(completedStatus.eth.actions, []);
    const unavailable = { ...rain, provider: { getBlock: async () => { throw new Error("RPC unavailable"); } } };
    const errorOutcome = await refundRun({ ...chains, sepolia: unavailable }, options, runFile, loaded.run, "rain");
    assert.equal(errorOutcome.exitCode, 1);
    assert.equal(errorOutcome.results.rain.error, true);
    console.log("PASS: lock-only, exact expiry, sender refunds, no transactions on refusal, stale-read preflight, event-derived secret and recovery journal.");
  } finally {
    close(chains);
    for (const child of processes) {
      const stopped = new Promise((resolve) => { if (child.exitCode !== null) resolve(); else child.once("exit", resolve); });
      child.kill();
      await stopped;
    }
    console.log(`Local-only refund evidence: ${directory}`);
  }
}

if (require.main === module) main().catch((error) => { console.error(errorMessage(error)); process.exitCode = 1; });
