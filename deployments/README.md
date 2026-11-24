# Public Deployment Records

Deployment on both testnets was completed on 2026-10-25. The records are in `sepolia.json` and `arbitrumSepolia.json`, and both have status confirmed. Public evidence of the completed successful swap is in `successful-swap-2026-10-25.json`.

- Ethereum Sepolia ERC20HTLC: `0x98eFb0B12BA43d5efc3723fFf839Fee29B8f72A3`
- Arbitrum Sepolia ETHHTLC: `0x6c4826b0D6Ad8aB8dBbeD368f45E963306626aA2`
- Rain: `0xf49d4F8A697C09D4daf942938A2C4cb5593164dC` on Ethereum Sepolia

Each record contains `schemaVersion`, `network`, `chainId`, `contract`, `address`, `rpcEnv` (the environment variable name), `explorer`, `deployer`, `accounts`, `rainAddress`, `status`, and `transaction` (hash, url, blockNumber, confirmations, status). Private keys, secrets, and actual RPC URLs are not written.

After a deployment is confirmed, `status=confirmed`. A normal re-run verifies the deployed code and reuses the address; an unconfirmed deployment record blocks repeated deployment, so first check its on-chain state using the transaction hash in the record. To deploy a brand-new version, archive the old public records, recompile, and then deploy, and update the addresses used by teammates at the same time.

Only commit real public testnet deployment records. Local integration tests write records to a temporary directory, with chain IDs 31337 / 31338, and these cannot be used as testnet addresses.

The point-lock version's [deployment records for both chains](point/) and the [2026-11-17 successful swap report](point/successful-swap-2026-11-17.json) are stored separately in `deployments/point/`.
