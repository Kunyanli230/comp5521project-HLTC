// Off-chain secp256k1 arithmetic for the point-lock swaps.
const { ethers } = require("ethers");

const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

function assertScalar(value, name) {
  if (typeof value !== "bigint" || value < 1n || value >= N) {
    throw new RangeError(name + " must be a bigint in [1, n-1]");
  }
}

function randomScalar() {
  let scalar;
  do {
    scalar = ethers.toBigInt(ethers.randomBytes(32));
  } while (scalar === 0n || scalar >= N);
  return scalar;
}

function pointOf(scalar) {
  assertScalar(scalar, "scalar");
  return ethers.SigningKey.computePublicKey(ethers.toBeHex(scalar, 32), false);
}

function lockOf(point) {
  // ethers also accepts private keys here. A protocol point must encode a public key.
  if (!ethers.isHexString(point, true) || ethers.dataLength(point) === 32) {
    throw new TypeError("Expected a secp256k1 public key");
  }
  return ethers.computeAddress(point);
}

function createOffer(t = randomScalar(), r = randomScalar()) {
  assertScalar(t, "t");
  assertScalar(r, "r");
  const tokenSecret = (t + r) % N;
  if (tokenSecret === 0n) throw new RangeError("t + r is zero modulo n");

  const ethPoint = pointOf(t);
  return {
    secret: t,
    offer: { ethPoint, blind: ethers.toBeHex(r, 32) },
    ethLock: lockOf(ethPoint),
    tokenLock: lockOf(pointOf(tokenSecret)),
  };
}

function matchesLock(expected, supplied) {
  return ethers.isAddress(supplied) && ethers.getAddress(supplied) === expected;
}

function verifyOffer(offer, tokenLock) {
  const { ethPoint, blind } = offer ?? {};
  if (!ethers.isHexString(blind, 32)) {
    throw new Error("Point-lock offer rejected: blind must be a 32-byte hex string");
  }
  const r = ethers.toBigInt(blind);
  if (r === 0n || r >= N) throw new Error("Point-lock offer rejected: blind is out of range");

  let ethLock;
  try {
    ethLock = lockOf(ethPoint);
  } catch {
    throw new Error("Point-lock offer rejected: ethPoint is not a valid secp256k1 point");
  }

  let expected;
  try {
    expected = lockOf(ethers.SigningKey.addPoints(ethPoint, pointOf(r), false));
  } catch {
    // Both inputs are valid, but their sum can be the point at infinity.
    throw new Error("Point-lock offer rejected: the sum of the points has no address");
  }
  if (!matchesLock(expected, tokenLock)) {
    throw new Error("Point-lock offer rejected: token lock is not the address of ethPoint + blind*G");
  }
  return ethLock;
}

function deriveTokenSecret(revealed, blind, tokenLock) {
  assertScalar(revealed, "revealed scalar");
  const r = ethers.toBigInt(blind);
  assertScalar(r, "blind");
  const secret = (revealed + r) % N;
  if (secret === 0n || !matchesLock(lockOf(pointOf(secret)), tokenLock)) {
    throw new Error("Derived scalar does not open the token lock");
  }
  return secret;
}

module.exports = { N, randomScalar, pointOf, lockOf, createOffer, verifyOffer, deriveTokenSecret };
