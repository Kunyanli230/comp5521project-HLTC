// AI-assisted tests for the shared integration contract, including expiry boundaries.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Project HTLC interface", function () {
  async function fixture() {
    const [alice, bob, outsider] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("TestToken")).deploy(alice.address, 1000n);
    const erc20 = await (await ethers.getContractFactory("ERC20HTLC")).deploy();
    const eth = await (await ethers.getContractFactory("ETHHTLC")).deploy();
    await Promise.all([token.waitForDeployment(), erc20.waitForDeployment(), eth.waitForDeployment()]);
    const preimage = ethers.hexlify(ethers.randomBytes(32));
    const hashlock = ethers.keccak256(preimage);
    const id = ethers.id("rain-swap");
    const deadline = await time.latest() + 600;
    await token.approve(erc20.target, 1000n);
    return { alice, bob, outsider, token, erc20, eth, preimage, hashlock, id, deadline };
  }
  for (const asset of ["Rain", "ETH"]) {
    async function locked() {
      const f = await loadFixture(fixture);
      f.htlc = asset === "Rain" ? f.erc20 : f.eth;
      f.create = (id = f.id, receiver = f.bob.address, hashlock = f.hashlock, deadline = f.deadline, amount = 100n) => asset === "Rain"
        ? f.erc20.createERC20Swap(id, receiver, f.token.target, amount, hashlock, deadline)
        : f.eth.createETHSwap(id, receiver, hashlock, deadline, { value: amount });
      return f;
    }
    it(`${asset}: creates a typed lock, emits the preimage and pays only the receiver`, async function () {
      const f = await locked();
      await expect(f.create()).to.emit(f.htlc, "SwapCreated").withArgs(f.id, f.alice.address, f.bob.address,
        asset === "Rain" ? f.token.target : ethers.ZeroAddress, 100n, f.hashlock, f.deadline);
      await expect(f.htlc.connect(f.outsider).claim(f.id, f.preimage)).to.be.revertedWithCustomError(f.htlc, "NotReceiver");
      await expect(f.htlc.connect(f.bob).claim(f.id, ethers.ZeroHash)).to.be.revertedWithCustomError(f.htlc, "InvalidSecret");
      const claim = () => f.htlc.connect(f.bob).claim(f.id, f.preimage);
      if (asset === "Rain") await expect(claim()).to.changeTokenBalances(f.token, [f.htlc, f.bob], [-100n, 100n]);
      else await expect(claim()).to.changeEtherBalances([f.htlc, f.bob], [-100n, 100n]);
      expect((await f.htlc.swaps(f.id)).status).to.equal(2n);
      await expect(claim()).to.be.revertedWithCustomError(f.htlc, "AlreadyCompleted");
      await expect(f.htlc.refund(f.id)).to.be.revertedWithCustomError(f.htlc, "AlreadyCompleted");
    });
    it(`${asset}: rejects invalid and duplicate locks`, async function () {
      const f = await locked();
      for (const args of [[ethers.ZeroHash], [f.id, ethers.ZeroAddress], [f.id, f.alice.address],
        [f.id, f.bob.address, ethers.ZeroHash], [f.id, f.bob.address, f.hashlock, 1],
        [f.id, f.bob.address, f.hashlock, f.deadline, 0n]]) {
        await expect(f.create(...args)).to.be.revertedWithCustomError(f.htlc, "InvalidInput");
      }
      await f.create();
      await expect(f.create()).to.be.revertedWithCustomError(f.htlc, "SwapAlreadyExists");
      await expect(f.htlc.refund(ethers.id("missing"))).to.be.revertedWithCustomError(f.htlc, "SwapNotFound");
    });
    it(`${asset}: rejects claims at expiry and allows exactly one sender refund`, async function () {
      const f = await locked();
      await f.create();
      await expect(f.htlc.refund(f.id)).to.be.revertedWithCustomError(f.htlc, "RefundNotReady");
      await expect(f.htlc.connect(f.bob).refund(f.id)).to.be.revertedWithCustomError(f.htlc, "NotSender");
      await time.setNextBlockTimestamp(f.deadline);
      await expect(f.htlc.connect(f.bob).claim(f.id, f.preimage)).to.be.revertedWithCustomError(f.htlc, "ClaimExpired");
      await expect(f.htlc.refund(f.id)).to.emit(f.htlc, "SwapRefunded").withArgs(f.id);
      expect((await f.htlc.swaps(f.id)).status).to.equal(3n);
      await expect(f.htlc.refund(f.id)).to.be.revertedWithCustomError(f.htlc, "AlreadyCompleted");
      await expect(f.htlc.connect(f.bob).claim(f.id, f.preimage)).to.be.revertedWithCustomError(f.htlc, "AlreadyCompleted");
      await expect(f.create()).to.be.revertedWithCustomError(f.htlc, "InvalidInput");
    });
  }
  it("requires token approval and rejects non-contract token addresses", async function () {
    const f = await loadFixture(fixture);
    await expect(f.erc20.createERC20Swap(f.id, f.bob.address, f.outsider.address, 1, f.hashlock, f.deadline)).to.be.revertedWithCustomError(f.erc20, "InvalidInput");
    await f.token.approve(f.erc20.target, 0);
    await expect(f.erc20.createERC20Swap(f.id, f.bob.address, f.token.target, 1, f.hashlock, f.deadline)).to.be.reverted;
    expect((await f.erc20.swaps(f.id)).status).to.equal(0n);
  });
});
