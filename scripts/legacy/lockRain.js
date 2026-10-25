// Historical single-chain classroom example. Not used by the project workflow.
const hre = require("hardhat");
const { randomBytes } = require("node:crypto");
const { htlcAddress, required, signerFor } = require("./utils");

async function main() {
  const alice = await signerFor("alice");
  const bob = required("BOB_ADDRESS");
  const tokenAddress = required("RAIN_ADDRESS");
  const htlc = await hre.ethers.getContractAt("SimpleHTLC", htlcAddress(), alice);
  const token = await hre.ethers.getContractAt([
    "function decimals() view returns (uint8)",
    "function approve(address,uint256) returns (bool)"
  ], tokenAddress, alice);
  const amount = hre.ethers.parseUnits(process.env.RAIN_AMOUNT || "100", await token.decimals());
  const timelock = Math.floor(Date.now() / 1000) + Number(process.env.TIMELOCK_SECONDS || 3600);
  const id = `0x${randomBytes(32).toString("hex")}`;

  const approveTx = await token.approve(await htlc.getAddress(), amount);
  await approveTx.wait();
  const lockTx = await htlc.createERC20Swap(id, bob, tokenAddress, amount, required("SWAP_HASHLOCK"), timelock);
  await lockTx.wait();
  console.log(`RAIN approval transaction: ${approveTx.hash}`);
  console.log(`RAIN lock transaction: ${lockTx.hash}`);
  console.log(`Add to .env: RAIN_SWAP_ID=${id}`);
  console.log(`Claim deadline: ${new Date(timelock * 1000).toISOString()}`);
}

main().catch((error) => { console.error(error.message || error); process.exitCode = 1; });
