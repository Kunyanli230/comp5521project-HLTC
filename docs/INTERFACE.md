# Task A / B / C 接口约定 v1

本仓库把原代币引用统一命名为 **Rain**。`RAIN_ADDRESS` 指向真实的 Ethereum Sepolia ERC20 代币；改配置名不会修改已部署代币的 `name()`、`symbol()` 或地址。公网脚本不部署或铸造测试代币，`TestToken` 只用于本地测试。

## 网络和账户

| 资产 | 网络 | chain ID | 合约 | 发送人 | 接收人 |
|---|---|---:|---|---|---|
| Rain ERC20 | Ethereum Sepolia | 11155111 | ERC20HTLC | Alice | Bob |
| 原生 ETH | Arbitrum Sepolia | 421614 | ETHHTLC | Bob | Alice |

网络公开元数据：`config/networks.js`。B 原 CLI 从本地 `.env` 读取 RPC 和账户私钥并签名；网页 HTTP 服务读取 RPC 配置、使用只读 provider，不创建私钥签名钱包，未配置 RPC 时使用代码中的公开回退地址。C 不导入 `.env`，由 MetaMask 签名并广播。公开地址和初始交易结果见 `deployments/*.json`，后续实际验收证据另记在 TEST_RESULTS.md。Arbitrum 官方网络资料：<https://docs.arbitrum.io/chain-info>。

## 函数签名（固定参数顺序）

```solidity
// ERC20HTLC: Alice 先在 Rain 代币上 approve(ERC20HTLC地址, amount)。
function createERC20Swap(
    bytes32 swapId, address receiver, address token, uint256 amount,
    bytes32 hashlock, uint256 timelock
) external;

// ETHHTLC: amount 由 msg.value 决定，不另传 amount。
function createETHSwap(
    bytes32 swapId, address receiver, bytes32 hashlock, uint256 timelock
) external payable;

// 两份合约均提供：
function claim(bytes32 swapId, bytes32 preimage) external;
function refund(bytes32 swapId) external;
function swaps(bytes32 swapId) external view returns (
    address sender, address receiver, address token, uint256 amount,
    bytes32 hashlock, uint256 timelock, uint8 status
);
```

- `swapId`：非零、每个合约内不可复用的 bytes32；本项目 CLI 和网页为两条链分别生成不同 ID，由脚本报告或公开设置关联两者。两份合约不通信，不在链上强制跨链 ID 不同。
- `preimage`：密码学随机生成的 **32 个原始字节**。ethers `keccak256(preimage)` 等价于 Solidity `keccak256(abi.encodePacked(preimage))`。不要哈希 `0x...` 的文本字符串。
- `hashlock`：两条链相同的非零 bytes32。
- `timelock`：各自链上的绝对 Unix 秒数；`claim` 要求 `block.timestamp < timelock`，`refund` 要求 `block.timestamp >= timelock`。
- `amount`：最小单位整数。B 原 CLI 按 Rain 链上 `decimals()` 转换；当前网页/HTTP 入口按课程 Rain 的 18 位精度解析，并在授权或建 Rain 锁时检查代币精度为 18。ETH 使用 wei，ETH 锁的 `token` 字段是零地址。
- `status`：`0=None`、`1=Active`、`2=Claimed`、`3=Refunded`，终态不可逆。领取和退款都须由指定账户调用。

## 事件

```solidity
event SwapCreated(
    bytes32 indexed swapId, address indexed sender, address indexed receiver,
    address token, uint256 amount, bytes32 hashlock, uint256 timelock
);
event SwapClaimed(bytes32 indexed swapId, bytes32 preimage);
event SwapRefunded(bytes32 indexed swapId);
```

按合约地址、事件 topic 和 swapId 查找日志，不能假设事件处在 `receipt.logs[0]`。领取交易一旦广播，秘密就可能从 calldata 被观察到；Bob 的正常恢复入口仍要求从已确认的 Arbitrum `SwapClaimed` 事件取得并核验秘密。网页中 Alice 点击领取时，会先把 preimage 交给本机 HTTP 服务校验、编码和估费，估费 RPC 也会收到含秘密的调用参数；因此不能声称广播前只有浏览器知道秘密。服务不将秘密写入文件或请求日志；公开设置和浏览器 localStorage 不保存 preimage。

ABI 文件在 `config/abi/ERC20HTLC.json`、`config/abi/ETHHTLC.json`。修改合约后执行 `npm run abi:export`；接口变更应同步脚本、前端和本文档。部署与交换共用 `runtime.assertCode`：完整 runtime bytecode 一致则通过；可靠解码后只有元数据哈希不同、执行部分与编译器标记一致则警告通过；执行部分不同或无法可靠判断则阻止。元数据警告不证明源码和完整编译设置一致，详细边界见 TASK_C.md。Task A 修改执行实现后需重新编译并部署对应版本；仅元数据哈希不同不自动要求重新部署。

## B/C 的接入方式

C 调用的是组员实际部署的合约，没有另建一套前端 HTLC 合约或 HTLC ABI 文件副本。`frontend/main.js` 直接导入 `deployments/sepolia.json`、`deployments/arbitrumSepolia.json` 及 `config/abi/` 下两份共享 ABI；HTTP 服务也读取同一套文件。前端另有查询 Rain 余额、allowance 和编码 approve 所需的少量标准 ERC20 ABI 声明，这是代币接口，不是另一份 HTLC 实现。

C 通过本机 HTTP 调用 B：`chainActions.js → serveFrontend.mjs → webCoordinator.mjs → protocol.js / recovery.js / runtime.js`。链上操作前置核验、逐笔估费、交易准备和确认核验在 Node.js 中运行；C 仍做表单预览、身份/网络检查、返回交易参数复核、备份管理和 MetaMask 签名请求，不能说前端完全没有检查。

`serveFrontend.mjs`、`webCoordinator.mjs`、`webProtocol.mjs` 是接入网页时新增的 HTTP/单步适配，不是组员原先就有的三个文件。它们调用原 B 功能；建锁参数用共用的 `protocol.lockCall`，输入解析和预期字段用 `shared/swapInputs.mjs`。B 原 CLI 仍可独立执行整轮交换，网页则由参与者逐步确认。本机服务不是已部署的远程多用户后端。

职责、复用和原文件调整统一见 [Task C 说明](TASK_C.md)，输入、按钮与预期结果见 [操作流程](TASK_C_FLOW.md)。本文件保留 A/B/C 的共同合约接口约定。


## 错误与状态流

`InvalidInput`、`SwapAlreadyExists`、`SwapNotFound`、`NotReceiver`、`NotSender`、`InvalidSecret`、`ClaimExpired`、`RefundNotReady`、`AlreadyCompleted`，ETH 付款失败另有 `ETHTransferFailed`。两份合约继承 ReentrancyGuard，重入可能抛出 `ReentrancyGuardReentrantCall`；ERC20 转账使用 SafeERC20，可能抛出代币自身或 SafeERC20 的错误。

```text
None --create--> Active --claim before expiry--> Claimed
                       --refund at/after expiry--> Refunded
```

Task B3/B4 和 Task C 使用 `swaps(id)` 与各链区块时间：合约层面，Active 且未到期时指定接收人可用正确秘密领取；Active 且到期后指定发送人可退款。到期不会自动修改 Active 或自动退款。C 额外检查双方约定、跨链窗口、当前账户/网络和所需备份，条件不足时即使 Active 也会禁用相应按钮；不存在或终态不能再次领取/退款。B 的状态查看和退款入口为 `scripts/status.js`、`scripts/refund.js`；C 通过 HTTP 使用 B 的状态分类及操作核验。当前验收状态和历史证据见 [TEST_RESULTS.md](TEST_RESULTS.md)，不能仅凭接口已实现就宣称所有场景已测通过。

## B2 协调顺序

1. 两条链分别检查 chain ID、合约代码、账户和余额。
2. 生成独立 swapId、随机秘密及共同 hashlock，并将秘密保存到独立本机文件；检查 allowance，仅在不足时由 Alice 授权并等待确认。网页对应 Prepare 的下载/验证私密备份，再在 Lock Rain 按需授权。
3. Alice 在 Sepolia 创建 Rain 锁并等待确认。Bob 读取该链核对双方地址、代币、数量、hashlock、期限、Active 状态。
4. Bob 在 Arbitrum Sepolia 创建 ETH 锁并等待确认。ETH 的期限更短；脚本同时核对绝对时间差和各链剩余时间差。
5. Alice 再核对两笔锁，确认仍有领取窗口后领取 ETH，等待确认。
6. Bob 从已确认的 ETH 领取事件读取秘密，领取 Rain，等待确认。
7. 分别读取两条链确认 Claimed。B CLI 在公开 run 报告及终端记录各步交易；C 在操作处和完成弹窗显示可读结果/交易链接，将 ETH 领取哈希带入下一步。C 只持久化当前公开设置和至多一个未决哈希，没有完整交易历史列表，证据需按 FLOW 保存。

默认 Rain=7200 秒、ETH=3600 秒、最小差=600 秒、最小领取窗口=120 秒。B CLI 的配置由 `runtime.settings` 读取；网页可填写本轮时长，但 HTTP 的当前默认边界来自 `shared/swapInputs.mjs` 的 DEFAULT_POLICY，不会因为修改 CLI 的 `.env` 边界而自动改变。计划 ETH 时长必须严格大于 120 秒；正常双边 Active 流程要求两边剩余窗口至少 120 秒，并同时检查绝对期限差和剩余窗口差。它们是协调器的测试策略，不是单份 A 合约强制的跨链常量。

确认块数只表示各自网络的确认，Arbitrum 的 L2 确认不代表 L1 最终结算。网络拥塞或 RPC 故障下不保证自动完成；已提交但未核验的交易应先查回执和两边状态，再决定下一步，不能盲目重发。
