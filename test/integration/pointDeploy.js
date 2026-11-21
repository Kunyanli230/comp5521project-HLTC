// Challenge Part: acceptance test for scripts/pointDeploy.js on two independent local chains.
// Run: npx hardhat compile && node test/integration/pointDeploy.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { ethers } = require("ethers");
const networks = require("../../config/networks");
const { ROOT, artifact, close } = require("../../scripts/lib/runtime");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function main() {
  // Required here so that `npx hardhat test` (which loads every file under test/) still runs before the module exists.
  const { runPointSwap, pointArtifact } = require("../../scripts/lib/pointProtocol");
  const { POINT_CONTRACTS, POINT_DEPLOYMENTS, deployPointChain, bindPointChain } = require("../../scripts/pointDeploy");
  const processes = [];
  const chains = {};
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rain-point-deploy-"));
  const records = path.join(directory, "deployments");
  const scratch = (name) => { const dir = path.join(directory, name); fs.mkdirSync(dir, { recursive: true }); return dir; };
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
      // Same shape as runtime.contexts(env, false): metadata of the basic contracts, no address, no htlc.
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
    const first = chains.sepolia;
    const second = chains.arbitrumSepolia;
    const tokenArtifact = artifact("TestToken");
    const token = await new ethers.ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, first.alice)
      .deploy(await first.alice.getAddress(), ethers.parseUnits("1000", 18));
    await token.waitForDeployment();
    const options = { rainAddress: token.target, rainAmount: "100", ethAmount: "0.001", rainSeconds: 1200, ethSeconds: 600, minGap: 120, minWindow: 30 };

    // 0. Naming: the point-lock records live apart from the basic deployment records.
    assert.deepEqual(POINT_CONTRACTS, { sepolia: "ERC20PointHTLC", arbitrumSepolia: "ETHPointHTLC" });
    assert.notEqual(path.resolve(POINT_DEPLOYMENTS), path.join(ROOT, "deployments"), "point-lock records need their own directory");
    assert(path.resolve(POINT_DEPLOYMENTS).startsWith(path.join(ROOT, "deployments") + path.sep), "keep the records under deployments/");

    // 1. Nothing deployed yet: binding must refuse rather than guess an address.
    await assert.rejects(bindPointChain(first, records), /deploy ERC20PointHTLC first/i);
    assert.equal(first.htlc, undefined);

    // 2. Deployment writes a confirmed public record per chain.
    const deployed = {};
    for (const chain of [first, second]) {
      const name = POINT_CONTRACTS[chain.key];
      const record = await deployPointChain(chain, options, records);
      deployed[chain.key] = record;
      const onDisk = JSON.parse(fs.readFileSync(path.join(records, `${chain.key}.json`), "utf8"));
      assert.deepEqual(onDisk, JSON.parse(JSON.stringify(record)), "the returned record is the one on disk");
      assert.equal(record.contract, name);
      assert.equal(record.network, chain.key);
      assert.equal(record.chainId, chain.chainId);
      assert.equal(record.status, "confirmed");
      assert.equal(record.transaction.status, "confirmed");
      assert.equal(record.transaction.label, `Deploy ${name}`);
      assert.equal(record.deployer, await chain.alice.getAddress());
      assert.equal(record.rainAddress, token.target);
      assert.equal(await chain.provider.getCode(record.address), pointArtifact(name).deployedBytecode);
      assert(!/private|secret|https?:/i.test(JSON.stringify(onDisk)), "records hold no keys, secrets or RPC URLs");
      assert(!fs.existsSync(path.join(records, `${chain.key}.json.tmp`)));
    }
    assert.deepEqual(fs.readdirSync(records).sort(), ["arbitrumSepolia.json", "sepolia.json"]);

    // 3. A second run reuses the confirmed deployment and sends nothing.
    for (const chain of [first, second]) {
      const height = await chain.provider.getBlockNumber();
      assert.equal((await deployPointChain(chain, options, records)).address, deployed[chain.key].address);
      assert.equal(await chain.provider.getBlockNumber(), height, "reuse must not send a transaction");
    }

    // 4. An unconfirmed record blocks redeployment.
    const pendingDir = scratch("pending");
    fs.writeFileSync(path.join(pendingDir, "sepolia.json"), JSON.stringify({ ...deployed.sepolia, status: "pending" }));
    let height = await first.provider.getBlockNumber();
    await assert.rejects(deployPointChain(first, options, pendingDir), /unresolved deployment/);
    await assert.rejects(bindPointChain(first, pendingDir), /deploy ERC20PointHTLC first/i);
    assert.equal(await first.provider.getBlockNumber(), height);

    // 5. A record of the basic contract (the easy mistake: pointing at deployments/) is refused, and left untouched.
    const basicDir = scratch("basic");
    const basicRecord = JSON.stringify({ ...deployed.sepolia, contract: "ERC20HTLC" });
    fs.writeFileSync(path.join(basicDir, "sepolia.json"), basicRecord);
    await assert.rejects(deployPointChain(first, options, basicDir), /incompatible deployment record/);
    await assert.rejects(bindPointChain(first, basicDir), /incompatible deployment record/);
    assert.equal(fs.readFileSync(path.join(basicDir, "sepolia.json"), "utf8"), basicRecord);

    // 6. A record from another chain is refused.
    const chainDir = scratch("chain");
    fs.writeFileSync(path.join(chainDir, "sepolia.json"), JSON.stringify({ ...deployed.sepolia, chainId: 11155111 }));
    await assert.rejects(deployPointChain(first, options, chainDir), /incompatible deployment record/);
    await assert.rejects(bindPointChain(first, chainDir), /incompatible deployment record/);

    // 7. A record whose address holds different code is refused: here the basic ERC20HTLC, then an empty address.
    const basicArtifact = artifact("ERC20HTLC");
    const basic = await new ethers.ContractFactory(basicArtifact.abi, basicArtifact.bytecode, first.alice).deploy();
    await basic.waitForDeployment();
    const codeDir = scratch("code");
    for (const address of [basic.target, ethers.Wallet.createRandom().address]) {
      fs.writeFileSync(path.join(codeDir, "sepolia.json"), JSON.stringify({ ...deployed.sepolia, address }));
      height = await first.provider.getBlockNumber();
      await assert.rejects(deployPointChain(first, options, codeDir), /deployment check failed/);
      await assert.rejects(bindPointChain(first, codeDir), /deployment check failed/);
      assert.equal(await first.provider.getBlockNumber(), height);
    }
    assert.equal(first.htlc, undefined, "a failed bind leaves the chain unbound");
    assert.equal(first.address, undefined);

    // 8. Binding turns the contexts(env, false) chains into what runPointSwap expects.
    for (const chain of [first, second]) {
      const bound = await bindPointChain(chain, records);
      assert.equal(bound, chain);
      assert.equal(chain.contract, POINT_CONTRACTS[chain.key]);
      assert.equal(chain.address, deployed[chain.key].address);
      assert.equal(chain.htlc.target, deployed[chain.key].address);
      assert(chain.htlc.interface.getFunction("claim").inputs[1].type === "uint256", "bound with the point-lock ABI");
    }
    const report = await runPointSwap(chains, options, { runDir: path.join(directory, "runs"), secretDir: path.join(directory, "secrets") });
    assert.equal(report.status, "completed");
    assert.equal(report.rain.contract, deployed.sepolia.address);
    assert.equal(report.eth.contract, deployed.arbitrumSepolia.address);

    // 9. The repository's public deployment records were not touched by any of this.
    assert(!fs.existsSync(path.join(ROOT, "deployments", "point", "sepolia.json"))
      || JSON.parse(fs.readFileSync(path.join(ROOT, "deployments", "point", "sepolia.json"))).chainId === 11155111,
      "local test records must never land in the repository");
    console.log("PASS: point-lock deployment recorded and reused; pending, basic-contract, wrong-chain and wrong-code records refused; bound chains complete a point-lock swap.");
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
