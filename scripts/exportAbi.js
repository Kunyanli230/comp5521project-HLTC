// AI-assisted: shared ABI files for Task A/C integration.
const path = require("node:path");
const { ROOT, artifact, writeJson } = require("./lib/runtime");
for (const name of ["ERC20HTLC", "ETHHTLC"]) {
  writeJson(path.join(ROOT, "config/abi", `${name}.json`), artifact(name).abi);
  console.log(`Exported config/abi/${name}.json`);
}
