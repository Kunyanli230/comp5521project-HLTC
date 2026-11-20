const { contexts, close, errorMessage } = require("./lib/runtime");
const { runPointSwap } = require("./lib/pointProtocol");
const { bindPointChain } = require("./pointDeploy");

async function main() {
  const { chains, options } = await contexts(process.env, false);
  try {
    for (const chain of Object.values(chains)) await bindPointChain(chain);
    const report = await runPointSwap(chains, options);
    console.log("Point-lock swap " + report.status + ": run " + report.runId);
  } finally { close(chains); }
}

main().catch((error) => { console.error(errorMessage(error)); process.exitCode = 1; });
