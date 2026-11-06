// AI-assisted B3 entry point; reads each chain independently, never local secrets.
const { ethers } = require("ethers");
const { contexts, close, errorMessage } = require("./lib/runtime");
const { readSide, advise, findRevealedPreimage, loadRun } = require("./lib/recovery");

async function readStatus(chains, options, run) {
  const [rain, eth] = await Promise.all([
    readSide(chains.sepolia, run.rain.swapId, options.minWindow),
    readSide(chains.arbitrumSepolia, run.eth.swapId, options.minWindow),
  ]);
  for (const view of [rain, eth]) {
    if (view.state !== "NOT_FOUND" && view.swap.hashlock.toLowerCase() !== run.hashlock.toLowerCase()) {
      throw new Error(`${view.network}: on-chain hashlock does not match this run`);
    }
  }
  let preimage = null;
  if (eth.state === "CLAIMED") {
    const lock = run.transactions.find((tx) => tx.label === "Lock ETH" && tx.network === run.eth.network &&
      tx.chainId === run.eth.chainId && tx.status === "confirmed");
    preimage = await findRevealedPreimage(chains.arbitrumSepolia, run.eth.swapId, lock?.blockNumber);
  }
  let rainAmount = "0";
  if (rain.state !== "NOT_FOUND") {
    const token = new ethers.Contract(rain.swap.token, ["function decimals() view returns (uint8)"], chains.sepolia.provider);
    const decimals = await token.decimals({ blockTag: rain.blockNumber });
    rainAmount = ethers.formatUnits(rain.swap.amount, decimals);
  }
  function side(view, key) {
    const swap = view.swap;
    return {
      network: view.network, chainId: run[key].chainId, contract: run[key].contract, swapId: run[key].swapId,
      sender: swap.sender, receiver: swap.receiver, token: swap.token, amount: swap.amount.toString(),
      formattedAmount: key === "rain" ? rainAmount : ethers.formatEther(swap.amount),
      timelock: Number(swap.timelock), expiresAt: view.state === "NOT_FOUND" ? null : new Date(Number(swap.timelock) * 1000).toISOString(),
      now: view.now, blockNumber: view.blockNumber, state: view.state, remaining: view.remaining, actions: view.actions,
    };
  }
  return { runId: run.runId, rain: side(rain, "rain"), eth: side(eth, "eth"),
    hashlock: run.hashlock, preimage, preimageKnown: preimage !== null, advice: advise(rain, eth, preimage !== null) };
}

function printStatus(status) {
  console.log(`Run: ${status.runId}`);
  for (const [key, asset] of [["rain", "Rain"], ["eth", "ETH"]]) {
    const side = status[key];
    console.log(`\n${asset} / ${side.network} (block ${side.blockNumber}, time ${side.now})`);
    console.log(`swapId: ${side.swapId}`);
    console.log(`${side.sender} -> ${side.receiver}: ${side.formattedAmount} ${asset}`);
    console.log(`State: ${side.state}; expiry: ${side.expiresAt || "none"}; remaining: ${side.remaining} seconds`);
    for (const action of side.actions) {
      console.log(`Action: ${action.action} by ${action.by}${action.warning ? `; ${action.warning}` : ""}`);
      if (action.action === "claim") {
        console.log(key === "rain" && !status.preimageKnown
          ? "Claim requires the secret; no matching public preimage has been verified."
          : "Claim requires the matching secret.");
      }
    }
    if (!side.actions.length) console.log("Actions: none");
  }
  if (status.preimageKnown) {
    const digest = ethers.keccak256(status.preimage);
    console.log(`Arbitrum SwapClaimed preimage: ${status.preimage}`);
    console.log(`keccak256(preimage) = ${digest}\nhashlock = ${status.hashlock}`);
    console.log(`keccak256(preimage) == hashlock: ${digest.toLowerCase() === status.hashlock.toLowerCase()}`);
  }
  console.log(`\n${status.advice.join("\n")}`);
}

async function main(args = process.argv.slice(2)) {
  const positional = args.filter((arg) => arg !== "--json");
  if (positional.length !== 1 || positional[0].startsWith("-") || args.filter((arg) => arg === "--json").length > 1) {
    throw new Error("Usage: node scripts/status.js <runId | record.json> [--json]");
  }
  const { chains, options } = await contexts();
  try {
    const { run } = loadRun(positional[0], chains);
    const status = await readStatus(chains, options, run);
    if (args.includes("--json")) console.log(JSON.stringify(status));
    else printStatus(status);
  } finally { close(chains); }
}

if (require.main === module) main().catch((error) => { console.error(errorMessage(error)); process.exitCode = 1; });
module.exports = { main, readStatus, printStatus };
