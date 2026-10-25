// Historical single-chain classroom example. Not used by the project workflow.
const hre = require("hardhat");
const { signerFor } = require("./utils");

async function main() {
  const deployer = await signerFor("alice");
  const SimpleHTLC = await hre.ethers.getContractFactory("SimpleHTLC", deployer);
  const htlc = await SimpleHTLC.deploy();
  await htlc.waitForDeployment();
  const address = await htlc.getAddress();
  console.log(`Network: ${hre.network.name}`);
  console.log(`SimpleHTLC deployed by Alice: ${address}`);
  console.log(`Add to .env: SEPOLIA_SIMPLE_HTLC_ADDRESS=${address}`);
}

main().catch((error) => { console.error(error.message || error); process.exitCode = 1; });
