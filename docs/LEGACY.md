# 原单链例子

原来的分步教学脚本移到了 `scripts/legacy/`，代币引用已统一为 Rain。它们连接 `SimpleHTLC`，使用历史变量 `SEPOLIA_SIMPLE_HTLC_ADDRESS`、`SWAP_PREIMAGE`、`SWAP_HASHLOCK`、`RAIN_SWAP_ID`、`ETH_SWAP_ID`、`TIMELOCK_SECONDS`，不属于当前双链流程，不应作为项目演示入口。

新的入口是 `npm run deploy` 和 `npm run swap:success`；新合约与 ABI 见 `docs/INTERFACE.md`。保留的 `test/SimpleHTLC.js` 仅用于验证教学示例没有因 Rain 改名而破坏。
