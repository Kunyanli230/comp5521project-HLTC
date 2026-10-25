require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ quiet: true });

const accounts = [process.env.ALICE_PRIVATE_KEY, process.env.BOB_PRIVATE_KEY, process.env.PRIVATE_KEY]
  .filter((value) => /^0x[0-9a-fA-F]{64}$/.test(value || ""))
  .filter((value, index, values) => values.indexOf(value) === index);

module.exports = {
  solidity: "0.8.20",
  networks: {
    hardhat: { chainId: Number(process.env.HTLC_LOCAL_CHAIN_ID || 31337) },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      chainId: 11155111,
      accounts,
    },
    arbitrumSepolia: {
      url: process.env.ARBITRUM_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc",
      chainId: 421614,
      accounts,
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },
};
