# 加分题 · 两条链上的点锁交换

2026-11-17（UTC），Alice 在 Ethereum Sepolia 锁定 10 MST，Bob 在 Arbitrum Sepolia 锁定 0.001 ETH。两人分别领到约定资产，两份合约都进入 `Claimed`。这次交换消除了基础版中可直接跨链匹配的锁值和领取值，但同一对账户仍很容易被认出。[本次公开报告](../deployments/point/successful-swap-2026-11-17.json)

## 1. 两条链各自公开了什么？

创建交易公开合约、资产、金额、付款方、收款方、交换 ID、到期时间和一把 20 字节的地址锁。领取交易公开该链的标量，合约把它写入 `SwapClaimed(swapId, secret)`。交易时间、发起地址和最终状态也可查。表中标量取自领取回执，报告只记录对应交易和锁。

| 本次链上记录 | Ethereum Sepolia · MST | Arbitrum Sepolia · ETH |
|---|---|---|
| 付款方 → 收款方 | Alice → Bob，10 MST | Bob → Alice，0.001 ETH |
| 交换 ID（缩写） | `0x5f3e8f0a…b52c5825` | `0x4a2d4895…8eee5bde` |
| `pointLock` | `0x8605f390451E0554321bD98229e8f1e6ed1a9B06` | `0x80f50bB4b8736879aeCB28806a22623EA0a4c3F5` |
| 领取标量（缩写） | `0x7052b8af…1745763a` | `0xbc5fefe6…725fb468` |
| 到期时间（Unix 秒） | `1794898200` | `1794894629` |
| 交易证据 | [部署](https://sepolia.etherscan.io/tx/0x7c186ebeccfb36e1199ef95558bf328fc34871e13cbc1456b22ba9951ff67818) · [授权](https://sepolia.etherscan.io/tx/0x0a0454f448a319a95cc5f2aee6077f097f0a24f2974aecb4c17bbd3cb0bb7cc6) · [建锁](https://sepolia.etherscan.io/tx/0x7cfbc41e9838569284fdb633ff7bd9c8e05c9135e5506a4ba7c30bb75cd82fc5) · [领取](https://sepolia.etherscan.io/tx/0xe3da1b554b1af64fca32793f6a432011715c9fe62d4d459426738ff98f763f37) | [部署](https://sepolia.arbiscan.io/tx/0x912a82183d267246ac449a26df017e91592e8660568d04c84773590e71440fee) · [建锁](https://sepolia.arbiscan.io/tx/0x0beaf8aff60012e7608dceb906acc1c183a4709f66561c4696c55fed1e2bc653) · [领取](https://sepolia.arbiscan.io/tx/0xb248bb665c82121c72371c4fefa3fc5f63454462852f2e80a8bb3a028c2c6e61) |

**基础版对照。** 2026-10-25 的报告记录了一个共用的 `hashlock`（`0xc1449bbb…e9596c92`）。分别解码两笔 `claim(bytes32,bytes32)` 的交易输入，交换 ID 不同，第二个参数却逐字节相同（`0xba0a3845…05a8cc03`）；其 Keccak-256 正好等于报告中的锁。观察者只要比较两个公开值是否相等，就能找到匹配。[基础版报告](../deployments/successful-swap-2026-10-25.json) · [Alice 领 ETH](https://sepolia.arbiscan.io/tx/0xe6110e61d5acc2d17aae909840ff1afd043e5e1bc88d31bd68f9c6cf4a8cfcb1) · [Bob 领 MST](https://sepolia.etherscan.io/tx/0xed0d9ac507c3c58633d843cacdfcc67e1f11ae12b9fc0b4a59281960af596110)

## 2. 为什么 Bob 能验证和领取，两笔领取却公开不同的值？

设 `G` 为 secp256k1 的生成元，`n` 为群阶，`addr(P)` 为公钥点对应的以太坊地址。Alice 随机选取秘密标量 `t` 与非零盲因子 `r`，并确保 `u = (t + r) mod n` 非零。

| 顺序 | 谁在哪里做什么 | 对外可见的信息 |
|---|---|---|
| 1 | Alice 在 Sepolia 为 Bob 锁 MST，并通过链下通道把 `T = t·G` 和 `r` 发给 Bob。 | 链上记录 `addr(u·G)`；offer 只交给 Bob。 |
| 2 | Bob 读取有效的 MST 锁及条款，核对 `addr(T + r·G)` 等于读到的锁地址，通过后才为 Alice 锁 ETH。 | Arbitrum 上出现另一把锁 `addr(T)`。 |
| 3 | Alice 核对两把锁和期限，以 `t` 领取 ETH。 | ETH 领取事件公开 `t`。 |
| 4 | Bob 从已确认事件读出 `t`，结合手中的 `r` 算出 `u`，核对地址后以 `u` 领取 MST。 | MST 领取事件公开 `u`。 |

**CH1** 的依据是群运算恒等式 `T + r·G = u·G`。Bob 可以在承诺 ETH 之前独立检查它；知道点 `T` 并不会给出其离散对数 `t`。这套构造使用点加法作密码学验证，无需零知识证明系统。**CH2** 的关键是非零的 `r` 使 `u ≠ t`。合约只将提交标量导出的地址与锁地址比较，点加法和跨链核对均在链下完成。两个实际领取标量分别导出了上表对应的锁地址。[链下计算](../scripts/lib/pointLock.js) · [建锁与领取顺序](../scripts/lib/pointProtocol.js) · [链上地址校验](../contracts/challenge/PointHTLCBase.sol)

## 3. 观察者还能怎样把交易配对？

单靠标量，任取一个 ETH 领取和一个 MST 领取都能算出一个候选差值。链上没有发布可独立核对的原始 `r`。持有原始 offer 的参与者事后可以出示它，让第三方核对两把锁；仅从两笔已公开的领取倒算出的差值，本身不能证明这是事先约定的一对。

| 关联线索 | 这次交换给出的证据 |
|---|---|
| **同一对账户** | 两条链都使用 Alice（`0x6BdC…Fa79`）和 Bob（`0x8466…4eE8`），建锁与收款角色刚好对调。 |
| **候选交易只有一笔** | 从各合约的部署块查到本次各自的领取块，Sepolia（12152137–12152147）和 Arbitrum Sepolia（329992253–329992577）各只有一条 `SwapCreated`。在这个范围内只有一种配对。 |
| 时间接近 | 按两条链的区块时间，两次建锁相隔 21 秒，两次领取相隔 18 秒。 |
| 期限具有方向性 | MST 比 ETH 晚 3,571 秒到期，符合 Bob 在 ETH 领取后仍需时间领取 MST 的顺序。 |
| 金额组合 | 已知双方约定 10 MST 换 0.001 ETH，就能用金额筛选候选交易；单笔金额本身不足以确认配对。 |

公开运行报告还直接列出了两条链的交换 ID 和交易链接。读到这份报告就能知道配对；上述分析针对只观察链上数据的人。[部署和交易记录](../deployments/point/successful-swap-2026-11-17.json)

## 4. 验证失败时，谁的资金还锁着？

| 情况 | 实际检查与结果 |
|---|---|
| Alice 发错 `r`、Bob 读到无关的 MST 锁、或 offer 用 32 字节标量充当公钥点 | 三个本地用例都在 Bob 建 ETH 锁前被拒。测试逐次比较拒绝前后的 ETH 链区块高度，三次都没有新增区块；已锁的 MST 在到期后逐笔退回 Alice。[双链集成测试](../test/integration/pointSwap.js) |
| 收款人提交相邻标量、零或越界值 | 合约返回 `InvalidSecret`，锁仍为 `Active`。对应测试为 `rejects a neighbouring scalar, zero and out-of-range scalars with InvalidSecret`。[合约测试](../test/Challenge_PointHTLC.js) |
| 第三方知道正确标量，或收款人错过截止时间 | 只有指定收款人能在到期前领取。从到期所在区块起，发送人可退款，已退款的锁不能再领。对应测试为 `rejects a non-receiver with the correct scalar`、`rejects claims at and after the deadline` 和 `refunds at the deadline and keeps the refund final`。协调器的 `assertTimelocks` 还检查两链期限差及剩余领取窗口。[权限与退款测试](../test/Challenge_PointClaimRefund.js) · [期限检查](../scripts/lib/protocol.js) |

在项目根目录运行 `npm test` 可复核合约和协议用例；`npm run test:point` 在两条独立本地链上验证交换、失败后的退款及部署复用。
