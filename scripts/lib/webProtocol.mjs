//Consume the snapshot read by B, prepare the next parameters and English interface prompts. The time rule directly calls the original protocol.assertTimelocks; Does not include wallets, DOM or HTTP processing.
import { isHexString, keccak256 } from "ethers";
import protocol from "./protocol.js";
import { STATUS, exactInteger, policyValues, assertFields, expectedLock } from "../../shared/swapInputs.mjs";
const { assertTimelocks } = protocol;
export function assessTimelocks(rainDeadline, ethDeadline, rainNow, ethNow, options = {}) {
  const longDeadline = exactInteger(rainDeadline, "Rain deadline");
  const shortDeadline = exactInteger(ethDeadline, "ETH deadline");
  const rainRemaining = longDeadline - exactInteger(rainNow, "Rain chain time");
  const ethRemaining = shortDeadline - exactInteger(ethNow, "ETH chain time");
  const deadlineGap = longDeadline - shortDeadline;
  const remainingGap = rainRemaining - ethRemaining;
  const { minGap, minWindow } = policyValues(options);
  const issues = [];
  
  try { assertTimeWindows(longDeadline, shortDeadline, rainNow, ethNow, { minGap, minWindow }); }
  catch (error) { issues.push(error.message); }
  return { rainRemaining, ethRemaining, deadlineGap, remainingGap, minGap, minWindow, issues };
}

// Page and transaction preparation reuse this check. Suspend subsequent wallet requests when there are problems.
export function assertTimeWindows(rainDeadline, ethDeadline, rainNow, ethNow, options = {}) {
  assertTimelocks(
    exactInteger(rainDeadline, "Rain deadline"), exactInteger(ethDeadline, "ETH deadline"),
    exactInteger(rainNow, "Rain chain time"), exactInteger(ethNow, "ETH chain time"), policyValues(options)
  );
}

export function recoveryView(record) {
  return record.recovery;
}

// The fields on both sides must belong to the same swap convention; Whether it is Active or expired will continue to be verified by specific operations.
export function assertPairFields(snapshot, setup, allowMissingEth = false) {
  
  if (snapshot.rain.swapId !== setup.rainSwapId || snapshot.eth.swapId !== setup.ethSwapId) {
    throw new Error("The snapshot belongs to different swap IDs.");
  }
  // The subsequent ETH locking or withdrawal process is all based on the premise that the Rain lock already exists.
  if (snapshot.rain.swap.status === STATUS.NONE) throw new Error("The Rain lock does not exist.");
  assertFields(snapshot.rain.swap, expectedLock(setup, "rain"), "Rain lock");
  if (snapshot.eth.swap.status === STATUS.NONE) {
    if (allowMissingEth) return;
    throw new Error("The ETH lock does not exist.");
  }
  assertFields(snapshot.eth.swap, expectedLock(setup, "eth"), "ETH lock");
}



// Prepare the parameters for Bob to lock ETH, return the plan, and subsequently, workflow.js requests MetaMask to send it.
export function planEthLock(snapshot, setup, policy = {}) {
  // Check the Rain field, but allow ETH not to be created yet because it is about to be created this time.
  assertPairFields(snapshot, setup, true);
  //Rain must not have claimed and not refunded. The ETH ID must not have any existing records to avoid duplicate lock-up.
  if (snapshot.rain.swap.status !== STATUS.ACTIVE) throw new Error("The Rain lock must be Active before Bob locks ETH.");
  if (snapshot.eth.swap.status !== STATUS.NONE) throw new Error("This ETH swap ID already exists. Inspect it instead of locking again.");

  const deadline = BigInt(snapshot.eth.block.timestamp) + BigInt(setup.ethSeconds);
  
  assertTimeWindows(snapshot.rain.swap.timelock, deadline,
    BigInt(snapshot.rain.block.timestamp), BigInt(snapshot.eth.block.timestamp), policy);
  // "method" specifies the contract function; The sender is the sender of this transaction. The value is the ETH carried, and the handling fee is calculated separately.
  const expected = expectedLock(setup, "eth", deadline);
  return {
    ...protocol.lockCall(setup.ethSwapId, expected),
    asset: "eth", action: "lock-eth", swapId: setup.ethSwapId,
    sender: setup.bob, deadline, expected, eventName: "SwapCreated"
  };
}

// Prepare the claim parameters for Alice to claim ETH; When actually sent, the secret will be made public on the chain.
export function planEthClaim(snapshot, setup, preimage, policy = {}) {
  assertPairFields(snapshot, setup);
  if (snapshot.eth.swap.status !== STATUS.ACTIVE) throw new Error("The ETH lock is not Active.");
  // Rain must still be valid or have been claimed. Secrets are not allowed to be disclosed in this process when they do not exist or have been refunded.
  if (![STATUS.ACTIVE, STATUS.CLAIMED].includes(snapshot.rain.swap.status)) {
    throw new Error("The Rain lock is unavailable. Do not reveal the secret.");
  }
  //B does not trust the "Backup Verified" mark on the client side. Check the secret and convention hashlock provided for this call by yourself.
  if (!isHexString(preimage, 32) || keccak256(preimage) !== setup.hashlock) {
    throw new Error("Provide the matching 32-byte secret from Alice's verified private backup.");
  }
  if (snapshot.rain.swap.status === STATUS.ACTIVE) {
    assertTimeWindows(snapshot.rain.swap.timelock, snapshot.eth.swap.timelock,
      BigInt(snapshot.rain.block.timestamp), BigInt(snapshot.eth.block.timestamp), policy);
  } else if (BigInt(snapshot.eth.block.timestamp) >= snapshot.eth.swap.timelock) {
    throw new Error("The ETH claim window has expired.");
  }
  return {
    asset: "eth", action: "claim-eth", method: "claim", swapId: setup.ethSwapId,
    sender: setup.alice, value: 0n, args: [setup.ethSwapId, preimage],
    expected: expectedLock(setup, "eth"), eventName: "SwapClaimed"
  };
}

//Prepare parameters for Bob to collect Rain; observed: Verification of the ETH withdrawal event from chainActions.js.
export function planRainClaim(snapshot, setup, observed) {
  assertPairFields(snapshot, setup);
  // Alice must have claimed ETH, and Rain must not have claimed it, not refunded it, and it must not have expired.
  if (snapshot.eth.swap.status !== STATUS.CLAIMED) throw new Error("Wait for Alice's confirmed ETH claim first.");
  if (snapshot.rain.swap.status !== STATUS.ACTIVE) throw new Error("The Rain lock is not Active.");
  if (BigInt(snapshot.rain.block.timestamp) >= snapshot.rain.swap.timelock) throw new Error("The Rain claim window has expired.");
  // The event result must belong to the same ETH exchange, be confirmed at least twice, and the secret hash must be the same as the agreement.
  if (!observed || observed.swapId !== setup.ethSwapId || observed.confirmations < 2 ||
      !isHexString(observed.preimage, 32) || keccak256(observed.preimage) !== setup.hashlock) {
    throw new Error("A matching secret from a confirmed ETH claim event is required.");
  }
  // Bob uses the secrets that have already been made public on the chain; This path does not read Alice's local backup.
  return {
    asset: "rain", action: "claim-rain", method: "claim", swapId: setup.rainSwapId,
    sender: setup.bob, value: 0n, args: [setup.rainSwapId, observed.preimage],
    expected: expectedLock(setup, "rain"), eventName: "SwapClaimed"
  };
}

// Calculate the page prompts and candidate operations based on the real query results without modifying the on-chain status.
export function workflowState(snapshot, setup, policy = {}) {
  const rain = snapshot.rain.swap;
  const eth = snapshot.eth.swap;
  const rainRecovery = recoveryView(snapshot.rain);
  const ethRecovery = recoveryView(snapshot.eth);
  const result = {
    phase: "Inspect", message: "Inspect both chain records before proceeding.",
    lockRain: false, lockEth: false, claimEth: false, claimRain: false,
    refundRain: rainRecovery.state === "REFUNDABLE",
    refundEth: ethRecovery.state === "REFUNDABLE"
  };
  // Neither side has been created: In the first step, Alice locks Rain.
  if (rain.status === STATUS.NONE && eth.status === STATUS.NONE) {
    return { ...result, phase: "1. Alice locks Rain", lockRain: true,
      message: "Alice: restore the private backup, select Ethereum Sepolia, then Lock Rain." };
  }
  // Before opening the subsequent normal processes, check the record fields first. Display the specific issue when there is a mismatch.
  try { assertPairFields(snapshot, setup, eth.status === STATUS.NONE); }
  catch (error) { return { ...result, phase: "Parameters do not match", message: error.message }; }

  if (result.refundRain && ["CLAIMABLE", "CLOSING"].includes(ethRecovery.state)) {
    return { ...result, phase: "Unsafe deadline order",
      message: "Rain is refundable while ETH is still claimable. Bob risks losing both assets. Inspect both deadlines; if ETH expires unclaimed, Bob should refund it." };
  }
  if (result.refundRain && ethRecovery.state === "CLAIMED") {
    return { ...result, phase: "Rain claim window missed",
      message: "ETH is Claimed, but Rain has expired. Bob can no longer claim Rain; Alice can refund it. Inspect the records before taking recovery action." };
  }
  // Both sides have claimed: The exchange is complete.
  if (rain.status === STATUS.CLAIMED && eth.status === STATUS.CLAIMED) {
    return { ...result, phase: "Completed", message: "Both matching locks are Claimed. The exchange is complete." };
  }
  // Rain has been refunded, ETH has not been created or has also been refunded: There is no remaining locked position, indicating that the refund has ended.
  if (rain.status === STATUS.REFUNDED && [STATUS.NONE, STATUS.REFUNDED].includes(eth.status)) {
    return { ...result, phase: "Refunded", message: "The locked assets have been refunded. Use new swap IDs for a new exchange." };
  }
  if (rain.status === STATUS.ACTIVE && eth.status === STATUS.NONE && !result.refundRain) {
    try { planEthLock(snapshot, setup, policy); }
    catch (error) { return { ...result, phase: "Do not counter-lock", message: error.message + " Wait for the Rain refund window if the swap is abandoned." }; }
    return { ...result, phase: "2. Bob locks ETH", lockEth: true,
      message: "Bob: select Arbitrum Sepolia. Lock ETH will independently verify the Rain lock." };
  }
  // ETH is still available for collection and Rain has not refunded the money
  if (eth.status === STATUS.ACTIVE && [STATUS.ACTIVE, STATUS.CLAIMED].includes(rain.status) && !result.refundEth) {
    if (rain.status === STATUS.ACTIVE) {
      try { assertTimeWindows(rain.timelock, eth.timelock, BigInt(snapshot.rain.block.timestamp), BigInt(snapshot.eth.block.timestamp), policy); }
      catch (error) { return { ...result, phase: "Normal claim window unsafe", message: error.message + " Monitor the refund windows." }; }
    }
    return { ...result, phase: "3. Alice claims ETH", claimEth: true,
      message: "Alice: select Arbitrum Sepolia and restore the matching private backup. Claim ETH reveals the secret on-chain." };
  }
  // Alice has claimed ETH, but Rain's ETH has not yet expired
  if (rain.status === STATUS.ACTIVE && eth.status === STATUS.CLAIMED && !result.refundRain) {
    return { ...result, phase: "4. Bob claims Rain", claimRain: true,
      message: "Bob: " + rainRecovery.remaining + " seconds remained at the read block. Select Ethereum Sepolia, provide the public ETH claim transaction hash, and Claim Rain from ETH Event before expiry." };
  }
  if (result.refundRain || result.refundEth) {
    return { ...result, phase: "Refund available", message: "Only the original sender of each expired Active lock can refund it. Expiry does not refund automatically." };
  }
  
  return { ...result, phase: "Recovery / wait", message: "The normal swap cannot continue. Refresh the records and wait for any remaining Active lock's refund window." };
}

