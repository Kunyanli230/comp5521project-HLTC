import {
  BrowserProvider,//Wrap the browser wallet interface as an ethers connection
  Contract,//Create a JavaScript object for invoking the contract
  formatEther,//Display the amount of ETH
  formatUnits, //Display the token quantity by token precision
  randomBytes, //Generate 32-byte cryptographically secure random data.
  hexlify, //Convert bytes to 0x... Format.
  keccak256, //Hasher
  isHexString, //Check if it is a hexadecimal string representing 32 bytes
  ZeroHash //32-byte value with all zeros
} from "ethers";
// Use the shared ABI exported after compiling with Task A
import erc20HtlcAbi from "../config/abi/ERC20HTLC.json";
import ethHtlcAbi from "../config/abi/ETHHTLC.json";
// The public deployment result of Task B: It includes the contract address, network and public account, but does not include the wallet private key.
import sepoliaDeployment from "../deployments/sepolia.json";
import arbitrumDeployment from "../deployments/arbitrumSepolia.json";
import { attachWorkflow } from "./lib/workflow.js";
// Use the period and status judgment of B through the front-end adaptation function; The Node.js/.env runtime of B does not enter the browser.
import { fieldMismatches, validateDurations, recoveryView, requireBytes32, parseSwapTerms, expectedLock } from "./lib/swapProtocol.js";
const connectButton = document.querySelector("#connect-button");
const accountText = document.querySelector("#account");
const chainIdText = document.querySelector("#chain-id");
const statusText = document.querySelector("#status");
const sepoliaButton = document.querySelector("#sepolia-button");
const arbitrumButton = document.querySelector("#arbitrum-button");
const ethBalanceText = document.querySelector("#eth-balance");
const rainLockAssessmentText = document.querySelector("#rain-lock-assessment");
const rainBalanceText = document.querySelector("#rain-balance");
// Contract interface
const RAIN_ADDRESS = sepoliaDeployment.rainAddress;
const approveAmountInput = document.querySelector("#approve-amount");
const approveButton = document.querySelector("#approve-button");
const approvalStatusText = document.querySelector("#approval-status");
const approvalTxLink = document.querySelector("#approval-tx-link");
const RAIN_ABI = [
  "function balanceOf(address account) view returns (uint256)",//Return the token balance of the specified account
  "function decimals() view returns (uint8)", //Return the decimal places of the token.
  "function allowance(address owner, address spender) view returns (uint256)"
];

const rainAllowanceText = document.querySelector("#rain-allowance");
const generateSwapButton = document.querySelector("#generate-swap-button");
const backupSecretButton = document.querySelector("#backup-secret-button");
const hashlockText = document.querySelector("#swap-hashlock");
const rainSwapIdText = document.querySelector("#rain-swap-id");
const ethSwapIdText = document.querySelector("#eth-swap-id");
const swapSetupStatusText = document.querySelector("#swap-setup-status");
const secretBackupInput = document.querySelector("#secret-backup-input");
const rainSwapQueryInput = document.querySelector("#rain-swap-query");
const rainLockStateText = document.querySelector("#rain-lock-state");
const rainLockDetailsText = document.querySelector("#rain-lock-details");
const expectedRainHashlockInput = document.querySelector("#expected-rain-hashlock");
const rainParameterCheckText = document.querySelector("#rain-parameter-check");
const swapTermsSection = document.querySelector("#swap-terms-section");
const termsAliceInput = document.querySelector("#terms-alice");
const termsBobInput = document.querySelector("#terms-bob");
termsAliceInput.value = sepoliaDeployment.accounts.alice;
termsBobInput.value = sepoliaDeployment.accounts.bob;
const termsRainAmountInput = document.querySelector("#terms-rain-amount");
const termsEthAmountInput = document.querySelector("#terms-eth-amount");
const checkTermsButton = document.querySelector("#check-terms-button");
const swapTermsResultText = document.querySelector("#swap-terms-result");
let swapDraft = null;//saves the data generated this time. null indicates that there is no draft yet
let secretBackupVerified = false; //Has it been successfully restored from the local file and passed the verification?
const ERC20_HTLC_ADDRESS = sepoliaDeployment.address;
const ethSwapQueryInput = document.querySelector("#eth-swap-query");
const ethLockStateText = document.querySelector("#eth-lock-state");
const ethLockReportText = document.querySelector("#eth-lock-report");
const expectedEthHashlockInput = document.querySelector("#expected-eth-hashlock");
const ethParameterCheckText = document.querySelector("#eth-parameter-check");
const ETH_HTLC_ADDRESS = arbitrumDeployment.address;
const timelockSettingsSection = document.querySelector("#timelock-settings-section");
const rainLockSecondsInput = document.querySelector("#rain-lock-seconds");
const ethLockSecondsInput = document.querySelector("#eth-lock-seconds");
const checkTimelocksButton = document.querySelector("#check-timelocks-button");
const timelockSettingsResultText = document.querySelector("#timelock-settings-result");

const crossChainReportText = document.querySelector("#cross-chain-report");
const pairTimelockCheckText = document.querySelector("#pair-timelock-check");
const pairParameterCheckText = document.querySelector("#pair-parameter-check");
// refresh counter
let walletRefreshVersion = 0;
const refundRainButton = document.querySelector("#refund-rain-button");
const refundEthButton = document.querySelector("#refund-eth-button");
const refundStatusText = document.querySelector("#refund-status");
const refundTxLink = document.querySelector("#refund-tx-link");

let htlcTransactionPending = false;

const HTLC_CHAINS = {
  rain: {
    name: "Ethereum Sepolia",
    chainId: sepoliaDeployment.chainId,
    address: ERC20_HTLC_ADDRESS,
    abi: erc20HtlcAbi,
    explorer: sepoliaDeployment.explorer
  },
  eth: {
    name: "Arbitrum Sepolia",
    chainId: arbitrumDeployment.chainId,
    address: ETH_HTLC_ADDRESS,
    abi: ethHtlcAbi,
    explorer: arbitrumDeployment.explorer
  }
};
const lockRainButton = document.querySelector("#lock-rain-button");
const rainLockTxStatusText = document.querySelector("#rain-lock-tx-status");
const rainLockTxLink = document.querySelector("#rain-lock-tx-link");
let workflowUI = null;
// request wallet access and display the account and chain ID.
async function connectWallet() {
  if (!window.ethereum) {
    statusText.textContent =
      "No Ethereum wallet detected, please install MetaMask!";
    return;
  }

  connectButton.disabled = true;
  accountText.textContent = "Not connected";
  chainIdText.textContent = "Unknown";
  ethBalanceText.textContent = "—";//Used to clear the old balance when reconnecting.
  rainBalanceText.textContent = "—";
  rainAllowanceText.textContent = "—";
  statusText.textContent = "Connecting... Check MetaMask.";

  try {
    // Request account access from the wallet
    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts"
    });

    if (accounts.length === 0) {
      throw new Error("No authorized account was returned.");
    }
    // After a successful connection, it will be uniformly updated through refreshWalletState()
    await refreshWalletState();
  } catch (error) {
    console.error(error);
    // The user rejected the request.
    if (error.code === 4001) {
      statusText.textContent = "Connection request rejected. Please try again.";
    } else if (error.code === -32002) {
      statusText.textContent =
        "A wallet request is already pending. Please check MetaMask.";
    } else {
      statusText.textContent =
        "Connection failed. Check MetaMask and try again.";
    }
  } finally {
    // Disable the button during the waiting period to avoid repeated clicks
    connectButton.disabled = false;
  }
}

connectButton.addEventListener("click", connectWallet);

// read Rain balance and the HTLC allowance on Ethereum Sepolia.
async function readRainInfo(address) {
  // The MetaMask interface is handed over to ethers for packaging
  const provider = new BrowserProvider(window.ethereum);

  try {
    // Query the actual network used by this connection
    const network = await provider.getNetwork();

    if (network.chainId !== 11155111n) {
      throw new Error("Rain must be queried on Ethereum Sepolia.");
    }

    const token = new Contract(RAIN_ADDRESS, RAIN_ABI, provider);
    // Create an object pointing to the already deployed Rain contract
    const decimals = await token.decimals();
    const balance = await token.balanceOf(address);
    const allowance = await token.allowance(address, ERC20_HTLC_ADDRESS);
    return {
      balance: formatUnits(balance, decimals),
      allowance: formatUnits(allowance, decimals)
    };
  } finally {
    provider.destroy();//Release the connection resources created by this query
  }
}
// read existing wallet permissions and refresh the displayed state.
async function refreshWalletState() {
  const requestVersion = ++walletRefreshVersion;
  ethBalanceText.textContent = "Loading...";
  rainBalanceText.textContent = "Loading...";
  rainAllowanceText.textContent = "Loading...";
  try {
    const accounts = await window.ethereum.request({
      method: "eth_accounts"
    });

    const chainId = await window.ethereum.request({
      method: "eth_chainId"
    });
    if (requestVersion !== walletRefreshVersion) {
      return;
    }

    chainIdText.textContent = Number.parseInt(chainId, 16).toString();

    if (accounts.length === 0) {
      accountText.textContent = "Not connected";
      ethBalanceText.textContent = "—";
      rainBalanceText.textContent = "—";//If the account is not connected, the balance will not be checked
      rainAllowanceText.textContent = "—";
      statusText.textContent = "Connect your wallet to get started.";
      workflowUI?.walletChanged();
      return;
    }

    accountText.textContent = accounts[0];
    statusText.textContent = "Wallet connected.";
    workflowUI?.walletChanged();

    const balanceHex = await window.ethereum.request({//The hexadecimal wei quantity returned by the wallet
      // Check the balance of ETH coins
      method: "eth_getBalance",
      params: [accounts[0], "latest"] //Query this account address, Query by the current latest block
    });

    if (requestVersion !== walletRefreshVersion) {
      return;
    }
    // Conversion amount
    const balanceWei = BigInt(balanceHex);
    ethBalanceText.textContent = formatEther(balanceWei) + " ETH";
    if (Number.parseInt(chainId, 16) !== 11155111) {
      rainBalanceText.textContent = "Switch to Ethereum Sepolia";
      rainAllowanceText.textContent = "Switch to Ethereum Sepolia";
      return;
    }
    try {
      const rainInfo = await readRainInfo(accounts[0]);

      if (requestVersion !== walletRefreshVersion) {
        return;
      }

      rainBalanceText.textContent = rainInfo.balance + " Rain (MST)";
      rainAllowanceText.textContent = rainInfo.allowance + " Rain (MST)";
    } catch (error) {
      if (requestVersion !== walletRefreshVersion) {
        return;
      }
      console.error(error);
      rainBalanceText.textContent = "Unavailable";
      rainAllowanceText.textContent = "Unavailable";
    }
  } catch (error) {
    // If the number is not the latest, stop processing this old result.
    if (requestVersion !== walletRefreshVersion) {
      return;
    }

    console.error(error);

    accountText.textContent = "Not connected";
    chainIdText.textContent = "Unknown";
    ethBalanceText.textContent = "Unavailable";
    rainBalanceText.textContent = "Unavailable";
    rainAllowanceText.textContent = "Unavailable";
    statusText.textContent =
      "Unable to refresh wallet information. Please try again.";
    workflowUI?.walletChanged();
  }
}
// request a wallet network switch and refresh the displayed state.
// Let the same function switch between different networks
async function switchNetwork(targetChainId) {
  if (!window.ethereum) {
    statusText.textContent = "Please install or enable MetaMask.";
    return;
  }

  sepoliaButton.disabled = true;
  arbitrumButton.disabled = true;
  statusText.textContent = "Switching network... Check MetaMask.";

  try {
    await window.ethereum.request({
        // Request the wallet to switch the current network
      method: "wallet_switchEthereumChain",
      params: [
        {
        // Convert the decimal number to the format required by the wallet
          chainId: "0x" + targetChainId.toString(16)
        }
      ]
    });
    // Re-query the actual status
    await refreshWalletState();
  } catch (error) {
    console.error(error);

    if (error.code === 4001) {
      statusText.textContent = "Network switch rejected.";
    } else if (error.code === 4902) {
      statusText.textContent =
        "Network not added. Add it in MetaMask, then try again.";
    } else if (error.code === -32002) {
      statusText.textContent =
        "A wallet request is already pending. Please check MetaMask.";
    } else {
      statusText.textContent =
        "Unable to switch networks. Please check MetaMask.";
    }
  } finally {
    sepoliaButton.disabled = false;
    arbitrumButton.disabled = false;
  }
}
// When clicked, perform the operation within the curly braces.
sepoliaButton.addEventListener("click", () => {
  switchNetwork(11155111);
});

arbitrumButton.addEventListener("click", () => {
  switchNetwork(421614);
});
// AI-assisted: refresh wallet information when accounts or networks change.
if (window.ethereum) {
  window.ethereum.on("accountsChanged", refreshWalletState);
  window.ethereum.on("chainChanged", refreshWalletState);

  refreshWalletState();
}

// Approval is coordinated by B; C only starts the common MetaMask flow.
approveButton.addEventListener("click", () => { void workflowUI.runAction("approve-rain"); });

// Generate a private preimage and public swap identifiers locally.
function generateSwapDraft() {
  if (swapDraft !== null) {
    swapSetupStatusText.textContent = "A swap draft has already been created.";
    return;
  }

  try {
    const preimage = hexlify(randomBytes(32)); //Generate secrets
    const hashlock = keccak256(preimage); //Calculate its corresponding hashlock
    //Generate two swap ids independently
    // Chain ID: Identifies the network, for example, Sepolia's 11155111.
    // Swap ID: Identifies a certain locked record and regenerates it each time a new swap occurs.
    const rainSwapId = hexlify(randomBytes(32));
    const ethSwapId = hexlify(randomBytes(32));

    swapDraft = {
      preimage,
      hashlock,
      rainSwapId,
      ethSwapId
    };

    hashlockText.textContent = swapDraft.hashlock;
    rainSwapIdText.textContent = swapDraft.rainSwapId;
    ethSwapIdText.textContent = swapDraft.ethSwapId;

    generateSwapButton.disabled = true;
    backupSecretButton.disabled = false;
    swapSetupStatusText.textContent =
      "Draft created. Back up the secret before locking any assets.";
    workflowUI?.useDraft();
  } catch {
    swapSetupStatusText.textContent =
      "Unable to generate swap parameters. Please try again.";
  }
}

generateSwapButton.addEventListener("click", generateSwapDraft);

// Ai assistent: Download the current swap private secret backup as JSON.
function downloadSecretBackup() {
  if (swapDraft === null) {
    swapSetupStatusText.textContent = "Generate a swap draft first.";
    return;
  }
  // Organize and back up the content
  const backup = {
    schemaVersion: 1,
    type: "rain-eth-htlc-secret",
    createdAt: new Date().toISOString(),
    preimage: swapDraft.preimage,
    hashlock: swapDraft.hashlock,
    rainSwapId: swapDraft.rainSwapId,
    ethSwapId: swapDraft.ethSwapId
  };
  // AI-assisted: 复用 JSON 下载实现；私密备份仍只下载给 Alice，不写入公开设置或浏览器存储。
  downloadJson(backup, "htlc-private-" + swapDraft.rainSwapId + ".json");

  swapSetupStatusText.textContent =
    "Download requested. Verify that the private backup file was saved.";
}

backupSecretButton.addEventListener("click", downloadSecretBackup);

// Ai assistent: validate a local private backup before restoring the swap draft.
async function restoreSwapDraft() {
  // Read the file selected by the user
  const file = secretBackupInput.files[0];

  if (!file) {
    return;
  }

  generateSwapButton.disabled = true;
  secretBackupInput.disabled = true;
  swapSetupStatusText.textContent = "Reading and validating the backup...";

  try {
    if (file.size > 16 * 1024) {
      throw new Error("Backup file is too large.");
    }

    const text = await file.text();
    const data = JSON.parse(text);

    if (
      data === null ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      data.schemaVersion !== 1 ||
      data.type !== "rain-eth-htlc-secret"
    ) {
      throw new Error("Unsupported backup format.");
    }

    const fields = ["preimage", "hashlock", "rainSwapId", "ethSwapId"];

    for (const field of fields) {
      if (!isHexString(data[field], 32)) {
        throw new Error("Invalid backup field.");
      }
    }

    const restoredDraft = {
      preimage: data.preimage.toLowerCase(),
      hashlock: data.hashlock.toLowerCase(),
      rainSwapId: data.rainSwapId.toLowerCase(),
      ethSwapId: data.ethSwapId.toLowerCase()
    };

    if (
      restoredDraft.hashlock === ZeroHash ||
      restoredDraft.rainSwapId === ZeroHash ||
      restoredDraft.ethSwapId === ZeroHash ||
      restoredDraft.rainSwapId === restoredDraft.ethSwapId
    ) {
      throw new Error("Invalid swap identifiers.");
    }
    // Does the secret match?
    if (keccak256(restoredDraft.preimage) !== restoredDraft.hashlock) {
      throw new Error("Secret does not match the hashlock.");
    }

    if (swapDraft !== null && fields.some((field) => swapDraft[field] !== restoredDraft[field])) {
      throw new Error("A different draft is loaded. Select its matching backup or start a new swap after completing the old one.");
    }

    swapDraft = restoredDraft;
    secretBackupVerified = true;

    hashlockText.textContent = swapDraft.hashlock;
    rainSwapIdText.textContent = swapDraft.rainSwapId;
    ethSwapIdText.textContent = swapDraft.ethSwapId;
    backupSecretButton.disabled = false;

    swapSetupStatusText.textContent = "Private backup restored and verified. Selected file: " + file.name;
    workflowUI?.useDraft();
  } catch {
    swapSetupStatusText.textContent =
      "Unable to restore: invalid backup or inconsistent swap parameters.";
    secretBackupInput.value = "";
  } finally {
    generateSwapButton.disabled = swapDraft !== null;
    secretBackupInput.disabled = false;
  }
}

secretBackupInput.addEventListener("change", restoreSwapDraft);

// Read and validate the public swap terms.
function readSwapTerms() {
  return parseSwapTerms({
    alice: termsAliceInput.value.trim(), bob: termsBobInput.value.trim(),
    rainAmount: termsRainAmountInput.value.trim(), ethAmount: termsEthAmountInput.value.trim()
  });
}

// Ai assistent: preview the validated terms or display an input error.
checkTermsButton.addEventListener("click", () => {
  try {
    const terms = readSwapTerms();

    swapTermsResultText.textContent = [
      "Input checks passed. On-chain locks have not been verified.",
      "Alice: " + terms.alice,
      "Bob: " + terms.bob,
      "Rain amount: " + formatUnits(terms.rainAmount, 18),
      "ETH amount: " + formatEther(terms.ethAmount)
    ].join("\n");
  } catch (error) {
    swapTermsResultText.textContent =
      error.shortMessage || error.message || "Invalid swap terms.";
  }
});

// 两条链共用字段构造和比较；资产只决定参与者方向、代币及金额。
function readExpectedLockFields(asset, terms = readSwapTerms()) {
  const rain = asset === "rain";
  const input = rain ? expectedRainHashlockInput : expectedEthHashlockInput;
  return expectedLock({
    ...terms, rainToken: RAIN_ADDRESS,
    hashlock: requireBytes32(input.value.trim(), "Agreed hashlock")
  }, asset);
}

function checkLockParameters(swap, asset) {
  if (swap.status === 0n) return "No on-chain lock exists for this swap ID.";
  try {
    const mismatches = fieldMismatches(swap, readExpectedLockFields(asset));
    return mismatches.length
      ? "Mismatched fields: " + mismatches.join(", ")
      : "Sender, receiver, token, amount and hashlock match. State and deadlines are checked separately.";
  } catch (error) {
    return "Unable to check parameters: " + (error.shortMessage || error.message || "Invalid agreed parameters.");
  }
}

function renderLockReport(record, asset) {
  const { swapId, swap, block } = record;
  const chain = HTLC_CHAINS[asset];
  const rain = asset === "rain";
  const assessment = [
    "Network: " + chain.name,
    "Snapshot block: " + block.number,
    "Chain time (Unix seconds): " + block.timestamp,
    describeSwapPhase(record)
  ].join("\n");
  const amount = rain
    ? swap.token.toLowerCase() === RAIN_ADDRESS.toLowerCase()
      ? formatUnits(swap.amount, 18) + " Rain (MST)"
      : swap.amount + " base units (unrecognized token)"
    : formatEther(swap.amount) + " ETH";
  const details = swap.status === 0n ? "No on-chain lock exists for this swap ID." : [
    "Swap ID: " + swapId, "HTLC contract: " + chain.address,
    "Sender: " + swap.sender, "Receiver: " + swap.receiver, "Token: " + swap.token,
    "Amount: " + amount, "Hashlock: " + swap.hashlock,
    "Deadline (local time): " + new Date(Number(swap.timelock) * 1000).toLocaleString(),
    "Deadline (Unix seconds): " + swap.timelock
  ].join("\n");
  const stateText = rain ? rainLockStateText : ethLockStateText;
  stateText.textContent = ["Not created", "Active", "Claimed", "Refunded"][Number(swap.status)] || "Unknown";
  (rain ? rainParameterCheckText : ethParameterCheckText).textContent = checkLockParameters(swap, asset);
  if (rain) {
    rainLockDetailsText.textContent = details;
    rainLockAssessmentText.textContent = assessment;
  } else {
    ethLockReportText.textContent = assessment + "\n\n" + details;
  }
}

// Clear the old prompt of Check Swap Terms
swapTermsSection.addEventListener("input", () => {
  swapTermsResultText.textContent = "Terms changed. Check them again.";
});

// Classify a swap using its state and a chain timestamp.
function describeSwapPhase(record) {
  // 分类直接来自 B3；此函数只将状态转换为英文界面说明。
  const { state, remaining } = recoveryView(record);
  if (state === "NOT_FOUND") {
    return "Not created. No assets are locked under this ID.";
  }

  if (state === "CLAIMED") {
    return "Claimed. No further claim or refund is available.";
  }

  if (state === "REFUNDED") {
    return "Refunded. No further claim or refund is available.";
  }

  if (state === "REFUNDABLE") {
    return (
      "Expired and not refunded. The claim window is closed. " +
      "Only the original sender can request a refund."
    );
  }

  return (
    (state === "CLOSING" ? "Claim window is closing. " : "Within the claim window. ") +
    remaining.toString() +
    " seconds remain. Claiming requires the designated receiver " +
    "and the correct preimage."
  );
}

// Validate the planned durations before creating locks.
function readTimelockSettings() {
  // 这里只读取表单；整数、期限顺序和窗口边界交给前端的统一检查函数。
  return validateDurations(rainLockSecondsInput.value.trim(), ethLockSecondsInput.value.trim());
}

// Ai assistent: preview the duration checks without creating any lock.
checkTimelocksButton.addEventListener("click", () => {
  try {
    const settings = readTimelockSettings();

    timelockSettingsResultText.textContent = [
      "Duration checks passed. On-chain deadlines have not been verified.",
      "Rain duration: " + settings.rainSeconds.toString() + " seconds",
      "ETH duration: " + settings.ethSeconds.toString() + " seconds",
      "Minimum deadline gap: " + settings.minGap.toString() + " seconds",
      "Minimum claim window: " + settings.minWindow.toString() + " seconds"
    ].join("\n");
  } catch (error) {
    timelockSettingsResultText.textContent =
      error.message || "Invalid timelock settings.";
  }
});

// Require another check after either duration is edited.
timelockSettingsSection.addEventListener("input", () => {
  timelockSettingsResultText.textContent =
    "Settings changed. Check them again.";
});

// Assess the stage where both locks must still be active.
function assessActivePairTimelocks(snapshot) {
  if (!snapshot) return "Read both locks first.";
  const rain = snapshot.rain.swap;
  const eth = snapshot.eth.swap;
  if (rain.status === 0n || eth.status === 0n) return "Both locks must exist before assessing an active pair.";
  if (rain.status !== 1n || eth.status !== 1n) {
    const labels = ["Not created", "Active", "Claimed", "Refunded"];
    return "Not an active pair: Rain=" + (labels[Number(rain.status)] || "Unknown") +
      ", ETH=" + (labels[Number(eth.status)] || "Unknown") + ". This check requires both locks to be Active.";
  }
  const assessment = snapshot.timelocks;
  const report = [
    "Rain remaining: " + assessment.rainRemaining + " seconds",
    "ETH remaining: " + assessment.ethRemaining + " seconds",
    "Absolute deadline gap: " + assessment.deadlineGap + " seconds",
    "Remaining-time gap: " + assessment.remainingGap + " seconds"
  ];
  if (assessment.issues.length) report.push("Checks not passed:", ...assessment.issues.map((issue) => "- " + issue));
  else report.push("State and deadline checks passed at these snapshot blocks.",
    "Participant, amount and hashlock verification is separate.");
  return report.join("\n");
}

// Compare both snapshot records with the agreed parameters.
function getPairParameterErrors(snapshot) {
  if (!snapshot) return ["Read both locks first."];
  const rain = snapshot.rain.swap;
  const eth = snapshot.eth.swap;
  if (rain.status === 0n || eth.status === 0n) return ["Both locks must exist before checking their parameters."];
  try {
    const terms = readSwapTerms();
    const rainHash = expectedRainHashlockInput.value.trim().toLowerCase();
    const ethHash = expectedEthHashlockInput.value.trim().toLowerCase();
    if (!isHexString(rainHash, 32) || !isHexString(ethHash, 32) || rainHash === ZeroHash || ethHash === ZeroHash) {
      return ["Enter valid, non-zero agreed hashlocks in both sections."];
    }
    if (rainHash !== ethHash) return ["The two agreed hashlocks must be identical."];
    // 共享字段比较返回字段名，页面再补上 Rain/ETH 标签；不在此重写比较规则。
    const rainErrors = fieldMismatches(rain, readExpectedLockFields("rain", terms))
      .map((field) => "Rain " + field + " mismatch.");
    const ethErrors = fieldMismatches(eth, readExpectedLockFields("eth", terms))
      .map((field) => "ETH " + field + " mismatch.");
    return [...rainErrors, ...ethErrors];
  } catch (error) {
    return [error.shortMessage || error.message || "Invalid agreed parameters."];
  }
}

// All chain preparation and confirmation is handled by B through the HTTP client.
lockRainButton.addEventListener("click", () => { void workflowUI.runAction("lock-rain"); });
refundRainButton.addEventListener("click", () => { void workflowUI.runAction("refund-rain"); });
refundEthButton.addEventListener("click", () => { void workflowUI.runAction("refund-eth"); });

// AI-assisted: 私密备份和公开设置共用下载动作，由调用者分别选择文件内容；不写 localStorage。
function downloadJson(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 查询只需要公开 ID，不要求先准备完整交换，也不依赖当前钱包网络。
function readLookup() {
  return {
    rainSwapId: requireBytes32(rainSwapQueryInput.value.trim(), "Rain swap ID"),
    ethSwapId: requireBytes32(ethSwapQueryInput.value.trim(), "ETH swap ID"),
    rainChainId: HTLC_CHAINS.rain.chainId, ethChainId: HTLC_CHAINS.eth.chainId
  };
}

// Collect public terms; never include the preimage or wallet keys.
function readPublicSetup() {
  // Obtain and check the account, amount and duration
  const terms = readSwapTerms();
  const settings = readTimelockSettings();
  const hashlock = expectedRainHashlockInput.value.trim().toLowerCase();
  if (hashlock !== expectedEthHashlockInput.value.trim().toLowerCase()) {
    throw new Error("Use the same agreed hashlock in both lock sections.");
  }
  return {
    type: "rain-eth-htlc-public", schemaVersion: 1,
    alice: terms.alice, bob: terms.bob,
    rainAmount: formatUnits(terms.rainAmount, 18), ethAmount: formatEther(terms.ethAmount),
    rainSeconds: settings.rainSeconds.toString(), ethSeconds: settings.ethSeconds.toString(),
    ...readLookup(), hashlock,
    rainToken: RAIN_ADDRESS, rainHtlc: ERC20_HTLC_ADDRESS, ethHtlc: ETH_HTLC_ADDRESS
  };
}

//Fill in the configuration back on the page
function applyPublicFields(values) {
  // Establish a correspondence between "data fields → page input boxes"
  const bindings = {
    alice: termsAliceInput, bob: termsBobInput, rainAmount: termsRainAmountInput,
    ethAmount: termsEthAmountInput, rainSeconds: rainLockSecondsInput,
    ethSeconds: ethLockSecondsInput, rainSwapId: rainSwapQueryInput, ethSwapId: ethSwapQueryInput
  };

  for (const [key, input] of Object.entries(bindings)) {
    if (values[key] === undefined) continue;
    input.value = values[key];
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  
  if (values.hashlock !== undefined) {
    for (const input of [expectedRainHashlockInput, expectedEthHashlockInput]) {
      input.value = values.hashlock;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
}

// ai assistent: Display existing snapshots
function renderWorkflowSnapshot(snapshot, message = "Not checked.") {
  if (!snapshot) {
    for (const node of [rainLockStateText, ethLockStateText, rainParameterCheckText,
      ethParameterCheckText, rainLockAssessmentText, pairTimelockCheckText,
      pairParameterCheckText, crossChainReportText]) node.textContent = message;
    rainLockDetailsText.textContent = "";
    ethLockReportText.textContent = "";
    return;
  }
  const { rain, eth } = snapshot;
  renderLockReport(rain, "rain");
  renderLockReport(eth, "eth");
  // The calculation is based on the actual cut-off time difference on the chain
  const gap = rain.swap.status !== 0n && eth.swap.status !== 0n
    ? (rain.swap.timelock - eth.swap.timelock).toString() + " seconds"
    : "Unavailable until both locks exist.";
  crossChainReportText.textContent = [
    "Read-only snapshot. See the parameter, state and deadline checks below.", "",
    "Rain / Ethereum Sepolia", "Swap ID: " + rain.swapId, "Block: " + rain.block.number,
    "Chain time: " + rain.block.timestamp, describeSwapPhase(rain), "",
    "ETH / Arbitrum Sepolia", "Swap ID: " + eth.swapId, "Block: " + eth.block.number,
    "Chain time: " + eth.block.timestamp, describeSwapPhase(eth), "",
    "Recorded deadline gap (Rain - ETH): " + gap
  ].join("\n");
  pairTimelockCheckText.textContent = assessActivePairTimelocks(snapshot);
  const errors = getPairParameterErrors(snapshot);
  pairParameterCheckText.textContent = errors.length
    ? "Parameter checks not passed:\n" + errors.join("\n")
    : "Parameters match at these snapshot blocks. State, deadlines and caller authorization are checked separately.";
}
// Connect the existing pages with the new process
workflowUI = attachWorkflow({
  rain: HTLC_CHAINS.rain, eth: HTLC_CHAINS.eth, rainToken: RAIN_ADDRESS,
  actionDisplays: {
    "approve-rain": { status: approvalStatusText, link: approvalTxLink },
    "lock-rain": { status: rainLockTxStatusText, link: rainLockTxLink },
    "refund-rain": { status: refundStatusText, link: refundTxLink },
    "refund-eth": { status: refundStatusText, link: refundTxLink }
  },
  getApprovalAmount: () => approveAmountInput.value.trim(),
  // Each time the module calls it, it acquires the latest account at that time
  getAccount: () => accountText.textContent,
  getChainId: () => chainIdText.textContent,
  getDraft: () => swapDraft,
  isBackupVerified: () => secretBackupVerified,
  isBusy: () => htlcTransactionPending,
  setBusy(value) { htlcTransactionPending = value; workflowUI?.busyChanged(); },
  lockRainButton, refundRainButton, refundEthButton, approveButton,
  readLookup, readPublicSetup, applyPublicSetup: applyPublicFields, applyDraftFields: applyPublicFields,
  downloadJson, generateDraft: generateSwapDraft,
  // Clear the private draft and verification status in the current browser memory
  resetDraft() {
    swapDraft = null;
    secretBackupVerified = false;
    secretBackupInput.value = "";
    generateSwapButton.disabled = false;
    backupSecretButton.disabled = true;
    for (const text of [hashlockText, rainSwapIdText, ethSwapIdText]) text.textContent = "Not generated";
  },
  refreshWallet: refreshWalletState,
  onSnapshot: renderWorkflowSnapshot,
  inputs: [termsAliceInput, termsBobInput, termsRainAmountInput, termsEthAmountInput,
    rainLockSecondsInput, ethLockSecondsInput, rainSwapQueryInput, ethSwapQueryInput,
    expectedRainHashlockInput, expectedEthHashlockInput]
});
// Update the guide and buttons based on the current account and network on the page, not redeploy the contract.
workflowUI.walletChanged();
document.querySelector("#deployment-info").textContent = [
  "Rain ERC20 / Ethereum Sepolia (11155111): " + RAIN_ADDRESS,
  "Rain HTLC / Ethereum Sepolia (11155111): " + ERC20_HTLC_ADDRESS,
  "ETH HTLC / Arbitrum Sepolia (421614): " + ETH_HTLC_ADDRESS,
  "The two contracts are queried independently. Wallet signatures authorize each transaction."
].join("\n");


