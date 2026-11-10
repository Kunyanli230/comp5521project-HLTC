async function request(path, body, timeout = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch("/api/" + path, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: controller.signal
    });
    const result = await response.json().catch(() => null);
    if (!result) throw new Error("Task B service is unavailable. Start npm.cmd run server in the repository root.");
    if (!response.ok) throw new Error(result.error || "Task B coordinator request failed.");
    return result;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The coordinator timed out. If a transaction was sent, check its public link before retrying.");
    if (error instanceof TypeError) throw new Error("Cannot reach Task B. Check the backend terminal and network connection.");
    throw error;
  } finally { clearTimeout(timer); }
}

// The integer explicitly specified by ABI is restored to BigInt; The address and hash are still strings.
function decodeRecord(record) {
  for (const key of ["amount", "timelock", "status"]) record.swap[key] = BigInt(record.swap[key]);
  record.recovery.swap = record.swap;
  return record;
}

export async function readPairSnapshot(lookup, setup = null) {
  const pair = await request("snapshot", { lookup, setup });
  decodeRecord(pair.rain);
  decodeRecord(pair.eth);
  for (const key of ["rainRemaining", "ethRemaining", "deadlineGap", "remainingGap", "minGap", "minWindow"]) {
    pair.timelocks[key] = BigInt(pair.timelocks[key]);
  }
  return pair;
}

// When Alice collects it, she temporarily hands over the preimage to local machine B for the transaction
export async function prepareAction(action, setup, actor, extras = {}) {
  const plan = await request("prepare", { action, setup, actor, ...extras });
  plan.value = BigInt(plan.value);
  plan.quote.feeBudget = BigInt(plan.quote.feeBudget);
  return plan;
}

export function confirmAction(action, setup, hash) {
  return request("confirm", { action, setup, hash }, 200000);
}

export function transactionStatus(asset, hash) {
  return request("transaction-status", { asset, hash });
}
