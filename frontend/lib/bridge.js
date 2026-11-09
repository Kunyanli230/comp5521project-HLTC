// Display-only "bridge" inside the status strip. It reads the same snapshot the strip
// already shows and only toggles data attributes, captions and amounts. It never changes buttons,
// Task B judgements or any transaction path; the chain read remains the single source of truth.
import { formatEther, formatUnits } from "ethers";

// Contract status codes 0..3 mapped to a flow name used by the CSS animation.
const FLOW = ["none", "active", "claimed", "refunded"];

const CAPTION = {
  rain: {
    unchecked: "RAIN · NOT CHECKED",
    none: "RAIN · NOT LOCKED",
    active: "RAIN LOCKED · FLOWS TO BOB ON CLAIM",
    claimed: "RAIN DELIVERED TO BOB",
    refunded: "RAIN RETURNED TO ALICE",
    unknown: "RAIN · UNKNOWN STATE"
  },
  eth: {
    unchecked: "ETH · NOT CHECKED",
    none: "ETH · NOT LOCKED",
    active: "ETH LOCKED · FLOWS TO ALICE ON CLAIM",
    claimed: "ETH DELIVERED TO ALICE",
    refunded: "ETH RETURNED TO BOB",
    unknown: "ETH · UNKNOWN STATE"
  }
};

const ZERO_HASH = /^0x0{64}$/;

function shortHash(value) {
  return value.slice(0, 10) + "…" + value.slice(-4);
}

// strip: the snapshot the status strip renders (public setup snapshot or Inspect lookup), or null.
// setup: the current public setup, used only as a hashlock fallback before any lock exists.
export function renderBridge(strip, setup) {
  const root = document.getElementById("lock-bridge");
  if (!root) return;
  for (const asset of ["rain", "eth"]) {
    const record = strip?.[asset];
    const flow = !record ? "unchecked" : FLOW[Number(record.swap.status)] || "unknown";
    root.dataset[asset + "Flow"] = flow;
    document.getElementById("current-" + asset + "-flow").textContent = CAPTION[asset][flow];
    const hasAmount = record && flow !== "none" && flow !== "unchecked" && flow !== "unknown";
    document.getElementById("current-" + asset + "-amount").textContent = !hasAmount ? "—"
      : asset === "rain" ? formatUnits(record.swap.amount, 18) + " MST" : formatEther(record.swap.amount) + " ETH";
  }
  const recordedHashes = [strip?.rain?.swap?.hashlock, strip?.eth?.swap?.hashlock]
    .filter((value) => typeof value === "string" && value.length === 66 && !ZERO_HASH.test(value));
  const different = recordedHashes.length === 2 && recordedHashes[0].toLowerCase() !== recordedHashes[1].toLowerCase();
  const recorded = [...recordedHashes, setup?.hashlock]
    .find((value) => typeof value === "string" && value.length === 66 && !ZERO_HASH.test(value));
  const hashlockNode = document.getElementById("current-hashlock");
  // 手动查询两把无关的锁时，不能把第一把的哈希展示成两边共同哈希。
  hashlockNode.textContent = different ? "HASHLOCKS DIFFER · INSPECT RECORDS" : recorded ? "HASHLOCK " + shortHash(recorded) : "HASHLOCK · —";
  hashlockNode.title = different ? "These locks use different hashlocks; no matching pair has been established." : recorded || "";
  hashlockNode.dataset.present = String(Boolean(recorded));
}
