// AI-assisted B2 coordination. Two providers, no contract-to-contract linkage.
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");
const { ROOT, writeJson, assertChain, assertCode, confirmed, eventFrom, errorMessage } = require("./runtime");
const TOKEN_ABI = [
  "function decimals() view returns(uint8)", "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)", "function approve(address,uint256) returns(bool)",
];

async function timestamp(chain) { return (await chain.provider.getBlock("latest")).timestamp; }
function assertTimelocks(longDeadline, shortDeadline, longNow, shortNow, options) {
  if (longDeadline - shortDeadline < options.minGap ||
      (longDeadline - longNow) - (shortDeadline - shortNow) < options.minGap) {
    throw new Error("Insufficient timelock gap; stop before creating/revealing the counter-lock");
  }
  if (longDeadline - longNow < options.minWindow || shortDeadline - shortNow < options.minWindow) {
    throw new Error("Insufficient claim window; inspect locks and use the refund path after expiry");
  }
}
async function verifyLock(contract, id, expected) {
  const swap = await contract.swaps(id);
  for (const [key, value] of Object.entries(expected)) {
    const actual = swap[key];
    if (String(actual).toLowerCase() !== String(value).toLowerCase()) throw new Error(`Counterparty lock mismatch: ${key}`);
  }
  if (swap.status !== 1n) throw new Error("Counterparty lock is not active");
  return swap;
}
function verifyCreated(receipt, contract, id, expected) {
  const event = eventFrom(receipt, contract, "SwapCreated", id);
  for (const [key, value] of Object.entries(expected)) {
    if (String(event[key]).toLowerCase() !== String(value).toLowerCase()) throw new Error(`Creation event mismatch: ${key}`);
  }
}
async function runSuccessfulSwap(chains, options, output = {}) {
  const first = chains.sepolia;
  const second = chains.arbitrumSepolia;
  if (first.chainId === second.chainId) throw new Error("The swap requires two different chain IDs");
  for (const chain of [first, second]) {
    await assertChain(chain);
    await assertCode(chain, chain.address, chain.contract);
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

  const preimage = ethers.hexlify(ethers.randomBytes(32));
  const hashlock = ethers.keccak256(preimage);
  const runId = ethers.hexlify(ethers.randomBytes(16)).slice(2);
  const rainSwapId = ethers.hexlify(ethers.randomBytes(32));
  const ethSwapId = ethers.hexlify(ethers.randomBytes(32));
  const reportFile = path.join(output.runDir || path.join(ROOT, "runs"), `${runId}.json`);
  const secretDir = output.secretDir || path.join(ROOT, ".local/secrets");
  fs.mkdirSync(secretDir, { recursive: true });
  // Keep the preimage recoverable on failure, separate from public run records.
  fs.writeFileSync(path.join(secretDir, `${runId}.json`), JSON.stringify({ runId, rainSwapId, ethSwapId, preimage, hashlock }), { flag: "wx", mode: 0o600 });
  const report = { schemaVersion: 1, runId, status: "running", alice, bob, hashlock,
    startedAt: new Date().toISOString(),
    rain: { network: first.key, chainId: first.chainId, contract: first.address, token: options.rainAddress, swapId: rainSwapId, amount: rainAmount.toString() },
    eth: { network: second.key, chainId: second.chainId, contract: second.address, token: ethers.ZeroAddress, swapId: ethSwapId, amount: ethAmount.toString() },
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
    const rainExpected = { sender: alice, receiver: bob, token: options.rainAddress, amount: rainAmount, hashlock, timelock: longDeadline };
    report.rain.timelock = longDeadline;
    save();
    const rainReceipt = await confirmed(first,
      await first.htlc.connect(first.alice).createERC20Swap(rainSwapId, bob, options.rainAddress, rainAmount, hashlock, longDeadline), "Lock Rain", journal);
    verifyCreated(rainReceipt, first.htlc, rainSwapId, rainExpected);
    // Bob independently reads the first chain before committing his ETH.
    await verifyLock(first.htlc.connect(first.bob), rainSwapId, rainExpected);
    const shortDeadline = await timestamp(second) + options.ethSeconds;
    assertTimelocks(longDeadline, shortDeadline, await timestamp(first), await timestamp(second), options);
    const ethExpected = { sender: bob, receiver: alice, token: ethers.ZeroAddress, amount: ethAmount, hashlock, timelock: shortDeadline };
    report.eth.timelock = shortDeadline;
    save();
    const ethReceipt = await confirmed(second,
      await second.htlc.connect(second.bob).createETHSwap(ethSwapId, alice, hashlock, shortDeadline, { value: ethAmount }), "Lock ETH", journal);
    verifyCreated(ethReceipt, second.htlc, ethSwapId, ethExpected);
    // Alice verifies both active locks before publishing her secret.
    await verifyLock(first.htlc, rainSwapId, rainExpected);
    await verifyLock(second.htlc.connect(second.alice), ethSwapId, ethExpected);
    assertTimelocks(longDeadline, shortDeadline, await timestamp(first), await timestamp(second), options);
    if (output.stopAfterLocks) {
      report.status = "locked";
      save();
      console.log("Locked: Rain=Active, ETH=Active; no secret has been revealed.");
      return report;
    }
    const ethClaim = await confirmed(second,
      await second.htlc.connect(second.alice).claim(ethSwapId, preimage), "Alice claims ETH", journal);
    // Bob obtains s from the confirmed on-chain event, not Alice's local secret file.
    const observed = await second.provider.getTransactionReceipt(ethClaim.hash);
    if (!observed || observed.status !== 1 || observed.blockHash !== ethClaim.blockHash) throw new Error("ETH claim receipt changed; inspect chain state before proceeding");
    const revealed = eventFrom(observed, second.htlc, "SwapClaimed", ethSwapId).preimage;
    if (ethers.keccak256(revealed) !== hashlock) throw new Error("Revealed preimage does not match the agreed hashlock");
    if ((await second.htlc.swaps(ethSwapId)).status !== 2n) throw new Error("ETH claim state was not confirmed");
    await verifyLock(first.htlc, rainSwapId, rainExpected);
    // Once the secret is public, attempt Bob's claim for as long as it is valid.
    if (await timestamp(first) >= longDeadline) throw new Error("Rain claim expired; inspect the confirmed ETH claim immediately");
    const rainClaim = await confirmed(first,
      await first.htlc.connect(first.bob).claim(rainSwapId, revealed), "Bob claims Rain", journal);
    eventFrom(rainClaim, first.htlc, "SwapClaimed", rainSwapId);
    const rainState = await first.htlc.swaps(rainSwapId);
    const ethState = await second.htlc.swaps(ethSwapId);
    if (rainState.status !== 2n || ethState.status !== 2n) throw new Error("Both swaps must be claimed");
    if (await token.balanceOf(bob) - rainBefore < rainAmount) throw new Error("Bob did not receive the expected Rain amount");
    Object.assign(report, { status: "completed", completedAt: new Date().toISOString(), finalStatus: { rain: "Claimed", eth: "Claimed" } });
    save();
    console.log("Completed: Rain=Claimed, ETH=Claimed");
    for (const tx of report.transactions) console.log(`${tx.label}: ${tx.url || tx.hash}`);
    return report;
  } catch (error) {
    report.status = "incomplete";
    report.error = errorMessage(error).split(preimage).join("[secret redacted]");
    save();
    console.error(`Stopped; inspect ${reportFile}. Submitted transactions are recorded; do not blindly rerun. Secret recovery: .local/secrets/${runId}.json`);
    throw new Error(report.error);
  }
}
module.exports = { runSuccessfulSwap, verifyLock, assertTimelocks };
