// This document is responsible for guiding the interface on "which page the user should view and how to operate on this page".
import { formatEther, formatUnits } from "ethers";
import { recoveryView } from "./swapProtocol.js";

// The normal page exchange sequence is used to display step navigation, return to the previous page, and determine whether the recommended step is after the current page.
const STEPS = ["prepare", "lock-rain", "lock-eth", "claim-eth", "claim-rain", "complete"];
//The English display text corresponding to the route name; At the same time, it is included in the list of pages that can be accessed.
const LABELS = {
  prepare: "Prepare", "lock-rain": "Alice locks Rain", "lock-eth": "Bob locks ETH",
  "claim-eth": "Alice claims ETH", "claim-rain": "Bob claims Rain", complete: "Result",
  inspect: "Inspect locks", refund: "Refunds"
};
// The roles and networks required for each transaction step
const REQUIRED = {
  "lock-rain": ["alice", 11155111], "lock-eth": ["bob", 421614],
  "claim-eth": ["alice", 421614], "claim-rain": ["bob", 11155111]
};
// Convert the network number into a name that users can understand
const NETWORKS = { 11155111: "Ethereum Sepolia", 421614: "Arbitrum Sepolia" };
// The array indices correspond to the contract status codes 0, 1, 2, and 3, facilitating the display of on-chain integers as status characters.
const STATES = ["Not created", "Active", "Claimed", "Refunded"];

// Initialize step-by-step booting
export function attachStepGuide() {
  const el = (id) => document.getElementById(id);
  const pages = [...document.querySelectorAll("[data-view]")];
  let context = { setup: null, snapshot: null, state: null, who: {}, busy: false, backupVerified: false };
  let route = "prepare";
  let lastGuided = "prepare";

  // Recommend the page based on the actual status
  function recommended() {
    const { setup, state, backupVerified } = context;
    if (!setup) return "prepare";
    if (!state) return "inspect";
    if (state.phase === "Completed") return "complete";
    if (state.lockRain) return backupVerified ? "lock-rain" : "prepare";
    if (state.lockEth) return "lock-eth";
    if (state.claimEth) return "claim-eth";
    if (state.claimRain) return "claim-rain";
    if (state.refundRain || state.refundEth || state.phase === "Refunded" || state.phase === "Recovery / wait") return "refund";
    return "inspect";
  }

  function go(next) {
    if (!Object.hasOwn(LABELS, next)) return;
    if (window.location.hash === "#/" + next) showRoute(true);
    else window.location.hash = "/" + next;
  }

  function showRoute(focus = false) {
    const requested = window.location.hash.replace(/^#\/?/, "");
    route = Object.hasOwn(LABELS, requested) ? requested : "prepare";
    if (STEPS.includes(route)) lastGuided = route;
    for (const page of pages) page.hidden = page.dataset.view !== route;
    for (const link of document.querySelectorAll("[data-nav]")) {
      const active = link.dataset.nav === (STEPS.includes(route) ? "swap" : route);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
      if (link.dataset.nav === "swap") link.href = "#/" + lastGuided;
    }
    for (const link of document.querySelectorAll("#step-navigation a")) {
      if (link.getAttribute("href") === "#/" + route) link.setAttribute("aria-current", "step");
      else link.removeAttribute("aria-current");
    }
    el("step-navigation").hidden = !STEPS.includes(route);
    el("step-footer").hidden = !STEPS.includes(route) || route === "complete";
    document.title = LABELS[route] + " · Rain / ETH Swap";
    document.body.dataset.route = route;
    el("page-step").textContent = STEPS.includes(route)
      ? "STEP " + String(STEPS.indexOf(route) + 1).padStart(2, "0") + " / 06"
      : route === "inspect" ? "OBSERVE BOTH NETWORKS" : "TIMEOUT RECOVERY";
    el("page-mode").textContent = STEPS.includes(route) ? "GUIDED SWAP" : route === "inspect" ? "READ ONLY" : "ORIGINAL SENDER";
    render();
    if (focus) {
      const heading = pages.find((page) => !page.hidden).querySelector("h2");
      heading.focus({ preventScroll: true });
      el("step-navigation").hidden
        ? heading.scrollIntoView({ block: "start" })
        : el("step-navigation").scrollIntoView({ block: "start" });
    }
  }

  function displayRecord(id, rows) {
    const list = el(id);

    list.replaceChildren();

    for (const [label, value] of rows) {
      const term = document.createElement("dt");
      const detail = document.createElement("dd");
      term.textContent = label;
      detail.textContent = String(value);
      list.append(term, detail);
    }
  }

  // ai assistent: The refund prompt uses the time of the queried block
  function refundMessage(record, network, owner) {
    if (!record) return "Read Both Locks to check this lock.";
    const { state, remaining } = recoveryView(record);
    if (state === "NOT_FOUND") return "No lock exists under this ID. Nothing to refund.";
    if (state === "CLAIMED") return "Already Claimed. These assets cannot be refunded.";
    if (state === "REFUNDED") return "Already Refunded. No further refund is needed.";
    const deadline = new Date(Number(record.swap.timelock) * 1000).toLocaleString();
    return state !== "REFUNDABLE"
      ? "Not expired at the last read block. " + remaining + " seconds remained. Deadline: " + deadline + ". Wait, then read both locks again."
      : "Expired at the last read block. " + owner + " must select " + network + " and request the refund. Original sender: " + record.swap.sender + ".";
  }

  //Here, the control is for the guide button. The actual lock, claim, and refund buttons are still checked and controlled by workflow.js.
  function render() {
    const { setup, snapshot, state, who, busy, reading, backupVerified } = context;
    const target = recommended();
    const role = who.address && setup
      ? who.address === setup.alice ? "Alice" : who.address === setup.bob ? "Bob" : "Other account"
      : who.address ? "Connected account" : "Wallet not connected";
    const network = NETWORKS[who.chainId] || (who.address ? "Unsupported or unknown network" : "No network selected");
    el("wallet-identity").textContent = role + " · " + network;
    el("wallet-address-preview").textContent = who.address
      ? who.address.slice(0, 8) + "…" + who.address.slice(-6) : "No account selected";
    el("wallet-connection-label").textContent = who.address ? "Connected" : "Not connected";
    el("wallet-connection-label").dataset.connected = String(Boolean(who.address));
    for (const [id, chain] of [["sepolia-button", 11155111], ["arbitrum-button", 421614]]) {
      el(id).setAttribute("aria-pressed", String(who.chainId === chain));
    }
    const finished = state?.phase === "Completed" || state?.phase === "Refunded";
    const warning = state && !finished && !state.lockRain && !state.lockEth && !state.claimEth && !state.claimRain;
    el("workflow-guide").dataset.tone = busy ? "pending" : finished ? "success" : warning ? "warning" : "neutral";
    
    const completedThrough = state?.phase === "Completed" ? 5 : state?.claimRain ? 3
      : state?.claimEth ? 2 : state?.lockEth ? 1 : setup && backupVerified ? 0 : -1;
    for (const link of document.querySelectorAll("#step-navigation a")) {
      const step = link.getAttribute("href").slice(2);
      const index = STEPS.indexOf(step);
      link.dataset.progress = index <= completedThrough ? "done" : "upcoming";
      link.dataset.recommended = String(step === target);
      link.title = step === target ? "Recommended next step from the latest chain records" : LABELS[step];
    }
    const requirement = REQUIRED[route];
    if (busy) {
      el("wallet-guidance").textContent = "Review the pending request in MetaMask, then wait for the transaction result.";
    } else if (requirement) {
      const [owner, chain] = requirement;
      const name = owner === "alice" ? "Alice" : "Bob";
      el("wallet-guidance").textContent = !who.address
        ? "Connect " + name + " to continue on " + NETWORKS[chain] + "."
        : !setup
          ? "Load a valid public setup in Prepare so the agreed " + name + " account can be checked."
          : who.address !== setup[owner]
          ? "Select " + name + " in MetaMask and connect that account to this site."
          : who.chainId !== chain
            ? "Use Switch to " + NETWORKS[chain] + " above for this step."
            : name + " is on the correct network for this step.";
    } else if (route === "inspect") {
      el("wallet-guidance").textContent = "Read Both Locks queries both networks without switching MetaMask. Inspect each record and its parameter check below.";
    } else if (route === "complete") {
      el("wallet-guidance").textContent = "Use the public transaction links and Read Both Locks to verify the recorded outcome.";
    } else {
      el("wallet-guidance").textContent = route === "refund"
        ? "Each refund needs the original sender on that asset's network. See the two instructions below."
        : "Alice prepares or restores the private backup. Bob resumes using only the public setup.";
    }
    el("exchange-summary").textContent = setup
      ? "Alice sends " + setup.rainAmount + " Rain (MST) ↔ Bob sends " + setup.ethAmount + " ETH"
      : "Prepare the exchange or load an existing setup.";
    el("public-setup-summary").hidden = !setup;
    displayRecord("public-setup-fields", setup ? [
      ["Alice", setup.alice], ["Bob", setup.bob],
      ["Exchange", setup.rainAmount + " Rain (MST) ↔ " + setup.ethAmount + " ETH"],
      ["Planned durations", "Rain: " + setup.rainSeconds + "s · ETH: " + setup.ethSeconds + "s"],
      ["Rain swap ID", setup.rainSwapId], ["ETH swap ID", setup.ethSwapId],
      ["Hashlock", setup.hashlock],
      ...(setup.ethClaimTxHash ? [["Public ETH claim transaction", setup.ethClaimTxHash]] : [])
    ] : []);
    el("guide-resume").textContent = "Go to: " + LABELS[target];
    el("guide-resume").disabled = busy;
    el("guide-resume").hidden = target === route;
    el("export-public-button").disabled = !setup || busy;

    // ai assistent: Provide the next page entry according to the real stage
    const index = STEPS.indexOf(route);
    el("guide-back").disabled = index <= 0;
    const canContinue = !busy && (STEPS.indexOf(target) > index || target === "refund");
    el("guide-next").disabled = !canContinue;
    el("guide-next").textContent = canContinue ? "Continue: " + LABELS[target] : "Complete this step to continue";
    el("guide-next-hint").textContent = busy ? "Wait for the transaction result."
      : canContinue ? "The latest chain records indicate the next step shown above."
        : !setup ? "Load or create a setup, verify Alice's backup and check the terms."
          : !snapshot ? "Click Read Both Locks to check the selected exchange."
            : state?.lockRain && !backupVerified ? "Alice must restore and verify the matching private backup in Prepare."
              : "Follow the current exchange message above. Read Both Locks again after any transaction.";

    el("claim-backup-guidance").textContent = backupVerified
      ? "The matching private backup is verified in this browser."
      : "The Claim ETH button needs Alice's matching verified backup. Restore it in Prepare.";
    const funding = who.address === setup?.alice && who.chainId === 11155111;
    el("rain-funding-summary").textContent = funding
      ? "Alice's Rain balance: " + el("rain-balance").textContent + ". Allowance: " + el("rain-allowance").textContent + "."
      : "Connect Alice on Ethereum Sepolia to read her balance and allowance.";

    const rain = snapshot?.rain;
    const eth = snapshot?.eth;
    // AI-assisted: All steps share the same snapshot, directly showing the real status of both sides
    el("current-rain-state").textContent = rain ? STATES[Number(rain.swap.status)] || "Unknown" : "Not checked";
    el("current-eth-state").textContent = eth ? STATES[Number(eth.swap.status)] || "Unknown" : "Not checked";
    el("current-locks-read-status").textContent = !snapshot
      ? "Click Read Both Locks to check both networks."
      : busy ? "Transaction in progress. States shown are from the last completed chain read."
        : reading ? "Updating both networks. Showing the previous read until it completes."
          : "Latest read: Rain block " + rain.block.number + " · ETH block " + eth.block.number + ".";
    el("rain-step-state").textContent = !rain ? "Read both locks to check whether Rain is already locked."
      : Number(rain.swap.status) === 0 ? state?.lockRain
        ? "Rain is not locked yet. Verify Alice's backup, approve if needed, then Lock Rain."
        : "Rain is not locked yet, but this exchange cannot start here. Follow the exchange message above."
        : "Rain state: " + STATES[Number(rain.swap.status)] + ". Follow the recommended step instead of creating this lock again.";
    el("eth-lock-step-state").textContent = !eth ? "Read both locks to verify Rain before Bob locks ETH."
      : state?.lockEth ? "Rain passed the counterpart checks. Select Bob on Arbitrum Sepolia to lock ETH."
        : Number(eth.swap.status) !== 0 ? "ETH state: " + STATES[Number(eth.swap.status)] + ". This ID already has a lock."
          : "Do not lock ETH yet. Follow the current exchange message above.";
    el("eth-claim-step-state").textContent = state?.claimEth ? "The chain checks allow Alice to claim ETH. Confirm the account, network and backup below."
      : eth && Number(eth.swap.status) === 2 ? "ETH is already Claimed. Follow the recommended step or inspect the final result."
        : "ETH cannot be claimed in the normal flow right now. Read both locks and follow the exchange message.";
    el("rain-claim-step-state").textContent = state?.claimRain ? "Alice has claimed ETH. Bob can verify that public transaction and claim Rain before expiry."
      : rain && Number(rain.swap.status) === 2 ? "Rain is already Claimed. Read both locks to check the final result."
        : "Wait for Alice's confirmed ETH claim. Read both locks before continuing.";

    displayRecord("counterparty-summary", rain && Number(rain.swap.status) !== 0 ? [
      ["Rain on-chain state", STATES[Number(rain.swap.status)]],
      ["Recorded Rain amount", formatUnits(rain.swap.amount, 18) + " Rain (MST)"],
      ["Original sender", rain.swap.sender], ["Recipient", rain.swap.receiver],
      ["Recorded hashlock", rain.swap.hashlock],
      ["Rain deadline (local display)", new Date(Number(rain.swap.timelock) * 1000).toLocaleString()]
    ] : [["Rain lock", rain ? "Not created" : "Not checked"]]);
    el("refund-rain-guidance").textContent = refundMessage(rain, "Ethereum Sepolia", "Alice");
    el("refund-eth-guidance").textContent = refundMessage(eth, "Arbitrum Sepolia", "Bob");
    const completed = state?.phase === "Completed";
    el("completion-status").textContent = completed
      ? "Exchange completed. Both matching locks are Claimed: Alice received ETH and Bob received Rain."
      : state?.phase === "Refunded"
        ? "Exchange ended with a refund. All created locks were refunded to their original senders."
        : "This exchange has not been verified as completed. " + (state?.message || "Read both locks to check its state.");
    displayRecord("completion-summary", snapshot ? [
      ["Rain state", STATES[Number(rain.swap.status)]], ["ETH state", STATES[Number(eth.swap.status)]],
      ["Rain swap ID", rain.swapId], ["ETH swap ID", eth.swapId]
    ] : []);
    el("new-swap-button").disabled = busy || reading || !snapshot || [rain, eth].some((record) => Number(record.swap.status) === 1);
    el("workflow-action-status").hidden = el("workflow-action-status").textContent === "No new swap action submitted.";
  }

  el("skip-to-step").addEventListener("click", (event) => {
    event.preventDefault();
    const heading = pages.find((page) => !page.hidden)?.querySelector("h2");
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: "start" });
  });
  el("guide-resume").addEventListener("click", () => go(recommended()));
  el("guide-back").addEventListener("click", () => go(STEPS[STEPS.indexOf(route) - 1]));
  el("guide-next").addEventListener("click", () => { if (!el("guide-next").disabled) go(recommended()); });
  window.addEventListener("hashchange", () => showRoute(true));
  // When balance and transaction prompts are updated asynchronously, they are displayed synchronously.
  const observer = new MutationObserver(() => render());
  for (const id of ["rain-balance", "rain-allowance", "workflow-action-status"]) {
    observer.observe(el(id), { childList: true, subtree: true, characterData: true });
  }
  window.addEventListener("beforeunload", () => observer.disconnect());
  showRoute();
  return {
    go,
    update(next) { context = { ...context, ...next }; render(); }
  };
}
