# Group 4 HTLC Project

**Task A:**

- **Jiayang Li:**
  - **A1 (ERC20 lock, 5 marks):** Implement MST locking in `ERC20HTLC`: create a unique swap, transfer MST from the sender after allowance, record sender, receiver, token, amount, hashlock, timelock, and status, and emit a creation event. Reject invalid or duplicate swaps.
  - **A2 (ETH lock, 5 marks):** Implement native-ETH locking in `ETHHTLC`: create a unique swap using `msg.value`, record the equivalent protocol fields, and emit a creation event. Reject zero-value or invalid swaps.
  - **A5 (Validation and safety, 3 marks):** Validate addresses, amounts, deadlines, and swap identifiers; maintain clear swap states and events/errors; perform external token or ETH transfers safely and protect against reentrancy or equivalent hazards.
- **Yingying Guo:**
  - **A3 (Hashlock claim, 6 marks):** Implement `claim()`: allow only the designated receiver to claim an active swap before expiry with a preimage satisfying `keccak256(preimage) == hashlock`. Transfer the locked asset, prevent repeated completion, and emit an event exposing the revealed preimage.
  - **A4 (Timelock refund, 6 marks):** Implement `refund()`: after expiry, allow only the original sender to recover an unclaimed swap. Reject early refunds, claims after expiry, repeated claims, repeated refunds, and refund-after-claim attempts.

**Task B:**

- **Kunyan Li:**
  1. Deployment and configuration: deploy both contracts to the two chains and organize the contract addresses and network configuration.
  2. Successful swap script: run the normal swap flow end-to-end, wait for on-chain confirmations at every step, print transaction explorer links for both chains, and define the shared function names, parameters, and events for lock, claim, and refund.
- **Jiarong Li:**
  3. Status observation script: read both chains independently and report whether each lock is active/claimable, closing, claimed, expired, or refundable.
  4. Timeout refund script: allow the original sender to recover funds after expiry when a swap fails to complete, while rejecting early refunds and refunds of already-claimed swaps.
  5. Challenge part: point-lock contracts, off-chain protocol, and deployment/swap scripts completing a cross-chain swap with a distinct lock on each testnet; see [docs/CHALLENGE.md](docs/CHALLENGE.md).

**Task C:**

- **Helin Zhou:** Browser interface, MetaMask integration, step-by-step swap guidance, public setup and private backup management, status inspection, and timeout refunds; reuses Task B protocol and recovery functions via a localhost HTTP adapter, connects to Task A's deployed contracts, and performs manual acceptance testing.

## Rain / ETH Cross-Chain Swap (B1, B2)

The current entry points use Rain ERC20 on Ethereum Sepolia and native ETH on Arbitrum Sepolia. Both contracts are deployed independently, share a `keccak256` hashlock, and are coordinated by off-chain scripts. Token-related settings use the `Rain` naming consistently; `RAIN_ADDRESS` points to the course ERC20 contract address to use and does not change the token's on-chain symbol.

### Current Status and Configuration

- Implemented: `ERC20HTLC` / `ETHHTLC` integration baseline, network configuration, deployment records, successful swap script, ABIs, interface specification, and local tests.
- Verified: contract compilation, contract-rule unit tests, and repeated successful swaps on two independent local nodes.
- Executed real testnet deployment and completed a 100 Rain / 0.001 ETH swap on 2026-10-25; both contracts are deployed and both swaps have status `Claimed`. Deployment records are in `deployments/`.
- The B1/B2 milestone above did not include the frontend or B3/B4. B3 status inspection, B4 manually triggered refunds, and the Task C browser workflow have since been integrated (see sections below); expiry alone never triggers an automatic refund.

### Installation and Local Verification

Node.js 22 LTS is recommended. On Windows, if PowerShell blocks `npm`/`npx` scripts, use `npm.cmd` / `npx.cmd`.

Running the current Vite frontend requires Node.js `^20.19.0 || >=22.12.0`.

```powershell
npm ci
npm run compile
npm test
npm run test:cross-chain
npm run abi:export
```

`test:cross-chain` automatically starts and stops two independent local nodes (chain IDs `31337` and `31338`, random local ports), sends real RPC transactions, and checks balances, swap states, secret events, deployment reuse, and repeated swaps. Test evidence is written to the system temp directory and does not generate fake public explorer links.

## B1: Configuration and Deployment

Configure only in your local `.env`:

| Setting | Description |
|---|---|
| `SEPOLIA_RPC_URL` | Ethereum Sepolia RPC, chain ID 11155111 |
| `ARBITRUM_SEPOLIA_RPC_URL` | Arbitrum Sepolia RPC, chain ID 421614 |
| `ALICE_PRIVATE_KEY` / `BOB_PRIVATE_KEY` | `0x`-prefixed private keys for two distinct test accounts |
| `ALICE_ADDRESS` / `BOB_ADDRESS` | Optional; if set, must match the corresponding private key |
| `RAIN_ADDRESS` | Existing Rain ERC20 address on Ethereum Sepolia |
| `RAIN_AMOUNT` / `ETH_AMOUNT` | Human-readable amounts, defaults `100` / `0.001` |

Both Alice and Bob need test ETH on both chains for gas. Alice also needs sufficient Rain, and Bob's Arbitrum balance must cover the locked ETH plus gas. By default, Alice deploys the contracts on both chains.

```powershell
npm run config:check
npm run deploy
```

The deployment script creates both RPC connections itself, so `--network` is not needed. It waits for the configured confirmation count on each transaction, verifies runtime bytecode, and writes:

- `deployments/sepolia.json`: `ERC20HTLC` address, Rain address, Alice/Bob public addresses, deployment transaction, and explorer link.
- `deployments/arbitrumSepolia.json`: `ETHHTLC` address, participant accounts, deployment transaction, and explorer link.

Scripts read these records automatically. You can also set `SEPOLIA_ERC20_HTLC_ADDRESS` and `ARBITRUM_SEPOLIA_ETH_HTLC_ADDRESS` in `.env`; swap scripts prioritize and verify those addresses when present. Confirmed deployments are reused; on partial deployment failure, submitted transaction records are kept without falsely reporting both chains as finished. Unconfirmed records must be verified manually before continuing deployment.

Network metadata is in `config/networks.js`; notes on public deployment records are in [deployments/README.md](deployments/README.md). Arbitrum RPC and chain ID were verified against the [official documentation](https://docs.arbitrum.io/chain-info).

## B2: Complete Successful Swap

```powershell
npm run swap:success
```

One run completes the following steps:

1. Validates both chain IDs, contract bytecode, accounts, Rain decimals, and both parties' balances.
2. Randomly generates a 32-byte secret, shared hashlock, and two distinct swap IDs, saving the secret privately.
3. Alice approves Rain (waiting for confirmation) and locks Rain for Bob on Sepolia (waiting for confirmation).
4. Bob reads and verifies the Rain lock's participants, token, amount, hashlock, deadline, and `Active` status.
5. Bob locks ETH for Alice on Arbitrum Sepolia (waiting for confirmation); Alice then verifies both locks and timelock ordering.
6. Alice claims ETH (waiting for confirmation). Bob reads the secret from the confirmed `SwapClaimed` event on Arbitrum Sepolia.
7. Bob claims Rain using the secret from the event (waiting for confirmation); checks that both chains are `Claimed` and prints explorer links for every step.

Defaults: Rain lock 7200s, ETH lock 3600s, minimum deadline gap 600s, and at least 120s remaining before claiming. Timestamps come from each chain's blocks rather than the local clock. `SEPOLIA_CONFIRMATIONS` / `ARBITRUM_SEPOLIA_CONFIRMATIONS` both default to `2`, and `TX_TIMEOUT_MS` defaults to `300000`. The confirmation strategy is intended for course demonstration and is not equivalent to cross-chain or L1 finality guarantees.

### Verified Testnet Deployment and Successful Swap (2026-10-25)

| Item | Network | Address |
|---|---|---|
| Rain (on-chain symbol MST, 18 decimals) | Ethereum Sepolia | `0xf49d4F8A697C09D4daf942938A2C4cb5593164dC` |
| ERC20HTLC | Ethereum Sepolia | `0x98eFb0B12BA43d5efc3723fFf839Fee29B8f72A3` |
| ETHHTLC | Arbitrum Sepolia | `0x6c4826b0D6Ad8aB8dBbeD368f45E963306626aA2` |

| Action | Confirmed Public Transaction |
|---|---|
| Deploy ERC20HTLC | [Sepolia tx](https://sepolia.etherscan.io/tx/0x9b9cfe42d658a1a993058d20ed12b277bc01950d099a2b9e05be8fa686bea8bd) |
| Deploy ETHHTLC | [Arbitrum Sepolia tx](https://sepolia.arbiscan.io/tx/0x1242d34a10356381bba907a31409300f68d64ae189d82b356413bc45c9198b58) |
| Approve Rain | [Sepolia tx](https://sepolia.etherscan.io/tx/0xde136aa7582cf4fde1f8494c034ee8853d778e95d73e0a678804186d8f01bbfc) |
| Lock 100 Rain | [Sepolia tx](https://sepolia.etherscan.io/tx/0x8ef9e2345035526a3e78086c16d55300a08952866c04f8403d6eec5fb022e165) |
| Lock 0.001 ETH | [Arbitrum Sepolia tx](https://sepolia.arbiscan.io/tx/0x886f7a8e50370a4f94bacf38256528a17f91585b4cbc4cb3ea182de9d30ee7b1) |
| Alice claims ETH | [Arbitrum Sepolia tx](https://sepolia.arbiscan.io/tx/0xe6110e61d5acc2d17aae909840ff1afd043e5e1bc88d31bd68f9c6cf4a8cfcb1) |
| Bob claims Rain | [Sepolia tx](https://sepolia.etherscan.io/tx/0xed0d9ac507c3c58633d843cacdfcc67e1f11ae12b9fc0b4a59281960af596110) |

Each transaction waited for 2 confirmations. Complete public evidence is saved in `deployments/successful-swap-2026-10-25.json`. Alice's 100 Rain were transferred to Bob; before re-running the default swap, replenish Alice's Rain and check gas balances on both chains.

Public run records live in `runs/<runId>.json` and contain contracts, swap IDs, hashlock, amounts, deadlines, transaction hashes/links/confirmation status, and final status. Secret files are stored in `.local/secrets/<runId>.json` and ignored by Git. On Windows, file permissions depend on account ACLs, so keep them in a private user directory.

If a run fails partway through, the script exits and marks the run as `incomplete`. Inspect pending/confirmed transactions in the run record and on-chain states first; a timeout does not mean the transaction was never mined. Keep the secret and continue claiming via the fixed interface based on on-chain status, or have the original sender call `refund(swapId)` after expiry. There is no automatic resume/continuation feature; re-running creates a fresh pair of swap IDs.

## Challenge Part: Point-Lock Swap

On 2026-11-17 (UTC), Alice and Bob completed a testnet swap of 10 MST and 0.001 ETH using two distinct point locks. Before re-running, confirm Alice's MST balance covers `RAIN_AMOUNT` (set to `10` for that run). [Protocol, privacy boundary, and failure cases](docs/CHALLENGE.md) · [Public swap report](deployments/point/successful-swap-2026-11-17.json)

| Network | Point-Lock Contract |
|---|---|
| Ethereum Sepolia | ERC20PointHTLC · [`0xB54568981Da8FEAa6bE483e8ED2597876178c4Dd`](https://sepolia.etherscan.io/address/0xB54568981Da8FEAa6bE483e8ED2597876178c4Dd) |
| Arbitrum Sepolia | ETHPointHTLC · [`0x5fda2400Adfde8F03AfA07E341D9482Dc859cd2C`](https://sepolia.arbiscan.io/address/0x5fda2400Adfde8F03AfA07E341D9482Dc859cd2C) |

| Command | Purpose |
|---|---|
| `npm run test:point` | Verify swaps, rejections, refunds, and deployment-record reuse on two local chains. |
| `npm run deploy:point` | Deploy or reuse point-lock contracts on both configured testnets, writing records to `deployments/point/`. |
| `npm run swap:point` | Bind to the deployed contracts above and execute a new point-lock swap. |

## B3 / B4: Status Inspection, Timeout Refund, and Demo Preparation

For first-time setup, run `npm ci` and `npm run compile`. Status and refund entry points use `node`, with arguments passed via `npm run ... --`. Run the commands below from the repository root, replacing `<runId>` with a run record ID or JSON file path.

```sh
npm run status -- <runId>
npm run status -- <runId> --json
npm run refund -- <runId> eth
npm run refund -- <runId> rain
npm run refund -- <runId> auto
```

`status` reads both chains independently, pinning each chain's swap state and timestamp to one latest block. It outputs states, sender/receiver addresses, amounts, deadlines, remaining seconds, and currently permitted contract actions. Claiming still requires the valid secret. It verifies public secrets exclusively from Arbitrum `SwapClaimed` events, never reading `.local/secrets/`, sending transactions, or modifying run records. `--json` outputs JSON consumable by Task C; when piping directly to a JSON parser, invoke `node scripts/status.js <runId> --json` to avoid npm banner output.

| State | Permitted Contract Action |
|---|---|
| `NOT_FOUND` | None |
| `CLAIMABLE` | Receiver claims with the valid secret before expiry |
| `CLOSING` | Same as above, with remaining time less than `MIN_CLAIM_WINDOW_SECONDS` |
| `REFUNDABLE` | Sender refunds; enters this state when `block.timestamp == timelock` |
| `CLAIMED` / `REFUNDED` | None; no further claim or refund action is offered |

In status JSON, `preimage` comes from the verified Arbitrum claim event and is `null` if not yet found. Terminal output displays the preimage, computed hash, run record hashlock, and comparison result when verified. If Rain is already refundable while ETH is still claimable, B3 warns Bob about the double-loss risk.

If ETH is claimed while Rain is still claimable, advice reminds Bob to claim Rain before its deadline using the event preimage (explicitly noting this requirement when the preimage is not yet verified); if Rain has expired, it warns Bob that the claim window was missed.

`refund` defaults to `auto`, inspecting Rain and ETH independently and submitting refunds only for expired `Active` locks. Signers are matched to Alice/Bob by on-chain `sender`. Before broadcasting, it executes `refund.staticCall`, and after confirmation verifies the `SwapRefunded` event and `Refunded` status. Early, claimed, refunded, or non-existent locks submit no transactions. In `auto` mode, one side's refusal still checks the other side.

- Exit code `0`: all requested refunds succeeded; `2`: at least one side was properly refused (another side may have succeeded); `1`: configuration, RPC, or transaction error.
- The run record must match both chains' current deployment addresses, chain IDs, and networks.
- Refunds update `runs/<runId>.json` keyed by transaction hash and chain ID, setting `recovery.rain/eth = "Refunded"` after confirmation. Committed samples in `deployments/` always remain read-only.

Prepare a fresh "lock both sides without claiming" instance:

```sh
npm run lock:only
# macOS / Linux: shorten timelocks for a refund demo
ETH_TIMELOCK_SECONDS=240 RAIN_TIMELOCK_SECONDS=480 MIN_TIMELOCK_GAP_SECONDS=120 MIN_CLAIM_WINDOW_SECONDS=60 npm run lock:only
```

`lockOnly` reuses B2's locking and verification flow, returning early before claim via `stopAfterLocks` and saving `status: "locked"`. This command actually locks the configured Rain/ETH and spends testnet gas, so ensure both accounts are funded. Normal successful swaps do not enable this option.

Before the defense demo, prepare an expired instance P and an unexpired instance Q: show Q's `status` and rejected early refund first, then demonstrate P's timeout refund and final `REFUNDED` state. Each `lockOnly` execution creates a new instance and cannot recover an existing one via re-run.

Verification commands:

```sh
npm test
npm run test:refund-path
npm run test:cross-chain
npm run status -- deployments/successful-swap-2026-10-25.json
```

`test:refund-path` automatically starts and stops two local chains and tests lock-only setup, expiry boundaries, early/duplicate/claimed rejections, stale-snapshot preflight rejection, correct sender enforcement, event preimages, and recovery journals. Local test artifacts are stored in Git-ignored `.local/refund-test-*/` and represent local verification only. B4 real testnet locking and refund demonstration must still be run and recorded separately with public transaction links.

On Windows PowerShell, replace `npm` with `npm.cmd` if scripts are blocked. CLI run records and browser public JSON files have different formats and are not interchangeable.

## Task C: Browser Frontend

For first-time setup, run `npm ci` and compile at the repository root as described above. The web app requires two concurrent terminals.

**Terminal 1 (repository root):**

```powershell
npm run server
```

The local HTTP service listens on `http://127.0.0.1:3001` and invokes Task B's chain-reading, verification, fee estimation, and transaction-preparation functions; signing and broadcasting are handled by MetaMask in the browser. Stop and restart the process after modifying backend code.

**Terminal 2 (enter `frontend` from repository root):**

```powershell
cd frontend
npm ci
npm run dev
```

Routine restarts do not require re-running `npm ci`. Vite proxies `/api` requests to the server above; starting only the frontend is insufficient. Check server status at `/api/health` on the Vite URL: healthy state shows `status: ready` and `deploymentIssues: []`. Valid metadata-hash differences display warnings, whereas executable-bytecode mismatches keep the interface read-only.

Open the Local URL printed by Vite and connect MetaMask. The English UI covers wallet/network switching, Rain approval, private backup verification, public setup import/export, locking both sides, Alice claiming ETH, Bob reading the secret from the confirmed ETH claim event to claim Rain, and timeout refunds. `Exchange Workflow` guides actions based on on-chain records, current account, and network; the browser persists only the current public setup and at most one pending transaction, never a swap history list or private preimage.

Implementation details and A/B integration are in [docs/TASK_C.md](docs/TASK_C.md), with additional startup notes in [frontend/README.md](frontend/README.md). Follow the guided workflow for manual testnet verification; passing builds do not substitute for live public-testnet MetaMask confirmations and recorded evidence.

Use the same hostname and port consistently, because `localhost` and `127.0.0.1` maintain separate browser storage. After reloading, Alice must re-select the matching private backup to restore the in-memory secret; Bob needs only the public setup. The server binds strictly to localhost and is not a deployed remote multi-user service.

Before submission, you can run `npm run test:refund-path`, `npm run test:web`, and `npm run build` inside `frontend/`. These integration tests send transactions only to local nodes and do not replace real MetaMask acceptance testing.

## Task A / C Integration

The web app integrates with Task B via `scripts/serveFrontend.mjs`, `scripts/lib/webCoordinator.mjs`, and `scripts/lib/webProtocol.mjs` (new adapter modules for web integration). Both HTTP and CLI share core functions in `protocol.js`, `recovery.js`, and `runtime.js`, while public input and expected-field helpers reside in `shared/swapInputs.mjs`. Task C presents actions and results, Task B prepares and verifies, and Task A enforces on-chain escrow rules.

Complete function signatures, fields, events, errors, status values, and time boundaries are documented in [docs/INTERFACE.md](docs/INTERFACE.md). The frontend directly imports `config/abi/ERC20HTLC.json` / `ETHHTLC.json` and `deployments/sepolia.json` / `arbitrumSepolia.json`, without maintaining duplicate ABIs or addresses. When Task A updates contract interfaces, re-export shared ABIs and check frontend calls; when Task B redeploys, update the public deployment records and re-verify integration. The browser signs exclusively with MetaMask and never imports Node.js scripts that read `.env` private keys.

| Action | ERC20HTLC | ETHHTLC |
|---|---|---|
| Lock | `createERC20Swap(id, receiver, token, amount, hashlock, timelock)` | `createETHSwap(id, receiver, hashlock, timelock, {value})` |
| Claim | `claim(id, preimage)` | `claim(id, preimage)` |
| Refund | `refund(id)` | `refund(id)` |
| Query | `swaps(id)` | `swaps(id)` |

Both contracts emit `SwapCreated`, `SwapClaimed`, and `SwapRefunded`. Status codes are `0=None`, `1=Active`, `2=Claimed`, and `3=Refunded`. Teammates may refine implementations against the fixed interface; recompile and redeploy after runtime changes.

## Differences from Course Examples and Contribution Notes

The original single-chain `SimpleHTLC` contract is retained for historical reference, and tutorial scripts were moved to `scripts/legacy/`; see [docs/LEGACY.md](docs/LEGACY.md). The new workflow uses two independent chains, separate contracts, staggered timelocks, confirmation and lock verification, on-chain event secret transfer, and public run records.

The inventory of AI-assisted files and functions is listed in [docs/AI_ASSISTANCE.md](docs/AI_ASSISTANCE.md) for code review and report disclosure. The basic protocol and the Challenge Part maintain separate contracts and deployment records.
