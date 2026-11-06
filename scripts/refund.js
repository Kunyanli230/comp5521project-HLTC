// AI-assisted B4 entry point; each chain independently permits or refuses a refund.
const { contexts, close, errorMessage } = require("./lib/runtime");
const { loadRun, makeJournal, refundIfAllowed } = require("./lib/recovery");
const { readStatus, printStatus } = require("./status");

async function refundRun(chains, options, runFile, run, target = "auto") {
  if (!["rain", "eth", "auto"].includes(target)) throw new Error("Refund target must be rain, eth or auto");
  const journal = makeJournal(runFile, run);
  const results = {};
  let exitCode = 0;
  for (const side of target === "auto" ? ["rain", "eth"] : [target]) {
    try {
      results[side] = await refundIfAllowed(chains[side === "rain" ? "sepolia" : "arbitrumSepolia"], run[side].swapId, options.minWindow, journal);
      if (!results[side].refunded && exitCode !== 1) exitCode = 2;
    } catch (error) {
      results[side] = { refunded: false, error: true, reason: errorMessage(error) };
      exitCode = 1;
    }
  }
  return { results, exitCode };
}

async function main(args = process.argv.slice(2)) {
  const [arg, target = "auto"] = args;
  if (!arg || arg.startsWith("-") || args.length > 2 || !["rain", "eth", "auto"].includes(target)) {
    throw new Error("Usage: node scripts/refund.js <runId | record.json> [rain|eth|auto]");
  }
  const { chains, options } = await contexts();
  try {
    const { runFile, run } = loadRun(arg, chains);
    const outcome = await refundRun(chains, options, runFile, run, target);
    for (const [side, result] of Object.entries(outcome.results)) {
      console.log(result.refunded ? `${side}: refunded ${result.url || result.hash}` : `${side}: not executed — ${result.reason}`);
    }
    process.exitCode = outcome.exitCode;
    printStatus(await readStatus(chains, options, run));
  } finally { close(chains); }
}

if (require.main === module) main().catch((error) => { console.error(errorMessage(error)); process.exitCode = 1; });
module.exports = { main, refundRun };
