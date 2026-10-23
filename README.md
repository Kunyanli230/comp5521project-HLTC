# Group 4 HTLC Project

已完成工作的记录：

Task A:

郭盈盈：

李佳阳：

Task：

李昆晏：1. 部署和配置：把两个合约分别部署到两条链上，地址和网络配置整理好。
2. 成功交换脚本：把正常交换的流程跑通，每一步等链上确认，最后打印两条链的交易链接。把函数名、参数和事件定下来，比如锁定、取款、退款各叫什么这些。

李家榕：3. 状态查看脚本：分别读两条链，告诉你每笔锁现在是「进行中 / 可以取 / 已取走 / 已过期 / 可以退款」。
4. 超时退款脚本：交换没完成时，到期后让原主人把钱退回来；没到期不让退，已经取走的也不能再退。

Task C：
周翮霖：

This classroom demo builds on Lab 3 and uses the `MySimpleToken` (MST) contract already deployed on Ethereum Sepolia. Alice and Bob use two Sepolia accounts to exchange MST and native Sepolia ETH through one small HTLC contract. The balances and transactions are real Sepolia state.

This is a single-chain teaching exercise, not a complete cross-chain protocol. The final project can extend the ideas to separate chains, for example MST on Ethereum Sepolia and ETH on Arbitrum Sepolia. No bridge or contract here communicates across chains.

## Swap flow

```text
Alice locks MST for Bob ─┐
                         ├─ same hashlock / secret
Bob locks ETH for Alice ┘

Alice claims ETH and reveals the secret on Sepolia.
Bob uses that secret to claim MST on Sepolia.
```

> **Classroom scope:** this lesson only demonstrates both parties completing the exchange before the timelock expires. Timeout refunds are not covered, and this simplified contract has no refund function. If a lock expires before it is claimed, its assets remain locked in the contract. Use only small testnet amounts and follow the steps carefully.

## Prerequisites

- Node.js LTS and npm.
- Two disposable MetaMask accounts with Sepolia enabled. Alice is configured as signer 0 and Bob as signer 1.
- Sepolia ETH in both accounts for gas; Bob also needs enough Sepolia ETH to lock the demo amount.
- The deployed Lab 3 `MySimpleToken` address and enough MST in Alice's account.
- A Sepolia RPC endpoint, for example from [Infura](https://app.infura.io/key/active-endpoints).
- Never use mainnet accounts or commit private keys. A blockchain transaction and revealed secret are public and irreversible.

## 1. Install and configure

> Windows PowerShell note: if your computer blocks `npx.ps1`, replace `npx` in the commands below with `npx.cmd` (for example, `npx.cmd hardhat compile`).

```bash
npm install
```

Copy `.env.example` to `.env`, then set the RPC URL, both test-account private keys and addresses, and the Lab 3 token address:

```env
SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/YOUR_PROJECT_ID"
ALICE_PRIVATE_KEY="ALICE_TESTNET_PRIVATE_KEY"
BOB_PRIVATE_KEY="BOB_TESTNET_PRIVATE_KEY"
ALICE_ADDRESS="ALICE_METAMASK_ADDRESS"
BOB_ADDRESS="BOB_METAMASK_ADDRESS"
MST_ADDRESS="LAB3_MST_ADDRESS_ON_SEPOLIA"
```

`ETHERSCAN_API_KEY` is optional and only used if you choose to verify the contract source. It is not needed to compile, deploy, or use the demo.

Compile and run local tests:

```bash
npx hardhat compile
npx hardhat test
```

## 2. Deploy the HTLC

Deploy the single `SimpleHTLC` contract to Sepolia using Alice's account:

```bash
npx hardhat run scripts/deploySimpleHTLC.js --network sepolia
```

Copy the printed address into `.env`:

```env
SEPOLIA_SIMPLE_HTLC_ADDRESS="0x..."
```

## 3. Generate a secret and hashlock

```bash
npx hardhat run scripts/generateSecret.js
```

Copy both printed values into `.env`. Keep `SWAP_PREIMAGE` private until Alice claims ETH. Both locks use `SWAP_HASHLOCK`.

```env
SWAP_PREIMAGE="0x..."
SWAP_HASHLOCK="0x..."
```

## 4. Check starting balances

```bash
npx hardhat run scripts/checkBalances.js --network sepolia
```

Record Alice and Bob's MST and ETH balances. Gas fees will also change each sender's ETH balance.

## 5. Lock MST and ETH

Alice approves the HTLC contract to use MST, then locks MST for Bob:

```bash
npx hardhat run scripts/lockMST.js --network sepolia
```

Copy `MST_SWAP_ID` from the output into `.env`.

Bob locks native ETH for Alice:

```bash
npx hardhat run scripts/lockETH.js --network sepolia
```

Copy `ETH_SWAP_ID` from the output into `.env`. Both commands create a separate on-chain lock with the same hashlock.

Inspect the lock records and current balances:

```bash
npx hardhat run scripts/checkSwap.js --network sepolia
npx hardhat run scripts/checkBalances.js --network sepolia
```

The locked assets are held by `SimpleHTLC`; balances in Alice's and Bob's wallets have decreased.

## 6. Claim the assets

Alice claims Bob's locked ETH using the secret. This transaction reveals the preimage publicly:

```bash
npx hardhat run scripts/claimETH.js --network sepolia
```

Bob then uses the same preimage to claim Alice's MST:

```bash
npx hardhat run scripts/claimMST.js --network sepolia
```

Check the final swap status and wallet balances:

```bash
npx hardhat run scripts/checkSwap.js --network sepolia
npx hardhat run scripts/checkBalances.js --network sepolia
```

Alice should have received ETH and Bob should have received MST. Compare with the starting balances; account for gas costs on ETH balances.

## Project files

- `contracts/SimpleHTLC.sol`: one minimal classroom contract that escrows either ERC20 MST or native ETH and checks the hashlock and timelock on claim.
- `scripts/deploySimpleHTLC.js`: deploys the contract on Sepolia.
- `scripts/generateSecret.js`: generates a random preimage and its hashlock locally.
- `scripts/lockMST.js` and `scripts/lockETH.js`: approve and lock the two assets.
- `scripts/claimETH.js` and `scripts/claimMST.js`: claim each asset with the preimage.
- `scripts/checkSwap.js` and `scripts/checkBalances.js`: inspect on-chain swap states and wallet balances.
- `test/SimpleHTLC.js`: local test for the two asset paths and shared-secret claim flow.
- `contracts/TestToken.sol`: local test token only; the Sepolia demo uses the Lab 3 MST deployment.
