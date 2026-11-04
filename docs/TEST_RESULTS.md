# 验证记录（2026-10-24 / 2026-10-25）

下表保留本地验证情况；2026-10-25 已另外完成真实测试网部署和成功交换，证据见文末。

| 命令 | 结果 |
|---|---|
| `npm run compile` | Solidity 编译成功，目标 EVM 为 paris |
| `npm test` | 13 项通过 |
| `npm run abi:export` | 两份 ABI 导出成功，并与当前编译产物一致 |
| `npm run test:cross-chain` | 两个独立 Hardhat 节点上的端到端验证通过 |
| `npm run config:check` / `npm run deploy` | 缺少本地配置时明确退出；未提交公网交易 |

单元测试覆盖：两类资产的创建/领取/退款规则、授权、错误秘密、无效输入、重复 ID、重复完成、到期边界、锁参数核验、双链期限差、等待确认数量、pending/confirmed 记录与按地址/ID 提取事件。

双节点集成测试覆盖：

1. 分别部署 ERC20HTLC 与 ETHHTLC，并验证重复调用复用已确认地址。
2. 使用同一部署连续执行两组全新 swap ID 的成功交换。
3. 每次完成 approval、Rain lock、ETH lock、ETH claim、Rain claim 五笔确认交易。
4. 从 ETH claim 事件取得秘密，核对 Rain 接收余额、两个 Claimed 状态和空 escrow 余额。
5. ETH 链只产生其对应的 lock/claim 区块，未使用单链模拟跨链。
6. 公开报告不包含秘密，私密文件独立保存。
7. 注入错误 Rain 数量，确认在 Bob 锁 ETH 前中止，记录 incomplete 且没有公开秘密。
8. 本地推进时间后，使用固定 refund 接口退回该失败场景的 Rain 锁。

集成测试使用本机随机端口及 chain ID 31337/31338，脚本自动结束节点。公开记录和秘密测试文件保存在临时目录，实际路径由测试输出给出。真实测试网执行结果如下。

## 2026-10-25 真实测试网结果

- `npm run config:check`：两条链 chain ID、Alice/Bob 账户及资金检查通过。
- `npm run deploy`：ERC20HTLC / ETHHTLC 均部署成功，等待两次确认并核验 runtime bytecode。
- `npm run swap:success`：100 Rain / 0.001 ETH 交换完成，每笔交易等待两次确认。
- 完成后独立读取两条链：两个 swap 的 status 均为 2 (Claimed)，Alice Rain=0、Bob Rain=100。
- 公开部署及七笔交易证据见 `deployments/sepolia.json`、`deployments/arbitrumSepolia.json`、`deployments/successful-swap-2026-10-25.json`。
- 本次没有执行公网退款演示或浏览器源码验证。

## 2026-11-04 Task A1/A2/A5 本地测试（分支 `taskA/lock-safety`）

- `npx hardhat test`：53 项通过（原有 13 项 + `test/TaskA_LockSafety.js` 新增 40 项），Node.js 22.23.4，solc 0.8.20。
- 变异检查：临时删除 `createERC20Swap` 的前后余额检查和 `_create` 的 `receiver == msg.sender` 校验后，新增测试有 3 项失败（扣费型代币、两种资产的发送人=接收人）；之后已用 git 恢复合约。
- 生产合约未改动，无需重新部署；未执行任何公网交易。
