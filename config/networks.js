// AI-assisted: public metadata only; RPC credentials remain in .env.
module.exports = {
  sepolia: {
    name: "Ethereum Sepolia", chainId: 11155111,
    rpcEnv: "SEPOLIA_RPC_URL", addressEnv: "SEPOLIA_ERC20_HTLC_ADDRESS",
    contract: "ERC20HTLC", explorer: "https://sepolia.etherscan.io",
  },
  arbitrumSepolia: {
    name: "Arbitrum Sepolia", chainId: 421614,
    rpcEnv: "ARBITRUM_SEPOLIA_RPC_URL", addressEnv: "ARBITRUM_SEPOLIA_ETH_HTLC_ADDRESS",
    contract: "ETHHTLC", explorer: "https://sepolia.arbiscan.io",
  },
};
