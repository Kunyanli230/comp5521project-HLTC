# 验证记录

操作步骤见 [TASK_C_FLOW.md](TASK_C_FLOW.md)，实现见 [TASK_C.md](TASK_C.md)。

## 2026-11-10 后前端手动验收 S（交换成功）

| 动作 | 用户提供的交易 | RPC 核验结果 |
|---|---|---|
| Alice 锁 1 Rain | [Ethereum Sepolia](https://sepolia.etherscan.io/tx/0x19e2ba2ff0bd7cc2de1a29957b7e68f90abc0dd6f3b9b572a3a8abce7245f33b) | receipt.status=1，规范区块，建锁核验时 33 次确认；createERC20Swap，目标为部署的 ERC20HTLC；当时 Active |
| Bob 锁 0.001 ETH | [Arbitrum Sepolia](https://sepolia.arbiscan.io/tx/0x8904baad8c7a9f9bc925729cf6a8906f29687d94149d884065f8773a85a66f0b) | receipt.status=1，规范区块，建锁核验时 1179 次 L2 确认；createETHSwap，目标为部署的 ETHHTLC；当时 Active |
| Alice 领取 ETH | [Arbitrum Sepolia](https://sepolia.arbiscan.io/tx/0x71c9694e7d88e910bef6e346985870c0344fdd6e013f8beda1c931ddcf423516) | receipt.status=1，规范区块，领取核验时 1742 次 L2 确认；claim 方法和 SwapClaimed 事件对应本轮 ETH ID，状态 Claimed |
| Bob 领取 Rain | [Ethereum Sepolia](https://sepolia.etherscan.io/tx/0x313bcfcc54bc3c588f71cb417cca43583a1a913d915cfc21665b110fd2a485d7) | 从本轮公开 SwapClaimed 事件定位；receipt.status=1，规范区块，领取核验时 33 次确认；claim 方法和事件对应本轮 Rain ID，状态 Claimed |

- Rain swap ID：`0x99d523eb138db7a7f61ab152f287bc49132967b1a17566c6d5afc71217a1a643`。
- ETH swap ID：`0xf7cef6660f2b1ab49797326dfe54d0b8ba58f758cce4de1d9031f781475726bf`。
- 共用 hashlock：`0x0978c40e0357b2a21897ab7ff0ec82a679c36ae4c401d53304cde5bd03f445a8`。
- Rain：Alice → Bob，token 为课程 MST，1.0 Rain；ETH：Bob → Alice，token 字段为零地址，0.001 ETH。
- Rain 截止时间 `1794287652`，ETH 截止时间 `1794284145`，实际期限差 3507 秒。读取时分别剩 6792、3279 秒；剩余秒数是各读取区块的快照，不是持续倒计时。
- 两笔领取的目标合约、调用者、接收方和事件字段均匹配；事件秘密的哈希与上述 hashlock 一致。记录不保存秘密原文。真实成功交换路径已通过。

## 新 HTTP 入口成功交换 S（2026-11-08）

通过当前 HTTP/MetaMask 入口完成 **1 Rain / 0.001 ETH** 交换，并提供两笔领取交易。此前只读 RPC 核验记录为：两笔成功回执、对应合约和匹配 SwapClaimed 事件、秘密哈希一致、两边均为 Claimed。本次文档恢复没有重新访问公网或发交易。

| 资产 | 领取交易 | 已核验结果 |
|---|---|---|
| ETH / Arbitrum Sepolia，Bob → Alice | [Alice 领取 ETH](https://sepolia.arbiscan.io/tx/0x779803c9dc9e0c0b3db5242c6a65941659880b85db8f7c19e3cf154ad1b8d6ef) | receipt.status=1，Claimed |
| Rain / Ethereum Sepolia，Alice → Bob | [Bob 领取 Rain](https://sepolia.etherscan.io/tx/0xb5e11752efda651c8c44d6b48e9e74a991dc168a7699d5c6ce7f31969e485275) | receipt.status=1，Claimed |

- Rain swap ID：`0x1f91e0e9eea9e0602a44c93575d61993b2a7fef3a63b75fe20723613920c7019`。
- ETH swap ID：`0x6275767182f55d7ef4898f8340e6be0d8851637da3bf149ec9f034c98a9b2915`。
- 共用 hashlock：`0xec33843d1fdb98924393df237c1368db3199e89d9fb533ea97c643dc1970cc10`。
- 实际期限 Rain=1794117828、ETH=1794115025，差值 2803 秒。记录不保存秘密原文。

## Task C 开发验证与旧入口归档

2026-11-08：单元测试 143 项、HTTP 集成 33 项、B 的 cross-chain/refund-path 集成及前端构建通过。

此前曾观察到 HTTP 缺少 protocol.lockCall 导出，以及仅建锁入口缺少 stopAfterLocks 分支；补回共用入口及 B 原有停止分支后，相关集成通过。开发夹具检查了备份、公开设置、状态显示、操作结果提示和刷新失效保护；这些检查使用钱包/HTTP 替身，不算 MetaMask 公网验收。

<details>
<summary>旧入口公开退款证据（用户提供，非新版 HTTP 退款验收）</summary>

- 单边 Rain 退款：[Sepolia 交易](https://sepolia.etherscan.io/tx/0x406c411d5a273f3fadf71fa160fc2efdf4c80f9a562c6501f17239bd019dab39),成功并返还 1 MST 给 Alice。
- 双边退款实例 Rain ID：`0x5a39cc3a1ad59cde179de91a42c1253d5a3219513185321910e377452d589481`；ETH ID：`0x55baecb9944ee0d0e6e8a264020fcde64824295d73264ba8a21db47db27bd042`。
- Bob 的 ETH 退款：[Arbitrum Sepolia 交易](https://sepolia.arbiscan.io/tx/0xd10269fb81ef88e561715f96c3eee66fa2d2395d7757acf87f47d6e0f9ebcd04)。成功并退回 0.001 ETH；随后该实例两边 Refunded，Alice Rain 恢复到 90。Rain 对应退款哈希未在本恢复记录中补造。

</details>

<details>
<summary>main 原始历史记录：10-24/25 本地验证、10-25 公网交换、11-04 Task A 测试</summary>

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

</details>
