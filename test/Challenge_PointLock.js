// Challenge Part: PointLock.pointAddress(scalar) must equal the Ethereum address of scalar*G.
// The reference value comes from ethers (off-chain secp256k1), the tested value from the
// on-chain ecrecover call, so the two implementations are independent.
const { expect } = require("chai");
const { ethers } = require("hardhat");

const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

function reference(scalar) {
  return ethers.computeAddress(ethers.toBeHex(scalar, 32));
}

describe("Challenge: PointLock.pointAddress", function () {
  let harness;

  before(async function () {
    harness = await (await ethers.getContractFactory("PointLockHarness")).deploy();
    await harness.waitForDeployment();
  });

  it("matches ethers for edge scalars 1, 2, n-2, n-1", async function () {
    for (const scalar of [1n, 2n, N - 2n, N - 1n]) {
      expect(await harness.pointAddress(scalar), `scalar ${scalar}`).to.equal(reference(scalar));
    }
  });

  it("matches ethers for 50 random scalars", async function () {
    for (let i = 0; i < 50; i += 1) {
      const scalar = (ethers.toBigInt(ethers.randomBytes(32)) % (N - 1n)) + 1n;
      expect(await harness.pointAddress(scalar), `scalar ${scalar}`).to.equal(reference(scalar));
    }
  });

  it("returns the zero address for scalars outside [1, n-1]", async function () {
    for (const scalar of [0n, N, N + 1n, 2n ** 256n - 1n]) {
      expect(await harness.pointAddress(scalar), `scalar ${scalar}`).to.equal(ethers.ZeroAddress);
    }
  });

  it("is additive: address((t + r) mod n) equals the address of T + r*G computed off-chain", async function () {
    const t = (ethers.toBigInt(ethers.randomBytes(32)) % (N - 1n)) + 1n;
    const r = (ethers.toBigInt(ethers.randomBytes(32)) % (N - 1n)) + 1n;
    const T = new ethers.SigningKey(ethers.toBeHex(t, 32)).publicKey;
    const rG = new ethers.SigningKey(ethers.toBeHex(r, 32)).publicKey;
    const sum = ethers.SigningKey.addPoints(T, rG);
    expect(await harness.pointAddress((t + r) % N)).to.equal(ethers.computeAddress(sum));
  });
});
