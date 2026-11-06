// AI-assisted refund-demo setup; reuse B2 and stop after both verified locks.
const { contexts, close, errorMessage } = require("./lib/runtime");
const { runSuccessfulSwap } = require("./lib/protocol");

async function main() {
  const { chains, options } = await contexts();
  try { await runSuccessfulSwap(chains, options, { stopAfterLocks: true }); }
  finally { close(chains); }
}

if (require.main === module) main().catch((error) => { console.error(errorMessage(error)); process.exitCode = 1; });
module.exports = { main };
