// AI-assisted B3 classification tests; see docs/AI_ASSISTANCE.md.
const { expect } = require("chai");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ethers } = require("ethers");
const { ROOT } = require("../scripts/lib/runtime");
const { classify, advise, findRevealedPreimage, refundIfAllowed, loadRun, makeJournal } = require("../scripts/lib/recovery");

describe("B3 recovery classification", function () {
  const timelock = 1000n;
  const minWindow = 120;

  it("reports an absent swap without offering any action", function () {
    expect(classify({ status: 0n, timelock: 0n }, 1000, minWindow)).to.deep.equal({
      state: "NOT_FOUND", actions: [], remaining: -1000,
    });
  });

  for (const [status, state] of [[2n, "CLAIMED"], [3n, "REFUNDED"]]) {
    for (const now of [999, 1000, 1001]) {
      it(`keeps ${state} terminal at timestamp ${now}`, function () {
        expect(classify({ status, timelock }, now, minWindow)).to.deep.equal({
          state, actions: [], remaining: 1000 - now,
        });
      });
    }
  }

  it("offers only a receiver claim while an active lock has enough time", function () {
    expect(classify({ status: 1n, timelock }, 800, minWindow)).to.deep.equal({
      state: "CLAIMABLE", actions: [{ action: "claim", by: "receiver" }], remaining: 200,
    });
  });

  it("does not warn when the remaining time equals minWindow", function () {
    expect(classify({ status: 1n, timelock }, 880, minWindow)).to.deep.equal({
      state: "CLAIMABLE", actions: [{ action: "claim", by: "receiver" }], remaining: 120,
    });
  });

  for (const [now, remaining] of [[881, 119], [999, 1]]) {
    it(`warns the receiver with ${remaining} seconds left`, function () {
      const view = classify({ status: 1n, timelock }, now, minWindow);
      expect(view.state).to.equal("CLOSING");
      expect(view.remaining).to.equal(remaining);
      expect(view.actions).to.have.lengthOf(1);
      expect(view.actions[0]).to.include({ action: "claim", by: "receiver" });
      expect(view.actions[0].warning).to.be.a("string").and.not.equal("");
    });
  }

  it("remains claimable one second before expiry when minWindow is one", function () {
    expect(classify({ status: 1n, timelock }, 999, 1)).to.deep.equal({
      state: "CLAIMABLE", actions: [{ action: "claim", by: "receiver" }], remaining: 1,
    });
  });

  for (const [now, remaining] of [[1000, 0], [1001, -1]]) {
    it(`offers only a sender refund at timestamp ${now}`, function () {
      expect(classify({ status: 1n, timelock }, now, minWindow)).to.deep.equal({
        state: "REFUNDABLE", actions: [{ action: "refund", by: "sender" }], remaining,
      });
    });
  }

  it("still permits a refund at expiry when minWindow is zero", function () {
    expect(classify({ status: 1n, timelock }, 1000, 0)).to.deep.equal({
      state: "REFUNDABLE", actions: [{ action: "refund", by: "sender" }], remaining: 0,
    });
  });

  it("rejects an unknown status instead of suggesting an action", function () {
    expect(() => classify({ status: 4n, timelock }, 800, minWindow)).to.throw(/status/i);
  });
});

describe("B3 public event lookup", function () {
  const preimage = ethers.id("public secret"), swapId = ethers.id("event lookup");
  function chain(queryFilter, hashlock = ethers.keccak256(preimage)) {
    return { provider: { getBlockNumber: async () => 10002 }, htlc: {
      swaps: async () => ({ hashlock }), filters: { SwapClaimed: () => ({ swapId }) }, queryFilter,
    } };
  }

  it("reduces an RPC-limited range and includes the final block without gaps", async function () {
    // A provider-limit response cannot be reproduced on an unlimited local node.
    let checkedThrough = 1;
    const remote = chain(async (filter, start, end) => {
      expect(filter.swapId).to.equal(swapId);
      if (end - start + 1 > 2000) {
        const error = new Error("provider error");
        error.shortMessage = "could not coalesce error";
        error.error = { message: "maximum block range exceeded" };
        throw error;
      }
      expect(start).to.equal(checkedThrough + 1);
      checkedThrough = end;
      return end === 10002 ? [{ args: { preimage } }] : [];
    });
    expect(await findRevealedPreimage(remote, swapId, 2)).to.equal(preimage);
    expect(checkedThrough).to.equal(10002);
  });

  it("rejects a revealed secret that does not match the on-chain hashlock", async function () {
    const remote = chain(async () => [{ args: { preimage } }], ethers.ZeroHash);
    expect(await findRevealedPreimage(remote, swapId, 10002)).to.equal(null);
  });

  it("propagates an unrelated RPC failure instead of treating it as an absent secret", async function () {
    const error = new Error("connection unavailable");
    let caught;
    try { await findRevealedPreimage(chain(async () => { throw error; }), swapId, 10002); }
    catch (failure) { caught = failure; }
    expect(caught).to.equal(error);
  });
});

describe("B4 run records and command validation", function () {
  const sampleFile = path.join(ROOT, "deployments/successful-swap-2026-10-25.json");
  const sample = JSON.parse(fs.readFileSync(sampleFile, "utf8"));
  const chains = { sepolia: { address: sample.rain.contract, chainId: sample.rain.chainId },
    arbitrumSepolia: { address: sample.eth.contract, chainId: sample.eth.chainId } };
  let directory;
  before(function () {
    fs.mkdirSync(path.join(ROOT, ".local"), { recursive: true });
    directory = fs.mkdtempSync(path.join(ROOT, ".local/recovery-unit-"));
  });
  after(function () { fs.rmSync(directory, { recursive: true, force: true }); });

  it("propagates a preflight RPC outage rather than reporting a normal refund refusal", async function () {
    const error = new Error("RPC unavailable");
    const sender = "0x" + "11".repeat(20);
    // Simulate a transport failure at the contract RPC boundary, not a contract revert.
    const chain = { name: "offline preflight", provider: { getBlock: async () => ({ number: 1, timestamp: 1000 }) },
      alice: { getAddress: async () => sender }, htlc: {
        swaps: async () => ({ sender, status: 1n, timelock: 1000n }),
        connect: () => ({ refund: { staticCall: async () => { throw error; } } }),
      } };
    let caught;
    try { await refundIfAllowed(chain, ethers.id("offline"), 120); }
    catch (failure) { caught = failure; }
    expect(caught).to.equal(error);
  });

  it("validates both configured deployments before returning a run", function () {
    expect(loadRun(sampleFile, chains).run.runId).to.equal(sample.runId);
    expect(() => loadRun(sampleFile, { ...chains, arbitrumSepolia: { ...chains.arbitrumSepolia, chainId: 1 } })).to.throw(/deployment/);
    expect(() => loadRun("../escape", chains)).to.throw(/Invalid runId/);
    expect(() => loadRun(path.join(directory, "missing.json"), chains)).to.throw(/Available runIds/);
  });

  it("updates pending refunds by hash plus chain ID and marks recovery only after confirmation", function () {
    const run = { ...sample, transactions: [] };
    const file = path.join(directory, "journal.json");
    fs.writeFileSync(file, JSON.stringify(run));
    const journal = makeJournal(file, run);
    const eth = { label: "Refund ETH (bob)", network: "arbitrumSepolia", chainId: sample.eth.chainId,
      hash: ethers.id("same hash on independent chains"), status: "pending" };
    journal(eth);
    expect(run.recovery).to.equal(undefined);
    journal({ ...eth, status: "confirmed", blockNumber: 10 });
    const rain = { ...eth, label: "Refund Rain (alice)", network: "sepolia", chainId: sample.rain.chainId };
    journal(rain);
    expect(run.recovery).to.deep.equal({ eth: "Refunded" });
    journal({ ...rain, status: "confirmed", blockNumber: 12 });
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(saved.transactions).to.have.lengthOf(2);
    expect(saved.transactions.map((tx) => tx.blockNumber)).to.deep.equal([10, 12]);
    expect(saved.recovery).to.deep.equal({ eth: "Refunded", rain: "Refunded" });
  });

  it("never mutates the committed deployment sample or its in-memory journal", function () {
    const before = fs.readFileSync(sampleFile, "utf8");
    const run = JSON.parse(before);
    makeJournal(sampleFile, run)({ label: "Refund ETH (bob)", hash: ethers.id("ignored"),
      chainId: run.eth.chainId, network: run.eth.network, status: "confirmed" });
    expect(fs.readFileSync(sampleFile, "utf8")).to.equal(before);
    expect(JSON.stringify(run)).to.equal(JSON.stringify(JSON.parse(before)));
  });

  for (const [script, args] of [["status.js", []], ["status.js", ["run", "--unknown"]],
    ["refund.js", []], ["refund.js", ["run", "both"]]]) {
    it(`rejects invalid ${script} arguments before opening any chain`, function () {
      const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], { encoding: "utf8", timeout: 5000 });
      expect(result.status).to.equal(1);
      expect(result.stderr).to.include("Usage:");
      expect(result.stdout).to.equal("");
    });
  }
});

describe("B3 cross-chain advice", function () {
  it("urgently tells Bob to claim Rain before its deadline after ETH is claimed", function () {
    const rain = { state: "CLAIMABLE", remaining: 200, swap: { timelock: 1000n } };
    const text = advise(rain, { state: "CLAIMED" }, true).join("\n");
    expect(text).to.include("Bob").and.include("Rain").and.include("必须");
    expect(text).to.include("1970-01-01T00:16:40.000Z");
    expect(text).to.include("事件").and.not.include("退款");
  });

  function view(state, remaining = 200) {
    return { state, remaining, swap: { timelock: 1000n } };
  }

  for (const state of ["CLAIMABLE", "CLOSING"]) {
    it(`qualifies Bob's ${state} claim when the public secret has not been verified`, function () {
      const text = advise(view(state), view("CLAIMED"), false).join("\n");
      expect(text).to.include("Bob").and.include("秘密").and.include("核验");
      expect(text).not.to.include("Bob 可以领取");
    });
  }

  for (const state of ["CLAIMABLE", "CLOSING"]) {
    it(`warns Bob about inverted windows when ETH is ${state}`, function () {
      const text = advise(view("REFUNDABLE", 0), view(state), false).join();
      expect(text).to.include("时锁").and.include("风险").and.include("Bob");
      expect(text).to.include("领取 ETH").and.include("退回 Rain");
    });
  }

  it("handles completed swaps without requiring active-lock metadata", function () {
    expect(advise({ state: "CLAIMED" }, { state: "CLAIMED" }, true).join()).to.include("交换完成");
    expect(advise({ state: "REFUNDED" }, { state: "REFUNDED" }, false).join()).to.include("全部退回");
  });

  it("warns about Bob's loss when ETH is claimed and Rain has expired", function () {
    const text = advise(view("REFUNDABLE", -1), view("CLAIMED"), true).join();
    expect(text).to.include("警告").and.include("Bob").and.include("损失");
    expect(text).to.include("Alice 可以退");
    expect(text).not.to.include("Bob 可以领取");
  });

  it("tells Alice that claiming ETH reveals the secret while both locks are active", function () {
    const text = advise(view("CLAIMABLE"), view("CLAIMABLE"), false).join();
    expect(text).to.include("Alice 可以领取 ETH").and.include("公开秘密");
    expect(text).not.to.include("Bob 可以领取");
  });

  it("allows both senders to refund when both independent locks are expired", function () {
    const text = advise(view("REFUNDABLE", -1), view("REFUNDABLE", -10), false).join();
    expect(text).to.include("Bob 可以退").and.include("Alice 可以退");
    expect(text).not.to.include("可以领取");
  });

  for (const rainState of ["CLAIMABLE", "CLOSING"]) {
    for (const ethState of ["REFUNDABLE", "REFUNDED"]) {
      it(`waits for Rain expiry for ${rainState} / ${ethState}`, function () {
        const text = advise(view(rainState), view(ethState), false).join();
        expect(text).to.include("Alice").and.include("等待").and.include("200 秒");
        expect(text).not.to.include("Alice 可以领取");
        if (ethState === "REFUNDABLE") expect(text).to.include("Bob 可以退");
        else expect(text).not.to.include("Bob 可以退");
      });
    }
  }

  it("makes Alice wait when Bob never locked ETH, but permits refund after Rain expires", function () {
    const waiting = advise(view("CLAIMABLE"), view("NOT_FOUND"), false).join();
    expect(waiting).to.include("Bob 尚未锁 ETH").and.include("等待");
    expect(waiting).not.to.include("Alice 可以退");
    const expired = advise(view("REFUNDABLE", -1), view("NOT_FOUND"), false).join();
    expect(expired).to.include("Alice 可以退").and.not.include("等待");
  });

  it("does not suggest an action for an unsupported state combination", function () {
    const text = advise(view("CLAIMED"), view("CLAIMABLE"), false).join();
    expect(text).to.include("非常规组合").and.not.include("可以");
  });
});
