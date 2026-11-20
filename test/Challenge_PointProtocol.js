// Challenge Part: acceptance tests for scripts/lib/pointLock.js (off-chain point-lock arithmetic).
// AI-assisted (function-level): test written with AI help; see docs/AI_ASSISTANCE.md.
// CH1: Bob's check that the two locks are related. CH2: deriving the second claim scalar.
// CH3: failed verifications and incorrect-secret cases.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { N, randomScalar, pointOf, lockOf, createOffer, verifyOffer, deriveTokenSecret } = require("../scripts/lib/pointLock");

describe("Challenge: off-chain point-lock protocol", function () {
  describe("scalars and points", function () {
    it("randomScalar stays in [1, n-1] and does not repeat", function () {
      const seen = new Set();
      for (let i = 0; i < 200; i += 1) {
        const scalar = randomScalar();
        expect(scalar >= 1n && scalar < N, `scalar ${scalar}`).to.equal(true);
        seen.add(scalar);
      }
      expect(seen.size).to.equal(200);
    });

    it("pointOf returns the uncompressed public key and lockOf its address", function () {
      // Private key 1 is the generator G; its address is a well-known constant.
      expect(pointOf(1n)).to.equal(
        "0x0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798" +
          "483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8"
      );
      expect(lockOf(pointOf(1n))).to.equal("0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf");
    });

    it("pointOf rejects 0, n and non-bigint input", function () {
      for (const bad of [0n, N, N + 5n, -1n, 5, "5"]) {
        expect(() => pointOf(bad), `input ${bad}`).to.throw("[1, n-1]");
      }
    });
  });

  describe("createOffer (Alice)", function () {
    it("produces two different locks related by the blind", function () {
      const t = 11n;
      const r = 31n;
      const made = createOffer(t, r);
      expect(made.secret).to.equal(t);
      expect(made.offer.ethPoint).to.equal(pointOf(t));
      expect(made.offer.blind).to.equal(ethers.toBeHex(r, 32));
      expect(made.ethLock).to.equal(lockOf(pointOf(t)));
      expect(made.tokenLock).to.equal(lockOf(pointOf(42n)));
      expect(made.tokenLock).to.not.equal(made.ethLock);
    });

    it("wraps t + r modulo n", function () {
      const made = createOffer(N - 1n, 3n);
      expect(made.tokenLock).to.equal(lockOf(pointOf(2n)));
    });

    it("never puts the secret scalar into the offer and draws fresh scalars by default", function () {
      const first = createOffer();
      const second = createOffer();
      expect(JSON.stringify(first.offer)).to.not.include(ethers.toBeHex(first.secret, 32).slice(2));
      expect(Object.keys(first.offer).sort()).to.deep.equal(["blind", "ethPoint"]);
      expect(first.ethLock).to.not.equal(second.ethLock);
      expect(first.offer.blind).to.not.equal(second.offer.blind);
    });

    it("refuses t + r = 0 mod n and out-of-range scalars", function () {
      expect(() => createOffer(5n, N - 5n)).to.throw("zero");
      expect(() => createOffer(0n, 5n)).to.throw("[1, n-1]");
      expect(() => createOffer(5n, N)).to.throw("[1, n-1]");
    });
  });

  describe("verifyOffer (Bob, before the second lock)", function () {
    const made = createOffer();

    it("accepts a correct offer and returns the lock Bob must use on the ETH chain", function () {
      expect(verifyOffer(made.offer, made.tokenLock)).to.equal(made.ethLock);
      expect(verifyOffer(made.offer, made.tokenLock.toLowerCase())).to.equal(made.ethLock);
    });

    it("accepts a compressed ethPoint", function () {
      const compressed = ethers.SigningKey.computePublicKey(made.offer.ethPoint, true);
      expect(verifyOffer({ ...made.offer, ethPoint: compressed }, made.tokenLock)).to.equal(made.ethLock);
    });

    it("rejects a wrong blind", function () {
      const wrong = { ...made.offer, blind: ethers.toBeHex(randomScalar(), 32) };
      expect(() => verifyOffer(wrong, made.tokenLock)).to.throw("Point-lock offer rejected: token lock is not");
    });

    it("rejects an unrelated lock pair", function () {
      const other = createOffer();
      expect(() => verifyOffer(made.offer, other.tokenLock)).to.throw("Point-lock offer rejected: token lock is not");
      expect(() => verifyOffer({ ...made.offer, ethPoint: other.offer.ethPoint }, made.tokenLock))
        .to.throw("Point-lock offer rejected: token lock is not");
    });

    it("rejects a token lock equal to the ETH lock (same value on both chains)", function () {
      expect(() => verifyOffer(made.offer, made.ethLock)).to.throw("Point-lock offer rejected");
    });

    it("rejects malformed input", function () {
      const offCurve = "0x04" + "11".repeat(64);
      const cases = [
        [{ ...made.offer, ethPoint: offCurve }, "not a valid secp256k1 point"],
        [{ ...made.offer, ethPoint: ethers.toBeHex(made.secret, 32) }, "not a valid secp256k1 point"],
        [{ ...made.offer, ethPoint: "0x1234" }, "not a valid secp256k1 point"],
        [{ ...made.offer, blind: ethers.ZeroHash }, "blind is out of range"],
        [{ ...made.offer, blind: ethers.toBeHex(N, 32) }, "blind is out of range"],
        [{ ...made.offer, blind: "0x05" }, "32-byte hex"],
        [{ ethPoint: made.offer.ethPoint }, "32-byte hex"],
        [undefined, "32-byte hex"],
      ];
      for (const [offer, message] of cases) {
        expect(() => verifyOffer(offer, made.tokenLock), message)
          .to.throw(new RegExp(`^Point-lock offer rejected: .*${message}`));
      }
      expect(() => verifyOffer(made.offer, "not-an-address")).to.throw("Point-lock offer rejected");
    });
  });

  describe("deriveTokenSecret (Bob, after Alice's claim)", function () {
    it("returns (t + r) mod n when it opens the token lock", function () {
      const made = createOffer(N - 1n, 3n);
      expect(deriveTokenSecret(N - 1n, made.offer.blind, made.tokenLock)).to.equal(2n);
    });

    it("rejects a wrong revealed scalar, a wrong blind and a wrong lock", function () {
      const made = createOffer();
      const other = createOffer();
      expect(() => deriveTokenSecret(other.secret, made.offer.blind, made.tokenLock)).to.throw("does not open");
      expect(() => deriveTokenSecret(made.secret, other.offer.blind, made.tokenLock)).to.throw("does not open");
      expect(() => deriveTokenSecret(made.secret, made.offer.blind, other.tokenLock)).to.throw("does not open");
      expect(() => deriveTokenSecret(0n, made.offer.blind, made.tokenLock)).to.throw("[1, n-1]");
    });
  });

  describe("against the contracts", function () {
    it("runs offer -> verify -> two locks -> claim -> derive -> claim on the point-lock HTLCs", async function () {
      const [alice, bob] = await ethers.getSigners();
      const token = await ethers.deployContract("TestToken", [alice.address, 100n]);
      const erc20 = await ethers.deployContract("ERC20PointHTLC");
      const eth = await ethers.deployContract("ETHPointHTLC");
      await token.approve(erc20.target, 100n);
      const now = await time.latest();
      const tokenSwap = ethers.id("token-swap");
      const ethSwap = ethers.id("eth-swap");

      // Alice: private scalars, first lock, then the offer goes to Bob off-chain.
      const made = createOffer();
      await erc20.createERC20Swap(tokenSwap, bob.address, token.target, 100n, made.tokenLock, now + 1200);

      // Bob: reads the token lock from the chain, checks the offer, only then locks ETH.
      const onChainLock = (await erc20.swaps(tokenSwap)).pointLock;
      const ethLock = verifyOffer(made.offer, onChainLock);
      await eth.connect(bob).createETHSwap(ethSwap, alice.address, ethLock, now + 600, { value: 100n });

      // Alice claims ETH; the scalar becomes public in the event.
      const receipt = await (await eth.connect(alice).claim(ethSwap, made.secret)).wait();
      const revealed = eth.interface.parseLog(receipt.logs[0]).args.secret;

      // Bob derives his scalar and claims the tokens.
      const tokenSecret = deriveTokenSecret(revealed, made.offer.blind, onChainLock);
      await expect(erc20.connect(bob).claim(tokenSwap, tokenSecret))
        .to.changeTokenBalances(token, [erc20, bob], [-100n, 100n]);

      // Nothing published on one chain appears on the other.
      expect(revealed).to.not.equal(tokenSecret);
      expect(ethLock).to.not.equal(onChainLock);
    });
  });
});
