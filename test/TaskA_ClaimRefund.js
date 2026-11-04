// Task A (X): claim/refund happy-path and failure tests for both assets.
// AI-assisted scaffold; see docs/AI_ASSISTANCE.md for disclosure.
// Order: ERC20 claim -> ERC20 refund -> ETH claim -> ETH refund -> ERC20 failures -> ETH failures.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Task A: claim and refund", function () {
  async function deployFixture() {
    const [alice, bob, outsider] = await ethers.getSigners();

    const token = await (await ethers.getContractFactory("TestToken")).deploy(
      alice.address,
      1000n
    );
    const erc20 = await (await ethers.getContractFactory("ERC20HTLC")).deploy();
    const eth = await (await ethers.getContractFactory("ETHHTLC")).deploy();
    await Promise.all([
      token.waitForDeployment(),
      erc20.waitForDeployment(),
      eth.waitForDeployment(),
    ]);

    await token.approve(erc20.target, 1000n);

    const preimage = ethers.hexlify(ethers.randomBytes(32));
    const hashlock = ethers.keccak256(preimage);
    const deadline = (await time.latest()) + 600;

    return {
      alice,
      bob,
      outsider,
      token,
      erc20,
      eth,
      preimage,
      hashlock,
      deadline,
    };
  }

  it("ERC20: the receiver can claim before expiry", async function () {
    const { alice, bob, token, erc20, preimage, hashlock, deadline } =
      await loadFixture(deployFixture);
    const swapId = ethers.id("taskA-erc20-claim");
    const amount = 100n;

    await erc20.createERC20Swap(
      swapId,
      bob.address,
      token.target,
      amount,
      hashlock,
      deadline
    );

    const tx = await erc20.connect(bob).claim(swapId, preimage);

    await expect(tx).to.emit(erc20, "SwapClaimed").withArgs(swapId, preimage);
    await expect(tx).to.changeTokenBalances(
      token,
      [erc20, bob],
      [-amount, amount]
    );

    const swap = await erc20.swaps(swapId);
    expect(swap.status).to.equal(2n); // Claimed
    expect(swap.sender).to.equal(alice.address);
    expect(swap.receiver).to.equal(bob.address);
  });

  it("ERC20: the sender can refund at exactly the timelock", async function () {
    const { alice, bob, token, erc20, hashlock, deadline } = await loadFixture(
      deployFixture
    );
    const swapId = ethers.id("taskA-erc20-refund");
    const amount = 100n;

    await erc20.createERC20Swap(
      swapId,
      bob.address,
      token.target,
      amount,
      hashlock,
      deadline
    );

    await time.setNextBlockTimestamp(deadline);
    const tx = await erc20.connect(alice).refund(swapId);

    await expect(tx).to.emit(erc20, "SwapRefunded").withArgs(swapId);
    await expect(tx).to.changeTokenBalances(
      token,
      [erc20, alice],
      [-amount, amount]
    );

    const swap = await erc20.swaps(swapId);
    expect(swap.status).to.equal(3n); // Refunded
    expect(swap.sender).to.equal(alice.address);
    expect(swap.receiver).to.equal(bob.address);
  });

  it("ETH: the receiver can claim before expiry", async function () {
    const { alice, bob, eth, preimage, hashlock, deadline } = await loadFixture(
      deployFixture
    );
    const swapId = ethers.id("taskA-eth-claim");
    const amount = 100n;

    await eth.createETHSwap(swapId, bob.address, hashlock, deadline, {
      value: amount,
    });

    const tx = await eth.connect(bob).claim(swapId, preimage);

    await expect(tx).to.emit(eth, "SwapClaimed").withArgs(swapId, preimage);
    await expect(tx).to.changeEtherBalances([eth, bob], [-amount, amount]);

    const swap = await eth.swaps(swapId);
    expect(swap.status).to.equal(2n); // Claimed
    expect(swap.sender).to.equal(alice.address);
    expect(swap.receiver).to.equal(bob.address);
  });

  it("ETH: the sender can refund at exactly the timelock", async function () {
    const { alice, bob, eth, hashlock, deadline } = await loadFixture(
      deployFixture
    );
    const swapId = ethers.id("taskA-eth-refund");
    const amount = 100n;

    await eth.createETHSwap(swapId, bob.address, hashlock, deadline, {
      value: amount,
    });

    await time.setNextBlockTimestamp(deadline);
    const tx = await eth.connect(alice).refund(swapId);

    await expect(tx).to.emit(eth, "SwapRefunded").withArgs(swapId);
    await expect(tx).to.changeEtherBalances([eth, alice], [-amount, amount]);

    const swap = await eth.swaps(swapId);
    expect(swap.status).to.equal(3n); // Refunded
    expect(swap.sender).to.equal(alice.address);
    expect(swap.receiver).to.equal(bob.address);
  });

  // -----------------------------------------------------------------
  // ERC20 claim failures
  // -----------------------------------------------------------------
  describe("ERC20 claim failures", function () {
    it("rejects a claim from a non-receiver", async function () {
      const { bob, outsider, token, erc20, preimage, hashlock, deadline } =
        await loadFixture(deployFixture);
      const swapId = ethers.id("taskA-erc20-claim-not-receiver");

      await erc20.createERC20Swap(
        swapId,
        bob.address,
        token.target,
        100n,
        hashlock,
        deadline
      );

      await expect(erc20.connect(outsider).claim(swapId, preimage))
        .to.be.revertedWithCustomError(erc20, "NotReceiver");
    });

    it("rejects a claim with a wrong preimage", async function () {
      const { bob, token, erc20, hashlock, deadline } = await loadFixture(
        deployFixture
      );
      const swapId = ethers.id("taskA-erc20-claim-wrong-preimage");

      await erc20.createERC20Swap(
        swapId,
        bob.address,
        token.target,
        100n,
        hashlock,
        deadline
      );

      await expect(erc20.connect(bob).claim(swapId, ethers.ZeroHash))
        .to.be.revertedWithCustomError(erc20, "InvalidSecret");
    });

    it("rejects a claim at exactly the timelock", async function () {
      const { bob, token, erc20, preimage, hashlock, deadline } =
        await loadFixture(deployFixture);
      const swapId = ethers.id("taskA-erc20-claim-at-expiry");

      await erc20.createERC20Swap(
        swapId,
        bob.address,
        token.target,
        100n,
        hashlock,
        deadline
      );

      await time.setNextBlockTimestamp(deadline);

      await expect(erc20.connect(bob).claim(swapId, preimage))
        .to.be.revertedWithCustomError(erc20, "ClaimExpired");
    });

    it("rejects a repeated claim", async function () {
      const { bob, token, erc20, preimage, hashlock, deadline } =
        await loadFixture(deployFixture);
      const swapId = ethers.id("taskA-erc20-claim-repeated");

      await erc20.createERC20Swap(
        swapId,
        bob.address,
        token.target,
        100n,
        hashlock,
        deadline
      );
      await erc20.connect(bob).claim(swapId, preimage);

      await expect(erc20.connect(bob).claim(swapId, preimage))
        .to.be.revertedWithCustomError(erc20, "AlreadyCompleted");
    });

    it("rejects a claim for an unknown swap", async function () {
      const { bob, erc20, preimage } = await loadFixture(deployFixture);

      await expect(
        erc20.connect(bob).claim(ethers.id("taskA-missing-erc20-claim"), preimage)
      ).to.be.revertedWithCustomError(erc20, "SwapNotFound");
    });
  });

  // -----------------------------------------------------------------
  // ERC20 refund failures
  // -----------------------------------------------------------------
  describe("ERC20 refund failures", function () {
    it("rejects an early refund", async function () {
      const { alice, bob, token, erc20, hashlock, deadline } = await loadFixture(
        deployFixture
      );
      const swapId = ethers.id("taskA-erc20-refund-early");

      await erc20.createERC20Swap(
        swapId,
        bob.address,
        token.target,
        100n,
        hashlock,
        deadline
      );

      await expect(erc20.connect(alice).refund(swapId))
        .to.be.revertedWithCustomError(erc20, "RefundNotReady");
    });

    it("rejects a refund from a non-sender", async function () {
      const { bob, token, erc20, hashlock, deadline } = await loadFixture(
        deployFixture
      );
      const swapId = ethers.id("taskA-erc20-refund-not-sender");

      await erc20.createERC20Swap(
        swapId,
        bob.address,
        token.target,
        100n,
        hashlock,
        deadline
      );

      await expect(erc20.connect(bob).refund(swapId))
        .to.be.revertedWithCustomError(erc20, "NotSender");
    });

    it("rejects a repeated refund", async function () {
      const { alice, bob, token, erc20, hashlock, deadline } = await loadFixture(
        deployFixture
      );
      const swapId = ethers.id("taskA-erc20-refund-repeated");

      await erc20.createERC20Swap(
        swapId,
        bob.address,
        token.target,
        100n,
        hashlock,
        deadline
      );
      await time.setNextBlockTimestamp(deadline);
      await erc20.connect(alice).refund(swapId);

      await expect(erc20.connect(alice).refund(swapId))
        .to.be.revertedWithCustomError(erc20, "AlreadyCompleted");
    });

    it("rejects a refund after a claim", async function () {
      const { alice, bob, token, erc20, preimage, hashlock, deadline } =
        await loadFixture(deployFixture);
      const swapId = ethers.id("taskA-erc20-refund-after-claim");

      await erc20.createERC20Swap(
        swapId,
        bob.address,
        token.target,
        100n,
        hashlock,
        deadline
      );
      await erc20.connect(bob).claim(swapId, preimage);

      await expect(erc20.connect(alice).refund(swapId))
        .to.be.revertedWithCustomError(erc20, "AlreadyCompleted");
    });
  });

  // -----------------------------------------------------------------
  // ETH claim failures
  // -----------------------------------------------------------------
  describe("ETH claim failures", function () {
    it("rejects a claim from a non-receiver", async function () {
      const { bob, outsider, eth, preimage, hashlock, deadline } =
        await loadFixture(deployFixture);
      const swapId = ethers.id("taskA-eth-claim-not-receiver");

      await eth.createETHSwap(swapId, bob.address, hashlock, deadline, {
        value: 100n,
      });

      await expect(eth.connect(outsider).claim(swapId, preimage))
        .to.be.revertedWithCustomError(eth, "NotReceiver");
    });

    it("rejects a claim with a wrong preimage", async function () {
      const { bob, eth, hashlock, deadline } = await loadFixture(deployFixture);
      const swapId = ethers.id("taskA-eth-claim-wrong-preimage");

      await eth.createETHSwap(swapId, bob.address, hashlock, deadline, {
        value: 100n,
      });

      await expect(eth.connect(bob).claim(swapId, ethers.ZeroHash))
        .to.be.revertedWithCustomError(eth, "InvalidSecret");
    });

    it("rejects a claim at exactly the timelock", async function () {
      const { bob, eth, preimage, hashlock, deadline } = await loadFixture(
        deployFixture
      );
      const swapId = ethers.id("taskA-eth-claim-at-expiry");

      await eth.createETHSwap(swapId, bob.address, hashlock, deadline, {
        value: 100n,
      });

      await time.setNextBlockTimestamp(deadline);

      await expect(eth.connect(bob).claim(swapId, preimage))
        .to.be.revertedWithCustomError(eth, "ClaimExpired");
    });

    it("rejects a repeated claim", async function () {
      const { bob, eth, preimage, hashlock, deadline } = await loadFixture(
        deployFixture
      );
      const swapId = ethers.id("taskA-eth-claim-repeated");

      await eth.createETHSwap(swapId, bob.address, hashlock, deadline, {
        value: 100n,
      });
      await eth.connect(bob).claim(swapId, preimage);

      await expect(eth.connect(bob).claim(swapId, preimage))
        .to.be.revertedWithCustomError(eth, "AlreadyCompleted");
    });

    it("rejects a claim for an unknown swap", async function () {
      const { bob, eth, preimage } = await loadFixture(deployFixture);

      await expect(
        eth.connect(bob).claim(ethers.id("taskA-missing-eth-claim"), preimage)
      ).to.be.revertedWithCustomError(eth, "SwapNotFound");
    });
  });

  // -----------------------------------------------------------------
  // ETH refund failures
  // -----------------------------------------------------------------
  describe("ETH refund failures", function () {
    it("rejects an early refund", async function () {
      const { alice, bob, eth, hashlock, deadline } = await loadFixture(
        deployFixture
      );
      const swapId = ethers.id("taskA-eth-refund-early");

      await eth.createETHSwap(swapId, bob.address, hashlock, deadline, {
        value: 100n,
      });

      await expect(eth.connect(alice).refund(swapId))
        .to.be.revertedWithCustomError(eth, "RefundNotReady");
    });

    it("rejects a refund from a non-sender", async function () {
      const { bob, eth, hashlock, deadline } = await loadFixture(deployFixture);
      const swapId = ethers.id("taskA-eth-refund-not-sender");

      await eth.createETHSwap(swapId, bob.address, hashlock, deadline, {
        value: 100n,
      });

      await expect(eth.connect(bob).refund(swapId))
        .to.be.revertedWithCustomError(eth, "NotSender");
    });

    it("rejects a repeated refund", async function () {
      const { alice, bob, eth, hashlock, deadline } = await loadFixture(
        deployFixture
      );
      const swapId = ethers.id("taskA-eth-refund-repeated");

      await eth.createETHSwap(swapId, bob.address, hashlock, deadline, {
        value: 100n,
      });
      await time.setNextBlockTimestamp(deadline);
      await eth.connect(alice).refund(swapId);

      await expect(eth.connect(alice).refund(swapId))
        .to.be.revertedWithCustomError(eth, "AlreadyCompleted");
    });

    it("rejects a refund after a claim", async function () {
      const { alice, bob, eth, preimage, hashlock, deadline } =
        await loadFixture(deployFixture);
      const swapId = ethers.id("taskA-eth-refund-after-claim");

      await eth.createETHSwap(swapId, bob.address, hashlock, deadline, {
        value: 100n,
      });
      await eth.connect(bob).claim(swapId, preimage);

      await expect(eth.connect(alice).refund(swapId))
        .to.be.revertedWithCustomError(eth, "AlreadyCompleted");
    });
  });
});
