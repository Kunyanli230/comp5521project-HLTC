// Challenge Part: acceptance tests for the point-lock HTLC variants (ETHPointHTLC / ERC20PointHTLC).
// Covers only what differs from the basic contracts: the lock is an address derived from a
// secp256k1 point, and claim() takes the scalar. Receiver/expiry/repeat rules are inherited
// unchanged and are covered by the ported Task A regression tests.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const randomScalar = () => (ethers.toBigInt(ethers.randomBytes(32)) % (N - 1n)) + 1n;
const lockOf = (scalar) => ethers.computeAddress(ethers.toBeHex(scalar, 32));
const id = () => ethers.hexlify(ethers.randomBytes(32));

describe("Challenge: point-lock HTLC", function () {
  async function deployFixture() {
    const [alice, bob, outsider] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("TestToken")).deploy(alice.address, 1000n);
    const erc20 = await (await ethers.getContractFactory("ERC20PointHTLC")).deploy();
    const eth = await (await ethers.getContractFactory("ETHPointHTLC")).deploy();
    await Promise.all([token.waitForDeployment(), erc20.waitForDeployment(), eth.waitForDeployment()]);
    await token.approve(erc20.target, 1000n);
    const deadline = (await time.latest()) + 600;
    return { alice, bob, outsider, token, erc20, eth, deadline };
  }

  describe("ETHPointHTLC", function () {
    it("stores the point lock and emits it in SwapCreated", async function () {
      const { alice, bob, eth, deadline } = await loadFixture(deployFixture);
      const swapId = id();
      const lock = lockOf(randomScalar());
      await expect(eth.connect(bob).createETHSwap(swapId, alice.address, lock, deadline, { value: 100n }))
        .to.emit(eth, "SwapCreated")
        .withArgs(swapId, bob.address, alice.address, ethers.ZeroAddress, 100n, lock, deadline);
      const swap = await eth.swaps(swapId);
      expect(swap.pointLock).to.equal(lock);
      expect(swap.status).to.equal(1n);
    });

    it("rejects a zero-address point lock", async function () {
      const { alice, bob, eth, deadline } = await loadFixture(deployFixture);
      await expect(
        eth.connect(bob).createETHSwap(id(), alice.address, ethers.ZeroAddress, deadline, { value: 100n })
      ).to.be.revertedWithCustomError(eth, "InvalidInput");
    });

    it("pays the receiver for the correct scalar and reveals it in SwapClaimed", async function () {
      const { alice, bob, eth, deadline } = await loadFixture(deployFixture);
      const swapId = id();
      const t = randomScalar();
      await eth.connect(bob).createETHSwap(swapId, alice.address, lockOf(t), deadline, { value: 100n });
      const claim = eth.connect(alice).claim(swapId, t);
      await expect(claim).to.emit(eth, "SwapClaimed").withArgs(swapId, t);
      await expect(claim).to.changeEtherBalances([eth, alice], [-100n, 100n]);
      expect((await eth.swaps(swapId)).status).to.equal(2n);
    });

    it("rejects a neighbouring scalar, zero and out-of-range scalars with InvalidSecret", async function () {
      const { alice, bob, eth, deadline } = await loadFixture(deployFixture);
      const swapId = id();
      const t = 5n;
      await eth.connect(bob).createETHSwap(swapId, alice.address, lockOf(t), deadline, { value: 100n });
      // t + N is congruent to t mod n: it must not open the lock a second way.
      for (const wrong of [t + 1n, 0n, N, t + N, 2n ** 256n - 1n]) {
        await expect(eth.connect(alice).claim(swapId, wrong), `scalar ${wrong}`)
          .to.be.revertedWithCustomError(eth, "InvalidSecret");
      }
      expect((await eth.swaps(swapId)).status).to.equal(1n);
    });

    it("still refunds the sender after expiry when nobody claimed", async function () {
      const { alice, bob, eth, deadline } = await loadFixture(deployFixture);
      const swapId = id();
      await eth.connect(bob).createETHSwap(swapId, alice.address, lockOf(randomScalar()), deadline, { value: 100n });
      await expect(eth.connect(bob).refund(swapId)).to.be.revertedWithCustomError(eth, "RefundNotReady");
      await time.increaseTo(deadline);
      await expect(eth.connect(bob).refund(swapId)).to.changeEtherBalances([eth, bob], [-100n, 100n]);
      expect((await eth.swaps(swapId)).status).to.equal(3n);
    });
  });

  describe("ERC20PointHTLC", function () {
    it("locks tokens under a point lock and releases them for the correct scalar only", async function () {
      const { alice, bob, token, erc20, deadline } = await loadFixture(deployFixture);
      const swapId = id();
      const u = randomScalar();
      await expect(erc20.createERC20Swap(swapId, bob.address, token.target, 100n, lockOf(u), deadline))
        .to.emit(erc20, "SwapCreated")
        .withArgs(swapId, alice.address, bob.address, token.target, 100n, lockOf(u), deadline);
      await expect(erc20.connect(bob).claim(swapId, (u % (N - 1n)) + 1n))
        .to.be.revertedWithCustomError(erc20, "InvalidSecret");
      await expect(erc20.connect(bob).claim(swapId, u))
        .to.changeTokenBalances(token, [erc20, bob], [-100n, 100n]);
    });

    it("rejects a zero-address point lock", async function () {
      const { bob, token, erc20, deadline } = await loadFixture(deployFixture);
      await expect(
        erc20.createERC20Swap(id(), bob.address, token.target, 100n, ethers.ZeroAddress, deadline)
      ).to.be.revertedWithCustomError(erc20, "InvalidInput");
    });
  });

  describe("private linked claims", function () {
    it("the ETH claim reveals t; only t + r opens the token lock, and the two chains share no value", async function () {
      const { alice, bob, token, erc20, eth, deadline } = await loadFixture(deployFixture);
      const t = randomScalar();
      const r = randomScalar();
      const tokenLock = lockOf((t + r) % N);
      const ethLock = lockOf(t);
      const tokenSwap = id();
      const ethSwap = id();
      expect(tokenLock).to.not.equal(ethLock);

      await erc20.createERC20Swap(tokenSwap, bob.address, token.target, 100n, tokenLock, deadline + 600);
      await eth.connect(bob).createETHSwap(ethSwap, alice.address, ethLock, deadline, { value: 100n });

      const receipt = await (await eth.connect(alice).claim(ethSwap, t)).wait();
      const revealed = receipt.logs.map((log) => eth.interface.parseLog(log)).find((log) => log?.name === "SwapClaimed")
        .args.secret;
      expect(revealed).to.equal(t);

      // An observer who only saw the ETH claim cannot open the token lock with it.
      await expect(erc20.connect(bob).claim(tokenSwap, revealed))
        .to.be.revertedWithCustomError(erc20, "InvalidSecret");
      // Bob combines it with his private r.
      await expect(erc20.connect(bob).claim(tokenSwap, (revealed + r) % N))
        .to.changeTokenBalances(token, [erc20, bob], [-100n, 100n]);
    });
  });
});
