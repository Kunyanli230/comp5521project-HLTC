# AI 辅助记录

本次用户指定范围：双网络部署配置、成功交换协调、固定 Task A/C 对接接口，以及 Rain 命名。此文件用于保留实际辅助范围，供组员审查代码、解释函数并在报告中如实引用。

| 文件/函数 | 辅助内容 |
|---|---|
| `HTLCBase._create/claim/refund`、`ERC20HTLC.createERC20Swap/_pay`、`ETHHTLC.createETHSwap/_pay` | 生成供对接和本地验证使用的合约基线，实现校验、状态、事件和安全转账 |
| `runtime.settings/contexts/assertChain/assertCode/confirmed/eventFrom` 等 | 配置校验、独立 RPC、指定角色签名、确认等待和事件解析 |
| `deploy.deployChain` | 分链部署、已有部署校验和公开部署记录 |
| `protocol.runSuccessfulSwap/verifyLock/assertTimelocks` | 成功路径协调、锁仓核验、时序检查、读取链上秘密、结果与失败记录 |
| `checkConfig.main`、`generateSecret.main`、`exportAbi` | 预检、私密保存随机秘密、导出前端 ABI |
| `test/CrossChainHTLC.js`、`test/integration/crossChain.js` | 合约规则测试和双节点端到端测试 |
| README、配置模板、接口文档与旧例子整理 | 操作说明、公开元数据、Rain 重命名 |

原有 `SimpleHTLC` 教学合约保留；分步教学脚本移至 `scripts/legacy/`。新增合约是明确标记的集成基线，不表示其他组员已完成其负责模块。公网部署和测试结果只能在真实执行后记录，不能把本地测试地址或哈希作为公网证据。

## Task A1/A2/A5 锁仓与安全测试（分支 `taskA/lock-safety`，2026-11-04）

工具：Claude Code（Claude Opus 5.5）。未修改生产合约（`HTLCBase`、`ERC20HTLC`、`ETHHTLC`、`TestToken`），接口不变，无需重新部署；`claim()/refund()` 属 A3/A4，仅在测试中调用。

| 文件 | AI 辅助内容 |
|---|---|
| `test/TaskA_LockSafety.js` | 起草测试：锁仓记录、输入校验、重复 ID、代币转账安全、ETH 拒收、重入 |
| `contracts/test/FeeOnTransferToken.sol` | 扣费型代币，验证前后余额检查 |
| `contracts/test/ETHRejecter.sol` | 拒收 ETH 合约，验证 `ETHTransferFailed` 且交换保持可退款 |
| `contracts/test/ReentrantReceiver.sol` | 重入攻击合约，验证 `nonReentrant` |
| `contracts/test/HookToken.sol` | 带回调的 ERC20，用于 ERC20 支付及 `createERC20Swap` 重入测试 |
| `docs/TASK_A_EXPLAIN.md` | 起草函数说明文档 |

`contracts/test/` 下合约仅用于本地测试，不会被部署。源码中不逐个标注，以本文件为准。

## Task B3 状态分类第一步（分支 `b3-b4-recovery`，2026-11-05）

工具：Codex。依据 B3/B4 框架编写 `test/Recovery.js`，先运行并确认测试失败，再实现 `scripts/lib/recovery.js` 的纯函数 `classify`。覆盖状态优先级、合法操作角色、到期边界、临近到期提示和剩余秒数；未知状态抛错，不提供操作建议。本阶段代码与测试由 AI 编写，待李家榕检查；尚未实现 `advise`、双链状态读取或 B4 退款执行。
