// Historical single-chain classroom example. Not used by the project workflow.
const hre = require("hardhat");
const { randomBytes } = require("node:crypto");
const { htlcAddress, required, signerFor } = require("./utils");

async function main() {
  const bob = await signerFor("bob");
  const alice = required("ALICE_ADDRESS");
  const htlc = await hre.ethers.getContractAt("SimpleHTLC", htlcAddress(), bob);
  const amount = hre.ethers.parseEther(process.env.ETH_AMOUNT || "0.001");
  const timelock = Math.floor(Date.now() / 1000) + Number(process.env.TIMELOCK_SECONDS || 3600);
  const id = `0x${randomBytes(32).toString("hex")}`;
  const lockTx = await htlc.createETHSwap(id, alice, required("SWAP_HASHLOCK"), timelock, { value: amount });
  await lockTx.wait();
  console.log(`ETH lock transaction: ${lockTx.hash}`);
  console.log(`Add to .env: ETH_SWAP_ID=${id}`);
  console.log(`Claim deadline: ${new Date(timelock * 1000).toISOString()}`);
}

main().catch((error) => { console.error(error.message || error); process.exitCode = 1; });
