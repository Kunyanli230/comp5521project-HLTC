// Historical single-chain classroom example. Not used by the project workflow.
const hre = require("hardhat");
const { htlcAddress, required, signerFor, swapId } = require("./utils");

async function main() {
  const bob = await signerFor("bob");
  const htlc = await hre.ethers.getContractAt("SimpleHTLC", htlcAddress(), bob);
  const tx = await htlc.claim(swapId("rain"), required("SWAP_PREIMAGE"));
  await tx.wait();
  console.log(`Bob claimed RAIN. Transaction: ${tx.hash}`);
}

main().catch((error) => { console.error(error.message || error); process.exitCode = 1; });
