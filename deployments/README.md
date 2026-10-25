# 公网部署记录

2026-10-25 已在两条测试网完成部署，记录位于 `sepolia.json` 和 `arbitrumSepolia.json`，状态均为 confirmed。已完成的成功交换公开证据位于 `successful-swap-2026-10-25.json`。

- Ethereum Sepolia ERC20HTLC：`0x98eFb0B12BA43d5efc3723fFf839Fee29B8f72A3`
- Arbitrum Sepolia ETHHTLC：`0x6c4826b0D6Ad8aB8dBbeD368f45E963306626aA2`
- Rain：Ethereum Sepolia 上的 `0xf49d4F8A697C09D4daf942938A2C4cb5593164dC`

每份记录包含 `schemaVersion`、`network`、`chainId`、`contract`、`address`、`rpcEnv`（环境变量名）、`explorer`、`deployer`、`accounts`、`rainAddress`、`status` 和 `transaction`（hash、url、blockNumber、confirmations、status）。不写入私钥、秘密或实际 RPC URL。

部署确认后 `status=confirmed`。正常重跑会校验已部署代码并复用地址；未确认的部署记录会阻止重复部署，应先通过记录中的交易哈希核对其链上状态。若需部署全新版本，先归档旧公开记录，重新编译再部署，同时更新组员使用的地址。

仅提交真正的公开测试网部署记录。本地集成测试把记录写入临时目录，chain ID 为 31337 / 31338，不能当作测试网地址使用。
