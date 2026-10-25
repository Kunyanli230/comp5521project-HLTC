// AI-assisted regression tests for counterparty checks and confirmation handling.
const { expect } = require("chai");
const { ethers } = require("ethers");
const { settings, confirmed, eventFrom, txUrl } = require("../scripts/lib/runtime");
const { verifyLock, assertTimelocks } = require("../scripts/lib/protocol");
describe("B1/B2 coordinator guards", function () {
  const env = { SEPOLIA_RPC_URL: "http://localhost:8545", ARBITRUM_SEPOLIA_RPC_URL: "http://localhost:8546",
    ALICE_PRIVATE_KEY: "0x" + "11".repeat(32), BOB_PRIVATE_KEY: "0x" + "22".repeat(32),
    RAIN_ADDRESS: "0x" + "33".repeat(20) };
  it("rejects missing config and an unsafe timelock order", function () {
    expect(() => settings({})).to.throw("Configure local .env");
    expect(() => settings({ ...env, RAIN_TIMELOCK_SECONDS: "3600", ETH_TIMELOCK_SECONDS: "3600" })).to.throw("timelock");
    expect(settings(env).minGap).to.equal(600);
  });
  it("checks every expected counterparty field and requires Active", async function () {
    const expected = { sender: env.RAIN_ADDRESS, receiver: "0x" + "44".repeat(20), token: "0x" + "55".repeat(20),
      amount: 10n, hashlock: ethers.id("hash"), timelock: 1000n };
    const contract = { swaps: async () => ({ ...expected, status: 1n }) };
    await verifyLock(contract, ethers.id("id"), expected);
    for (const field of Object.keys(expected)) {
      let message;
      try { await verifyLock(contract, ethers.id("id"), { ...expected, [field]: "incorrect" }); } catch (error) { message = error.message; }
      expect(message).to.equal(`Counterparty lock mismatch: ${field}`);
    }
    let message;
    try { await verifyLock({ swaps: async () => ({ ...expected, status: 2n }) }, ethers.id("id"), expected); } catch (error) { message = error.message; }
    expect(message).to.include("not active");
  });
  it("checks absolute and remaining timelock gaps and both claim windows", function () {
    const options = { minGap: 100, minWindow: 20 };
    expect(() => assertTimelocks(1000, 800, 0, 0, options)).not.to.throw();
    expect(() => assertTimelocks(1000, 950, 0, 0, options)).to.throw("gap");
    expect(() => assertTimelocks(1000, 800, 400, 0, options)).to.throw("gap");
    expect(() => assertTimelocks(1000, 800, 790, 799, options)).to.throw("window");
  });
  it("waits for configured confirmations, journals pending first and rejects failure", async function () {
    const chain = { key: "unitTest", chainId: 31337, explorer: null, confirmations: 3, timeout: 1234 };
    const hash = ethers.id("tx");
    const entries = [];
    const tx = { hash, wait: async (count, timeout) => {
      expect(count).to.equal(3); expect(timeout).to.equal(1234); expect(entries[0].status).to.equal("pending");
      return { status: 1, blockNumber: 12 };
    } };
    await confirmed(chain, tx, "test confirmation", (entry) => entries.push({ ...entry }));
    expect(entries.map((entry) => entry.status)).to.deep.equal(["pending", "confirmed"]);
    expect(txUrl({ ...chain, explorer: "https://sepolia.etherscan.io" }, hash)).to.equal(`https://sepolia.etherscan.io/tx/${hash}`);
    let message;
    try { await confirmed(chain, { hash, wait: async () => ({ status: 0 }) }, "failed tx"); } catch (error) { message = error.message; }
    expect(message).to.include("did not succeed");
  });
  it("finds events by emitter and swap ID rather than log position", function () {
    const abi = new ethers.Interface(["event SwapClaimed(bytes32 indexed swapId,bytes32 preimage)"]);
    const id = ethers.id("id"), secret = ethers.id("secret");
    const encoded = abi.encodeEventLog(abi.getEvent("SwapClaimed"), [id, secret]);
    const contract = { target: env.RAIN_ADDRESS, interface: abi };
    const receipt = { logs: [{ address: "0x" + "44".repeat(20), ...encoded }, { address: env.RAIN_ADDRESS, ...encoded }] };
    expect(eventFrom(receipt, contract, "SwapClaimed", id).preimage).to.equal(secret);
    expect(() => eventFrom(receipt, contract, "SwapClaimed", ethers.id("other"))).to.throw("Expected one");
  });
});
