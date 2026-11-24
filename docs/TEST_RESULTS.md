# Verification Records

For operating steps, see [the Task C section of the README](../README.md#task-c-browser-frontend); for the implementation, see [TASK_C.md](TASK_C.md).

## 2026-11-17 (UTC) Challenge Part: Point-Lock Swap

For the protocol, privacy boundary, and failure cases, see [CHALLENGE.md](CHALLENGE.md); the public report is [successful-swap-2026-11-17.json](../deployments/point/successful-swap-2026-11-17.json).

| Action | Transaction | RPC Verification Result |
|---|---|---|
| Alice locks 10 MST | [Ethereum Sepolia](https://sepolia.etherscan.io/tx/0x7cfbc41e9838569284fdb633ff7bd9c8e05c9135e5506a4ba7c30bb75cd82fc5) | Target is the deployed ERC20PointHTLC; lock `0x8605f390451E0554321bD98229e8f1e6ed1a9B06` |
| Bob locks 0.001 ETH | [Arbitrum Sepolia](https://sepolia.arbiscan.io/tx/0x0beaf8aff60012e7608dceb906acc1c183a4709f66561c4696c55fed1e2bc653) | Target is the deployed ETHPointHTLC; lock `0x80f50bB4b8736879aeCB28806a22623EA0a4c3F5`, different from the MST side |
| Alice claims ETH | [Arbitrum Sepolia](https://sepolia.arbiscan.io/tx/0xb248bb665c82121c72371c4fefa3fc5f63454462852f2e80a8bb3a028c2c6e61) | The address derived from the scalar revealed in SwapClaimed equals the ETH-side lock; status Claimed |
| Bob claims MST | [Ethereum Sepolia](https://sepolia.etherscan.io/tx/0xe3da1b554b1af64fca32793f6a432011715c9fe62d4d459426738ff98f763f37) | The scalar revealed in SwapClaimed differs from the ETH side, and the derived address equals the MST-side lock; status Claimed |

- Each transaction waited for two confirmations. The public report contains no claim scalar and no off-chain offer.
- From the deployment blocks of the two point-lock contracts to the latest block at verification time, each chain has exactly one SwapCreated.
- Local verification on the same day: `npm test` 188 passed; `npm run test:point`, `npm run test:cross-chain`, and `npm run test:refund-path` passed. The point-lock integration tests cover a successful swap, three rejected offers (the ETH chain block height unchanged), a refund after the rejections, and deployment record reuse.

## Manual Frontend Acceptance S (Successful Swap) After 2026-11-10

| Action | Transaction Provided by the User | RPC Verification Result |
|---|---|---|
| Alice locks 1 Rain | [Ethereum Sepolia](https://sepolia.etherscan.io/tx/0x19e2ba2ff0bd7cc2de1a29957b7e68f90abc0dd6f3b9b572a3a8abce7245f33b) | receipt.status=1, canonical block, 33 confirmations at lock verification; createERC20Swap, target is the deployed ERC20HTLC; Active at that time |
| Bob locks 0.001 ETH | [Arbitrum Sepolia](https://sepolia.arbiscan.io/tx/0x8904baad8c7a9f9bc925729cf6a8906f29687d94149d884065f8773a85a66f0b) | receipt.status=1, canonical block, 1179 L2 confirmations at lock verification; createETHSwap, target is the deployed ETHHTLC; Active at that time |
| Alice claims ETH | [Arbitrum Sepolia](https://sepolia.arbiscan.io/tx/0x71c9694e7d88e910bef6e346985870c0344fdd6e013f8beda1c931ddcf423516) | receipt.status=1, canonical block, 1742 L2 confirmations at claim verification; the claim method and SwapClaimed event match this run's ETH ID, status Claimed |
| Bob claims Rain | [Ethereum Sepolia](https://sepolia.etherscan.io/tx/0x313bcfcc54bc3c588f71cb417cca43583a1a913d915cfc21665b110fd2a485d7) | Located from this run's public SwapClaimed event; receipt.status=1, canonical block, 33 confirmations at claim verification; the claim method and event match this run's Rain ID, status Claimed |

- Rain swap ID: `0x99d523eb138db7a7f61ab152f287bc49132967b1a17566c6d5afc71217a1a643`.
- ETH swap ID: `0xf7cef6660f2b1ab49797326dfe54d0b8ba58f758cce4de1d9031f781475726bf`.
- Shared hashlock: `0x0978c40e0357b2a21897ab7ff0ec82a679c36ae4c401d53304cde5bd03f445a8`.
- Rain: Alice → Bob, token is the course MST, 1.0 Rain; ETH: Bob → Alice, token field is the zero address, 0.001 ETH.
- Rain deadline `1794287652`, ETH deadline `1794284145`, actual deadline gap 3507 seconds. At read time, 6792 and 3279 seconds remained respectively; the remaining seconds are a snapshot at each read block, not a continuous countdown.
- The target contract, caller, receiver, and event fields of both claims all match; the hash of the secret in the event matches the hashlock above. The record does not store the secret itself. The real successful swap path has passed.

## Successful Swap S via the New HTTP Entry (2026-11-08)

A **1 Rain / 0.001 ETH** swap was completed through the current HTTP/MetaMask entry, and two claim transactions were provided. The earlier read-only RPC verification recorded: both receipts successful, matching contracts and matching SwapClaimed events, secret hashes consistent, and both sides Claimed. This documentation recovery did not access the public network or send any transactions again.

| Asset | Claim Transaction | Verified Result |
|---|---|---|
| ETH / Arbitrum Sepolia, Bob → Alice | [Alice claims ETH](https://sepolia.arbiscan.io/tx/0x779803c9dc9e0c0b3db5242c6a65941659880b85db8f7c19e3cf154ad1b8d6ef) | receipt.status=1, Claimed |
| Rain / Ethereum Sepolia, Alice → Bob | [Bob claims Rain](https://sepolia.etherscan.io/tx/0xb5e11752efda651c8c44d6b48e9e74a991dc168a7699d5c6ce7f31969e485275) | receipt.status=1, Claimed |

- Rain swap ID: `0x1f91e0e9eea9e0602a44c93575d61993b2a7fef3a63b75fe20723613920c7019`.
- ETH swap ID: `0x6275767182f55d7ef4898f8340e6be0d8851637da3bf149ec9f034c98a9b2915`.
- Shared hashlock: `0xec33843d1fdb98924393df237c1368db3199e89d9fb533ea97c643dc1970cc10`.
- Actual deadlines Rain=1794117828, ETH=1794115025, gap 2803 seconds. The record does not store the secret itself.

## Task C Development Verification and Legacy Entry Archive

2026-11-08: 143 unit tests, 33 HTTP integration tests, B's cross-chain/refund-path integration tests, and the frontend build passed.

Previously, the HTTP layer was observed to lack the protocol.lockCall export, and the lock-only entry lacked the stopAfterLocks branch; after restoring the shared entry and B's original stop branch, the related integration tests passed. The development fixtures checked backup, public setup, status display, operation result messages, and stale-after-refresh protection; these checks used wallet/HTTP stand-ins and do not count as MetaMask public-network acceptance.

<details>
<summary>Legacy entry public refund evidence (provided by the user, not acceptance of the new HTTP refund)</summary>

- One-sided Rain refund: [Sepolia transaction](https://sepolia.etherscan.io/tx/0x406c411d5a273f3fadf71fa160fc2efdf4c80f9a562c6501f17239bd019dab39), succeeded and returned 1 MST to Alice.
- Two-sided refund instance Rain ID: `0x5a39cc3a1ad59cde179de91a42c1253d5a3219513185321910e377452d589481`; ETH ID: `0x55baecb9944ee0d0e6e8a264020fcde64824295d73264ba8a21db47db27bd042`.
- Bob's ETH refund: [Arbitrum Sepolia transaction](https://sepolia.arbiscan.io/tx/0xd10269fb81ef88e561715f96c3eee66fa2d2395d7757acf87f47d6e0f9ebcd04). Succeeded and returned 0.001 ETH; afterwards both sides of that instance are Refunded, and Alice's Rain is back to 90. The refund hash for the Rain side was not fabricated in this recovered record.

</details>

<details>
<summary>Original main history: 10-24/25 local verification, 10-25 public-network swap, 11-04 Task A tests</summary>

# Verification Records (2026-10-24 / 2026-10-25)

The table below retains the local verification results; on 2026-10-25 a real testnet deployment and successful swap were also completed, with evidence at the end.

| Command | Result |
|---|---|
| `npm run compile` | Solidity compiled successfully, target EVM is paris |
| `npm test` | 13 passed |
| `npm run abi:export` | Both ABIs exported successfully and match the current build artifacts |
| `npm run test:cross-chain` | End-to-end verification on two independent Hardhat nodes passed |
| `npm run config:check` / `npm run deploy` | Exits with a clear message when local configuration is missing; no public-network transaction submitted |

Unit tests cover: create/claim/refund rules for both asset types, authorization, wrong secret, invalid input, duplicate ID, repeated completion, expiry boundary, lock parameter verification, deadline gap across the two chains, number of confirmations awaited, pending/confirmed records, and event extraction by address/ID.

The two-node integration test covers:

1. Deploy ERC20HTLC and ETHHTLC separately, and verify that repeated calls reuse the confirmed addresses.
2. Use the same deployment to run two successful swaps in a row, each with fresh swap IDs.
3. Each run completes five confirmed transactions: approval, Rain lock, ETH lock, ETH claim, Rain claim.
4. Obtain the secret from the ETH claim event, and check the Rain receiver balance, both Claimed states, and the empty escrow balance.
5. The ETH chain produces only its own lock/claim blocks; a single-chain simulation of cross-chain was not used.
6. The public report does not contain the secret; the private file is stored separately.
7. Inject a wrong Rain amount, and confirm the run aborts before Bob locks ETH, records incomplete, and has no public secret.
8. After advancing local time, use the fixed refund interface to refund the Rain lock of that failure scenario.

The integration test uses random local ports and chain IDs 31337/31338, and the script ends the nodes automatically. Public records and secret test files are saved in a temporary directory, and the test output gives the actual path. The real testnet results follow.

## 2026-10-25 Real Testnet Results

- `npm run config:check`: chain IDs of both chains, Alice/Bob accounts, and funds checks passed.
- `npm run deploy`: ERC20HTLC / ETHHTLC both deployed successfully, waited for two confirmations and verified runtime bytecode.
- `npm run swap:success`: the 100 Rain / 0.001 ETH swap completed, and each transaction waited for two confirmations.
- After completion, both chains were read independently: both swaps have status 2 (Claimed), Alice Rain=0, Bob Rain=100.
- Public deployment and seven-transaction evidence are in `deployments/sepolia.json`, `deployments/arbitrumSepolia.json`, and `deployments/successful-swap-2026-10-25.json`.
- This run did not execute a public-network refund demonstration or browser source verification.

## 2026-11-04 Task A1/A2/A5 Local Tests (Branch `taskA/lock-safety`)

- `npx hardhat test`: 53 passed (13 existing + 40 new in `test/TaskA_LockSafety.js`), Node.js 22.23.4, solc 0.8.20.
- Mutation check: after temporarily deleting the before/after balance check in `createERC20Swap` and the `receiver == msg.sender` validation in `_create`, 3 of the new tests failed (fee-on-transfer token, sender equals receiver for both asset types); the contracts were then restored with git.
- Production contracts were not changed, so no redeployment is needed; no public-network transactions were executed.

</details>
