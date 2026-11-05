// AI-assisted B3 classification; see docs/AI_ASSISTANCE.md.
function classify(swap, now, minWindow) {
  const status = Number(swap.status);
  const remaining = Number(swap.timelock) - now;

  // A completed or missing swap never becomes refundable as time passes.
  if (status === 0) return { state: "NOT_FOUND", actions: [], remaining };
  if (status === 2) return { state: "CLAIMED", actions: [], remaining };
  if (status === 3) return { state: "REFUNDED", actions: [], remaining };
  if (status !== 1) throw new Error(`Unknown swap status: ${swap.status}`);

  // Match HTLCBase: claim requires now < timelock; refund starts at equality.
  if (remaining <= 0) {
    return { state: "REFUNDABLE", actions: [{ action: "refund", by: "sender" }], remaining };
  }
  if (remaining < minWindow) {
    return {
      state: "CLOSING",
      actions: [{ action: "claim", by: "receiver", warning: `Claim window closes in ${remaining} seconds.` }],
      remaining,
    };
  }
  return { state: "CLAIMABLE", actions: [{ action: "claim", by: "receiver" }], remaining };
}

module.exports = { classify };
