// AI-assisted B1 deployment. Each chain is connected and confirmed independently.
const path = require("node:path");
const { ethers } = require("ethers");
const { ROOT, artifact, contexts, close, readJson, writeJson, assertCode, confirmed, errorMessage } = require("./lib/runtime");

async function deployChain(chain, options, directory = path.join(ROOT, "deployments")) {
  const file = path.join(directory, `${chain.key}.json`);
  const previous = readJson(file);
  if (previous) {
    if (previous.chainId !== chain.chainId || previous.contract !== chain.contract) throw new Error(`${chain.key}: incompatible deployment record`);
    if (previous.status !== "confirmed") throw new Error(`${chain.key}: unresolved deployment ${previous.transaction?.hash}; inspect it before redeploying`);
    await assertCode(chain, previous.address, chain.contract);
    console.log(`${chain.name}: reusing ${previous.address}`);
    return previous;
  }
  const compiled = artifact(chain.contract);
  const deployer = await chain.alice.getAddress();
  const record = { schemaVersion: 1, network: chain.key, chainId: chain.chainId, contract: chain.contract,
    rpcEnv: chain.rpcEnv, explorer: chain.explorer, deployer,
    accounts: { alice: deployer, bob: await chain.bob.getAddress() },
    rainAddress: options.rainAddress, status: "pending", createdAt: new Date().toISOString(),
  };
  const contract = await new ethers.ContractFactory(compiled.abi, compiled.bytecode, chain.alice).deploy();
  record.address = await contract.getAddress();
  await confirmed(chain, contract.deploymentTransaction(), `Deploy ${chain.contract}`, (transaction) => {
    record.transaction = transaction;
    writeJson(file, record);
  });
  await assertCode(chain, record.address, chain.contract);
  record.status = "confirmed";
  writeJson(file, record);
  console.log(`${chain.addressEnv}=${record.address}`);
  return record;
}
async function main() {
  const { chains, options } = await contexts(process.env, false);
  try {
    // Preflight both chains before sending the first deployment.
    for (const chain of Object.values(chains)) {
      if (await chain.provider.getBalance(await chain.alice.getAddress()) === 0n) throw new Error(`${chain.name}: Alice needs test ETH for deployment gas`);
    }
    for (const chain of Object.values(chains)) await deployChain(chain, options);
  } finally { close(chains); }
}
if (require.main === module) main().catch((error) => { console.error(errorMessage(error)); process.exitCode = 1; });
module.exports = { deployChain };
