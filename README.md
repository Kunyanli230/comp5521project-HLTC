# Group 4 HTLC Project

已完成工作的记录：

Task A:

郭盈盈：

李佳阳：

Task B：

李昆晏：1. 部署和配置：把两个合约分别部署到两条链上，地址和网络配置整理好。
2. 成功交换脚本：把正常交换的流程跑通，每一步等链上确认，最后打印两条链的交易链接。把函数名、参数和事件定下来，比如锁定、取款、退款各叫什么这些。

李家榕：3. 状态查看脚本：分别读两条链，告诉你每笔锁现在是「进行中 / 可以取 / 已取走 / 已过期 / 可以退款」。
4. 超时退款脚本：交换没完成时，到期后让原主人把钱退回来；没到期不让退，已经取走的也不能再退。

Task C：
周翮霖：浏览器界面、MetaMask 交互、交换步骤引导、公开设置与私密备份、状态查询和到期退款；通过本机 HTTP 适配复用 B 的协议与恢复函数，连接 A 已部署合约，并进行手动验收。

# Rain / ETH 双链交换（B1、B2）

当前入口使用 Ethereum Sepolia 上的 Rain ERC20 和 Arbitrum Sepolia 上的原生 ETH。两份合约独立部署，共用 keccak256 hashlock，由链下脚本协调。代币相关配置统一使用 Rain 命名；RAIN_ADDRESS 指向需要使用的课程 ERC20 地址，不会修改链上代币本身的名称。

## 当前完成与待配置

- 已实现：ERC20HTLC / ETHHTLC 对接基线、网络配置、部署记录、成功交换脚本、ABI、接口约定和本地测试。
- 已验证：编译、合约规则测试，以及两个独立本地节点上的重复成功交换。
- 已执行真实测试网部署，并于 2026-10-25 完成 100 Rain / 0.001 ETH 交换；两份合约均已部署、两笔交换状态均为 Claimed。部署记录见 `deployments/`。
- 上述 B1/B2 阶段不包含前端或 B3/B4。后续已接入 B3 状态查看、B4 手动触发退款及 Task C 浏览器流程，入口见下文；退款不会仅因到期而自动执行。

## 安装与本地验证

建议使用 Node.js 22 LTS。Windows 如阻止 PowerShell 的 npm/npx 脚本，使用 `npm.cmd` / `npx.cmd`。

运行当前 Vite 前端时，Node.js 版本需满足 `^20.19.0 || >=22.12.0`。

```powershell
npm ci
npm run compile
npm test
npm run test:cross-chain
npm run abi:export
```

`test:cross-chain` 自动启动并结束两个独立节点（chain ID 31337 / 31338，随机本机端口），运行真实 RPC 交易并核对余额、状态、秘密事件、部署复用和重复交换。测试证据输出到系统临时目录，不生成虚假的公网链接。

## B1：配置与部署

只在本地 `.env` 填写：

| 配置 | 内容 |
|---|---|
| `SEPOLIA_RPC_URL` | Ethereum Sepolia RPC，chain ID 11155111 |
| `ARBITRUM_SEPOLIA_RPC_URL` | Arbitrum Sepolia RPC，chain ID 421614 |
| `ALICE_PRIVATE_KEY` / `BOB_PRIVATE_KEY` | 两个不同测试账户的 0x 开头私钥 |
| `ALICE_ADDRESS` / `BOB_ADDRESS` | 可选；填写时必须与对应私钥匹配 |
| `RAIN_ADDRESS` | Ethereum Sepolia 上现有 Rain ERC20 地址 |
| `RAIN_AMOUNT` / `ETH_AMOUNT` | 人类可读数量，默认 100 / 0.001 |

Alice 和 Bob 都需要两条链的测试 ETH 支付 gas，Alice 还需要足够的 Rain；Bob 在 Arbitrum 的余额须覆盖锁定 ETH 和 gas。Alice 默认在两条链部署合约。

```powershell
npm run config:check
npm run deploy
```

部署脚本自己创建两条 RPC 连接，不需要加 `--network`。它逐笔等待配置的确认数，验证 runtime bytecode，生成：

- `deployments/sepolia.json`：ERC20HTLC 地址、Rain 地址、Alice/Bob 公共地址、部署交易与链接。
- `deployments/arbitrumSepolia.json`：ETHHTLC 地址、参与账户、部署交易与链接。

脚本自动读取这些记录。也可在 `.env` 填写 `SEPOLIA_ERC20_HTLC_ADDRESS` 和 `ARBITRUM_SEPOLIA_ETH_HTLC_ADDRESS`，交换时会优先使用并验证这些地址。已有确认部署会复用；部分部署失败时保留已提交交易记录，不会假报两条链全部完成。未确认记录需要先人工核实，再继续部署。

网络元数据见 `config/networks.js`；公开部署记录说明见 [deployments/README.md](deployments/README.md)。Arbitrum RPC 与 chain ID 核对自[官方文档](https://docs.arbitrum.io/chain-info)。

## B2：完整成功交换

```powershell
npm run swap:success
```

一次运行完成：

1. 校验两条链 ID、合约代码、账户、Rain 精度和双方资金。
2. 随机生成 32 字节秘密、共同 hashlock 和两个不同的 swap ID，私密保存秘密。
3. Alice approve Rain 并等待确认，在 Sepolia 锁 Rain 给 Bob，并等待确认。
4. Bob 读取并核验 Rain 锁的双方、代币、数量、hashlock、期限和 Active 状态。
5. Bob 在 Arbitrum Sepolia 锁 ETH 给 Alice，等待确认；Alice 再核验两条链的锁和时序。
6. Alice 领取 ETH，等待确认。Bob 从该链已确认的 `SwapClaimed` 事件取得秘密。
7. Bob 用事件中的秘密领取 Rain，等待确认；分别检查两条链为 Claimed 并打印每步交易链接。

默认 Rain 锁 7200 秒、ETH 锁 3600 秒、最小期限差 600 秒，领取前至少保留 120 秒。时间来自各链区块，不使用电脑时钟。`SEPOLIA_CONFIRMATIONS` / `ARBITRUM_SEPOLIA_CONFIRMATIONS` 默认均为 2，`TX_TIMEOUT_MS` 默认 300000。确认策略适用于课程演示，不等同于跨链或 L1 最终结算保证。

### 已验证的测试网部署和成功交换（2026-10-25）

| 项目 | 网络 | 地址 |
|---|---|---|
| Rain（链上符号 MST，18 decimals） | Ethereum Sepolia | `0xf49d4F8A697C09D4daf942938A2C4cb5593164dC` |
| ERC20HTLC | Ethereum Sepolia | `0x98eFb0B12BA43d5efc3723fFf839Fee29B8f72A3` |
| ETHHTLC | Arbitrum Sepolia | `0x6c4826b0D6Ad8aB8dBbeD368f45E963306626aA2` |

| 动作 | 已确认的真实交易 |
|---|---|
| 部署 ERC20HTLC | [Sepolia 交易](https://sepolia.etherscan.io/tx/0x9b9cfe42d658a1a993058d20ed12b277bc01950d099a2b9e05be8fa686bea8bd) |
| 部署 ETHHTLC | [Arbitrum Sepolia 交易](https://sepolia.arbiscan.io/tx/0x1242d34a10356381bba907a31409300f68d64ae189d82b356413bc45c9198b58) |
| 授权 Rain | [Sepolia 交易](https://sepolia.etherscan.io/tx/0xde136aa7582cf4fde1f8494c034ee8853d778e95d73e0a678804186d8f01bbfc) |
| 锁定 100 Rain | [Sepolia 交易](https://sepolia.etherscan.io/tx/0x8ef9e2345035526a3e78086c16d55300a08952866c04f8403d6eec5fb022e165) |
| 锁定 0.001 ETH | [Arbitrum Sepolia 交易](https://sepolia.arbiscan.io/tx/0x886f7a8e50370a4f94bacf38256528a17f91585b4cbc4cb3ea182de9d30ee7b1) |
| Alice 领取 ETH | [Arbitrum Sepolia 交易](https://sepolia.arbiscan.io/tx/0xe6110e61d5acc2d17aae909840ff1afd043e5e1bc88d31bd68f9c6cf4a8cfcb1) |
| Bob 领取 Rain | [Sepolia 交易](https://sepolia.etherscan.io/tx/0xed0d9ac507c3c58633d843cacdfcc67e1f11ae12b9fc0b4a59281960af596110) |

每笔交易等待两次确认。完整公开证据见 `deployments/successful-swap-2026-10-25.json`。Alice 的 100 Rain 已转给 Bob；再次运行默认交换前，需要先向 Alice 补回 Rain，并检查两条链 gas 余额。

公开运行记录位于 `runs/<runId>.json`，包含双链合约、swap ID、hashlock、金额、期限、交易哈希/链接/确认状态及最终状态。秘密文件位于 `.local/secrets/<runId>.json`，并由 Git 忽略。Windows 文件权限由账户 ACL 决定，应保留在个人目录。

若中途失败，脚本退出并将运行标记为 `incomplete`。先检查记录中的 pending/confirmed 交易及链上状态；超时不代表交易没有上链。保留秘密并使用固定接口按状态继续领取，或到期后由原发送人调用 `refund(swapId)`。本次没有自动恢复或重跑续接功能；直接重跑会创建一组新 ID。

## B3 / B4：状态查看、超时退款与演示准备

首次运行先 `npm ci`、`npm run compile`。状态和退款入口使用 `node`，参数由 `npm run ... --` 传入。以下命令在仓库根目录执行，`<runId>` 替换为运行记录 ID，也可使用 JSON 文件路径。

```sh
npm run status -- <runId>
npm run status -- <runId> --json
npm run refund -- <runId> eth
npm run refund -- <runId> rain
npm run refund -- <runId> auto
```

`status` 分别读取两条链，同一条链的锁和时间固定在同一个最新区块；输出状态、双方地址、金额、截止时间、剩余秒数和当前合约允许的操作。领取仍需正确秘密。它只从 Arbitrum 的 `SwapClaimed` 事件核验公开秘密，不读取 `.local/secrets/`、不发交易、不写记录。`--json` 输出可供 Task C 使用的 JSON；如需直接交给 JSON 解析器，使用 `node scripts/status.js <runId> --json`，避免 npm 的命令提示行。

| 状态 | 合约允许的操作 |
|---|---|
| `NOT_FOUND` | 无 |
| `CLAIMABLE` | receiver 在到期前用正确秘密领取 |
| `CLOSING` | 同上，但剩余时间小于 `MIN_CLAIM_WINDOW_SECONDS` |
| `REFUNDABLE` | sender 退款；`区块时间 == timelock` 即进入此状态 |
| `CLAIMED` / `REFUNDED` | 无，不再提供领取或退款操作 |

状态 JSON 的 `preimage` 来自 Arbitrum 的已核验领取事件，尚未找到时为 `null`。终端在核验成功时显示原文、计算所得哈希、运行记录的 hashlock 及比较结果。若 Rain 已可退款而 ETH 仍可领取，B3 会提示 Bob 注意双重损失风险。

若 ETH 已领取而 Rain 仍可领取，建议会提醒 Bob 在 Rain 截止时间前用事件秘密领取。无法核验秘密时会明确提示这一条件；Rain 已过期时会警告 Bob 已错过窗口。

`refund` 默认目标为 `auto`，逐条检查 Rain 和 ETH，仅向已过期且仍 Active 的锁提交退款。签名者按链上 `sender` 匹配 Alice/Bob；交易前执行 `refund.staticCall`，确认后检查 `SwapRefunded` 事件及 Refunded 状态。提前、已领取、已退款或不存在的锁均不发交易。`auto` 中一条被拒仍会检查另一条。

- 退出码 `0`：请求的退款均成功；`2`：至少一条被正确拒绝，可能已有另一条成功；`1`：配置、RPC 或交易错误。
- 运行记录必须与当前两条链的部署地址、chain ID 和网络一致。
- 退款按交易哈希和 chain ID 更新 `runs/<runId>.json`，确认后写入 `recovery.rain/eth = "Refunded"`。`deployments/` 中的已提交样例始终只读。

准备一笔“两边只锁不领”的新实例：

```sh
npm run lock:only
# macOS / Linux：缩短期限，供退款演示使用
ETH_TIMELOCK_SECONDS=240 RAIN_TIMELOCK_SECONDS=480 MIN_TIMELOCK_GAP_SECONDS=120 MIN_CLAIM_WINDOW_SECONDS=60 npm run lock:only
```

`lockOnly` 复用 B2 的建锁及核验流程，通过 `stopAfterLocks` 在领取前保存 `status: "locked"` 并结束。此命令会实际锁定配置的 Rain/ETH 并消耗测试网 gas；需要双方余额充足。普通成功交换入口默认不启用该选项。

答辩前分别准备一笔已过期实例 P 和一笔尚未过期实例 Q：先展示 Q 的 `status` 和被拒绝的提前退款，再用 P 展示到期退款及最终 `REFUNDED` 状态。每次 `lockOnly` 都创建新实例，不能靠重跑恢复原实例。

验证命令：

```sh
npm test
npm run test:refund-path
npm run test:cross-chain
npm run status -- deployments/successful-swap-2026-10-25.json
```

`test:refund-path` 自动启停两条本地链，覆盖只锁不领、到期边界、提前/重复/已领取拒绝、旧快照的预检拒绝、正确 sender、事件秘密和恢复记录。本地测试资料保存在被 Git 忽略的 `.local/refund-test-*/`，只代表本地链验证。B4 真实测试网锁仓及退款演示尚需另行执行并记录真实交易链接。

Windows PowerShell 如阻止 npm 脚本，可将上述命令中的 `npm` 换为 `npm.cmd`。CLI run 记录与网页 public JSON 格式不同，不能直接互换。

## Task C：浏览器前端

首次使用先在根目录执行上述 `npm ci` 和编译。网页需要同时运行两个终端。

**终端一，仓库根目录：**

```powershell
npm run server
```

本机 HTTP 服务监听 `http://127.0.0.1:3001`，负责调用 B 的读链、核验、估费和交易准备函数；签名与广播由浏览器中的 MetaMask 完成。修改后端代码后需停止旧进程并重新启动。

**终端二，从仓库根目录进入前端：**

```powershell
cd frontend
npm ci
npm run dev
```

日常重启不必重复 `npm ci`。Vite 将 `/api` 请求转发给上述服务；只启动前端不足以运行当前流程。可访问 Vite 地址下的 `/api/health` 检查服务：正常为 `status: ready`、`deploymentIssues: []`。有效元数据哈希差异可显示警告，执行代码不匹配则保持只读。

打开 Vite 打印的 Local 地址，连接 MetaMask。英文界面包含钱包/切链、Rain 授权、私密备份验证、公共设置导入导出、两边锁仓、Alice 领取 ETH、Bob 从已确认 ETH 事件取得秘密后领取 Rain，以及到期退款。`Exchange Workflow` 根据链上记录、当前账户和网络引导操作；浏览器只保存当前公开设置及至多一笔未决交易，不保存多交换列表、交易历史或私密 preimage。

具体输入、按钮和预期结果见 [完整操作流程](docs/TASK_C_FLOW.md)，实现与 A/B 对接见 [Task C 说明](docs/TASK_C.md)，前端启动补充见 [frontend/README.md](frontend/README.md)。前端按手动测试网验收流程操作；构建通过不等于完成公网现场演示，公网交易由参与者在 MetaMask 中逐笔确认并保存真实证据。

日常操作沿用同一网页主机名和端口，`localhost` 与 `127.0.0.1` 的浏览器存储不同。Alice 刷新后需重新选择匹配私密备份以恢复内存中的秘密；Bob 只需公开设置。当前服务仅监听本机，不是已部署的远程多人服务。

提交前可运行 `npm run test:refund-path`、`npm run test:web`，以及在 `frontend/` 中运行 `npm run build`。这些集成测试只在本地节点发送交易，不能替代真实 MetaMask 验收。

## Task A / C 对接

当前网页通过 `scripts/serveFrontend.mjs`、`scripts/lib/webCoordinator.mjs` 和 `webProtocol.mjs` 接入 B；这些是网页集成新增的适配。HTTP 与 CLI 共用 B 的 `protocol.js`、`recovery.js`、`runtime.js` 中相关函数，公开输入与预期字段工具位于 `shared/swapInputs.mjs`。C 展示操作和结果，B 准备与核验，A 执行链上资产规则。

完整函数签名、字段、事件、错误、状态值和时间边界见 [docs/INTERFACE.md](docs/INTERFACE.md)。前端直接引用 `config/abi/ERC20HTLC.json` / `ETHHTLC.json` 和 `deployments/sepolia.json` / `arbitrumSepolia.json`，不维护 ABI 副本或另一套部署地址。Task A 更新接口后导出共享 ABI 并核对前端函数调用；Task B 重新部署后更新公开部署记录，再重新联调。浏览器使用 MetaMask 签名，不导入读取 `.env` 私钥的 Node.js 脚本。

| 动作 | ERC20HTLC | ETHHTLC |
|---|---|---|
| 锁定 | `createERC20Swap(id, receiver, token, amount, hashlock, timelock)` | `createETHSwap(id, receiver, hashlock, timelock, {value})` |
| 领取 | `claim(id, preimage)` | `claim(id, preimage)` |
| 退款 | `refund(id)` | `refund(id)` |
| 查询 | `swaps(id)` | `swaps(id)` |

两份合约均发出 `SwapCreated`、`SwapClaimed`、`SwapRefunded`。状态为 0=None、1=Active、2=Claimed、3=Refunded。组员可在固定接口上完善实现；修改 runtime 后需重新编译和部署。

## 与课堂例子的区别和贡献记录

原单链合约保留用于历史参考，教学脚本移至 `scripts/legacy/`，说明见 [docs/LEGACY.md](docs/LEGACY.md)。新流程使用两条链、独立合约、长短期限、确认与锁仓核验、链上事件传递秘密和公开结果记录。

AI 辅助文件与函数清单见 [docs/AI_ASSISTANCE.md](docs/AI_ASSISTANCE.md)，供实际审查和报告披露使用。本仓库此次未实现隐私扩展，也未声称完成其他组员负责的项目组件。
