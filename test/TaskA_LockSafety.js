// Task A1 + A2 + A5: lock creation (createERC20Swap / createETHSwap), input validation
// and security tests.
// These tests do NOT change claim()/refund() (owned by A3/A4); they only use them to
// prove that funds locked by the create functions cannot be stolen or stuck.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const ACTIVE = 1n;
const NONE = 0n;
const CLAIMED = 2n;
const Attack = { None: 0, Claim: 1, Refund: 2 };

describe("Task A: lock creation, validation and security", function () {
  async function deployFixture() {
    const [alice, bob, outsider] = await ethers.getSigners();
    const deploy = async (name, ...args) => {
      const c = await (await ethers.getContractFactory(name)).deploy(...args);
      await c.waitForDeployment();
      return c;
    };
    const token = await deploy("TestToken", alice.address, 10_000n);
    const feeToken = await deploy("FeeOnTransferToken", alice.address, 10_000n);
    const hookToken = await deploy("HookToken", alice.address, 10_000n);
    const erc20 = await deploy("ERC20HTLC");
    const eth = await deploy("ETHHTLC");

    const preimage = ethers.hexlify(ethers.randomBytes(32));
    const hashlock = ethers.keccak256(preimage); // == keccak256(abi.encodePacked(bytes32))
    const deadline = (await time.latest()) + 3600;
    const id = ethers.id("swap-1");
    return { alice, bob, outsider, deploy, token, feeToken, hookToken, erc20, eth, preimage, hashlock, deadline, id };
  }

  // Every create call goes through one helper per asset so that each test only states
  // the parameter it is breaking. Defaults are a valid lock.
  function lockERC20(f, o = {}) {
    const p = { id: f.id, receiver: f.bob.address, token: f.token.target, amount: 100n,
      hashlock: f.hashlock, deadline: f.deadline, from: f.alice, ...o };
    return f.erc20.connect(p.from).createERC20Swap(p.id, p.receiver, p.token, p.amount, p.hashlock, p.deadline);
  }
  function lockETH(f, o = {}) {
    const p = { id: f.id, receiver: f.bob.address, value: 100n, hashlock: f.hashlock,
      deadline: f.deadline, from: f.alice, ...o };
    return f.eth.connect(p.from).createETHSwap(p.id, p.receiver, p.hashlock, p.deadline, { value: p.value });
  }

  // ------------------------------------------------------------------ A1/A2 happy path
  describe("successful locks record exactly what was escrowed", function () {
    it("ERC20: stores caller as sender, moves tokens into escrow, emits SwapCreated", async function () {
      const f = await loadFixture(deployFixture);
      await f.token.approve(f.erc20.target, 100n);
      const tx = lockERC20(f); // same tx checked twice: chai-matchers can't chain emit + balance
      await expect(tx).to.emit(f.erc20, "SwapCreated")
        .withArgs(f.id, f.alice.address, f.bob.address, f.token.target, 100n, f.hashlock, f.deadline);
      await expect(tx).to.changeTokenBalances(f.token, [f.alice, f.erc20], [-100n, 100n]);
      const s = await f.erc20.swaps(f.id);
      expect([s.sender, s.receiver, s.token, s.amount, s.hashlock, s.timelock, s.status])
        .to.deep.equal([f.alice.address, f.bob.address, f.token.target, 100n, f.hashlock, BigInt(f.deadline), ACTIVE]);
    });

    it("ETH: stores msg.value as amount and token = address(0)", async function () {
      const f = await loadFixture(deployFixture);
      const tx = lockETH(f, { value: 12345n });
      await expect(tx).to.emit(f.eth, "SwapCreated")
        .withArgs(f.id, f.alice.address, f.bob.address, ethers.ZeroAddress, 12345n, f.hashlock, f.deadline);
      await expect(tx).to.changeEtherBalances([f.alice, f.eth], [-12345n, 12345n]);
      const s = await f.eth.swaps(f.id);
      expect(s.token).to.equal(ethers.ZeroAddress);
      expect(s.amount).to.equal(12345n);
      expect(s.status).to.equal(ACTIVE);
    });

    it("accepts the earliest valid deadline (block.timestamp + 1)", async function () {
      const f = await loadFixture(deployFixture);
      const t = (await time.latest()) + 10;
      await time.setNextBlockTimestamp(t);
      await expect(lockETH(f, { deadline: t + 1 })).to.emit(f.eth, "SwapCreated");
    });
  });

  // ------------------------------------------------------------------ A5 input validation
  for (const asset of ["ERC20", "ETH"]) {
    describe(`${asset}: input validation (InvalidInput)`, function () {
      // Prepare a fixture where Alice has already approved the ERC20 escrow, so the
      // only reason a call can fail is the parameter under test.
      async function ready() {
        const f = await loadFixture(deployFixture);
        await f.token.approve(f.erc20.target, 10_000n);
        f.htlc = asset === "ERC20" ? f.erc20 : f.eth;
        f.lock = (o) => (asset === "ERC20" ? lockERC20(f, o) : lockETH(f, { ...o, value: o?.amount ?? 100n }));
        return f;
      }
      async function expectInvalidAndNoSideEffects(f, overrides) {
        const escrowBefore = asset === "ERC20"
          ? await f.token.balanceOf(f.htlc.target)
          : await ethers.provider.getBalance(f.htlc.target);
        await expect(f.lock(overrides)).to.be.revertedWithCustomError(f.htlc, "InvalidInput");
        const id = overrides.id ?? f.id;
        expect((await f.htlc.swaps(id)).status).to.equal(NONE);
        const escrowAfter = asset === "ERC20"
          ? await f.token.balanceOf(f.htlc.target)
          : await ethers.provider.getBalance(f.htlc.target);
        expect(escrowAfter).to.equal(escrowBefore);
      }

      it("rejects zero swapId", async function () {
        const f = await ready();
        await expectInvalidAndNoSideEffects(f, { id: ethers.ZeroHash });
      });
      it("rejects zero receiver address", async function () {
        const f = await ready();
        await expectInvalidAndNoSideEffects(f, { receiver: ethers.ZeroAddress });
      });
      it("rejects receiver == sender", async function () {
        const f = await ready();
        await expectInvalidAndNoSideEffects(f, { receiver: f.alice.address });
      });
      it("rejects zero amount", async function () {
        const f = await ready();
        await expectInvalidAndNoSideEffects(f, { amount: 0n });
      });
      it("rejects zero hashlock", async function () {
        const f = await ready();
        await expectInvalidAndNoSideEffects(f, { hashlock: ethers.ZeroHash });
      });
      it("rejects a deadline in the past", async function () {
        const f = await ready();
        await expectInvalidAndNoSideEffects(f, { deadline: (await time.latest()) - 1 });
      });
      it("rejects deadline == block.timestamp (would be expired immediately)", async function () {
        const f = await ready();
        const t = (await time.latest()) + 10;
        await time.setNextBlockTimestamp(t);
        await expectInvalidAndNoSideEffects(f, { deadline: t });
      });
    });

    describe(`${asset}: duplicate swapId (SwapAlreadyExists)`, function () {
      async function ready() {
        const f = await loadFixture(deployFixture);
        await f.token.approve(f.erc20.target, 10_000n);
        await f.token.transfer(f.outsider.address, 1_000n);
        await f.token.connect(f.outsider).approve(f.erc20.target, 1_000n);
        f.htlc = asset === "ERC20" ? f.erc20 : f.eth;
        f.lock = (o) => (asset === "ERC20" ? lockERC20(f, o) : lockETH(f, o));
        return f;
      }

      it("rejects the same id twice from the same sender", async function () {
        const f = await ready();
        await f.lock();
        await expect(f.lock()).to.be.revertedWithCustomError(f.htlc, "SwapAlreadyExists");
      });

      it("another user cannot overwrite an existing lock by reusing its id", async function () {
        const f = await ready();
        await f.lock();
        const before = (await f.htlc.swaps(f.id)).toArray();
        await expect(f.lock({ from: f.outsider })) // outsider tries to become sender of Alice's id
          .to.be.revertedWithCustomError(f.htlc, "SwapAlreadyExists");
        expect((await f.htlc.swaps(f.id)).toArray()).to.deep.equal(before);
        expect((await f.htlc.swaps(f.id)).sender).to.equal(f.alice.address);
      });

      it("a finished (Claimed) id can never be reused", async function () {
        const f = await ready();
        await f.lock();
        await f.htlc.connect(f.bob).claim(f.id, f.preimage);
        expect((await f.htlc.swaps(f.id)).status).to.equal(CLAIMED);
        await expect(f.lock()).to.be.revertedWithCustomError(f.htlc, "SwapAlreadyExists");
      });
    });
  }

  it("ERC20 and ETH escrows keep separate id spaces", async function () {
    const f = await loadFixture(deployFixture);
    await f.token.approve(f.erc20.target, 100n);
    await lockERC20(f);
    await expect(lockETH(f)).to.emit(f.eth, "SwapCreated");
  });

  // ------------------------------------------------------------------ ERC20-specific checks
  describe("ERC20: token transfer safety", function () {
    it("rejects token = address(0) and token = EOA (no contract code)", async function () {
      const f = await loadFixture(deployFixture);
      await expect(lockERC20(f, { token: ethers.ZeroAddress })).to.be.revertedWithCustomError(f.erc20, "InvalidInput");
      await expect(lockERC20(f, { token: f.outsider.address })).to.be.revertedWithCustomError(f.erc20, "InvalidInput");
    });

    it("reverts with ERC20InsufficientAllowance when approval < amount, nothing recorded", async function () {
      const f = await loadFixture(deployFixture);
      await f.token.approve(f.erc20.target, 99n);
      await expect(lockERC20(f, { amount: 100n }))
        .to.be.revertedWithCustomError(f.token, "ERC20InsufficientAllowance")
        .withArgs(f.erc20.target, 99n, 100n);
      expect((await f.erc20.swaps(f.id)).status).to.equal(NONE);
      expect(await f.token.balanceOf(f.alice.address)).to.equal(10_000n);
    });

    it("reverts with ERC20InsufficientBalance when sender owns less than amount", async function () {
      const f = await loadFixture(deployFixture);
      await f.token.connect(f.outsider).approve(f.erc20.target, 100n); // outsider has 0 tokens
      await expect(lockERC20(f, { from: f.outsider }))
        .to.be.revertedWithCustomError(f.token, "ERC20InsufficientBalance")
        .withArgs(f.outsider.address, 0n, 100n);
      expect((await f.erc20.swaps(f.id)).status).to.equal(NONE);
    });

    it("rejects a fee-on-transfer token: received 990 but swap would record 1000", async function () {
      const f = await loadFixture(deployFixture);
      await f.feeToken.approve(f.erc20.target, 1000n);
      await expect(lockERC20(f, { token: f.feeToken.target, amount: 1000n }))
        .to.be.revertedWithCustomError(f.erc20, "InvalidInput");
      // Whole transaction rolled back: no record, no fee burned, escrow empty.
      expect((await f.erc20.swaps(f.id)).status).to.equal(NONE);
      expect(await f.feeToken.balanceOf(f.alice.address)).to.equal(10_000n);
      expect(await f.feeToken.balanceOf(f.erc20.target)).to.equal(0n);
    });

    it("the balance check is exact, not a token ban: fee rounds to 0 below 100 units", async function () {
      const f = await loadFixture(deployFixture);
      await f.feeToken.approve(f.erc20.target, 99n);
      await expect(lockERC20(f, { token: f.feeToken.target, amount: 99n })).to.emit(f.erc20, "SwapCreated");
      expect(await f.feeToken.balanceOf(f.erc20.target)).to.equal(99n);
      expect((await f.erc20.swaps(f.id)).amount).to.equal(99n);
    });

    it("a malicious token cannot re-enter createERC20Swap during transferFrom", async function () {
      const f = await loadFixture(deployFixture);
      await f.hookToken.setLockReentryTarget(f.erc20.target);
      await f.hookToken.approve(f.erc20.target, 100n);
      await expect(lockERC20(f, { token: f.hookToken.target }))
        .to.be.revertedWithCustomError(f.erc20, "ReentrancyGuardReentrantCall");
      expect((await f.erc20.swaps(f.id)).status).to.equal(NONE);
      expect((await f.erc20.swaps(ethers.id("reentry"))).status).to.equal(NONE);
    });
  });

  // ------------------------------------------------------------------ ETH payout failure
  describe("ETH: receiver/sender that rejects ETH (ETHTransferFailed)", function () {
    it("claim to a contract that rejects ETH reverts; swap stays Active and refundable", async function () {
      const f = await loadFixture(deployFixture);
      const rejecter = await f.deploy("ETHRejecter", f.eth.target);
      await lockETH(f, { receiver: rejecter.target, value: 500n });

      await expect(rejecter.claim(f.id, f.preimage)).to.be.revertedWithCustomError(f.eth, "ETHTransferFailed");
      expect((await f.eth.swaps(f.id)).status).to.equal(ACTIVE);
      expect(await ethers.provider.getBalance(f.eth.target)).to.equal(500n);

      // Funds are not stuck: the honest sender can still refund after the deadline.
      await time.increaseTo(f.deadline);
      await expect(f.eth.refund(f.id)).to.changeEtherBalances([f.eth, f.alice], [-500n, 500n]);
    });

    it("refund to a sender contract that rejects ETH reverts; swap stays Active", async function () {
      const f = await loadFixture(deployFixture);
      const rejecter = await f.deploy("ETHRejecter", f.eth.target);
      await rejecter.lockETH(f.id, f.bob.address, f.hashlock, f.deadline, { value: 500n });
      expect((await f.eth.swaps(f.id)).sender).to.equal(rejecter.target);

      await time.increaseTo(f.deadline);
      await expect(rejecter.refund(f.id)).to.be.revertedWithCustomError(f.eth, "ETHTransferFailed");
      expect((await f.eth.swaps(f.id)).status).to.equal(ACTIVE);
      expect(await ethers.provider.getBalance(f.eth.target)).to.equal(500n);
    });
  });

  // ------------------------------------------------------------------ re-entrancy
  describe("re-entrancy: malicious participant calls back into claim/refund", function () {
    const reentrySelector = async (htlc) => htlc.interface.getError("ReentrancyGuardReentrantCall").selector;

    async function ethAttackSetup() {
      const f = await loadFixture(deployFixture);
      f.attacker = await f.deploy("ReentrantReceiver", f.eth.target);
      return f;
    }

    it("ETH claim -> re-enter claim of another swap: blocked, attacker paid once", async function () {
      const f = await ethAttackSetup();
      const idA = ethers.id("A"), idB = ethers.id("B");
      await lockETH(f, { id: idA, receiver: f.attacker.target, value: 100n });
      await lockETH(f, { id: idB, receiver: f.attacker.target, value: 200n });

      await f.attacker.setAttack(Attack.Claim, idB, f.preimage, false);
      await expect(f.attacker.claim(idA, f.preimage)).to.changeEtherBalance(f.attacker, 100n);

      expect(await f.attacker.attempts()).to.equal(1n);
      expect(await f.attacker.reentrySucceeded()).to.equal(false);
      expect(await f.attacker.lastError()).to.equal(await reentrySelector(f.eth));
      expect((await f.eth.swaps(idB)).status).to.equal(ACTIVE);
      expect(await ethers.provider.getBalance(f.eth.target)).to.equal(200n);
    });

    it("ETH claim -> re-enter claim of the SAME swap: blocked (no double pay)", async function () {
      const f = await ethAttackSetup();
      await lockETH(f, { receiver: f.attacker.target, value: 100n });
      await lockETH(f, { id: ethers.id("other"), receiver: f.bob.address, value: 900n }); // pot to steal
      await f.attacker.setAttack(Attack.Claim, f.id, f.preimage, false);
      await expect(f.attacker.claim(f.id, f.preimage)).to.changeEtherBalance(f.attacker, 100n);
      expect(await f.attacker.lastError()).to.equal(await reentrySelector(f.eth));
      expect(await ethers.provider.getBalance(f.eth.target)).to.equal(900n);
    });

    it("ETH claim -> re-enter refund of an expired swap it sent: blocked", async function () {
      const f = await ethAttackSetup();
      const now = await time.latest();
      const idLong = ethers.id("long"), idShort = ethers.id("short");
      await lockETH(f, { id: idLong, receiver: f.attacker.target, value: 100n, deadline: now + 3600 });
      await f.attacker.lockETH(idShort, f.bob.address, f.hashlock, now + 60, { value: 50n });
      await time.increaseTo(now + 60); // idShort expired, idLong still claimable

      await f.attacker.setAttack(Attack.Refund, idShort, ethers.ZeroHash, false);
      await f.attacker.claim(idLong, f.preimage);
      expect(await f.attacker.lastError()).to.equal(await reentrySelector(f.eth));
      expect((await f.eth.swaps(idShort)).status).to.equal(ACTIVE);
    });

    it("ETH refund -> re-enter refund of another swap: blocked", async function () {
      const f = await ethAttackSetup();
      const idC = ethers.id("C"), idD = ethers.id("D");
      await f.attacker.lockETH(idC, f.bob.address, f.hashlock, f.deadline, { value: 70n });
      await f.attacker.lockETH(idD, f.bob.address, f.hashlock, f.deadline, { value: 30n });
      await time.increaseTo(f.deadline);

      await f.attacker.setAttack(Attack.Refund, idD, ethers.ZeroHash, false);
      await expect(f.attacker.refund(idC)).to.changeEtherBalance(f.attacker, 70n);
      expect(await f.attacker.lastError()).to.equal(await reentrySelector(f.eth));
      expect((await f.eth.swaps(idD)).status).to.equal(ACTIVE);
      // Without the attack the second refund works normally: the guard is per call, not a lock-out.
      await expect(f.attacker.refund(idD)).to.changeEtherBalance(f.attacker, 30n);
    });

    it("ETH: if the attacker re-throws, the whole claim is rolled back (ETHTransferFailed)", async function () {
      const f = await ethAttackSetup();
      await lockETH(f, { receiver: f.attacker.target, value: 100n });
      await f.attacker.setAttack(Attack.Claim, f.id, f.preimage, true);
      await expect(f.attacker.claim(f.id, f.preimage)).to.be.revertedWithCustomError(f.eth, "ETHTransferFailed");
      expect((await f.eth.swaps(f.id)).status).to.equal(ACTIVE);
    });

    it("ERC20 (hook token) claim -> re-enter claim: blocked, attacker paid once", async function () {
      const f = await loadFixture(deployFixture);
      const attacker = await f.deploy("ReentrantReceiver", f.erc20.target);
      const idA = ethers.id("A"), idB = ethers.id("B");
      await f.hookToken.approve(f.erc20.target, 300n);
      await lockERC20(f, { id: idA, receiver: attacker.target, token: f.hookToken.target, amount: 100n });
      await lockERC20(f, { id: idB, receiver: attacker.target, token: f.hookToken.target, amount: 200n });
      await f.hookToken.setHookReceiver(attacker.target);

      await attacker.setAttack(Attack.Claim, idB, f.preimage, false);
      await expect(attacker.claim(idA, f.preimage)).to.changeTokenBalance(f.hookToken, attacker, 100n);
      expect(await attacker.lastError()).to.equal(await reentrySelector(f.erc20));
      expect(await attacker.reentrySucceeded()).to.equal(false);
      expect((await f.erc20.swaps(idB)).status).to.equal(ACTIVE);
    });

    it("ERC20 (hook token) refund -> re-enter refund of another swap: blocked", async function () {
      const f = await loadFixture(deployFixture);
      const attacker = await f.deploy("ReentrantReceiver", f.erc20.target);
      const idC = ethers.id("C"), idD = ethers.id("D");
      await f.hookToken.transfer(attacker.target, 100n); // fund attacker before enabling hooks
      await attacker.lockERC20(idC, f.bob.address, f.hookToken.target, 70n, f.hashlock, f.deadline);
      await attacker.lockERC20(idD, f.bob.address, f.hookToken.target, 30n, f.hashlock, f.deadline);
      await f.hookToken.setHookReceiver(attacker.target);
      await time.increaseTo(f.deadline);

      await attacker.setAttack(Attack.Refund, idD, ethers.ZeroHash, false);
      await expect(attacker.refund(idC)).to.changeTokenBalance(f.hookToken, attacker, 70n);
      expect(await attacker.attempts()).to.equal(1n);
      expect(await attacker.lastError()).to.equal(await reentrySelector(f.erc20));
      expect((await f.erc20.swaps(idD)).status).to.equal(ACTIVE);
      expect(await f.hookToken.balanceOf(f.erc20.target)).to.equal(30n);
    });

    it("ERC20 (hook token): re-thrown re-entry error rolls back the claim", async function () {
      const f = await loadFixture(deployFixture);
      const attacker = await f.deploy("ReentrantReceiver", f.erc20.target);
      await f.hookToken.approve(f.erc20.target, 100n);
      await lockERC20(f, { receiver: attacker.target, token: f.hookToken.target });
      await f.hookToken.setHookReceiver(attacker.target);

      await attacker.setAttack(Attack.Claim, f.id, f.preimage, true);
      await expect(attacker.claim(f.id, f.preimage))
        .to.be.revertedWithCustomError(f.erc20, "ReentrancyGuardReentrantCall");
      expect((await f.erc20.swaps(f.id)).status).to.equal(ACTIVE);
      expect(await f.hookToken.balanceOf(f.erc20.target)).to.equal(100n);
    });
  });
});
