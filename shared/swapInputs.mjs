// Public input validation shared by browser and Node coordinator; no signing or chain access.
import { MaxUint256, ZeroAddress, ZeroHash, formatEther, formatUnits,
  getAddress, isHexString, parseEther, parseUnits } from "ethers";
export const DEFAULT_POLICY = Object.freeze({ minGap: 600, minWindow: 120 });

export function exactInteger(value, label) {
  if ((typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ||
      (typeof value === "bigint" && value >= 0n) ||
      (typeof value === "string" && /^\d+$/.test(value))) return BigInt(value);
  throw new Error(label + " must be a non-negative, exact integer.");
}

export function policyValues(options) {
  const minGap = exactInteger(options.minGap ?? DEFAULT_POLICY.minGap, "Minimum timelock gap");
  const minWindow = exactInteger(options.minWindow ?? DEFAULT_POLICY.minWindow, "Minimum claim window");
  if (minGap === 0n || minWindow === 0n) throw new Error("Timelock policy values must be greater than zero.");
  return { minGap, minWindow };
}

export function validateDurations(rainValue, ethValue, options = {}) {
  const rainSeconds = exactInteger(rainValue, "Rain duration");
  const ethSeconds = exactInteger(ethValue, "ETH duration");
  const { minGap, minWindow } = policyValues(options);
  if (rainSeconds === 0n || ethSeconds === 0n || rainSeconds > MaxUint256 || ethSeconds > MaxUint256) {
    throw new Error("Lock durations must fit positive uint256 values.");
  }
  if (ethSeconds <= minWindow) {
    throw new Error("ETH timelock duration must exceed the minimum claim window of " + minWindow + " seconds.");
  }
  if (rainSeconds - ethSeconds < minGap) {
    throw new Error("Rain timelock must exceed ETH timelock by at least " + minGap + " seconds.");
  }
  return { rainSeconds, ethSeconds, minGap, minWindow };
}


// Return the names of the mismatched fields, and the page can display multiple issues at once.
export function fieldMismatches(actual, expected) {
  return Object.entries(expected)
    .filter(([field, value]) => String(actual[field]).toLowerCase() !== String(value).toLowerCase())
    .map(([field]) => field);
}

export function assertFields(actual, expected, label = "Lock") {
  const mismatches = fieldMismatches(actual, expected);
  if (mismatches.length) throw new Error(label + " mismatch: " + mismatches[0]);
}

// Corresponding contract status: Not created, created and not processed, claimed, refunded
export const STATUS = { NONE: 0n, ACTIVE: 1n, CLAIMED: 2n, REFUNDED: 3n };

export function requireBytes32(value, label) {
  if (!isHexString(value, 32) || value.toLowerCase() === ZeroHash) {
    throw new Error(label + " must be a non-zero 32-byte hex value.");
  }
  return value.toLowerCase();
}

// Extract the original parsing from the public setting verification
export function parseSwapTerms(data) {
  const alice = getAddress(data.alice);
  const bob = getAddress(data.bob);
  if (alice === ZeroAddress || bob === ZeroAddress) throw new Error("Participant addresses must not be the zero address.");
  if (alice === bob) throw new Error("Alice and Bob must use different addresses.");
  for (const name of ["rainAmount", "ethAmount"]) {
    if (typeof data[name] !== "string" || !/^\d+(\.\d+)?$/.test(data[name])) {
      throw new Error("Enter decimal amounts such as 100 and 0.001.");
    }
  }
  const rainAmount = parseUnits(data.rainAmount, 18);
  const ethAmount = parseEther(data.ethAmount);
  if (rainAmount <= 0n || ethAmount <= 0n) throw new Error("Both swap amounts must be greater than zero.");
  if (rainAmount > MaxUint256 || ethAmount > MaxUint256) throw new Error("Amounts must fit positive uint256 values.");
  return { alice, bob, rainAmount, ethAmount };
}

// Verify the public exchange Settings and only return the public fields that are allowed to be saved and shared.
export function validatePublicSetup(data, policy = {}) {
  // The file type and version must be correct to avoid importing private backups as public Settings.
  if (!data || data.type !== "rain-eth-htlc-public" || data.schemaVersion !== 1) {
    throw new Error("Select a public swap setup file, not a private secret backup.");
  }
  // Public documents should not contain secret original texts. Reject them if the preimage field is found.
  if (Object.hasOwn(data, "preimage")) throw new Error("A public setup must not contain a private preimage.");
  const { alice, bob, rainAmount, ethAmount } = parseSwapTerms(data);
  
  // Following the strict boundary of B, the duration of the ETH plan must be greater than the minimum withdrawal window.
  const { rainSeconds, ethSeconds } = validateDurations(data.rainSeconds, data.ethSeconds, policy);
  // Regularly use Ethereum Sepolia and Arbitrum Sepolia
  if (data.rainChainId !== 11155111 || data.ethChainId !== 421614) {
    throw new Error("This setup must use Ethereum Sepolia and Arbitrum Sepolia.");
  }
  // The two chains use different swap ids respectively, but share the same hashlock.
  const rainSwapId = requireBytes32(data.rainSwapId, "Rain swap ID");
  const ethSwapId = requireBytes32(data.ethSwapId, "ETH swap ID");
  if (rainSwapId === ethSwapId) throw new Error("Use different Rain and ETH swap IDs.");
  
  const setup = {
    schemaVersion: 1, type: "rain-eth-htlc-public", alice, bob,
    rainSwapId, ethSwapId, hashlock: requireBytes32(data.hashlock, "Hashlock"),
    rainAmount: formatUnits(rainAmount, 18), ethAmount: formatEther(ethAmount),
    rainSeconds: rainSeconds.toString(), ethSeconds: ethSeconds.toString(),
    rainChainId: 11155111, ethChainId: 421614,
    rainToken: getAddress(data.rainToken), rainHtlc: getAddress(data.rainHtlc),
    ethHtlc: getAddress(data.ethHtlc), ethClaimTxHash: ""
  };
  
  if ([setup.rainToken, setup.rainHtlc, setup.ethHtlc].includes(ZeroAddress)) {
    throw new Error("Contract addresses must not be zero.");
  }
  
  if (data.ethClaimTxHash) setup.ethClaimTxHash = requireBytes32(data.ethClaimTxHash, "ETH claim transaction hash");
  return setup;
}




// ai assistent: Sort out the error messages on the page
export function safeErrorMessage(error, secrets = []) {
  const messages = [];
  const visited = new Set();
  function readMessages(value, depth = 0) {
    if (!value || typeof value !== "object" || visited.has(value) || depth > 6) return;
    visited.add(value);
    for (const key of ["message", "shortMessage"]) {
      if (typeof value[key] === "string") messages.push(value[key]);
    }
    for (const key of ["error", "info", "data", "cause", "originalError"]) readMessages(value[key], depth + 1);
  }
  readMessages(error);
  let message = error?.code === 4001 || error?.code === "ACTION_REJECTED"
    ? "Wallet request rejected. No new transaction hash was received."
    : String(error?.shortMessage || error?.message || "Operation failed.");
  if (messages.some((text) => /max fee per gas.*less than.*base fee|fee cap.*(?:less than|below).*base fee/i.test(text))) {
    message = "The network rejected the transaction because its gas fee cap is below the current base fee. Check MetaMask Activity for a pending transaction before retrying with fresh network fees.";
  }
  for (const secret of secrets) {
    if (!isHexString(secret, 32)) continue;
    message = message.replace(new RegExp(secret.slice(2), "gi"), "[secret redacted]");
  }
  return message;
}

export function expectedLock(setup, asset, deadline) {
  const rain = asset === "rain";
  const expected = {
    // Here, the sender is the original locker: Rain was locked in by Alice, and ETH was locked in by Bob.
    sender: rain ? setup.alice : setup.bob,
    // Both parties are each other's recipients: Bob receives Rain and Alice receives ETH.
    receiver: rain ? setup.bob : setup.alice,
    token: rain ? setup.rainToken : ZeroAddress,
    amount: rain
      ? typeof setup.rainAmount === "bigint" ? setup.rainAmount : parseUnits(setup.rainAmount, 18)
      : typeof setup.ethAmount === "bigint" ? setup.ethAmount : parseEther(setup.ethAmount),
    hashlock: setup.hashlock
  };
  if (deadline !== undefined) expected.timelock = deadline;
  return expected;
}

