const { expect } = require("chai");

describe("SimpleHTLC", function () {
  async function setup() {
    const [alice, bob] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("TestToken");
    const HTLC = await ethers.getContractFactory("SimpleHTLC");
    const token = await Token.deploy(alice.address, ethers.parseUnits("1000", 18));
    const htlc = await HTLC.deploy();
    await Promise.all([token.waitForDeployment(), htlc.waitForDeployment()]);
    const preimage = ethers.encodeBytes32String("class-demo-secret");
    const hashlock = ethers.keccak256(ethers.solidityPacked(["bytes32"], [preimage]));
    const timelock = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    return { alice, bob, token, htlc, preimage, hashlock, timelock };
  }

  it("uses one hashlock to release locked Rain and ETH", async function () {
    const { alice, bob, token, htlc, preimage, hashlock, timelock } = await setup();
    const rain = ethers.parseUnits("100", 18);
    const eth = ethers.parseEther("1");
    const rainId = ethers.keccak256(ethers.toUtf8Bytes("rain-swap"));
    const ethId = ethers.keccak256(ethers.toUtf8Bytes("eth-swap"));
    await token.approve(await htlc.getAddress(), rain);
    await htlc.createERC20Swap(rainId, bob.address, await token.getAddress(), rain, hashlock, timelock);
    await htlc.connect(bob).createETHSwap(ethId, alice.address, hashlock, timelock, { value: eth });
    await htlc.claim(ethId, preimage);
    await htlc.connect(bob).claim(rainId, preimage);
    expect(await token.balanceOf(bob.address)).to.equal(rain);
    expect((await htlc.swaps(rainId)).claimed).to.equal(true);
    expect((await htlc.swaps(ethId)).claimed).to.equal(true);
  });
});
