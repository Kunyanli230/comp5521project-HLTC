// AI-assisted B3/B4 recovery; see docs/AI_ASSISTANCE.md.
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");
const { ROOT, readJson, writeJson, confirmed, eventFrom, errorMessage, txUrl } = require("./runtime");

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

function advise(rainView, ethView, preimageKnown) {
  const rain = rainView.state, eth = ethView.state;
  const rainActive = ["CLAIMABLE", "CLOSING"].includes(rain);
  const ethActive = ["CLAIMABLE", "CLOSING"].includes(eth);
  if (rain === "CLAIMED" && eth === "CLAIMED") return ["交换完成：两边都已领取。"];
  if (rain === "REFUNDED" && eth === "REFUNDED") return ["资产已全部退回原发送人。"];
  if (eth === "CLAIMED" && rainActive) {
    const deadline = rainView.swap
      ? new Date(Number(rainView.swap.timelock) * 1000).toISOString()
      : `剩余 ${rainView.remaining} 秒`;
    if (!preimageKnown) {
      return [`紧急：Bob 可领取 Rain（需秘密，目前未从链上核验到）；必须在 Rain 到期（${deadline}）前核查 ETH SwapClaimed 事件并领取。`];
    }
    return [`紧急：Bob 必须在 Rain 到期（${deadline}）前用 ETH SwapClaimed 事件中的秘密领取 Rain。`];
  }
  if (eth === "CLAIMED" && rain === "REFUNDABLE") {
    return ["警告：Bob 已错过 Rain 领取窗口，ETH 已被领取；Alice 可以退回 Rain，Bob 面临损失。"];
  }
  if (rain === "REFUNDABLE" && ethActive) {
    return ["时锁顺序异常：Alice 仍可领取 ETH，也可退回 Rain，Bob 面临两项资产都拿不到的风险。Bob 应立即核查两链；若 ETH 到期时仍未领取，立即退款。"];
  }
  if (rainActive && ethActive) {
    return ["交换进行中：Alice 可以领取 ETH，这会公开秘密；Bob 随后须在 Rain 到期前用该事件秘密领取 Rain。"];
  }
  const messages = [];
  if (eth === "REFUNDABLE") messages.push("Bob 可以退回 ETH；Alice 已不能领取 ETH。");
  if (rain === "REFUNDABLE" && eth !== "CLAIMED") messages.push("Alice 可以退回 Rain。");
  if (rainActive && ["REFUNDABLE", "REFUNDED"].includes(eth)) {
    messages.push(`Alice 需等待 Rain 到期后退款，还剩 ${rainView.remaining} 秒。`);
  }
  if (rainActive && eth === "NOT_FOUND") {
    messages.push(`Bob 尚未锁 ETH；Alice 需等待 Rain 到期后退款，还剩 ${rainView.remaining} 秒。`);
  }
  return messages.length ? messages : ["非常规组合，请人工核查。"];
}

async function readSide(chain, swapId, minWindow) {
  // Pin storage and time to one block so a concurrent claim cannot mix snapshots.
  const block = await chain.provider.getBlock("latest");
  if (!block) throw new Error(`${chain.name}: latest block is unavailable`);
  const swap = await chain.htlc.swaps(swapId, { blockTag: block.number });
  return { ...classify(swap, block.timestamp, minWindow), swap, now: block.timestamp,
    blockNumber: block.number, network: chain.name };
}

// CLI 与网页共用同一条“已确认 ETH 领取事件 → 秘密”的恢复路径。
// 先核验回执、规范链区块及确认数，再接受事件中的 preimage。
async function readConfirmedClaim(chain, swapId, transactionHash) {
  if (!ethers.isHexString(transactionHash, 32)) throw new Error("Enter the public ETH claim transaction hash");
  const receipt = await chain.provider.getTransactionReceipt(transactionHash);
  if (!receipt || receipt.status !== 1) throw new Error("The ETH claim transaction is not mined successfully yet");
  const [head, block] = await Promise.all([
    chain.provider.getBlock("latest"), chain.provider.getBlock(receipt.blockNumber),
  ]);
  if (!head || !block || block.hash !== receipt.blockHash || head.number < receipt.blockNumber) {
    throw new Error("The ETH claim receipt is not on the canonical chain");
  }
  const confirmations = head.number - receipt.blockNumber + 1;
  if (confirmations < chain.confirmations) throw new Error("Wait for the required ETH claim confirmations");
  const preimage = eventFrom(receipt, chain.htlc, "SwapClaimed", swapId).preimage;
  const swap = await chain.htlc.swaps(swapId, { blockTag: head.number });
  if (swap.status !== 2n || ethers.keccak256(preimage) !== swap.hashlock) {
    throw new Error("The confirmed event does not match the claimed ETH lock");
  }
  return { swapId, transactionHash, confirmations, blockHash: receipt.blockHash, preimage, swap };
}

// AI-assisted segmented event query; the secret is taken only from on-chain events.
async function findRevealedPreimage(chain, swapId, fromBlock) {
  if (!Number.isSafeInteger(fromBlock) || fromBlock < 0) throw new Error("A valid Lock ETH blockNumber is required");
  const swap = await chain.htlc.swaps(swapId);
  const filter = chain.htlc.filters.SwapClaimed(swapId);
  const latest = await chain.provider.getBlockNumber();
  let span = 5000;
  for (let start = fromBlock; start <= latest;) {
    const end = Math.min(start + span - 1, latest);
    let events;
    try { events = await chain.htlc.queryFilter(filter, start, end); }
    catch (error) {
      const detail = [errorMessage(error), error.error?.message, error.info?.error?.message].join(" ");
      if (span === 1 || !/range|too many|limit|maximum|response size|query returned|exceed/i.test(detail)) throw error;
      span = Math.max(1, Math.floor(span / 2));
      continue;
    }
    for (const event of events) {
      const preimage = event.args.preimage;
      if (ethers.keccak256(preimage).toLowerCase() === swap.hashlock.toLowerCase()) return preimage;
      console.warn("Warning: SwapClaimed preimage does not match the on-chain hashlock; ignoring it.");
    }
    start = end + 1;
  }
  return null;
}

async function pickSigner(chain, swap) {
  const sender = ethers.getAddress(swap.sender);
  for (const role of ["alice", "bob"]) {
    if (ethers.getAddress(await chain[role].getAddress()) === sender) return { role, signer: chain[role] };
  }
  throw new Error(`${chain.name}: neither configured account is this lock's sender`);
}

// CLI 和 HTTP 服务共用退款前置条件；只读链，不选择私钥、不发送交易。
async function prepareRefund(chain, swapId, minWindow) {
  const view = await readSide(chain, swapId, minWindow);
  if (view.state !== "REFUNDABLE") {
    const reasons = {
      NOT_FOUND: "SwapNotFound: this chain has no lock with that swapId",
      CLAIMED: "AlreadyCompleted: already claimed by the receiver; cannot refund",
      REFUNDED: "AlreadyCompleted: already refunded",
      CLAIMABLE: `RefundNotReady: ${view.remaining} seconds remain; expires at ${new Date(Number(view.swap.timelock) * 1000).toISOString()}`,
      CLOSING: `RefundNotReady: ${view.remaining} seconds remain; expires at ${new Date(Number(view.swap.timelock) * 1000).toISOString()}`,
    };
    return { refunded: false, reason: reasons[view.state] };
  }
  return { refundable: true, sender: view.swap.sender, view };
}

async function refundIfAllowed(chain, swapId, minWindow, journal) {
  const prepared = await prepareRefund(chain, swapId, minWindow);
  if (!prepared.refundable) return prepared;
  const view = prepared.view;
  const { role, signer } = await pickSigner(chain, view.swap);
  const contract = chain.htlc.connect(signer);
  try { await contract.refund.staticCall(swapId); }
  catch (error) {
    if (error.code !== "CALL_EXCEPTION" && !error.revert) throw error;
    return { refunded: false, reason: `${error.revert?.name || "Refund preflight failed"}: ${errorMessage(error)}` };
  }
  const asset = chain.key === "sepolia" ? "Rain" : "ETH";
  const receipt = await confirmed(chain, await contract.refund(swapId), `Refund ${asset} (${role})`, journal);
  eventFrom(receipt, chain.htlc, "SwapRefunded", swapId);
  if (Number((await chain.htlc.swaps(swapId)).status) !== 3) throw new Error("Refund confirmed but lock is not Refunded");
  return { refunded: true, hash: receipt.hash, url: txUrl(chain, receipt.hash) };
}

function loadRun(arg, chains) {
  if (typeof arg !== "string" || !arg) throw new Error("Specify a runId or a JSON run record");
  if (!arg.endsWith(".json") && !/^[a-zA-Z0-9_-]+$/.test(arg)) throw new Error("Invalid runId; use a JSON path for a record outside runs/");
  const runFile = arg.endsWith(".json") ? path.resolve(arg) : path.join(ROOT, "runs", `${arg}.json`);
  const run = readJson(runFile);
  if (!run) {
    const directory = path.join(ROOT, "runs");
    const available = fs.existsSync(directory) ? fs.readdirSync(directory).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5)) : [];
    throw new Error(`Run not found. Available runIds: ${available.join(", ") || "none"}`);
  }
  if (!chains) throw new Error("Configured chains are required to validate the run's deployments");
  if (!ethers.isHexString(run.hashlock, 32) || !Array.isArray(run.transactions)) throw new Error("Invalid run: hashlock or transaction journal is missing");
  for (const [side, key] of [["rain", "sepolia"], ["eth", "arbitrumSepolia"]]) {
    const record = run[side], chain = chains[key];
    if (!record || !chain || !ethers.isAddress(record.contract) || !ethers.isAddress(chain.address) ||
        ethers.getAddress(record.contract) !== ethers.getAddress(chain.address) ||
        record.chainId !== chain.chainId || record.network !== key) {
      throw new Error(`${side}: run deployment does not match the configured chain; stop recovery`);
    }
    if (!ethers.isHexString(record.swapId, 32)) throw new Error(`${side}: invalid swapId in run record`);
  }
  return { runFile, run };
}

function makeJournal(runFile, run) {
  // Resolve symlinks as well: committed deployment evidence is always read-only.
  const file = fs.realpathSync(runFile);
  const deployments = fs.realpathSync(path.join(ROOT, "deployments"));
  const relative = path.relative(deployments, file);
  const outsideDeployments = path.isAbsolute(relative) || relative.split(path.sep)[0] === "..";
  if (!outsideDeployments) return () => {};
  return (entry) => {
    const index = run.transactions.findIndex((tx) => tx.hash === entry.hash && tx.chainId === entry.chainId);
    if (index < 0) run.transactions.push({ ...entry });
    else run.transactions[index] = { ...run.transactions[index], ...entry };
    if (entry.status === "confirmed" && entry.label.startsWith("Refund ")) {
      for (const side of ["rain", "eth"]) {
        if (run[side].chainId === entry.chainId && run[side].network === entry.network) {
          run.recovery = { ...run.recovery, [side]: "Refunded" };
        }
      }
    }
    writeJson(file, run);
  };
}

module.exports = { classify, advise, readSide, readConfirmedClaim, findRevealedPreimage, pickSigner, prepareRefund, refundIfAllowed, loadRun, makeJournal };
