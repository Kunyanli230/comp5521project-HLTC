// Historical single-chain classroom example. Not used by the project workflow.
const hre = require("hardhat");
const { htlcAddress, required, signerFor, swapId } = require("./utils");

async function main() {
  const alice = await signerFor("alice");
  const htlc = await hre.ethers.getContractAt("SimpleHTLC", htlcAddress(), alice);
  const tx = await htlc.claim(swapId("eth"), required("SWAP_PREIMAGE"));
  await tx.wait();
  console.log(`Alice claimed ETH. Transaction: ${tx.hash}`);
  console.log("The preimage is now publicly visible in this Sepolia transaction.");
}

main().catch((error) => { console.error(error.message || error); process.exitCode = 1; });
