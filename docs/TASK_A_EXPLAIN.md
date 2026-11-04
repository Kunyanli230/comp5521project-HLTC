# Task A1 / A2 / A5 函数说明

范围：锁仓函数 `createERC20Swap()`、`createETHSwap()`，公共校验 `_create()`，付款 `_pay()`，以及对应的安全测试。`claim()` / `refund()` 由 A3/A4 负责，这里只说明锁仓如何保证它们拿到的数据可靠。

接口（签名、事件、`swaps()` 字段、状态码 0–3）见 `docs/INTERFACE.md`，本任务没有改动。

## 1. `HTLCBase._create()` —— 两种资产共用的校验与记账

```solidity
function _create(bytes32 swapId, address receiver, address token, uint256 amount,
    bytes32 hashlock, uint256 timelock) internal
```

逐条检查，任一失败都 `revert InvalidInput()`：

| 条件 | 为什么要拒绝 |
|---|---|
| `swapId == 0` | `0` 是 mapping 的默认键，前端/脚本容易误传；也无法区分“没生成 ID” |
| `hashlock == 0` | 不存在已知原像，资金只能等退款，没有意义 |
| `receiver == address(0)` | 没人能以零地址身份调用 `claim`，等于烧掉领取路径 |
| `receiver == msg.sender` | 自己和自己交换没有对手方，属于误操作 |
| `amount == 0` | 空锁仓只会占用 swapId，污染状态 |
| `timelock <= block.timestamp` | `claim` 要求 `block.timestamp < timelock`，这样的锁一创建就过期，接收人永远领不了 |

然后：

1. `if (swaps[swapId].status != Status.None) revert SwapAlreadyExists();`
   只要 ID 曾经用过（Active / Claimed / Refunded），就不能再用。这既防止误重复提交，也防止别人用同一 ID 覆盖已有的锁、把自己改成发送人。
2. 写入 `Swap(msg.sender, receiver, token, amount, hashlock, timelock, Active)`。发送人永远是 `msg.sender`，调用者无法冒充别人。
3. 发出 `SwapCreated` 事件，供对方链上的脚本核对。

## 2. `ERC20HTLC.createERC20Swap()`

```solidity
function createERC20Swap(bytes32 swapId, address receiver, address token, uint256 amount,
    bytes32 hashlock, uint256 timelock) external nonReentrant
```

1. `if (token.code.length == 0) revert InvalidInput();`
   代币地址必须是合约。零地址和普通账户没有代码：用底层 `call` 调用这种地址会“成功”却什么都不转，是 ERC20 托管的经典漏洞。
   本合约后面的 `balanceOf` 调用和 OpenZeppelin 5.x 的 `SafeERC20` 其实也会因为没有代码而 revert，所以这一行是“提前、明确地失败”：
   在动任何状态之前就以统一的 `InvalidInput` 拒绝，而不是依赖后面调用报出不明确的错误。
2. `_create(...)`：执行上面的全部校验并记账。
3. 记录转账前本合约的代币余额 `beforeBalance`。
4. `safeTransferFrom(msg.sender, address(this), amount)`：把代币从发送人拉进托管。
   - 需要发送人事先 `approve`；不足时代币合约抛 `ERC20InsufficientAllowance`。
   - 余额不足时抛 `ERC20InsufficientBalance`。
   - 用 `SafeERC20` 是因为有些代币失败时返回 `false` 而不是 revert，`SafeERC20` 会把这种情况也变成 revert。
5. `if (balanceOf(this) - beforeBalance != amount) revert InvalidInput();`
   核对实际到账金额。扣费型代币（转 1000 只到 990）会被拒绝，否则 `swaps(id).amount` 记录 1000，领取时托管里却不够付。

**为什么先记账、后转账？** 整个函数在一笔交易里，任何一步 revert 都会回滚全部状态，包括第 2 步写入的记录和事件。所以不会留下“有记录但没资金”的锁。

**`nonReentrant` 的作用**：第 4 步调用了外部代币合约。如果代币是恶意的，它可以在 `transferFrom` 里回调 `createERC20Swap`；重入保护会让这次回调失败（`ReentrancyGuardReentrantCall`），整笔交易回滚。

## 3. `ETHHTLC.createETHSwap()`

```solidity
function createETHSwap(bytes32 swapId, address receiver, bytes32 hashlock, uint256 timelock)
    external payable nonReentrant
```

- 金额就是 `msg.value`，没有单独的 `amount` 参数，所以“记录金额 = 实际收到金额”天然成立。
- `token` 字段固定写 `address(0)`，表示原生 ETH。
- `msg.value == 0` 会在 `_create` 里被 `amount == 0` 拦下。
- 该函数不调用任何外部合约，`nonReentrant` 主要是与其他函数保持一致：在 `claim`/`refund` 付款过程中也不能回调进来创建新锁。

## 4. `_pay()` —— 付款（被 `claim` / `refund` 调用）

- `ERC20HTLC._pay`：`safeTransfer(receiver, amount)`。
- `ETHHTLC._pay`：`payable(receiver).call{value: amount}("")`，失败则 `revert ETHTransferFailed()`。
  用 `call` 而不是 `transfer`，是因为 `transfer` 只给 2300 gas，接收人是合约钱包时可能失败。代价是接收人能执行任意代码，所以 `claim`/`refund` 必须先把状态改成终态再付款，并加 `nonReentrant`。

付款失败时整笔 `claim`/`refund` 回滚，状态仍是 Active：接收人拒收时，发送人到期后仍可退款，资金不会卡死。

## 5. 测试对照（`test/TaskA_LockSafety.js`）

| 测试分组 | 证明的规则 | 用到的辅助合约 |
|---|---|---|
| successful locks | 记录字段、事件、余额变化完全一致；期限 = 当前时间 + 1 可以通过 | — |
| input validation（两种资产） | 第 1 节表格的每一条，且失败后没有记录、托管余额不变 | — |
| duplicate swapId | 重复、他人覆盖、终态复用都被拒 | — |
| ERC20 token transfer safety | 零地址/普通账户代币、allowance 不足、余额不足、扣费型代币、恶意代币重入 `createERC20Swap` | `FeeOnTransferToken`、`HookToken` |
| ETH rejects | 接收人或发送人拒收 ETH → `ETHTransferFailed`，锁仍 Active 且可退款 | `ETHRejecter` |
| re-entrancy | ETH 与 ERC20 的 `claim`、`refund` 付款回调中重入均失败，攻击者只被付一次 | `ReentrantReceiver`、`HookToken` |

辅助合约都在 `contracts/test/`，只用于本地测试，不会被部署脚本部署：

- `FeeOnTransferToken`：每次转账烧掉 1%（金额小于 100 时手续费取整为 0）。
- `ETHRejecter`：`receive()` 总是 revert。
- `ReentrantReceiver`：收到 ETH 或 HookToken 时回调 `claim`/`refund`；`bubble=false` 时吞掉错误并记录到 `lastError`，`bubble=true` 时把错误往外抛。
- `HookToken`：转账到指定地址时调用其 `onTokenReceived()`；或在转入 HTLC 时回调 `createERC20Swap`。

运行：`npm test`。
