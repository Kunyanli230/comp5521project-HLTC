// Historical single-chain classroom example. Not used by the project workflow.
const hre = require("hardhat");
const { htlcAddress, swapId } = require("./utils");

async function printSwap(name) {
  const htlc = await hre.ethers.getContractAt("SimpleHTLC", htlcAddress());
  const swap = await htlc.swaps(swapId(name));
  console.log(`${name.toUpperCase()} swap`);
  console.log(JSON.stringify({
    sender: swap.sender, receiver: swap.receiver, token: swap.token,
    amount: swap.amount.toString(), hashlock: swap.hashlock,
    timelock: new Date(Number(swap.timelock) * 1000).toISOString(),
    assetType: swap.assetType === 0n ? "RAIN (ERC20)" : "ETH",
    claimed: swap.claimed
  }, null, 2));
}

async function main() { await printSwap("rain"); await printSwap("eth"); }
main().catch((error) => { console.error(error.message || error); process.exitCode = 1; });
