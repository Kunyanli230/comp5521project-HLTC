// AI-assisted read-only preflight; prints public addresses and balances only.
const { ethers } = require("ethers");
const { contexts, close, errorMessage } = require("./lib/runtime");
async function main() {
  const { chains, options } = await contexts(process.env, false);
  try {
    for (const chain of Object.values(chains)) {
      console.log(`${chain.name}: chainId=${chain.chainId}; RPC=${chain.rpcEnv}`);
      for (const role of ["alice", "bob"]) {
        const address = await chain[role].getAddress();
        const balance = await chain.provider.getBalance(address);
        console.log(`  ${role}: ${address}, ${ethers.formatEther(balance)} ETH`);
        if (balance === 0n) throw new Error(`${chain.name}: ${role} has no gas funds`);
      }
    }
    const token = new ethers.Contract(options.rainAddress, ["function decimals() view returns(uint8)", "function balanceOf(address) view returns(uint256)"], chains.sepolia.provider);
    const amount = ethers.parseUnits(options.rainAmount, await token.decimals());
    if (amount <= 0n || ethers.parseEther(options.ethAmount) <= 0n) throw new Error("Swap amounts must be positive");
    if (await token.balanceOf(await chains.sepolia.alice.getAddress()) < amount) throw new Error("Alice has insufficient Rain");
    console.log(`Rain: ${options.rainAddress}; configuration preflight passed`);
  } finally { close(chains); }
}
main().catch((error) => { console.error(errorMessage(error)); process.exitCode = 1; });
