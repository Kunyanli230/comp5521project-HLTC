# AI 辅助记录

2026-11-08，按用户要求仅整理文档：将当前手动输入/点击/预期结果集中为 `docs/TASK_C_FLOW.md`，将 Task C 实现、PDF 对应与 A/B HTTP 接口说明集中为 `docs/TASK_C.md`；旧笔记和验收表保留在 `docs/TEST_RESULTS.md` 的折叠历史区，删除三个重复入口并同步 README/接口引用。本轮未修改运行代码、执行新链上操作或把未验收场景写为通过。

2026-11-07，按用户确认的函数级调试方案修正部署检查：在 `runtime.js` 新增 `splitSolidityMetadata`、`compareBytecode`，调整 `assertCode` 以完整解码 CBOR、区分完整一致/仅元数据哈希不同/不兼容；CLI 和 HTTP 共用该判断。调整 `configuredCoordinator`、快照、health 及前端 `render`，分别传递和显示 `deploymentWarnings`、`deploymentIssues`。使用现有依赖树中的 `cbor@8.1.0` 并声明为直接依赖。保留所有交易前置校验与 MetaMask 签名，不改 Solidity、ABI 或部署记录。新增部署检查边界测试，并扩展原本地 HTTP 集成检查，在本地改变元数据哈希后验证完整成功/退款流程；测试替身不作为公网 MetaMask 验收。

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

## Task B3/B4 完整入口（分支 `b3-b4-recovery`，2026-11-05）

下表记录本阶段的实现与测试范围。真实测试网退款演示仍待完成。

| 文件/函数 | AI 辅助内容 |
|---|---|
| `recovery.classify/advise` | 状态优先级、合法操作角色、到期边界与临近到期提示、跨链时锁异常风险及公开秘密核验 |
| `recovery.readSide/findRevealedPreimage` | 同区块快照、分段事件查询、RPC 范围缩减、链上 hashlock 核验，不读取本地秘密 |
| `recovery.pickSigner/refundIfAllowed` | 按链上 sender 匹配签名者、拒绝无效操作、静态预检、确认事件与最终状态 |
| `recovery.loadRun/makeJournal` | 部署/网络校验、按哈希与 chain ID 更新退款记录、保护部署样例不被回写 |
| `scripts/status.js/refund.js/lockOnly.js` | B3/B4 命令入口、JSON 状态、逐链退款与退出码、演示建锁 |
| `scripts/lib/protocol.js` | 在双方锁仓与核验后增加 `stopAfterLocks` 提前返回，默认成功交换路径不启用 |
| `test/Recovery.js`、`test/integration/refundPath.js` | 先观察失败再实现；纯函数、RPC 限制/错误、记录保护和双本地链退款路径测试，集成 setup adapted from `crossChain.js` |
| `package.json`、README | 增加四条运行命令及操作和验证说明，区分本地验证与公网证据 |

## Task C（2026-11-08）

### 为 C 接入而修改的 B 共用函数

| 文件/函数 | AI 辅助内容 |
|---|---|
| `scripts/lib/protocol.js`：`lockCall` | 从原 B 建锁调用抽出方法、参数顺序、ETH value，供 CLI 和 HTTP 共同使用 |
| 同文件：`runSuccessfulSwap` | 接入共用 `expectedLock/lockCall` 和 `recovery.readConfirmedClaim`，避免字段/事件逻辑重复；保留原有 `stopAfterLocks` 仅建锁分支 |
| 同文件：`verifyCreated`、`module.exports` | 原创建事件检查函数新增共用导出，HTTP 调用同一函数；原 `verifyLock/assertTimelocks` 仍供接入使用 |
| `scripts/lib/recovery.js`：`readConfirmedClaim` | 新增共用的领取回执、确认数、规范区块、对应合约/ID 事件、Claimed 状态及秘密哈希核验 |
| 同文件：`prepareRefund`、`refundIfAllowed` | 将原退款资格检查抽成只读准备函数；CLI 仍选择本地签名者并发交易，HTTP 使用相同前置条件后返回未签名请求 |
| `scripts/lib/runtime.js`：`splitSolidityMetadata`、`compareBytecode` | 新增 Solidity 尾部长度与 CBOR 完整解析；分类为完整相同、仅已识别元数据哈希不同或不兼容。直接运行时依赖 `cbor@8.1.0` 用于解码，替代固定长度截尾 |
| 同文件：`assertCode`、`module.exports` | 三态部署检查、元数据警告、`HTLC_CODE_MISMATCH` 错误码及共用比较函数导出；RPC 错误仍单独上报 |
| `scripts/lib/webCoordinator.mjs`、`webProtocol.mjs`、`scripts/serveFrontend.mjs` | 新增的网页 HTTP 适配：只读快照、动作准备/估费、确认核验、阶段判断及同源本机 API；调用 B 共用函数，不创建网页账户私钥签名钱包 |
| `shared/swapInputs.mjs` | AI 辅助的公开字段白名单、金额/期限解析、预期锁字段和错误信息工具，CLI/网页共享 |
| `test/Coordinator.js`、`test/DeploymentCode.js`、`test/integration/webCoordinator.mjs` | 共用金额精度、部署检查边界、HTTP 成功/双边退款及拒绝路径的本地回归检查；不作为公网验收 |

AI 在 `index.html/style.css` 添加统一原生结果弹窗。成功由后端核验返回触发，说明角色、数量和下一步；取消及核验未完成使用警告，保留公开链接与未决保护。

AI 在 `index.html`、`guide.js`、`style.css` 添加各视图共用的双链状态栏，使用既有快照展示状态、区块及查询中说明；不改变 B 或交易判断。同步 FLOW 的查看位置。实际 guide 开发检查及构建通过，尚待用户视觉验收。

AI 辅助实现 `frontend/lib/guide.js` 的 `attachStepGuide/recommended/showRoute/render/refundMessage` 界面函数，展示账户、网络、下一步和公开链上状态。
- `workflow.js` 在已有状态判断及创建新草稿后同步步骤引导；沿用原有交易准备、钱包签名和链上核验流程。文档同步记录新导航。

AI 调整 C 的 `readLockSnapshot/readPairSnapshot/findSwapEvent/assertTimeWindows/assessTimelocks/recoveryView/workflowState` 及退款、查询与引导调用，删除相应重复实现。

AI 辅助编写 `style.css`，并修改 `guide.showRoute/render` 的页面标题、账户预览、网络选中态、提示颜色及导航进度展示，添加键盘跳转入口。


