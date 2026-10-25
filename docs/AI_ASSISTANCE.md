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
