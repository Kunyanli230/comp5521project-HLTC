# Task C Notes: Implementation, A/B Integration, and Requirement Mapping

- This file: task responsibilities, the current implementation, and its connections to and limits with A/B.

## 1. What Is Implemented

Alice locks Rain (on-chain symbol MST) for Bob on Ethereum Sepolia, and Bob locks native ETH for Alice on Arbitrum Sepolia. Each of the two contracts holds its own asset, and an off-chain program coordinates the actions on both sides; the contracts do not communicate directly.

Alice generates a random 32-byte secret `preimage`, and both sides use the same `hashlock = keccak256(preimage)`. Alice reveals the secret when she claims ETH, and Bob takes it from the confirmed ETH claim event and claims Rain. The Rain deadline is later, which gives Bob a window to claim afterwards; an Active lock that has not been claimed is refunded manually by the original sender after expiry. The secret does not replace identity authorization: the contracts still restrict claiming to the receiver and refunding to the sender.

Task C provides an English browser interface for this process: connecting a wallet, filling in the agreement, backup, approval, confirming each transaction, state guidance, inspection, and refunds. The technology is plain HTML/CSS/JavaScript, ethers v6, and Vite.

## 2. How the Requirements Map

| Requirement | Current feature and implementation location | Manual acceptance entry point |
|---|---|---|
| C1 Wallet and network, 2 marks | `main.js` connects MetaMask, listens for account/network events, shows the address and chain ID, and provides switching between the two testnets | Flow section 2 |
| C2 Setup and status, 2 marks | Wallet ETH, Rain, and allowance; agreed amounts/durations; generates hashlock/two IDs; shows deployment and lock details; unified approval entry point | Prepare, Lock Rain, Inspect locks |
| C3 Guidance and recovery, 4 marks | Six-step view; B returns the stage, and C combines role, network, and backup to control the buttons; Bob verifies before locking, Alice claims ETH, Bob claims Rain via the event; the original sender refunds after expiry | Flow sections 3-6 |
| C4 Feedback and usability, 2 marks | Distinguishes requesting the wallet, submitting, waiting for two confirmations, and verification complete; after each transaction a dialog explains the role, amount, result, and next step, and provides the transaction link; cancellations and unverified results are shown separately, with explicit Completed/Refunded | Each action and exception acceptance |
| No built-in private keys | The frontend uses MetaMask; it does not import `.env` or create a private-key Wallet; public files and browser storage do not save the preimage | Source code, public export, and storage inspection |
| E Live demo | One real successful swap, plus one lock that is unavailable before expiry and really refunded after expiry; an independently pre-prepared instance may be used | Flow sections 3-5 |
| Submission and contribution | Runtime dependencies, configuration template, addresses, workflow, and explainable functions; contribution is evidenced by actual code/commits/tests | Root README, interface, and verification records |

HTTP is the entry point this project chose in order to reuse B; the refresh period and safety margins are current implementation policies.

## 3. How A, B, and C Are Connected

| Part | Responsibility | Current files |
|---|---|---|
| A | On-chain custody, legitimate lock creation, identity/secret/deadline checks, payment, states and events | `contracts/HTLCBase.sol`, `ERC20HTLC.sol`, `ETHHTLC.sol` |
| B | Deployment/configuration, successful swap, two-chain status, event recovery, refunds, confirmation and deadline rules | `scripts/lib/protocol.js`, `recovery.js`, `runtime.js`, and the CLI entry points |
| C | English pages, forms, wallet balances, backup/public files, HTTP client, MetaMask requests, display and navigation | `frontend/` |

```text
C form/button ── HTTP ──> B reads both chains, verifies, estimates fees, and prepares an unsigned transaction
C <─────────────────── B returns the transaction parameters
C ──> MetaMask ──> the user confirms, the wallet signs and broadcasts ──> the corresponding A contract on that chain
C ── transaction hash ──> B waits for confirmation, verifies the event and state ──> C updates the result
```

The local B service is a resident program started by `node scripts/serveFrontend.mjs`, listening on `127.0.0.1:3001`; Vite usually serves the page at `localhost:5173` and proxies same-origin `/api` to B. It provides off-chain coordination; it does not hold assets, does not create private-key wallets for Alice/Bob, and does not sign on behalf of the user. The original B CLI entry points remain usable independently, and their local private-key signing differs from the HTTP path's MetaMask signing.

### Where the ABI and Addresses Appear

The ABI is the interface description JavaScript needs to encode contract calls and decode events/results; it is not another contract. The address determines which deployed contract is actually accessed.

- A's shared ABI: `config/abi/ERC20HTLC.json`, `config/abi/ETHHTLC.json`.
- B's public deployment records: `deployments/sepolia.json`, `deployments/arbitrumSepolia.json`.
- `frontend/main.js` imports these files directly, for use by the page and for target/ABI checks before signing; the frontend does not maintain a separate copy of addresses or ABIs.
- `webCoordinator.configuredCoordinator()` also creates the two read-only RPC connections and contract objects from the same records, and checks the actual chain ID and deployed code.
- After A changes a function interface, compile and export the shared ABI; when an implementation changes, A/B check the deployed version and records before integration testing. Merely modifying JS documentation or metadata differences does not automatically require redeployment.

| Setting | Current public value |
|---|---|
| Ethereum Sepolia chain ID | `11155111` |
| Arbitrum Sepolia chain ID | `421614` |
| Rain / MST, 18 decimals | `0xf49d4F8A697C09D4daf942938A2C4cb5593164dC` |
| ERC20HTLC / Ethereum Sepolia | `0x98eFb0B12BA43d5efc3723fFf839Fee29B8f72A3` |
| ETHHTLC / Arbitrum Sepolia | `0x6c4826b0D6Ad8aB8dBbeD368f45E963306626aA2` |

The current values are listed here for ease of explanation; at runtime the deployment files remain authoritative, and if the deployment changes these notes should be updated in step. Full parameter signatures, events, state values, and time boundaries are collected in [INTERFACE.md](INTERFACE.md).

### Actual Scope of Reuse and Modification of B

| B function | Use in HTTP |
|---|---|
| `readSide` / `classify` | Reads the lock and time of one chain at the same block, and classifies claimable, refundable, and terminal states |
| `verifyLock` | Verifies the fields and Active state of the counterparty's real lock |
| `assertTimelocks` | Actual deadline gap, remaining-time gap, and claim window |
| `verifyCreated` | Creation event fields match expectations |
| `confirmed` / `eventFrom` | Waits for confirmation, and uniquely verifies logs by contract address, event, and swap ID |
| `readConfirmedClaim` | Shared by CLI/HTTP: verification of the ETH claim receipt, canonical-chain block, confirmation count, and secret event |
| `prepareRefund` | Shared by CLI/HTTP: pre-refund checks |
| `assertChain` / `assertCode` | Network and deployed-version checks |

The integration modified B's original files: `protocol.js` exports `verifyCreated` and hands the original successful flow's secret observation to the shared `readConfirmedClaim`; `recovery.js` extracts `prepareRefund` and adds shared event reading; `runtime.js` later fixed the classification of metadata differences. The other newly added web step plan and fee adapters are explicitly placed in `webCoordinator.mjs` / `webProtocol.mjs`.

`runSuccessfulSwap()`, which would operate the private-key accounts of both parties in sequence, was not directly wrapped into an automatic swap button. C calls B's step-by-step entry points, and the user authorizes each transaction; the old approach of extracting B's source with Vite is also no longer used.

## 4. What Each Frontend File Does

| File | Responsibility |
|---|---|
| [index.html](../frontend/index.html) | Six swap steps, separate inspect/refund views, labels and status area; shows the current task at any one time |
| [style.css](../frontend/style.css) | PPT-style light gray-green, navy blue, teal, and a few gold hints, narrow-screen layout and focus visibility |
| [main.js](../frontend/main.js) | Wallet and balances, form preview, generating the random secret/IDs, private backup verification, on-chain report display; hands actions to workflow |
| [workflow.js](../frontend/lib/workflow.js) | Current public setup, requests to B, refresh and invalidation control, pending hash, MetaMask signing and confirmation feedback |
| [chainActions.js](../frontend/lib/chainActions.js) | HTTP requests, timeout/error messages, restoring ABI integer fields to BigInt; does not implement lock coordination itself |
| [guide.js](../frontend/lib/guide.js) | Routing, step navigation, role/network hints, B's recommended stage, and button text; does not send transactions |
| [swapProtocol.js](../frontend/lib/swapProtocol.js) | Forwarding of a few shared input utilities and reading B's classification results; contains no simulated chain or independent protocol state machine |
| [swapInputs.mjs](../shared/swapInputs.mjs) | Public-field allowlist shared by B/C, address/amount/ID/duration format validation, and error masking |
| [vite.config.js](../frontend/vite.config.js) | Local development and the `/api` proxy; does not read or execute B's source |

The workflow is a separate file so that page state and wallet operations are managed in one place; guide handles page navigation and chainActions handles request transport. The purpose is readable responsibilities, not that B has been implemented a second time.

## 5. What Actually Happens on One Button Click

Take Bob's Lock ETH as an example:

1. C reads this round's public setup and the current account, and calls `POST /api/prepare`.
2. B checks the fixed network/deployment, the inputs, and Bob's identity, reads both chains, checks the Rain participants, token, amount, hashlock, Active state, and deadline, and confirms the ETH ID has not been used.
3. B computes the ETH deadline using the actual block time, estimates gas/fees and checks that the balance covers the principal plus the budget, and returns an unsigned transaction.
4. C checks the response's action, asset, swap ID, target, sender, chain ID, value, and the calldata encoded with the shared ABI; it re-checks that the wallet and agreement have not changed before requesting MetaMask.
5. After the user confirms, C obtains the hash, saves the public pending information, and calls `POST /api/confirm`.
6. B checks the transaction target/sender/call/receipt, waits for two confirmations, and verifies the creation event and on-chain fields; C shows the result and reads again.

The other six actions go through the same wallet entry point: `approve-rain`, `lock-rain`, `claim-eth`, `claim-rain`, `refund-rain`, `refund-eth`. Each action still has its own role, secret, state, and deadline rules.

| HTTP request | Input | Output |
|---|---|---|
| `GET /api/health` | None | ready/read-only, deploymentIssues, deploymentWarnings |
| `POST /api/snapshot` | lookup: the two IDs; optional setup: the complete public agreement | Records of both chains, snapshot block/time, deadline assessment; with a complete setup, gives the recommended stage |
| `POST /api/prepare` | action, setup, actor; approval adds approvalAmount, Alice's claim adds preimage | Unsigned transaction, parameters, and fee budget |
| `POST /api/confirm` | action, setup, hash | Confirmed and verified result |
| `POST /api/transaction-status` | asset, hash | Receipt status on the specified chain, used for pending protection |

On-chain integers are transmitted in JSON as decimal strings. B accepts only fixed business actions, and does not accept arbitrary RPC URLs, ABIs, methods, or contract targets; the server is restricted to the local machine, checks request size and origin, and does not log secret request bodies. C checks transaction requests using the shared ABI and deployed addresses, and a success reported by the web page itself cannot replace B reading the chain.

## 6. Files, Secrets, and Recovery

| Data | Where it lives | Purpose |
|---|---|---|
| Wallet private key | The user's MetaMask; the CLI's original configuration is different | User signing; not written into frontend source or the public setup |
| Private backup htlc-private | A local file downloaded by Alice; when in use, only in page memory | preimage, hashlock, the two IDs; does not include the complete amount/duration agreement |
| Public setup htlc-public | JSON that both parties can share | Addresses, amounts, durations, the two IDs, hashlock, deployment, and an optional ETH claim hash |
| Current public setup | `htlc.public.setup.v1` in localStorage | Restores the current instance after a page refresh; no swap list |
| One piece of public pending information | `htlc.public.pending.v1` | Action, network, target, swap ID, transaction hash; does not store the secret |
| Complete manual evidence | `TEST_RESULTS.md` | Scenarios executed and public links; does not store the private backup |

A refresh destroys the secret in page memory, so Alice must re-select the matching private file; Bob can continue with just the public setup and the confirmed ETH claim hash. An existing, different private draft cannot be casually overwritten, and the instance should not be switched while it is Active.

The secret is not always only in the browser: when Alice claims, C temporarily hands the preimage to the local B for validation, encoding, and fee estimation, and the fee-estimation RPC also receives the call parameters. The service does not persist it to files or request logs. After the claim transaction is broadcast the secret is public, and Bob's path has B obtain it from the confirmed event, without reading Alice's local backup.


## 7. Refresh, Fee Estimation, Deadlines, and Deployment Checks

### Refresh Is Not a Per-Second Push

When the page is visible and there is no wallet operation, it polls about every 15 seconds; it queries about 500 milliseconds after input stops; it queries again after a transaction ends; Read Both Locks can manually trigger the same path. A read-only refresh does not write back to the current public setup, to avoid an old tab's polling overwriting the new instance of another page.

During a read, the last successful display is kept and the transaction buttons are paused; a failed, input-changed, or stale request cannot put an old result back. The EXCHANGE OVERVIEW sidebar has been removed; the manual refresh is next to CURRENT ON-CHAIN STATE, and the next-step button at the bottom of the page follows the on-chain snapshot. Progress and a link are shown next to each transaction button, and after a refresh a transaction awaiting verification expands Most recent transaction. Ordinary compile-metadata warnings are placed in Configured networks and contracts under Inspect locks; deployment problems that truly block transactions and the reasons a flow is blocked are still shown above the current step. The page the user selected is kept separate from the recommended step. Remaining time is based on each chain's block time and shows the value as of the last read; it is not a per-second local countdown, nor an atomic read of both chains at the same moment. The auto-refresh and the sense-of-immediacy frequency are engineering choices, not fixed requirements of the PDF.

### Fee Estimation and Deadlines

B `estimate()` calls the RPC `estimateGas`, adds a margin of about 20% on gas usage, reads the current EIP-1559 fee fields or gasPrice, and checks that the sender's ETH covers the principal plus the budget. The result does not equal the actual fee and does not guarantee that later quotes will stay unchanged; it does not broadcast a transaction. Local automated tests, RPC fee estimation, and real MetaMask public-network acceptance are different levels.

The current web policy is Rain/ETH defaults of 7200/3600 seconds, a minimum gap of 600 seconds, a minimum claim window of 120 seconds, and two confirmations. The planned ETH duration must be strictly greater than 120, and creating a lock and claiming must also satisfy the actual windows on both chains. The B CLI's environment overrides do not automatically change the web policy; do not change only the browser input validation or only one end of `.env`. Arbitrum's L2 confirmation is not equal to L1 final settlement.

### Deployment Metadata Differences

`runtime.assertCode` is used by both the CLI and HTTP:

| Check | Behavior |
|---|---|
| Complete runtime bytecode identical | Pass |
| After complete decoding the executable part is identical, only the recognized metadata hash differs, and the compiler and non-hash markers match | Pass with a warning; legitimate actions are not closed |
| Executable part/required markers differ, or the difference cannot be reliably parsed | HTTP keeps historical reads and blocks transaction preparation, Deployment review required |
| RPC/chain ID/no contract at the address/missing compile artifact | Startup fails and the specific reason is reported |

Parsing relies on the two-byte length at the end, fully decodes with the direct dependency `cbor@8.1.0`, and checks the delimiter, hash format, and release-build compiler markers; it rejects duplicate keys, trailing data, and unknown formats. It is not a fixed truncation of trailing characters. A matching executable part does not prove that the source and the complete compile settings are identical item by item. The rules refer to the [official Solidity metadata documentation](https://docs.soliditylang.org/en/latest/metadata.html#encoding-of-the-metadata-hash-in-the-bytecode).

## 8. Verification Status and Current Limitations

```powershell
# Repository root
npm test
npm run test:web
# Frontend directory
cd frontend
npm run build
```
B's original success/recovery entry points still use `npm run test:cross-chain` and `npm run test:refund-path` for integration regression; these were run when HTTP was integrated, and the results of this round after the metadata fix are as given by the tests above and the HTTP checks, without conflating execution dates or scope.

| Scenario | Existing evidence | Status of the new HTTP entry point |
|---|---|---|
| Old S: 10 Rain / 0.001 ETH, both sides Claimed | Old page, the user's MetaMask/Etherscan screenshots, and some claim links | Not automatically counted as the new version's complete successful swap passing |
| Old R1: refund after locking Rain only | Real refund link and terminal state/balance/disabled screenshots | Pending new-version transaction regression |
| Old R2: both sides locked, then each refunded | Real ETH refund link, screenshots of both sides Refunded | New-version historical read passed, transaction regression still pending |
| New health / old R2 query | The user's ready JSON and screenshots of both sides Refunded | Feedback reported passed |
| New-version new S: 1 Rain / 0.001 ETH | This round's backup/public import and before/after claim screenshots, two claim hashes; real RPC verification of successful receipts, events, and both sides Claimed | The actual swap terminal state has passed; the result page, refresh-recovery feedback, and lock-creation links are still to be completed |
| Continuing after an Active refresh, real claim in an isolated Bob browser, recovery from an interrupted confirmation | Some old evidence or development checks | Manual acceptance still needed |

The HTTP version needs B and C running at the same time; a built dist also needs the B service and the same-origin `/api` proxy. The current B is a local-machine service only and cannot be treated as a deployed remote multi-user service. Currently only one public setup and at most one pending hash are stored, with no multi-swap list or transaction history. The frontend does not integrate the bonus question's point-lock swap (CLI only, see [CHALLENGE.md](CHALLENGE.md)); the basic protocol the web app follows, with the same hashlock/public secret, fits the idea of the basic question and does not have the challenge question's linkage privacy.

For startup steps see the [repository README](../README.md); carry out the manual operations following the web step navigation, and append the results to [TEST_RESULTS.md](TEST_RESULTS.md). The PDF's four-minute live demo must still be performed for real, and is not replaced by documents, screenshots, or build results.
