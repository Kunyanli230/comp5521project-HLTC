// AI-assisted: save the secret locally; print only its hash and private file path.
const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");
const { ROOT } = require("./lib/runtime");

async function main() {
  const preimage = `0x${randomBytes(32).toString("hex")}`;
  const hashlock = ethers.keccak256(ethers.solidityPacked(["bytes32"], [preimage]));
  const directory = path.join(ROOT, ".local/secrets");
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `manual-${randomBytes(8).toString("hex")}.json`);
  fs.writeFileSync(file, JSON.stringify({ preimage, hashlock }, null, 2), { flag: "wx", mode: 0o600 });
  console.log(`Private secret file: ${file}`);
  console.log(`SWAP_HASHLOCK=${hashlock}`);
}

main().catch((error) => { console.error(error.message || error); process.exitCode = 1; });
