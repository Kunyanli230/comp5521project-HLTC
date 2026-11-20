// PointHTLC regressions for the claim/refund rules shared with Task A.
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const secret = 73n;
const pointLock = ethers.computeAddress(ethers.toBeHex(secret, 32));
const swapId = ethers.id("point-claim-refund");
const amount = 100n;

// OpenZeppelin ReentrancyGuard v5.5 uses this ERC-7201 slot (1 = idle, 2 = entered).
const guardSlot = 0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00n;

async function expectGuardDuringPayout(tx, recipient) {
  const receipt = await tx.wait();
  const trace = await network.provider.send("debug_traceTransaction", [
    receipt.hash, { disableMemory: true, disableStorage: true },
  ]);
  let guard = 1n; // The guard starts idle on each new top-level transaction.
  let payouts = 0;
  for (const { depth, op, stack } of trace.structLogs) {
    if (depth !== 1) continue;
    if (op === "SSTORE" && BigInt("0x" + stack.at(-1)) === guardSlot) {
      guard = BigInt("0x" + stack.at(-2));
    }
    if (op === "CALL" && BigInt("0x" + stack.at(-2)) === BigInt(recipient)) {
      expect(guard, "guard at the external payout call").to.equal(2n);
      payouts++;
    }
  }
  expect(payouts, "external payout calls").to.equal(1);
  expect(guard, "guard after payout").to.equal(1n);
}

for (const asset of ["ETH", "ERC20"]) {
  describe(asset + " point-lock claim and refund", function () {
    async function lockedSwap() {
      const [sender, receiver, outsider] = await ethers.getSigners();
      const escrow = await ethers.deployContract(asset + "PointHTLC");
      const deadline = (await time.latest()) + 600;
      let token;
      if (asset === "ETH") {
        await escrow.createETHSwap(swapId, receiver.address, pointLock, deadline, { value: amount });
      } else {
        token = await ethers.deployContract("TestToken", [sender.address, amount]);
        await token.approve(escrow.target, amount);
        await escrow.createERC20Swap(swapId, receiver.address, token.target, amount, pointLock, deadline);
      }
      return { escrow, token, sender, receiver, outsider, deadline };
    }

    it("rejects a non-receiver with the correct scalar", async function () {
      const { escrow, outsider } = await loadFixture(lockedSwap);
      await expect(escrow.connect(outsider).claim(swapId, secret))
        .to.be.revertedWithCustomError(escrow, "NotReceiver");
      expect((await escrow.swaps(swapId)).status).to.equal(1n);
    });

    it("rejects claims at and after the deadline", async function () {
      const { escrow, receiver, deadline } = await loadFixture(lockedSwap);
      for (const timestamp of [deadline, deadline + 1]) {
        await time.setNextBlockTimestamp(timestamp);
        await expect(escrow.connect(receiver).claim(swapId, secret))
          .to.be.revertedWithCustomError(escrow, "ClaimExpired");
      }
      expect((await escrow.swaps(swapId)).status).to.equal(1n);
    });

    it("rejects early refunds and refunds by a non-sender", async function () {
      const { escrow, outsider, deadline } = await loadFixture(lockedSwap);
      await expect(escrow.refund(swapId)).to.be.revertedWithCustomError(escrow, "RefundNotReady");
      await time.setNextBlockTimestamp(deadline);
      await expect(escrow.connect(outsider).refund(swapId)).to.be.revertedWithCustomError(escrow, "NotSender");
      expect((await escrow.swaps(swapId)).status).to.equal(1n);
    });

    it("rejects both operations on an unknown swap", async function () {
      const { escrow, receiver } = await loadFixture(lockedSwap);
      const missing = ethers.id("missing-swap");
      await expect(escrow.connect(receiver).claim(missing, secret)).to.be.revertedWithCustomError(escrow, "SwapNotFound");
      await expect(escrow.refund(missing)).to.be.revertedWithCustomError(escrow, "SwapNotFound");
    });

    it("keeps a claim final across expiry", async function () {
      const { escrow, receiver, deadline } = await loadFixture(lockedSwap);
      await time.setNextBlockTimestamp(deadline - 1);
      await escrow.connect(receiver).claim(swapId, secret);
      await time.setNextBlockTimestamp(deadline);
      await expect(escrow.refund(swapId)).to.be.revertedWithCustomError(escrow, "AlreadyCompleted");
      await expect(escrow.connect(receiver).claim(swapId, secret))
        .to.be.revertedWithCustomError(escrow, "AlreadyCompleted");
      expect((await escrow.swaps(swapId)).status).to.equal(2n);
    });

    it("refunds at the deadline and keeps the refund final", async function () {
      const { escrow, token, sender, receiver, deadline } = await loadFixture(lockedSwap);
      await time.setNextBlockTimestamp(deadline);
      const tx = await escrow.refund(swapId);
      await expect(tx).to.emit(escrow, "SwapRefunded").withArgs(swapId);
      if (token) {
        await expect(tx).to.changeTokenBalances(token, [escrow, sender], [-amount, amount]);
      } else {
        await expect(tx).to.changeEtherBalances([escrow, sender], [-amount, amount]);
      }
      await expect(escrow.refund(swapId)).to.be.revertedWithCustomError(escrow, "AlreadyCompleted");
      await expect(escrow.connect(receiver).claim(swapId, secret))
        .to.be.revertedWithCustomError(escrow, "AlreadyCompleted");
      expect((await escrow.swaps(swapId)).status).to.equal(3n);
    });

    it("holds the reentrancy guard throughout the claim payout", async function () {
      const { escrow, token, receiver } = await loadFixture(lockedSwap);
      const tx = await escrow.connect(receiver).claim(swapId, secret);
      await expectGuardDuringPayout(tx, token?.target ?? receiver.address);
    });

    it("holds the reentrancy guard throughout the refund payout", async function () {
      const { escrow, token, sender, deadline } = await loadFixture(lockedSwap);
      await time.setNextBlockTimestamp(deadline);
      const tx = await escrow.refund(swapId);
      await expectGuardDuringPayout(tx, token?.target ?? sender.address);
    });
  });
}
