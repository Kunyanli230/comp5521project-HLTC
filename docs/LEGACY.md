# 原单链例子

原来的分步教学脚本移到了 `scripts/legacy/`，代币引用已统一为 Rain。它们连接 `SimpleHTLC`，使用历史变量 `SEPOLIA_SIMPLE_HTLC_ADDRESS`、`SWAP_PREIMAGE`、`SWAP_HASHLOCK`、`RAIN_SWAP_ID`、`ETH_SWAP_ID`、`TIMELOCK_SECONDS`，不属于当前双链流程，不应作为项目演示入口。

当前网页入口为 `npm.cmd run server` 配合前端 `npm.cmd run dev`；B 命令行入口包括 `deploy`、`swap:success`、`status` 和 `refund`，见根 README。新合约与 ABI 见 `docs/INTERFACE.md`。

