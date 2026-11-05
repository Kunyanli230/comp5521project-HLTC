// AI-assisted B3 classification tests; see docs/AI_ASSISTANCE.md.
const { expect } = require("chai");
const { classify } = require("../scripts/lib/recovery");

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
