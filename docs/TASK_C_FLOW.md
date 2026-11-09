# Task C 完整操作流程与手动验收

阅读顺序：[启动](#start) → [钱包](#wallet) → [成功交换](#success) → [超时退款](#refund) → [刷新恢复](#resume) → [异常验收](#checks)。

## 一次交换

Alice 用 Ethereum Sepolia 上的 1 Rain，换 Bob 在 Arbitrum Sepolia 上的 0.001 ETH。页面的 Rain 就是链上符号为 MST 的课程代币。

| 网页步骤 | 使用谁的钱包 | 钱包连接的网络 | 做什么 |
|---|---|---|---|
| 01 Prepare | Alice 准备；Bob 可导入公开设置 | 准备表单不发交易 | 约定数量、时长，生成新 ID 和秘密，验证备份 |
| 02 Lock Rain | Alice | Ethereum Sepolia | 必要时授权，再把 Rain 转入 HTLC |
| 03 Lock ETH | Bob | Arbitrum Sepolia | 核对 Rain 锁后，把 ETH 转入另一份 HTLC |
| 04 Claim ETH | Alice | Arbitrum Sepolia | 用秘密领取 ETH，秘密随领取交易公开 |
| 05 Claim Rain | Bob | Ethereum Sepolia | 从已确认的 ETH 领取事件取得秘密，领取 Rain |
| 06 Result | 任一账户 | 查询不依赖钱包当前网络 | 核对两笔匹配记录都是 Claimed |
| Refunds | 各资产的原发送人 | 该资产所在网络 | 交换中断后，到期手动取回未领取资产 |

锁仓是把资产转入合约保管，不是直接交给对方；approve 只设置扣币额度。两条链共用 hashlock，秘密是其 32 字节原文。合约核对秘密的哈希后才允许指定接收人领取。交换未完成时，原发送人只能在期限到达后退款。

两个账户在两条链都要有 ETH 支付各自动作的 gas。Bob 还需要 0.001 ETH 本金，Alice 还需要至少 1 Rain。后面数字是本次操作的输入，不代表当前余额固定不变。

<a id="start"></a>
## 1. 启动 B 服务和前端

### 1.1 首次安装或依赖更新后执行一次

在 VS Code 打开项目文件夹，在终端执行：

```powershell
# 在已打开的仓库根目录执行
npm ci
npm run compile
cd frontend
npm ci
```

已安装且编译产物存在时，日常重启直接进入下一步。运行网站不需要重新部署合约。

### 1.2 终端一：启动 B

```powershell
# 在已打开的仓库根目录执行
npm run server
```

等到出现 `Task B coordinator: http://127.0.0.1:3001`，保持运行。仅有 `compiler metadata differs` 警告时可以继续。修改后端文件后，要在此终端按 Ctrl+C 再执行启动命令，旧 Node 进程不会自动加载新文件。

### 1.3 终端二：启动 C

新建另一个终端：

```powershell
cd frontend
npm run dev
```

浏览器打开 `http://localhost:5173`。如果 Vite 打印的是其他端口，按该端口访问；恢复旧设置时尽量沿用同一主机名和端口。`localhost` 与 `127.0.0.1` 使用不同的浏览器存储。

### 1.4 检查前端是否接到 B

浏览器另开 `http://localhost:5173/api/health`，端口与网页相同。应包含：

```json
{"status":"ready","service":"task-b-coordinator","deploymentIssues":[],"deploymentWarnings":[]}
```

上面是字段示意，当前部署的 `deploymentWarnings` 可以包含两条元数据警告。`ready` 且 `deploymentIssues` 为空才继续交易。`read-only`、访问失败或没有新版字段时，按第 8 节排查。随后回到网站页面。

<a id="wallet"></a>
## 2. 连接钱包、切换账户和网络

未连接账户时，两颗切网按钮保持禁用。先点击 Connect Wallet 并授权账户，再按本步骤所需网络切换。

MetaMask 中使用已有的两个测试账户。公开地址如下，私钥不填入网页：

| 角色 | 地址 |
|---|---|
| Alice | `0x6BdC4C6fC34651E19aA35AFcd568BB8baF77Fa79` |
| Bob | `0x8466E5f6A23977baD8A46Af21d81525048474eE8` |

钱包确认请求中的代币、目标或支出者按以下当前部署核对；网站 **Inspect locks → Configured networks and contracts** 也可查看。若 A/B 更新部署，以同步后的部署记录为准。

| 用途 | 网络 | 地址 |
|---|---|---|
| Approve Rain 时交互的 Rain 代币 | Ethereum Sepolia | `0xf49d4F8A697C09D4daf942938A2C4cb5593164dC` |
| 授权支出者；Lock/Claim/Refund Rain 的目标 ERC20HTLC | Ethereum Sepolia | `0x98eFb0B12BA43d5efc3723fFf839Fee29B8f72A3` |
| Lock/Claim/Refund ETH 的目标 ETHHTLC | Arbitrum Sepolia | `0x6c4826b0D6Ad8aB8dBbeD368f45E963306626aA2` |

1. MetaMask 选择 Alice，网站点击 **Connect Wallet**；出现请求时授权给本网站。已授权时可能直接连接。
2. 点击 **Switch to Ethereum Sepolia**，展开 **Account and balances**。核对 Account 是 Alice、Chain ID 是 `11155111`，ETH/Rain/allowance 显示数值。
3. 点击 **Switch to Arbitrum Sepolia**，核对 Account 未变、Chain ID 是 `421614`，ETH 显示该网络余额；Rain 和 allowance 提示切回 Ethereum Sepolia。
4. 在 MetaMask 切换 Bob，确认网站地址同步到 Bob；按两条切链按钮确认网络和余额随之更新。
5. 回到 Alice，切回 Ethereum Sepolia，开始下一节。

通过标准是账户、chain ID、数据同步，不要求每次都弹出切换窗口。钱包资产列表的网络筛选不一定等于该网站实际连接的网络，以网页 chain ID 和钱包对网站的连接状态核对。

<a id="success"></a>
## 3. 成功交换 S：1 Rain 换 0.001 ETH

每一笔钱包操作都等完成提示弹窗后再继续。成功弹窗标有 **CONFIRMED ON-CHAIN**，用明确标题说明谁完成了什么、实际数量，以及 Next 下一步；可点 **View this transaction** 保存交易链接，点 **Got it** 关闭。等待过程中显示 **Transaction submitted** 只代表提交，尚未完成；程序还要等待两次确认并核验结果。取消、准备失败、已提交但核验未完成会弹出不同提醒，不当作成功，也不自动重发。

交易后及页面可见时会自动查链。下文的 Read Both Locks 是手动核对方式：状态已自动更新时不必重复点击；状态未更新、恢复交换或网络恢复后再手动刷新。确认过程中不要连续点击、修改约定或更换账户。保存每步交易链接，最后记录到第 9 节模板。

### S1. Prepare：填写本轮约定

1. 点击顶部 **Guided swap**，再点击步骤 **01 Prepare**。
2. 在 **Who sends what?** 填写：

   | 输入框 | 输入 |
   |---|---|
   | Alice address — sends Rain, receives ETH | 上面的 Alice 完整地址 |
   | Bob address — sends ETH, receives Rain | 上面的 Bob 完整地址 |
   | Rain amount (MST) | `1` |
   | ETH amount — excludes fees | `0.001` |

3. 点击 **Check Swap Terms**，应显示 `Input checks passed`。这只检查输入，不代表已核验链上的锁。
4. 在 **Give both sides enough time** 输入 Rain duration=`7200`、ETH duration=`3600`，点击 **Check Timelock Settings**，应显示 `Duration checks passed`。

Rain 的计划期限更长，给 Bob 留出后续领取时间。当前规则是最小期限差 600 秒、ETH 计划时长严格大于 120 秒；实际建锁和领取时 B 还会检查各链真正的截止时间与剩余窗口。

### S2. 生成新 ID、下载并验证 Alice 私密备份

1. 在 **Set up this exchange** 点击 **Generate Swap IDs and Hashlock**。
2. 点击 **Download Private Backup**，保存这次下载的 `htlc-private-<本轮RainID>.json`。
3. 在黄色 **Alice: verify or restore your backup** 区域点击“选择文件”，选刚下载的这个私密文件。
4. 应显示 `Private backup restored and verified` 和所选文件名。
5. 展开 **View draft IDs and hashlock**，记录本轮两个 ID 和 hashlock。若自己更改过查询框，可点击 **Use This Draft** 重新应用它们。
6. 点击左侧 **Read Both Locks**，等读取完成。在右侧步骤导航下方的 **CURRENT ON-CHAIN STATE** 查看：Rain 和 ETH 两栏都应为 **Not created**，推荐 Alice 锁 Rain。这块状态在各步骤和查询/退款页都会显示；点击 **View lock IDs and details** 可进入详细记录。Not created 表示这个 ID 还没有通过锁仓交易写入链上；Not checked 则表示尚无可用查询结果，不能当作未建锁。
7. 点击 **Export Public Setup**，保存 `htlc-public-<本轮RainID>.json`，供 Bob 导入和刷新恢复约定使用。

两处“选择文件”的用途不同：**Import Public Setup** 选 `htlc-public-...json`，恢复双方约定、ID、hashlock 和公开领取交易哈希；黄色区域选 `htlc-private-...json`，恢复 Alice 的秘密和 ID。私密备份不包含完整数量/时长约定，重开页面时应先导入匹配的公开设置，再由 Alice 验证私密备份。Bob 不需要 Alice 的私密文件。

公开文件导入成功后，选择框下方显示 **Public setup loaded**，紧接着 **Current public setup** 列出 Alice/Bob、交换金额、计划时长、两个 ID、hashlock，以及文件中已有的 ETH 领取交易哈希。对应表单也会填入这些值。该摘要只是当前约定，链上状态仍看 **CURRENT ON-CHAIN STATE**。Bob 未加载私密备份时，黄色区域显示 **No private backup loaded** 是正常的；没有私密草稿就不会显示空的 draft IDs 区域。

若生成按钮灰色，先展开 ID 看是否已有本轮草稿；已有匹配草稿可直接下载/验证。更换交换要先确认当前锁已结束，再按 S7 的 Start New Swap 操作。不能复用已完成或已退款的 ID。

### S3. Alice 在 Ethereum Sepolia 授权并锁 Rain

1. MetaMask 选择 Alice，网站点击 **Switch to Ethereum Sepolia**。
2. 点击 **02 Lock Rain**，或推荐按钮 **Go to: Alice locks Rain**。
3. 查看 **A. Allow the HTLC to transfer Rain**。Rain 余额必须至少 1，allowance 必须至少 1。
4. allowance 已够时直接进行第 6 步。若为 0，在 **Rain amount to approve** 输入 `1`，点击 **Approve Rain**，在 MetaMask 核对 Sepolia、Rain 代币、支出者 ERC20HTLC 地址和额度 1，再确认。等待 **Rain approval completed** 弹窗，allowance 更新为 1，Rain 本金不应减少。
5. 若 allowance 非零但不足 1，当前接口要求先将输入改为 `0`、Approve Rain 并确认；等额度为 0 后再输入 `1` 授权并确认。两次操作都消耗 gas。若专门验收“额度已经足够时仍重新授权”的分支，也使用先 0 后 1 的流程，不连续修改非零额度。
6. 在 **B. Check and lock the agreed Rain** 点击 **Lock Rain**。B 将重读余额、授权、实际链上时间并估费，随后才请求钱包。
7. MetaMask 核对 Alice / Sepolia、交互目标为 ERC20HTLC，再确认。此处是代币锁仓，原生 ETH 本金应为 0，另收 gas。
8. 等 **Rain locked successfully** 弹窗，保存交易链接。自动读取完成后在当前页面上方 **CURRENT ON-CHAIN STATE** 查看：Rain 栏为 **Active**、ETH 栏为 **Not created**，推荐 Bob 锁 ETH；未更新时点 **Read Both Locks**，不用切到 Inspect locks 找状态。

本次只锁 1 Rain。数量来自 Prepare 的约定，不是授权输入框中的旧默认 `100`。授权额度和实际交换数量是两个概念。

### S4. Bob 核验 Rain 后在 Arbitrum Sepolia 锁 ETH

1. 同一浏览器操作时，在 MetaMask 切换 Bob，公开设置会保留。若在独立浏览器/配置文件操作，则打开同一网站，在 Prepare 的 **Import Public Setup** 选择 Alice 本轮导出的公开文件；该浏览器需要可用的 MetaMask，并连接 Bob。
2. 点击 **Switch to Arbitrum Sepolia**，进入 **03 Lock ETH**。
3. 点击 **Read Both Locks**。在 **Check the counterparty lock** 核对 Rain=Active、数量=1、sender=Alice、recipient=Bob；hashlock 与本轮约定相同，期限仍足够。
4. 点击 **Lock ETH (Bob)**。B 会独立重新核验 Rain、确认 ETH ID 尚未使用，并检查期限与资金。
5. MetaMask 核对 Bob / Arbitrum Sepolia、目标为 ETHHTLC、发送本金为 `0.001 ETH`（gas 另计），再确认。
6. 等 **ETH locked successfully** 弹窗，保存交易链接，再查看两笔锁：两边都应为 Active，推荐 Alice 领取 ETH。

出现 `Do not counter-lock` 或期限差不足时，不继续建锁；按第 4 节等待并退款。表单计划通过不保证过了一段时间后实际窗口仍足够。

### S5. Alice 用私密备份领取 ETH

1. MetaMask 切换 Alice，网络保持 **Arbitrum Sepolia**，进入 **04 Claim ETH**。
2. 若本页刷新过或使用另一浏览器，先在 Prepare 导入本轮公开文件，再在黄色区域选择匹配的私密备份；应再次看到 `Private backup restored and verified`。
3. 查看两边状态，未更新时点 **Read Both Locks**。页面允许 Alice 领取，且领取按钮上方显示 **The matching private backup is verified in this browser.**，才表示当前页面已验证本轮私密备份。
4. 点击 **Claim ETH (Alice)**，在 MetaMask 核对账户、网络、ETHHTLC 目标后确认。
5. 等 **Alice received ETH** 弹窗，内容应说明 Alice 收到 `0.001 ETH`、秘密已公开，以及下一步 Bob 领取 Rain。这就是原日志 `claim-eth confirmed` 的含义。Alice 的 ETH 余额变化约为收到 0.001 ETH 减本次 gas。
6. 保存这笔 **ETH 领取交易哈希**和链接。它不是 ETH 建锁交易哈希，也不是 swap ID。
7. 同一浏览器会自动把它填入下一步的 **Public ETH claim transaction hash**。独立 Bob 浏览器需要粘贴这个哈希，或导入 Alice 此时重新 Export Public Setup 得到的更新文件。

### S6. Bob 从 ETH 事件取得秘密并领取 Rain

1. MetaMask 选择 Bob，网站切到 **Ethereum Sepolia**，进入 **05 Claim Rain**。
2. 核对 **Public ETH claim transaction hash** 是 S5 的领取哈希；同一浏览器已填好就保留，独立浏览器按 S5 第 7 步补齐。
3. 点击 **Read Both Locks**，预期 ETH=Claimed、Rain=Active 且尚未到期。
4. 点击 **Claim Rain from ETH Event**。B 核验 Arbitrum 上成功且已确认的领取事件，提取秘密并检查本轮 hashlock；Bob 不填写秘密、不导入 Alice 私密备份。
5. MetaMask 核对 Bob / Ethereum Sepolia、目标 ERC20HTLC，再确认。
6. 等 **Bob received Rain** 弹窗，保存交易链接。两边更新后应为双方 Claimed，Bob 的 Rain 增加 1。

### S7. Result：完成与下一轮

1. 点击 **Continue: Result** 或 **06 Result**。
2. 应显示 Completed、Rain state=Claimed、ETH state=Claimed，两个 ID 属于本轮。只完成一边不能判为整笔完成。
3. 按 F5，再读两笔锁，已保存的公开约定和终态应恢复；查看历史终态不需要重新导入秘密。
4. 记录本轮全部公开证据。旧交易链接不会组成历史列表，离开前复制保存；MetaMask 活动也可找回自己的交易。
5. 开始下一笔前等读取结束，点击 **Start New Swap**。它会生成新草稿并回到 Prepare；重新填写约定、下载并验证新备份，再导出新公开设置。仍有 Active 锁时按钮应阻止替换。

<a id="refund"></a>
## 4. 退款 R1：Alice 锁 Rain，Bob 不锁 ETH

这是与成功实例分开的新交换。示例输入 Rain=`1`、ETH=`0.001`、Rain duration=`900`、ETH duration=`180`。这组时长满足当前输入边界，Rain 建锁后约等 15 分钟才到期；不是在点 Check Timelock Settings 时开始计时。

1. 按 S7 新建实例，按 S1/S2 填上述参数，生成或使用新草稿、下载/验证备份、导出公开设置。
2. 按 S3 由 Alice 在 Sepolia 锁 1 Rain。确认 Rain=Active、ETH=Not created 后，保持 Bob 未创建 ETH 锁。
3. 点击顶部 **Refunds**。到期前应显示 `Not expired at the last read block`，**Refund Expired Rain** 灰色；ETH 显示无锁、退款按钮也灰色。这就是到期前不可用动作的证据，不需要强行发失败交易。
4. 保持网站和 B 服务运行，等 Rain 的真实链上截止时间。可见页面约每 15 秒更新，也可点击 **Read Both Locks**。显示的剩余秒数是上次读取区块的结果，不是每秒倒计时；改电脑时间不会令锁到期。
5. Rain 到期后切 Bob，确认不能退 Alice 的 Rain；再切回 **Alice / Ethereum Sepolia**，点击 Read Both Locks。
6. 页面应显示 Expired，并允许 **Refund Expired Rain**。点击它，在 MetaMask 确认，等 **Alice's Rain was refunded** 弹窗。
7. 保存退款链接，重新读取。Rain=Refunded、ETH=Not created、已锁 1 Rain 返回 Alice、重复退款禁用；整体应为 Refunded。gas 不退回，allowance 也不会因退款自动恢复。

到期只使退款“可执行”，不会自动把资产转回。若按钮仍灰色，依次检查是否为本轮 ID、Alice、Sepolia、最新链上时间以及当前是否正在刷新。

## 5. 退款 R2：两边锁定，双方都不领取

再使用独立的新 ID 和秘密。示例 Rain=`1`、ETH=`0.001`、Rain duration=`1800`、ETH duration=`600`，给建第二边锁留出操作余量。要在 Rain 剩余时间不足以覆盖 ETH 新期限及 600 秒安全差之前完成建锁；若 B 阻止对锁，就停止并改走 Rain 单边退款。

1. 按 S1–S4 准备并完成两次锁仓。两边均 Active 后，进入 Refunds，不执行 S5/S6。
2. 到期前分别观察两边退款禁用，记录各自链上截止时间。
3. ETH 先到期后选择 **Bob / Arbitrum Sepolia**，Read Both Locks，点击 **Refund Expired ETH**，在 MetaMask 确认。
4. 等 **Bob's ETH was refunded** 弹窗，保存链接，确认 ETH=Refunded。Rain 未到期时仍不能退。
5. Rain 到期后选择 **Alice / Ethereum Sepolia**，Read Both Locks，点击 **Refund Expired Rain** 并确认。
6. 等 **Alice's Rain was refunded** 弹窗，保存链接。两边都为 Refunded，两位原发送人取回各自本金，gas 由各自承担；重复退款应禁用。

PDF 的现场演示要求一个失败/恢复案例，不要求四分钟内从头等待整组期限。当前网页最小安全差为 600 秒，可提前准备独立的已过期实例，再现场演示另一实例的提前退款不可用和已过期实例的真实退款；不要把本地链快进当作测试网时间。

<a id="resume"></a>
## 6. 刷新、换浏览器和断网恢复

| 场景 | 具体操作 | 预期 |
|---|---|---|
| 切页面 | 点击步骤条、Inspect locks、Refunds | 不整页刷新，当前内存中的私密草稿仍在 |
| Active 中途 F5 | 先保存公开文件、私密备份及已提交哈希，再 F5；Read Both Locks | 显示已有锁，不重新创建同一 ID |
| F5 后 Alice 继续领取 | Prepare 导入匹配公开文件，再在黄色区导入匹配私密文件；回 Claim ETH | 只有备份与本轮相符、账户网络及状态正确时才能领取 |
| Bob 独立浏览器 | 用另一已装 MetaMask 的浏览器或独立配置文件；连接 Bob，在 Import Public Setup 导入本轮公开文件 | 可查锁、锁 ETH；S5 后取得公开领取哈希就可从事件领取 Rain，黄色区应仍没有 Alice 私密草稿 |
| 只有旧公开文件 | Bob 在 Claim Rain 输入 Alice 最新 ETH 领取哈希，或导入更新的公开文件 | 两种方式都能补齐公开事件来源 |
| 断网/RPC 故障 | 等连接恢复，确认两个终端运行，点击 Read Both Locks | 重新取得真实状态；读取失败不能沿用旧结果发交易 |
| 已提交但确认失败 | 保留哈希，点交易链接或在 MetaMask 活动查看；恢复网络后重新查锁 | 不把超时当成未发送；已有锁/终态按状态继续，未决时不盲目重发 |

验证 Bob 不依赖私密备份时，要使用隔离的浏览器存储/页面内存；同一浏览器只切换账户，不能单独证明这一点。一个正在进行的实例尽量只保留一个编辑窗口，多标签页显式修改仍会共用当前公开设置。

## 7. 只读查询旧交换

1. 点击 **Inspect locks**。在 **Rain swap ID to look up**、**ETH swap ID to look up** 分别填两个完整 ID，然后点 Read Both Locks。
2. 查询无需切换 MetaMask，也无需提供私密备份。仅查状态可不填 hashlock；参数核验要使用当时完整约定及双方相同的 agreed hashlock。
3. 展开 **Recorded Rain fields**、**Recorded ETH fields and deadline assessment**，看实际链上字段；展开 **Configured networks and contracts** 看部署配置。

已退款的旧 R2 可作为只读例子：

```text
Rain ID: 0x5a39cc3a1ad59cde179de91a42c1253d5a3219513185321910e377452d589481
ETH ID:  0x55baecb9944ee0d0e6e8a264020fcde64824295d73264ba8a21db47db27bd042
```

两边应为 Refunded。这两个 ID 仅用于查历史，不能拿来建立新的锁。只输入查询 ID 时，左侧可能提示准备完整约定；这不表示读取失败。

<a id="checks"></a>
## 8. 异常验收与排查

输入类检查优先在本轮任何资产上链前执行，每次测试后恢复正确值并重新检查、Read Both Locks。禁止通过改约定去掩盖已经上链的字段差异。

| 测试 | 输入什么、按什么 | 预期与恢复 |
|---|---|---|
| 零金额 | Prepare 将 Rain 改为 `0`，Check Swap Terms | 提示数量须大于零；恢复 `1` 并重新检查 |
| 同一参与者 | 将 Bob 地址改成 Alice，Check Swap Terms | 提示双方地址必须不同；恢复 Bob 地址 |
| 非法地址/金额 | Alice 填 `0x123`，或 Rain 填 `abc`；Check Swap Terms | 报格式错误，恢复公开地址/正数 |
| 期限不合理 | Rain/ETH duration=`3600/3600`；Check Timelock Settings | 不足 600 秒差被拒；恢复 `7200/3600` |
| 窗口边界 | duration=`7200/120`；Check Timelock Settings | ETH 时长必须严格大于 120 秒；恢复 `7200/3600` |
| 错文件类型 | 在 Import Public Setup 选择本轮私密文件 | 拒绝，不能把秘密保存为公开设置；重新选本轮公开文件 |
| 错备份 | 保存好真备份后，用一份无秘密的普通 JSON 在黄色区导入 | 显示 Unable to restore；重新选择正确私密备份 |
| 链上字段不符 | 查旧 R2，完整约定先设为其 `1/0.001` 并用 Recorded fields 的 hashlock；再改 Rain 为 `2`、Read Both Locks | 报 amount mismatch；恢复原数量，不能继续正常交换 |
| hashlock 不符 | 历史查询的 Agreed Rain hashlock 填该 Rain swap ID，Read Both Locks | ID 格式虽正确但不同于真实 hashlock，应报不匹配；恢复记录中的 hashlock |
| 错角色/网络 | 本轮允许 Alice Lock Rain 时切 Bob，或切 Arbitrum | Lock Rain 禁用或请求被拒；切回 Alice / Sepolia 再查询 |
| 取消钱包 | 首次 Lock Rain 请求出现时在 MetaMask 点取消 | 显示 rejected，解除忙碌且无新哈希；重新查锁应仍 Not created，再正常重试 |
| 用错 ETH 交易哈希 | S5 后在 Bob Claim Rain 框填本轮 ETH 建锁哈希，点 Claim Rain from ETH Event | B 找不到匹配领取事件，不应弹出新的有效签名请求；恢复 S5 领取哈希 |
| 已完成/重复操作 | S 结束后回 Claim ETH/Claim Rain，R 结束后回 Refunds | 对应动作禁用；不能再次领取或退款 |
| 未结束就新建 | Active 时进入 Result，查看 Start New Swap | 禁用或阻止替换，保留当前实例继续或退款 |
| 前端无钱包 | 在没有可用钱包扩展的浏览器打开页面、Connect Wallet | 给出安装/启用钱包提示；历史 ID 查询仍可由 B 提供 |
| 断开授权 | 先备份并在无待确认交易时，从 MetaMask 本网站连接中断开账户 | 网站账户/余额失效、不可发交易；重新 Connect Wallet 后读取恢复 |
| B 未运行 | 无待确认交易时 Ctrl+C 停 B，再 Read Both Locks | 出现连接/读取错误，交易不可继续；重启 B 后再读 |
| 一直 updating | 等一次读取结束；若多轮都不结束，检查 B 终端/RPC，再手动 Read Both Locks | 查询期间禁用是预期，永久无法结束才排查；不要连续点交易 |
| 旧后端 | health 为旧文本 read-only，缺 deploymentWarnings | Ctrl+C 停旧 B，再从根目录 run server；出现 EADDRINUSE 先核对占用端口的旧服务 |
| 真正版本不匹配 | health 为 read-only 且 issues 非空 | 保存原因给 A/B 核对产物与部署；仅元数据警告应为 ready |
| gas 报错/余额不足 | 检查当前发送人所在网络 ETH；看页面/MetaMask 错误 | 确认是否存在 pending 后再重试；费用低于 base fee 时重新取得报价，不自动重发 |

检查布局时将浏览器窗口收窄，逐一切换 Prepare、锁仓、领取、Result、Inspect、Refunds；主要按钮、身份/网络提示和错误信息都应可读。键盘 Tab 应能移动到按钮，Enter/Space 可操作有焦点的控件。

## 9. 证据怎么记、目前做到哪里

每组实例保存一份公开文件、两个 ID、公开 hashlock、双方地址、金额、真实期限、各次交易哈希及链接、前后状态截图。私密备份保存在个人本机，不放进测试记录、报告或截图。

将实际结果追加到 [TEST_RESULTS.md](TEST_RESULTS.md)：

| 日期/实例 | 操作与预期 | 实际结果 | 交易链接/截图说明 | 结论或未完成项 |
|---|---|---|---|---|
| 待实际执行后填写 | 例如 Alice Lock Rain：Not created → Active | 实测填写 | 仅公开证据 | 通过/失败/待补 |

2026-11-08 更新：新版 health 的 ready/警告分类、经新版 HTTP 读取旧 R2 两边 Refunded，已有用户反馈。本轮新 S 的 **1 Rain / 0.001 ETH** 交换已完成，用户提供两笔领取哈希，且真实 RPC 只读核验两笔成功回执、匹配事件及双方 Claimed 终态，详见 TEST_RESULTS 的“新 HTTP 入口成功交换 S”。下一步先核对 06 Result 及刷新后的同组 ID/终态，再进行新 HTTP 入口的退款和其余异常验收。此前 S/R1/R2 的公网截图属于旧入口，不能直接填作新版全部验收通过。

本地自动检查命令及证据边界见 [Task C 说明](TASK_C.md)。Task E 要求现场真实操作，截图、本地测试和预录视频不能替代现场演示。
