// AI-assisted B2 entry point; no secrets or RPC URLs are written to public reports.
const { contexts, close, errorMessage } = require("./lib/runtime");
const { runSuccessfulSwap } = require("./lib/protocol");
async function main() {
  const { chains, options } = await contexts();
  try { await runSuccessfulSwap(chains, options); }
  finally { close(chains); }
}
main().catch((error) => { console.error(errorMessage(error)); process.exitCode = 1; });
