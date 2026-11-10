// C controls the page and wallet; B owns protocol decisions over HTTP.
import { BrowserProvider, Interface, formatEther, getAddress, isHexString, keccak256 } from "ethers";
import { safeErrorMessage, validatePublicSetup } from "./swapProtocol.js";
import { prepareAction, confirmAction, transactionStatus, readPairSnapshot } from "./chainActions.js";
import { attachStepGuide } from "./guide.js";

const SETUP_KEY = "htlc.public.setup.v1";
const PENDING_KEY = "htlc.public.pending.v1";

export function attachWorkflow(options) {
  // Search for page nodes by element ID and save them centrally to the ui for easy updates of text and buttons later.
  const el = (id) => document.querySelector("#" + id);
  const ui = {
    status: el("workflow-status"), details: el("workflow-details"), readLocks: el("read-both-locks-button"),
    claimHash: el("eth-claim-tx-hash"), publicFile: el("public-setup-input"),
    lockEth: el("lock-eth-button"), claimEth: el("claim-eth-button"), claimRain: el("claim-rain-button"),
    actionStatus: el("workflow-action-status"), actionLink: el("workflow-action-link"),
    publicStatus: el("public-setup-status"), refreshStatus: el("workflow-refresh-status"),
    resultDialog: el("action-result-dialog"), resultLabel: el("action-result-label"),
    resultTitle: el("action-result-title"), resultDescription: el("action-result-description"),
    resultNext: el("action-result-next"), resultLink: el("action-result-link")
  };

  // AI-assisted: 一次交易完成后明确告诉用户发生了什么；只有 B 核验成功才显示成功弹窗。
  function showActionResult(title, description, next, tone, url = "") {
    ui.resultTitle.textContent = title;
    ui.resultDescription.textContent = description;
    ui.resultNext.textContent = next;
    ui.resultLabel.textContent = tone === "success" ? "CONFIRMED ON-CHAIN" : "ACTION NEEDS ATTENTION";
    ui.resultDialog.dataset.tone = tone;
    ui.resultLink.hidden = !url;
    if (url) ui.resultLink.href = url;
    else ui.resultLink.removeAttribute("href");
    if (!ui.resultDialog.open) ui.resultDialog.showModal();
  }
  el("action-result-close").addEventListener("click", () => ui.resultDialog.close());

  // Each action uses user-oriented completion instructions and next steps.
  function completedAction(action, setup, plan) {
    if (action === "approve-rain") {
      const amount = formatEther(BigInt(plan.args[1]));
      return BigInt(plan.args[1]) === 0n
        ? ["Rain allowance cleared", "Alice's Rain spending allowance is now 0. No Rain was locked or sent.", "Next: enter the required approval amount and approve it before locking Rain."]
        : ["Rain approval completed", "Alice authorized the HTLC to spend up to " + amount + " Rain (MST). This approval did not lock or send Rain.", "Next: Alice can lock the agreed Rain on Ethereum Sepolia."];
    }
    const messages = {
      "lock-rain": ["Rain locked successfully", "Alice locked " + setup.rainAmount + " Rain (MST) in the Ethereum Sepolia HTLC for Bob.", "Next: share the public setup with Bob. Bob uses step 03 Lock ETH on Arbitrum Sepolia before the safe time window closes."],
      "lock-eth": ["ETH locked successfully", "Bob locked " + setup.ethAmount + " ETH in the Arbitrum Sepolia HTLC for Alice.", "Next: Alice uses step 04 Claim ETH on Arbitrum Sepolia with her matching private backup, before expiry."],
      "claim-eth": ["Alice received ETH", "Alice received " + setup.ethAmount + " ETH. The claim also revealed the secret on-chain.", "Next: Bob uses step 05 Claim Rain on Ethereum Sepolia with this public ETH claim transaction, before the Rain lock expires. Bob does not need Alice's private backup."],
      "claim-rain": ["Bob received Rain", "Bob received " + setup.rainAmount + " Rain (MST) on Ethereum Sepolia using the revealed secret.", "Next: open step 06 Result to check that both locks are Claimed and the exchange is complete."],
      "refund-rain": ["Alice's Rain was refunded", setup.rainAmount + " Rain (MST) was returned to Alice on Ethereum Sepolia. Gas fees are not refunded.", "Next: check Refunds for the other lock. Each created lock needs its own original sender to request any eligible refund."],
      "refund-eth": ["Bob's ETH was refunded", setup.ethAmount + " ETH was returned to Bob on Arbitrum Sepolia. Gas fees are not refunded.", "Next: check Refunds for the other lock. Each created lock needs its own original sender to request any eligible refund."]
    };
    return messages[action];
  }

  // When a local countdown reaches zero, re-read both chains so refund eligibility comes from a real block, not the device clock.
  const guide = attachStepGuide({ onDeadlinePassed: () => { void refresh(); } });
  // Save the most recently read double-linked state; null indicates that there are no available query results at present.
  let snapshot = null;
  
  let snapshotSignature = "";
  
  let generation = 0;
  // Save the ongoing refresh Promise to prevent multiple automatic refreshes from running simultaneously.
  let refreshing = null;
  let checkingPending = false;
  // Wait for 500 milliseconds after the input stops before querying
  let timer = null;
  let applying = false;
  let pending = null;
  const storedPending = readStored(PENDING_KEY, null);
  const actions = ["approve-rain", "lock-rain", "lock-eth", "claim-eth", "claim-rain", "refund-rain", "refund-eth"];
  if (storedPending && actions.includes(storedPending.action) &&
      ["rain", "eth"].includes(storedPending.asset) &&
      isHexString(storedPending.hash, 32) && isHexString(storedPending.swapId, 32)) {
    const chain = storedPending.asset === "rain" ? options.rain : options.eth;
    if (Number(storedPending.chainId) === chain.chainId &&
        String(storedPending.contract).toLowerCase() === chain.address.toLowerCase()) {
      pending = {
        action: storedPending.action, asset: storedPending.asset, swapId: storedPending.swapId,
        hash: storedPending.hash, chainId: chain.chainId, contract: chain.address
      };
    }
  }

  try {
    localStorage.removeItem("htlc.public.saved.v1");
    localStorage.removeItem("htlc.public.transactions.v1");
  } catch { /* The current page operation can still be used when the browser disables storage. */ }

  // Read and parse the browser JSON
  function readStored(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  }

  // Write to public data
  function writeStored(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch { ui.publicStatus.textContent = "Browser storage is unavailable. Export the public setup and save transaction links."; }
  }

  function getSetup() {
    const raw = options.readPublicSetup();
    raw.ethClaimTxHash = ui.claimHash.value.trim();
    const setup = validatePublicSetup(raw);
    if (setup.rainToken !== getAddress(options.rainToken) ||
        setup.rainHtlc !== getAddress(options.rain.address) || setup.ethHtlc !== getAddress(options.eth.address)) {
      throw new Error("The setup contract addresses differ from this frontend deployment configuration.");
    }
    return setup;
  }
  function persist(setup) {
    writeStored(SETUP_KEY, setup);
  }

  function trackTransaction(action, asset, swapId, hash, state = "submitted") {
    const chain = asset === "rain" ? options.rain : options.eth;
    if (state === "submitted" || state === "unknown") {
      pending = { action, asset, swapId, hash, chainId: chain.chainId, contract: chain.address };
      writeStored(PENDING_KEY, pending);
    } else if (pending?.hash === hash) {
      pending = null;
      try { localStorage.removeItem(PENDING_KEY); } catch { /* 页面内仍已清除未决状态。 */ }
    }
    ui.actionLink.href = chain.explorer + "/tx/" + hash;
    ui.actionLink.hidden = false;
    ui.actionStatus.textContent = state === "unknown"
      ? action + " was submitted. Check this transaction and both locks before retrying."
      : action + ": " + state + ".";
    if (state === "confirmed") { snapshot = null; snapshotSignature = ""; generation++; }
  
    if (action === "claim-eth") {
      ui.claimHash.value = hash;
      try { persist(getSetup()); } catch { /* Do not save forms that have become illegal.*/ }
    }
  }

  // Only check the current transaction that has not yet been resolved to avoid directly resending it after a timeout.
  async function guardPending(asset, swapId, action) {
    const record = pending;
    if (!record || record.asset !== asset || record.swapId !== swapId || record.action !== action) return;
    const receipt = await transactionStatus(asset, record.hash);
    if (!receipt) throw new Error("A transaction is still unresolved. Check the transaction link or MetaMask before retrying.");
    if (receipt.status === 0) {
      trackTransaction(action, asset, swapId, record.hash, "reverted");
      return;
    }
    trackTransaction(action, asset, swapId, record.hash, "mined; refresh state");
    throw new Error("The transaction was mined. Read both locks before choosing the next action.");
  }

  // AI-assisted: 刷新后核验本轮领取/退款的旧回执；不能仅凭终态快照清除某笔交易的未决记录。
  async function reconcilePending() {
    if (!pending || checkingPending || options.isBusy() || !snapshot) return;
    const record = pending;
    let setup;
    try { setup = getSetup(); } catch { return; }
    if (record.swapId !== setup[record.asset + "SwapId"]) return;
    const required = record.action.startsWith("claim-") ? 2n : record.action.startsWith("refund-") ? 3n : null;
    if (required === null || snapshot[record.asset].swap.status !== required) return;
    const revision = generation;
    checkingPending = true;
    render();
    ui.actionStatus.textContent = "Checking the previously submitted transaction with Task B...";
    try {
      await confirmAction(record.action, setup, record.hash);
      if (pending !== record || revision !== generation) return;
      trackTransaction(record.action, record.asset, record.swapId, record.hash, "confirmed");
      ui.actionStatus.textContent = "Previous " + record.asset.toUpperCase() + " " +
        (required === 2n ? "claim" : "refund") + " transaction confirmed. Task B verified the receipt, event and on-chain result.";
    } catch (error) {
      if (pending === record && revision === generation) {
        ui.actionStatus.textContent = "The locks were read, but the previous transaction could not be verified. " +
          safeErrorMessage(error) + " Keep its link; do not submit it again.";
      }
    } finally {
      checkingPending = false;
      render();
      if (revision !== generation) void refresh();
    }
  }

  // Obtain the account and network currently connected to the page
  function actor() {
    try { return { address: getAddress(options.getAccount()), chainId: Number(options.getChainId()) }; }
    catch { return { address: null, chainId: NaN }; }
  }

  // AI-assisted: records read for the current Inspect IDs, even when no complete public setup exists. Used for the status strip only.
  function lookupSnapshot() {
    try { return snapshot && snapshotSignature === JSON.stringify(options.readLookup()) ? snapshot : null; }
    catch { return null; }
  }

  function draftMatches(setup) {
    const draft = options.getDraft();
    return options.isBackupVerified() && draft && draft.rainSwapId === setup.rainSwapId &&
      draft.ethSwapId === setup.ethSwapId && draft.hashlock === setup.hashlock;
  }

  // Guide the text and buttons based on transaction busyness, actual on-chain status, current identity, and network updates.
  function render() {
    const busy = options.isBusy();
    const reading = refreshing !== null || checkingPending;
    el("private-draft-details").hidden = !options.getDraft();
    el("use-draft-button").disabled = busy || !options.getDraft();
    guide.update({ busy, reading, who: actor() });
    const actionButtons = [options.lockRainButton, ui.lockEth, ui.claimEth, ui.claimRain,
      options.refundRainButton, options.refundEthButton];
    
    actionButtons.forEach((button) => { button.disabled = true; });
    options.approveButton.disabled = busy || reading;
    ui.readLocks.disabled = busy || reading;
    ui.refreshStatus.textContent = reading
      ? "Updating chain records. Transaction buttons are paused."
      : "Recommendations follow the latest completed chain read.";
    // When the wallet request or transaction confirmation has not been completed, do not allow the user to initiate another operation in parallel.
    if (busy) {
      ui.status.textContent = "Wallet / transaction operation in progress";
      ui.details.textContent = "Review the requested action in MetaMask, then wait for confirmation. Keep the transaction link shown here until the result is confirmed.";
      return;
    }
    let setup;
    
    try { setup = getSetup(); }
    catch (error) {
      guide.update({ setup: null, snapshot: null, lookupSnapshot: lookupSnapshot(), state: null, backupVerified: false });
      ui.status.textContent = "Set up the exchange";
      ui.details.textContent = "Alice: generate a draft, download its private backup, and select that file to verify it. Bob: import the public setup. " + safeErrorMessage(error);
      return;
    }
    if (!snapshot || snapshotSignature !== JSON.stringify(options.readLookup())) {
      guide.update({ setup, snapshot: null, lookupSnapshot: null, state: null, backupVerified: draftMatches(setup) });
      ui.status.textContent = "Read the selected exchange";
      ui.details.textContent = "Click Read Both Locks to obtain fresh chain records. Public setup is saved; the private secret is not stored in the browser.";
      return;
    }
    const state = snapshot.workflow;
    if (!state) return;
    if (snapshot.deploymentIssues?.length) {
      options.approveButton.disabled = true;
      if (!reading) ui.refreshStatus.textContent = snapshot.deploymentIssues.join(" ");
    } else if (!reading && snapshot.deploymentWarnings?.length) {
      // Metadata warnings are for illustration only; The account, network and real on-chain status still determine whether the operation is allowed.
      ui.refreshStatus.textContent = "Deployment warning: " + snapshot.deploymentWarnings.join(" ");
    }
    const who = actor();
    guide.update({ setup, snapshot, lookupSnapshot: null, state, who, busy, backupVerified: draftMatches(setup) });
    const aliceEth = who.address === setup.alice && who.chainId === 421614;
    ui.status.textContent = state.phase;
    ui.status.dataset.phase = state.phase;
    ui.details.textContent = state.lockRain && draftMatches(setup)
      ? "Alice's matching private backup is verified. Select Ethereum Sepolia, then Lock Rain."
      : state.message;
    if (state.claimEth && !draftMatches(setup)) ui.details.textContent += " Restore Alice's matching private backup to enable Claim ETH.";
    if (state.claimRain && !ui.claimHash.value.trim()) ui.details.textContent += " Paste the public ETH claim transaction hash below.";
    if (who.address !== setup.alice && who.address !== setup.bob) ui.details.textContent += " Connect the agreed Alice or Bob account to enable its actions.";
    // The last successful result can be viewed in the query, but the transaction button must be reopened only after the current read is completed.
    if (reading) return;
    // Alice lock Rain: It must be on Ethereum Sepolia and hold a private draft that has been verified for this exchange.
    options.lockRainButton.disabled = !(state.lockRain && draftMatches(setup) && who.address === setup.alice && who.chainId === 11155111);
    // Bob to lock ETH: You must use a Bob account and switch to Arbitrum Sepolia.
    ui.lockEth.disabled = !(state.lockEth && who.address === setup.bob && who.chainId === 421614);
    // Alice's claim of ETH: In addition to the on-chain status allowing it, a corresponding private backup must also be provided as a secret.
    ui.claimEth.disabled = !(state.claimEth && aliceEth && draftMatches(setup));
    // Bob to claim Rain: First, provide the correct format of the ETH claim transaction hash. Click on it and then verify the actual event.
    ui.claimRain.disabled = !(state.claimRain && who.address === setup.bob && who.chainId === 11155111 && isHexString(ui.claimHash.value.trim(), 32));
    // The refunder shall be the original person who locked the coin as recorded on the chain and must use the corresponding network.
    options.refundRainButton.disabled = !(state.refundRain && who.address === getAddress(snapshot.rain.swap.sender) && who.chainId === 11155111);
    options.refundEthButton.disabled = !(state.refundEth && who.address === getAddress(snapshot.eth.swap.sender) && who.chainId === 421614);
    
  }

  // Manual buttons, refresh after input, and scheduled refresh share this read/snapshot update path.
  async function fetchPair(lookup) {
    let setup = null;
    try { setup = getSetup(); } catch { /* Historical lookup remains available without valid terms. */ }
    return readPairSnapshot(lookup, setup);
  }

  async function refresh() {
    if (options.isBusy() || checkingPending) return;
    if (refreshing) return refreshing;
    const currentGeneration = generation;
    let lookup;
    try { lookup = options.readLookup(); }
    catch (error) {
      snapshot = null;
      snapshotSignature = "";
      options.onSnapshot(null, safeErrorMessage(error));
      render();
      return;
    }
    const signature = JSON.stringify(lookup);
    let failure = "";
    // The timed refresh of the same group of ids retains the last snapshot. Clear immediately when input changes or read failures occur to avoid misusing the old swap.
    if (snapshotSignature !== signature) {
      snapshot = null;
      snapshotSignature = "";
      options.onSnapshot(null, "Reading both chains...");
    }
    refreshing = (async () => {
      try {
        const next = await fetchPair(lookup);
        if (currentGeneration !== generation) return;
        snapshot = next;
        snapshotSignature = signature;
        options.onSnapshot(next);
      } catch (error) {
        if (currentGeneration !== generation) return;
        snapshot = null;
        snapshotSignature = "";
        failure = "Chain refresh failed: " + safeErrorMessage(error);
        options.onSnapshot(null, failure);
      } finally {
        refreshing = null;
        render();
        if (failure && currentGeneration === generation) ui.details.textContent = failure + " Use Read Both Locks to retry.";
        if (currentGeneration !== generation) void refresh();
        else if (!failure) void reconcilePending();
      }
    })();
    render();
    return refreshing;
  }

  ui.readLocks.addEventListener("click", () => { void refresh(); });

  function inputsChanged() {
    if (applying) return;
    generation++;
    snapshot = null;
    snapshotSignature = "";
    options.onSnapshot(null, "Inputs changed. Read both locks again.");
    try { persist(getSetup()); } catch { /* Do not overwrite the old Settings with an unfinished form. */ }
    render();
    clearTimeout(timer);
    timer = setTimeout(() => { void refresh(); }, 500);
  }

  //When importing the currently exchanged public files, verify them first and then batch fill them into the page.
  function applySetup(raw) {
    const setup = validatePublicSetup(raw);
    if (setup.rainToken !== getAddress(options.rainToken) || setup.rainHtlc !== getAddress(options.rain.address) || setup.ethHtlc !== getAddress(options.eth.address)) {
      throw new Error("This public setup uses different deployment addresses.");
    }
    applying = true;
    options.applyPublicSetup(setup);
    ui.claimHash.value = setup.ethClaimTxHash;
    applying = false;
    inputsChanged();
    ui.publicStatus.textContent = "Public setup loaded. No private secret was imported.";
  }

  // Fill in the public ID and hashlock from the private draft into the form. The secret itself will not enter the public Settings.
  function useDraft() {
    const draft = options.getDraft();
    if (!draft) throw new Error("Generate or restore a private draft first.");
    let previous = null;
    try { previous = getSetup(); } catch { /* no valid previous public context */ }
    const previousClaim = previous?.rainSwapId === draft.rainSwapId && previous?.ethSwapId === draft.ethSwapId
      ? ui.claimHash.value : "";
    applying = true;
    options.applyDraftFields(draft);
    ui.claimHash.value = previousClaim;
    applying = false;
    inputsChanged();
    ui.publicStatus.textContent = "Draft IDs and hashlock copied to the public setup. Keep the private backup with Alice.";
  }

  // MetaMask identity is checked again after the HTTP response: the user may switch it while waiting.
  async function requireWallet(plan, setup) {
    const [chainId, accounts] = await Promise.all([
      window.ethereum.request({ method: "eth_chainId" }),
      window.ethereum.request({ method: "eth_accounts" })
    ]);
    const chain = plan.asset === "rain" ? options.rain : options.eth;
    if (Number(chainId) !== chain.chainId) throw new Error("Switch MetaMask to " + chain.name + ".");
    if (!accounts.length || getAddress(accounts[0]) !== getAddress(plan.sender)) {
      throw new Error("Select the designated " + (plan.sender === setup.alice ? "Alice" : "Bob") + " account.");
    }
  }

  // A single wallet path serves approval, both locks, both claims and both refunds.
  // No contract-state decision or event verification is reimplemented in this browser controller.
  async function runAction(action) {
    if (options.isBusy() || checkingPending) return;
    const display = options.actionDisplays?.[action] || { status: ui.actionStatus, link: ui.actionLink };
    if (!window.ethereum) {
      display.status.textContent = "Enable MetaMask first.";
      showActionResult("Wallet connection needed", "MetaMask is not available on this page.", "Enable MetaMask and connect the account required for this step.", "warning");
      return;
    }
    const wallet = new BrowserProvider(window.ethereum);
    let plan = null, tx = null;
    const secrets = [options.getDraft()?.preimage];
    options.setBusy(true);
    display.link.hidden = true;
    display.status.textContent = "Checking the latest chain records and preparing your transaction...";
    try {
      const setup = getSetup();
      const signature = JSON.stringify(setup);
      const asset = ["lock-eth", "claim-eth", "refund-eth"].includes(action) ? "eth" : "rain";
      const swapId = setup[asset + "SwapId"];
      await guardPending(asset, swapId, action);
      const extras = {};
      if (action === "lock-rain" || action === "claim-eth") {
        if (!draftMatches(setup)) throw new Error("Restore the matching, verified private backup first.");
        const draft = options.getDraft();
        if (keccak256(draft.preimage) !== setup.hashlock) throw new Error("The private backup secret does not match this exchange.");
        if (action === "claim-eth") extras.preimage = draft.preimage;
      }
      if (action === "approve-rain") extras.approvalAmount = options.getApprovalAmount();
      plan = await prepareAction(action, setup, actor().address, extras);
      if (plan.method === "claim") secrets.push(plan.args[1]);
      const chain = asset === "rain" ? options.rain : options.eth;
      const target = action === "approve-rain" ? options.rainToken : chain.address;
      const abi = action === "approve-rain" ? ["function approve(address,uint256) returns(bool)"] : chain.abi;
      // Check the HTTP response envelope against the selected action and the repository ABI before asking the wallet.
      const methods = { "approve-rain": "approve", "lock-rain": "createERC20Swap", "lock-eth": "createETHSwap",
        "claim-eth": "claim", "claim-rain": "claim", "refund-rain": "refund", "refund-eth": "refund" };
      if (plan.action !== action || plan.asset !== asset || plan.swapId !== swapId ||
          plan.method !== methods[action] || getAddress(plan.transaction.to) !== getAddress(target) ||
          getAddress(plan.transaction.from) !== getAddress(plan.sender) ||
          BigInt(plan.transaction.value) !== plan.value ||
          Number(plan.transaction.chainId) !== chain.chainId ||
          plan.transaction.data !== new Interface(abi).encodeFunctionData(plan.method, plan.args)) {
        throw new Error("The coordinator response does not match the selected action.");
      }
      if (action === "claim-eth" && plan.args[1] !== extras.preimage) throw new Error("The returned claim uses a different secret.");
      await requireWallet(plan, setup);
      if (signature !== JSON.stringify(getSetup())) throw new Error("Terms changed while preparing the transaction. Retry with the current setup.");
      const signer = await wallet.getSigner(plan.sender);
      display.status.textContent = "Review this step's transaction in MetaMask. Estimated fee budget: " + formatEther(plan.quote.feeBudget) + " ETH.";
      // B prepares an unsigned request; only MetaMask can authorize and broadcast it.
      tx = await signer.sendTransaction(plan.transaction);
      trackTransaction(action, asset, swapId, tx.hash);
      display.link.href = chain.explorer + "/tx/" + tx.hash;
      display.link.hidden = false;
      display.status.textContent = "Transaction submitted. Waiting for 2 confirmations and checking the result. This step is not complete yet.";
      await confirmAction(action, setup, tx.hash);
      trackTransaction(action, asset, swapId, tx.hash, "confirmed");
      const [title, description, next] = completedAction(action, setup, plan);
      display.status.textContent = "Transaction confirmed. " + title + ". " + description + " " + next;
      showActionResult(title, description, next, "success", chain.explorer + "/tx/" + tx.hash);
      try { await options.refreshWallet(); } catch { /* The subsequent double-chain refresh will regain the status again. */ }
    } catch (error) {
      if (tx && plan) trackTransaction(action, plan.asset, plan.swapId, tx.hash, "unknown");
      display.status.textContent = (tx ? "Transaction submitted. Check its link before retrying. " : "") + safeErrorMessage(error, secrets);
      const cancelled = error.code === 4001 || error.code === "ACTION_REJECTED";
      showActionResult(tx ? "Transaction result not verified" : cancelled ? "Wallet request cancelled" : "This step could not be completed",
        safeErrorMessage(error, secrets),
        tx ? "A transaction was submitted. Check the transaction link and read both locks before retrying. Do not send it again just because confirmation failed."
          : "No new transaction hash was received by the app. Check MetaMask Activity and the message above before retrying.",
        "warning", tx && plan ? (plan.asset === "rain" ? options.rain : options.eth).explorer + "/tx/" + tx.hash : "");
    } finally {
      options.setBusy(false);
      wallet.destroy();
      void refresh();
    }
  }

  ui.lockEth.addEventListener("click", () => { void runAction("lock-eth"); });
  ui.claimEth.addEventListener("click", () => { void runAction("claim-eth"); });
  ui.claimRain.addEventListener("click", () => { void runAction("claim-rain"); });
  el("use-draft-button").addEventListener("click", () => {
    try { useDraft(); } catch (error) { ui.publicStatus.textContent = safeErrorMessage(error); }
  });
  // Export the public JSON that has undergone field whitelist checking for Bob or another browser to continue the operation.
  el("export-public-button").addEventListener("click", () => {
    try {
      const setup = getSetup();
      options.downloadJson(setup, "htlc-public-" + setup.rainSwapId + ".json");
      ui.publicStatus.textContent = "Public setup exported. It contains no private preimage or wallet key.";
    } catch (error) { ui.publicStatus.textContent = safeErrorMessage(error); }
  });
  ui.publicFile.addEventListener("change", async () => {
    const file = ui.publicFile.files[0];
    if (!file) return;

    try {
      if (file.size > 32768) throw new Error("Public setup file is too large.");
      applySetup(JSON.parse(await file.text()));
    } catch (error) {
      ui.publicStatus.textContent = safeErrorMessage(error);
      ui.publicFile.value = "";
    }
  });
  // Before creating a new switch, make sure that the old switch has no pending Active lock
  el("new-swap-button").addEventListener("click", () => {
    if (options.isBusy() || refreshing || checkingPending) { ui.publicStatus.textContent = "Wait for the current read or transaction to finish."; return; }
    
    if (!snapshot && options.getDraft()) { ui.publicStatus.textContent = "Read both locks before replacing the current private draft."; return; }
    if (snapshot && [snapshot.rain.swap, snapshot.eth.swap].some((swap) => swap.status === 1n)) {
      ui.publicStatus.textContent = "An Active lock is still selected. Complete or refund it before starting a new draft here.";
      return;
    }
    // Reset the old draft in the browser memory and generate a new ID and secret
    options.resetDraft();
    options.generateDraft();
    guide.go("prepare");
  });
  
  for (const input of options.inputs) input.addEventListener("input", inputsChanged);
  ui.claimHash.addEventListener("input", inputsChanged);
  const stored = readStored(SETUP_KEY, null);
  if (stored) {
    try { applySetup(stored); } catch (error) { ui.publicStatus.textContent = "Saved setup could not be restored: " + safeErrorMessage(error); }
  }
  if (pending) {
    const chain = pending.asset === "rain" ? options.rain : options.eth;
    ui.actionLink.href = chain.explorer + "/tx/" + pending.hash;
    ui.actionLink.hidden = false;
    ui.actionStatus.textContent = pending.action + " has not been verified. Check this transaction and read both locks.";
  }
  render();
  // Update the on-chain status every 15 seconds when the page is visible. 
  const poll = setInterval(() => {
    if (document.visibilityState === "visible") void refresh();
  }, 15000);
  // Clear the timer and RPC connections when leaving or refreshing the page; The private draft memory will also be destroyed along with the page.
  window.addEventListener("beforeunload", () => {
    clearInterval(poll); clearTimeout(timer);

  });

  return {
    refresh, useDraft, runAction, guardPending,
    walletChanged: render,
    busyChanged() { render(); if (!options.isBusy()) void refresh(); }
  };
}
