# Task C 说明：实现、A/B 对接与要求对应

- [完整操作流程](TASK_C_FLOW.md)：输入、按钮、预期结果、成功交换、退款、恢复及异常验收。
- 本文件：任务职责、当前实现、与 A/B 的连接及限制。

实际测试证据集中在 [TEST_RESULTS.md](TEST_RESULTS.md)，AI 辅助范围保留在 [AI_ASSISTANCE.md](AI_ASSISTANCE.md)。验证记录已恢复 main 原始历史及已留存的 Task C 验收证据；未找回的未提交长稿不声称完整恢复。不再分别维护 HTTP 说明、Task C 笔记和测试计划三套内容。

## 1. 实现什么

Alice 在 Ethereum Sepolia 锁 Rain（链上符号 MST）给 Bob，Bob 在 Arbitrum Sepolia 锁原生 ETH 给 Alice。两份合约各自保管资产，链下程序协调两边操作；它们不直接通信。

Alice 生成随机 32 字节秘密 `preimage`，两边使用相同的 `hashlock = keccak256(preimage)`。Alice 领取 ETH 时公开秘密，Bob 从已确认的 ETH 领取事件取得它并领取 Rain。Rain 截止时间更晚，让 Bob 有后续领取窗口；未领取的 Active 锁到期后由原发送人手动退款。秘密并不代替身份授权，合约仍限制接收人领取、发送人退款。

Task C 为上述过程提供英文浏览器界面：连接钱包、填写约定、备份、授权、逐笔确认、状态引导、查询与退款。技术为普通 HTML/CSS/JavaScript、ethers v6、Vite。

## 2. 要求如何对应

| 要求 | 当前功能与实现位置 | 手动验收入口 |
|---|---|---|
| C1 钱包与网络，2 分 | `main.js` 连接 MetaMask，监听账户/网络事件，显示地址、chain ID，提供两条测试网切换 | 流程第 2 节 |
| C2 设置与状态，2 分 | 钱包 ETH、Rain、allowance；约定数量/时长；生成 hashlock/两个 ID；显示部署和锁仓详情；统一授权入口 | Prepare、Lock Rain、Inspect locks |
| C3 引导与恢复，4 分 | 六步骤视图；B 返回阶段，C 结合角色、网络、备份控制按钮；Bob 对锁前核验，Alice 领 ETH，Bob 通过事件领 Rain；原发送人到期退款 | 流程第 3–6 节 |
| C4 反馈与易用性，2 分 | 区分请求钱包、提交、等待两次确认、核验完成；每笔交易完成后弹窗说明角色、数量、结果和下一步，提供交易链接；取消及未核验结果单独提示，明确 Completed/Refunded | 每笔动作及异常验收 |
| 不内置私钥 | 前端使用 MetaMask；不导入 `.env` 或创建私钥 Wallet；公开文件及浏览器存储不保存 preimage | 源码、公开导出及存储检查 |
| E 现场演示 | 一次真实成功交换，以及一次到期前不可用/到期后真实退款；可使用独立预准备实例 | 流程第 3–5 节 |
| 提交与贡献 | 运行依赖、配置模板、地址、流程和可解释的函数；贡献以实际代码/提交/测试为证据 | 根 README、接口及验证记录 |

HTTP 是本项目为复用 B 选择的入口，刷新周期和安全余量是当前实现策略。

## 3. A、B、C 是怎么连起来的

| 部分 | 负责什么 | 当前文件 |
|---|---|---|
| A | 链上保管、合法建锁、身份/秘密/期限检查、支付、状态与事件 | `contracts/HTLCBase.sol`、`ERC20HTLC.sol`、`ETHHTLC.sol` |
| B | 部署/配置、成功交换、双链状态、事件恢复、退款、确认与期限规则 | `scripts/lib/protocol.js`、`recovery.js`、`runtime.js` 及 CLI 入口 |
| C | 英文页面、表单、钱包余额、备份/公开文件、HTTP 客户端、MetaMask 请求、展示和导航 | `frontend/` |

```text
C 表单/按钮 ── HTTP ──> B 读取两条链、核验、估费和准备未签名交易
C <─────────────────── B 返回交易参数
C ──> MetaMask ──> 用户确认、钱包签名并广播 ──> 对应链上的 A 合约
C ── 交易哈希 ──> B 等待确认、核验事件与状态 ──> C 更新结果
```

本地 B 服务是 `node scripts/serveFrontend.mjs` 启动的常驻程序，监听 `127.0.0.1:3001`；Vite 通常提供 `localhost:5173` 页面，并代理同源 `/api` 给 B。它提供链下协调，不保管资产，不创建 Alice/Bob 的私钥钱包，不代替用户签名。原 B CLI 入口仍可独立使用，其本地私钥签名方式与 HTTP 的 MetaMask 方式不同。

### ABI 和地址在哪里体现

ABI 是 JavaScript 编码合约调用、解码事件/结果所需的接口描述，不是另一份合约。地址决定实际访问哪个已部署合约。

- A 的共享 ABI：`config/abi/ERC20HTLC.json`、`config/abi/ETHHTLC.json`。
- B 的公开部署记录：`deployments/sepolia.json`、`deployments/arbitrumSepolia.json`。
- `frontend/main.js` 直接导入这些文件，给页面和签名前目标/ABI 核对使用；不在前端维护另一套地址或 ABI 副本。
- `webCoordinator.configuredCoordinator()` 也从同一份记录创建两条只读 RPC 连接和合约对象，并检查实际 chain ID、部署代码。
- A 变更函数接口后要编译并导出共享 ABI；执行实现变更时 A/B 核对部署版本及记录，再进行联调。单纯修改 JS 文档或元数据差异不自动要求重新部署。

| 配置 | 当前公开值 |
|---|---|
| Ethereum Sepolia chain ID | `11155111` |
| Arbitrum Sepolia chain ID | `421614` |
| Rain / MST，18 decimals | `0xf49d4F8A697C09D4daf942938A2C4cb5593164dC` |
| ERC20HTLC / Ethereum Sepolia | `0x98eFb0B12BA43d5efc3723fFf839Fee29B8f72A3` |
| ETHHTLC / Arbitrum Sepolia | `0x6c4826b0D6Ad8aB8dBbeD368f45E963306626aA2` |

这里为便于解释列出当前值，运行时仍以部署文件为准；改变部署应同步这些说明。完整参数签名、事件、状态值和时间边界集中在 [INTERFACE.md](INTERFACE.md)。

### 复用与修改 B 的实际范围

| B 函数 | HTTP 中的用途 |
|---|---|
| `readSide` / `classify` | 同一区块读取某一链的锁和时间，分类可领取、可退款及终态 |
| `verifyLock` | 核验对方真实锁的字段及 Active 状态 |
| `assertTimelocks` | 实际截止时间差、剩余时间差和领取窗口 |
| `verifyCreated` | 创建事件字段与预期一致 |
| `confirmed` / `eventFrom` | 等待确认，按合约地址、事件、swap ID 唯一核验日志 |
| `readConfirmedClaim` | CLI/HTTP 共用的 ETH 领取回执、规范链区块、确认数和秘密事件核验 |
| `prepareRefund` | CLI/HTTP 共用的退款前置检查 |
| `assertChain` / `assertCode` | 网络及部署版本核对 |

接入时修改了 B 的原文件：`protocol.js` 导出 `verifyCreated`，将原成功流程的秘密观察交给共用 `readConfirmedClaim`；`recovery.js` 提取 `prepareRefund`、增加共用事件读取；`runtime.js` 后续修正元数据差异分类。其余新增的网页逐步计划和费用适配明确放在 `webCoordinator.mjs` / `webProtocol.mjs`。

没有把会连续操作两方私钥账户的 `runSuccessfulSwap()` 直接包装成自动交换按钮。C 调用的是 B 的逐步入口，用户逐笔授权；也不再使用 Vite 抽取 B 源码的旧方案。

## 4. 前端每个文件负责什么

| 文件 | 职责 |
|---|---|
| [index.html](../frontend/index.html) | 六个交换步骤、独立查询/退款视图、标签与状态区；同一时间显示当前任务 |
| [style.css](../frontend/style.css) | PPT 风格的浅灰绿、海军蓝、青绿与少量金色提示，窄屏布局和焦点可见性 |
| [main.js](../frontend/main.js) | 钱包及余额、表单预览、生成随机秘密/ID、私密备份验证、链上报告展示；动作交给 workflow |
| [workflow.js](../frontend/lib/workflow.js) | 当前公开设置、请求 B、刷新和失效控制、未决哈希、MetaMask 签名及确认反馈 |
| [chainActions.js](../frontend/lib/chainActions.js) | HTTP 请求、超时/错误说明、ABI 整数字段还原 BigInt；不自己实现锁仓协调 |
| [guide.js](../frontend/lib/guide.js) | 路由、步骤导航、角色/网络提示、B 推荐阶段及按钮文案，不发交易 |
| [swapProtocol.js](../frontend/lib/swapProtocol.js) | 少量共享输入工具的转发和 B 分类结果读取，不含模拟链或独立协议状态机 |
| [swapInputs.mjs](../shared/swapInputs.mjs) | B/C 共用公开字段白名单、地址/数量/ID/时长格式校验和错误遮蔽 |
| [vite.config.js](../frontend/vite.config.js) | 本机开发及 `/api` 代理；不读取或执行 B 源码 |

workflow 单独成文件是为了把页面状态和钱包操作集中管理；guide 管页面导航，chainActions 管请求传输。其目的在于职责可读，不代表又实现了一份 B。

## 5. 一次按钮点击实际上发生什么

以 Bob 的 Lock ETH 为例：

1. C 读取本轮公开设置及当前账户，调用 `POST /api/prepare`。
2. B 核对固定网络/部署、输入和 Bob 身份，读取两条链，检查 Rain 双方、token、amount、hashlock、Active 和期限，确认 ETH ID 没被使用。
3. B 用实际区块时间计算 ETH 截止时间，估 gas/费用并检查本金加预算余额，返回未签名交易。
4. C 核对响应的动作、资产、swap ID、目标、发送人、chain ID、value 及按共享 ABI 编码的 calldata；重新核对钱包和约定未改变，才请求 MetaMask。
5. 用户确认后，C 取得哈希并保存公开未决信息，调用 `POST /api/confirm`。
6. B 检查交易目标/发送人/调用/回执、等待两次确认，核验创建事件和链上字段；C 显示结果并重新读取。

其他六种动作走同一个钱包入口：`approve-rain`、`lock-rain`、`claim-eth`、`claim-rain`、`refund-rain`、`refund-eth`。每种动作仍有自身的角色、秘密、状态和期限规则。

| HTTP 请求 | 输入 | 输出 |
|---|---|---|
| `GET /api/health` | 无 | ready/read-only、deploymentIssues、deploymentWarnings |
| `POST /api/snapshot` | lookup：两个 ID；可选 setup：完整公开约定 | 两条链记录、快照区块/时间、期限评估；有完整设置时给推荐阶段 |
| `POST /api/prepare` | action、setup、actor；授权加 approvalAmount，Alice 领取加 preimage | 未签名 transaction、参数及费用预算 |
| `POST /api/confirm` | action、setup、hash | 已确认且核验后的结果 |
| `POST /api/transaction-status` | asset、hash | 指定链的回执状态，用于未决保护 |

链上整数在 JSON 中以十进制字符串传输。B 只接受固定业务动作，不接受任意 RPC URL、ABI、方法或合约目标；服务器限定本机、检查请求大小和来源，不记录秘密请求体。C 使用共享 ABI 和部署地址核对交易请求，不能以网页自报成功代替 B 读链。

## 6. 文件、秘密与恢复

| 数据 | 放在哪里 | 用途 |
|---|---|---|
| 钱包私钥 | 用户 MetaMask；CLI 原配置与此不同 | 用户签名，不写入前端源码或公开设置 |
| 私密备份 htlc-private | Alice 下载的本机文件；使用时仅在页面内存 | preimage、hashlock、两个 ID，不包含完整金额/时长约定 |
| 公开设置 htlc-public | 双方可分享的 JSON | 地址、数量、时长、两个 ID、hashlock、部署，以及可选 ETH 领取哈希 |
| 当前公开设置 | localStorage 的 `htlc.public.setup.v1` | 页面刷新后恢复当前实例，无交换列表 |
| 一笔公开未决信息 | `htlc.public.pending.v1` | 动作、网络、目标、swap ID、交易哈希；不存秘密 |
| 完整手动证据 | `TEST_RESULTS.md` | 已执行场景及公开链接，不存私密备份 |

刷新会销毁页面内存里的秘密，Alice 必须重新选匹配的私密文件；Bob 可只用公开设置和确认后的 ETH 领取哈希继续。既有不同私密草稿不能被随意覆盖，Active 期间不应换实例。

秘密并非永远只在浏览器：Alice 领取时，C 暂将 preimage 交给本机 B 进行校验、编码和估费，估费 RPC 也会收到调用参数。服务不把它持久化到文件或请求日志。领取交易广播后秘密已公开，Bob 的路径由 B 从已确认事件取得它，不读 Alice 的本机备份。

“前端不内置私钥”不等于整个仓库任意配置都可公开。PDF 提交包使用占位值配置模板，不提交真实 `.env`、私密备份或未公开秘密。具体 AI 辅助函数须如实标记并披露，不能把本文件当作实际贡献或 AI 使用政策合规的自动证明；范围见 [AI_ASSISTANCE.md](AI_ASSISTANCE.md)。

## 7. 刷新、估费、期限与部署检查

### 刷新不是每秒推送

页面可见且无钱包操作时约每 15 秒轮询；输入停止约 500 毫秒后查询；交易结束后重新查询；Read Both Locks 可手动触发同一条路径。只读刷新不反写当前公开设置，避免旧标签页轮询覆盖另一页的新实例。

读取期间保留上次成功展示并暂停交易按钮；失败、输入变化或过期请求不能重新放回旧结果。EXCHANGE OVERVIEW 的推荐跟随链上快照，用户选中的页面与推荐步骤分开。剩余时间基于各链区块时间，显示的是上次读取时的值；不是本机每秒倒计时，也不是两个链同时原子读取。自动刷新和即时感的频率是工程选择，不是 PDF 的固定要求。

### 费用估算和期限

B `estimate()` 调用 RPC `estimateGas`，加约 20% gas 用量余量，读取当前 EIP-1559 费用字段或 gasPrice，并检查发送人 ETH 可覆盖本金加预算。结果不等于实际手续费，不保证之后报价不变；它不广播交易。本地自动测试、RPC 估费、真实 MetaMask 公网验收是不同层次。

当前网页策略为 Rain/ETH 默认 7200/3600 秒、最小差 600 秒、最小领取窗口 120 秒、两次确认。计划 ETH 时长须严格大于 120，建锁与领取还需满足实际两链窗口。B CLI 的环境覆盖不会自动改变网页策略；不要只改浏览器输入校验或只改 `.env` 一端。Arbitrum 的 L2 确认不等于 L1 最终结算。

### 部署元数据差异

`runtime.assertCode` 同时供 CLI 和 HTTP 使用：

| 检查 | 行为 |
|---|---|
| 完整 runtime bytecode 一致 | 通过 |
| 完整解码后执行部分相同，仅已识别元数据哈希不同，编译器及非哈希标记匹配 | 警告通过，不关闭合法动作 |
| 执行部分/必要标记不同或差异无法可靠解析 | HTTP 保留历史读取并阻止交易准备，Deployment review required |
| RPC/链 ID/地址无合约/缺编译产物 | 启动失败并报告具体原因 |

解析依末尾两字节长度，使用直接依赖 `cbor@8.1.0` 完整解码，检查分隔符、哈希格式、发布版编译器标记；拒绝重复键、尾随数据和未知格式。不是固定截去末尾字符。执行部分匹配不证明源码和完整编译设置逐项相同。规则参考 [Solidity 官方元数据说明](https://docs.soliditylang.org/en/latest/metadata.html#encoding-of-the-metadata-hash-in-the-bytecode)。

## 8. 验证状态与当前限制

```powershell
# 仓库根目录
npm test
npm run test:web
# 前端目录
cd frontend
npm run build
```
B 原成功/恢复入口的集成回归命令仍为 `npm run test:cross-chain`、`npm run test:refund-path`；HTTP 接入时已执行过，元数据修正后的本轮结果以上述测试与 HTTP 检查为准，不混淆执行日期或范围。

| 场景 | 已有证据 | 新 HTTP 入口状态 |
|---|---|---|
| 旧 S：10 Rain / 0.001 ETH，双方 Claimed | 旧页面、用户 MetaMask/Etherscan 截图及部分领取链接 | 不自动算作新版完整成功交换通过 |
| 旧 R1：仅 Rain 锁后退款 | 真实退款链接及终态/余额/禁用截图 | 待新版交易回归 |
| 旧 R2：双方锁后分别退款 | 真实 ETH 退款链接、双方 Refunded 截图 | 新版历史读取已通过，交易回归仍待 |
| 新 health / 旧 R2 查询 | 用户 ready JSON 与双方 Refunded 截图 | 已反馈通过 |
| 新版新 S：1 Rain / 0.001 ETH | 本轮备份/公开导入和领取前后截图、两笔领取哈希；真实 RPC 核验成功回执、事件及双方 Claimed | 实际交换终态已通过；结果页、刷新恢复反馈及建锁链接仍待补齐 |
| Active 刷新后继续、隔离 Bob 浏览器真实领取、确认中断恢复 | 有部分旧证据或开发检查 | 尚需手动验收 |

HTTP 版需要同时运行 B 和 C；构建后的 dist 也要 B 服务和同源 `/api` 代理。当前 B 仅为本机服务，不能当作已部署的远程多用户服务。当前只存一笔公开设置和至多一个未决哈希，没有多交换列表或交易历史。未实现可选隐私扩展；同一 hashlock/公开秘密的基本协议符合基础题思路，不具备挑战题的关联隐私。

手动操作和异常步骤统一见 [TASK_C_FLOW.md](TASK_C_FLOW.md)，结果追加到 [TEST_RESULTS.md](TEST_RESULTS.md)。PDF 的四分钟现场演示仍须真实操作，不由文档、截图或构建结果替代。
