const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");
const { ROOT, writeJson, assertChain, assertCode, compareBytecode, confirmed, eventFrom, errorMessage } = require("./runtime");
const { verifyLock, verifyCreated, assertTimelocks } = require("./protocol");
const { N, createOffer, verifyOffer, deriveTokenSecret } = require("./pointLock");

const TOKEN_ABI = [
  "function decimals() view returns(uint8)", "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)", "function approve(address,uint256) returns(bool)",
];

async function timestamp(chain) { return (await chain.provider.getBlock("latest")).timestamp; }

function pointArtifact(name) {
  const file = path.join(ROOT, "artifacts/contracts/challenge", name + ".sol", name + ".json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function assertPointDeployment(chain) {
  if (ethers.getAddress(chain.htlc.target) !== ethers.getAddress(chain.address)) {
    throw new Error(chain.name + ": contract instance and deployment address differ");
  }
  const code = await chain.provider.getCode(chain.address);
  const result = compareBytecode(code, pointArtifact(chain.contract).deployedBytecode);
  if (result.match === "mismatch") throw new Error(chain.name + ": deployment check failed: " + result.reason);
  if (result.match === "metadata-only") console.warn(chain.name + ": compiler metadata differs");
}

function publicError(error, made) {
  const blind = ethers.toBigInt(made.offer.blind);
  const values = [made.secret, blind, (made.secret + blind) % N];
  // RPC errors can contain ABI calldata (hex without a prefix) or decoded arguments.
  let message = errorMessage(error);
  for (const scalar of values) {
    const hex = ethers.toBeHex(scalar, 32).slice(2);
    message = message.replace(new RegExp(hex, "gi"), "[redacted]").replaceAll(scalar.toString(), "[redacted]");
  }
  return message.replace(new RegExp(made.offer.ethPoint.slice(2), "gi"), "[redacted]");
}

async function runPointSwap(chains, options, output = {}) {
  const first = chains.sepolia;
  const second = chains.arbitrumSepolia;
  if (first.chainId === second.chainId) throw new Error("The swap requires two different chain IDs");
  for (const chain of [first, second]) {
    await assertChain(chain);
    await assertPointDeployment(chain);
  }
  const alice = await first.alice.getAddress();
  const bob = await first.bob.getAddress();
  if (alice === bob || await second.alice.getAddress() !== alice || await second.bob.getAddress() !== bob) throw new Error("Participant addresses must match on both chains and be distinct");
  await assertCode(first, options.rainAddress);
  const token = new ethers.Contract(options.rainAddress, TOKEN_ABI, first.alice);
  const rainAmount = ethers.parseUnits(options.rainAmount, await token.decimals());
  const ethAmount = ethers.parseEther(options.ethAmount);
  if (rainAmount <= 0n || ethAmount <= 0n) throw new Error("Swap amounts must be positive");
  const rainBefore = await token.balanceOf(bob);
  if (await token.balanceOf(alice) < rainAmount) throw new Error("Alice has insufficient Rain");
  for (const chain of [first, second]) {
    for (const role of ["alice", "bob"]) {
      const balance = await chain.provider.getBalance(await chain[role].getAddress());
      const fees = await chain.provider.getFeeData();
      const gasBudget = (fees.maxFeePerGas || fees.gasPrice || 1n) * 500000n;
      const value = chain === second && role === "bob" ? ethAmount : 0n;
      if (balance < value + gasBudget) throw new Error(`${chain.name}: ${role} needs more test ETH (value plus gas buffer)`);
    }
  }

  const made = createOffer();
  const runId = ethers.hexlify(ethers.randomBytes(16)).slice(2);
  const rainSwapId = ethers.hexlify(ethers.randomBytes(32));
  const ethSwapId = ethers.hexlify(ethers.randomBytes(32));
  const reportFile = path.join(output.runDir || path.join(ROOT, "runs"), runId + ".json");
  const secretDir = output.secretDir || path.join(ROOT, ".local/secrets");
  fs.mkdirSync(secretDir, { recursive: true, mode: 0o700 });
  const privateRecord = { runId, rainSwapId, ethSwapId, secret: ethers.toBeHex(made.secret, 32), offer: made.offer };
  fs.writeFileSync(path.join(secretDir, runId + ".json"), JSON.stringify(privateRecord), { flag: "wx", mode: 0o600 });

  const report = {
    schemaVersion: 1, mode: "point-lock", runId, status: "running", alice, bob, startedAt: new Date().toISOString(),
    rain: { network: first.key, chainId: first.chainId, contract: first.address, token: options.rainAddress,
      swapId: rainSwapId, amount: rainAmount.toString(), pointLock: made.tokenLock },
    eth: { network: second.key, chainId: second.chainId, contract: second.address, token: ethers.ZeroAddress,
      swapId: ethSwapId, amount: ethAmount.toString() },
    transactions: [],
  };
  const save = () => writeJson(reportFile, report);
  const journal = (entry) => {
    const index = report.transactions.findIndex((tx) => tx.hash === entry.hash && tx.chainId === entry.chainId);
    if (index < 0) report.transactions.push({ ...entry }); else report.transactions[index] = { ...entry };
    save();
  };
  save();
  console.log(`Run report: ${reportFile}`);
  try {
    const allowance = await token.allowance(alice, first.address);
    if (allowance < rainAmount) {
      if (allowance > 0n) await confirmed(first, await token.approve(first.address, 0), "Reset Rain allowance", journal);
      await confirmed(first, await token.approve(first.address, rainAmount), "Approve Rain", journal);
    }
    const longDeadline = await timestamp(first) + options.rainSeconds;
    const initialShort = await timestamp(second) + options.ethSeconds;
    assertTimelocks(longDeadline, initialShort, await timestamp(first), await timestamp(second), options);
    const rainTerms = { sender: alice, receiver: bob, token: options.rainAddress, amount: rainAmount, timelock: longDeadline };
    const aliceRainLock = { ...rainTerms, pointLock: made.tokenLock };
    report.rain.timelock = longDeadline;
    save();
    const rainTx = await first.htlc.connect(first.alice).createERC20Swap(
      rainSwapId, bob, options.rainAddress, rainAmount, made.tokenLock, longDeadline);
    const rainReceipt = await confirmed(first, rainTx, "Lock Rain", journal);
    verifyCreated(rainReceipt, first.htlc, rainSwapId, aliceRainLock);

    // Bob verifies the delivered offer against the active lock read through his own connection.
    const sent = output.sendOffer ? await output.sendOffer({ ...made.offer }) : made.offer;
    const offer = { ethPoint: sent?.ethPoint, blind: sent?.blind };
    const bobRain = first.htlc.connect(first.bob);
    const { pointLock: observedRainLock } = await verifyLock(bobRain, rainSwapId, rainTerms);
    const ethLock = verifyOffer(offer, observedRainLock);
    const shortDeadline = await timestamp(second) + options.ethSeconds;
    assertTimelocks(longDeadline, shortDeadline, await timestamp(first), await timestamp(second), options);
    const ethTerms = { sender: bob, receiver: alice, token: ethers.ZeroAddress, amount: ethAmount, timelock: shortDeadline };
    Object.assign(report.eth, { pointLock: ethLock, timelock: shortDeadline });
    save();
    const ethTx = await second.htlc.connect(second.bob).createETHSwap(
      ethSwapId, alice, ethLock, shortDeadline, { value: ethAmount });
    const ethReceipt = await confirmed(second, ethTx, "Lock ETH", journal);
    verifyCreated(ethReceipt, second.htlc, ethSwapId, { ...ethTerms, pointLock: ethLock });

    // Alice independently checks both commitments before revealing her scalar.
    await verifyLock(first.htlc, rainSwapId, aliceRainLock);
    await verifyLock(second.htlc.connect(second.alice), ethSwapId, { ...ethTerms, pointLock: made.ethLock });
    assertTimelocks(longDeadline, shortDeadline, await timestamp(first), await timestamp(second), options);
    if (output.stopAfterLocks) {
      report.status = "locked";
      save();
      return report;
    }
    const ethClaim = await confirmed(second,
      await second.htlc.connect(second.alice).claim(ethSwapId, made.secret), "Alice claims ETH", journal);

    const observed = await second.provider.getTransactionReceipt(ethClaim.hash);
    if (!observed || observed.blockHash !== ethClaim.blockHash) throw new Error("ETH claim receipt changed");
    const revealed = eventFrom(observed, second.htlc, "SwapClaimed", ethSwapId).secret;
    if ((await second.htlc.swaps(ethSwapId)).status !== 2n) throw new Error("ETH claim state was not confirmed");
    await verifyLock(bobRain, rainSwapId, { ...rainTerms, pointLock: observedRainLock });
    const tokenSecret = deriveTokenSecret(revealed, offer.blind, observedRainLock);
    if (await timestamp(first) >= longDeadline) throw new Error("Rain claim expired");
    const rainClaim = await confirmed(first, await bobRain.claim(rainSwapId, tokenSecret), "Bob claims Rain", journal);
    eventFrom(rainClaim, first.htlc, "SwapClaimed", rainSwapId);
    const rainState = await first.htlc.swaps(rainSwapId);
    const ethState = await second.htlc.swaps(ethSwapId);
    if (rainState.status !== 2n || ethState.status !== 2n) throw new Error("Both swaps must be claimed");
    if (await token.balanceOf(bob) - rainBefore < rainAmount) throw new Error("Bob did not receive the expected Rain amount");
    Object.assign(report, { status: "completed", completedAt: new Date().toISOString(), finalStatus: { rain: "Claimed", eth: "Claimed" } });
    save();
    return report;
  } catch (error) {
    report.status = "incomplete";
    report.error = publicError(error, made);
    save();
    throw new Error(report.error);
  }
}

module.exports = { runPointSwap, pointArtifact };
