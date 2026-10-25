# Task A / B / C 接口约定 v1

本仓库把原代币引用统一命名为 **Rain**。`RAIN_ADDRESS` 指向真实的 Ethereum Sepolia ERC20 代币；改配置名不会修改已部署代币的 `name()`、`symbol()` 或地址。公网脚本不部署或铸造测试代币，`TestToken` 只用于本地测试。

## 网络和账户

| 资产 | 网络 | chain ID | 合约 | 发送人 | 接收人 |
|---|---|---:|---|---|---|
| Rain ERC20 | Ethereum Sepolia | 11155111 | ERC20HTLC | Alice | Bob |
| 原生 ETH | Arbitrum Sepolia | 421614 | ETHHTLC | Bob | Alice |

网络公开元数据：`config/networks.js`。RPC、私钥由本地 `.env` 提供；地址和交易结果见 `deployments/*.json`。Arbitrum 官方网络资料：<https://docs.arbitrum.io/chain-info>。

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

- `swapId`：非零、每个合约内不可复用的 bytes32；两条链分别生成不同 ID，脚本报告关联两者。
- `preimage`：密码学随机生成的 **32 个原始字节**。ethers `keccak256(preimage)` 等价于 Solidity `keccak256(abi.encodePacked(preimage))`。不要哈希 `0x...` 的文本字符串。
- `hashlock`：两条链相同的非零 bytes32。
- `timelock`：各自链上的绝对 Unix 秒数；`claim` 要求 `block.timestamp < timelock`，`refund` 要求 `block.timestamp >= timelock`。
- `amount`：最小单位整数。Rain 使用链上 `decimals()` 转换；ETH 使用 wei。ETH 的 `token` 字段是零地址。
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

按合约地址、事件 topic 和 swapId 查找日志，不能假设事件处在 `receipt.logs[0]`。秘密只在领取交易广播后公开；Bob 从已确认的 Arbitrum `SwapClaimed` 事件获取秘密。

ABI 文件在 `config/abi/ERC20HTLC.json`、`config/abi/ETHHTLC.json`。修改合约后执行 `npm run abi:export`；接口变更应同步脚本、前端和本文档。部署与交换会检查本地编译产物和链上 runtime bytecode 是否一致，避免误用课堂单链合约。Task A 修改实现后需重新编译并部署对应版本。

## 错误与状态流

`InvalidInput`、`SwapAlreadyExists`、`SwapNotFound`、`NotReceiver`、`NotSender`、`InvalidSecret`、`ClaimExpired`、`RefundNotReady`、`AlreadyCompleted`，ETH 付款失败另有 `ETHTransferFailed`。ERC20 转账使用 SafeERC20，可能抛出代币自身或 SafeERC20 的错误。

```text
None --create--> Active --claim before expiry--> Claimed
                       --refund at/after expiry--> Refunded
```

Task B3/B4 和 Task C 可复用 `swaps(id)` 与各链最新区块时间：Active 且未到期时接收人可领取（需要秘密）；Active 且到期后发送人可退款；不存在和终态均不显示可执行操作。状态查看和自动退款脚本由对应组员继续实现，此次只固定接口并验证合约退款行为。

## B2 协调顺序

1. 两条链分别检查 chain ID、合约代码、账户和余额。
2. Alice approve Rain 并等待确认；生成独立 swapId、随机秘密及共同 hashlock。
3. Alice 在 Sepolia 创建 Rain 锁并等待确认。Bob 读取该链核对双方地址、代币、数量、hashlock、期限、Active 状态。
4. Bob 在 Arbitrum Sepolia 创建 ETH 锁并等待确认。ETH 的期限更短；脚本同时核对绝对时间差和各链剩余时间差。
5. Alice 再核对两笔锁，确认仍有领取窗口后领取 ETH，等待确认。
6. Bob 从已确认的 ETH 领取事件读取秘密，领取 Rain，等待确认。
7. 分别读取两条链确认 Claimed，并打印所有步骤的交易哈希与对应浏览器链接。

默认 Rain=7200 秒、ETH=3600 秒、最小差=600 秒、最小领取窗口=120 秒。它们是课堂测试配置；确认块数只表示各自网络的确认，Arbitrum 的 L2 确认不代表 L1 最终结算。网络拥塞或 RPC 故障下不保证自动完成，报告会保留已提交交易供恢复。
