// Historical single-chain classroom example. Not used by the project workflow.
const hre = require("hardhat");
require("dotenv").config();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing from .env`);
  return value;
}

async function signerFor(role) {
  const signers = await hre.ethers.getSigners();
  const index = role === "alice" ? 0 : role === "bob" ? 1 : -1;
  if (index < 0 || !signers[index]) throw new Error(`Configure ${String(role).toUpperCase()}_PRIVATE_KEY in .env`);
  return signers[index];
}

function htlcAddress() { return required("SEPOLIA_SIMPLE_HTLC_ADDRESS"); }
function swapId(asset) { return required(asset === "rain" ? "RAIN_SWAP_ID" : "ETH_SWAP_ID"); }

module.exports = { htlcAddress, required, signerFor, swapId };
