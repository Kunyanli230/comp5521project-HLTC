# Task A / B / C Interface Contract v1

This repository names the original token reference **Rain** throughout. `RAIN_ADDRESS` points to the real Ethereum Sepolia ERC20 token; renaming the configuration does not change the deployed token's `name()`, `symbol()` or address. Public-network scripts do not deploy or mint test tokens; `TestToken` is used only for local tests.

## Networks and Accounts

| Asset | Network | chain ID | Contract | Sender | Receiver |
|---|---|---:|---|---|---|
| Rain ERC20 | Ethereum Sepolia | 11155111 | ERC20HTLC | Alice | Bob |
| Native ETH | Arbitrum Sepolia | 421614 | ETHHTLC | Bob | Alice |

Public network metadata: `config/networks.js`. B's original CLI reads the RPC and account private keys from the local `.env` and signs. The web HTTP service reads the RPC configuration, uses a read-only provider, does not create a private-key signing wallet, and uses the public fallback addresses in the code when no RPC is configured. C does not import `.env`; MetaMask signs and broadcasts. Public addresses and initial transaction results are in `deployments/*.json`; later actual acceptance evidence is recorded separately in TEST_RESULTS.md. Official Arbitrum network information: <https://docs.arbitrum.io/chain-info>.

## Function Signatures (fixed parameter order)

```solidity
// ERC20HTLC: Alice first calls approve(ERC20HTLC address, amount) on the Rain token.
function createERC20Swap(
    bytes32 swapId, address receiver, address token, uint256 amount,
    bytes32 hashlock, uint256 timelock
) external;

// ETHHTLC: amount is determined by msg.value; no separate amount is passed.
function createETHSwap(
    bytes32 swapId, address receiver, bytes32 hashlock, uint256 timelock
) external payable;

// Provided by both contracts:
function claim(bytes32 swapId, bytes32 preimage) external;
function refund(bytes32 swapId) external;
function swaps(bytes32 swapId) external view returns (
    address sender, address receiver, address token, uint256 amount,
    bytes32 hashlock, uint256 timelock, uint8 status
);
```

- `swapId`: a non-zero bytes32 that cannot be reused within each contract. In this project the CLI and the web app generate different IDs for the two chains, and the script report or public setup links the two. The two contracts do not communicate and do not enforce on-chain that the IDs differ across chains.
- `preimage`: **32 raw bytes** generated cryptographically at random. ethers `keccak256(preimage)` is equivalent to Solidity `keccak256(abi.encodePacked(preimage))`. Do not hash the text string of `0x...`.
- `hashlock`: a non-zero bytes32, identical on both chains.
- `timelock`: an absolute Unix timestamp in seconds on each chain; `claim` requires `block.timestamp < timelock`, and `refund` requires `block.timestamp >= timelock`.
- `amount`: an integer in the smallest unit. B's original CLI converts using Rain's on-chain `decimals()`; the current web/HTTP entry point parses using the course Rain's 18-decimal precision, and checks that the token precision is 18 when approving or creating the Rain lock. ETH uses wei, and the `token` field of an ETH lock is the zero address.
- `status`: `0=None`, `1=Active`, `2=Claimed`, `3=Refunded`; terminal states are irreversible. Both claim and refund must be called by the designated account.

## Events

```solidity
event SwapCreated(
    bytes32 indexed swapId, address indexed sender, address indexed receiver,
    address token, uint256 amount, bytes32 hashlock, uint256 timelock
);
event SwapClaimed(bytes32 indexed swapId, bytes32 preimage);
event SwapRefunded(bytes32 indexed swapId);
```

Look up logs by contract address, event topic and swapId; do not assume the event is at `receipt.logs[0]`. Once a claim transaction is broadcast, the secret may be observed from calldata; Bob's normal recovery entry point still requires obtaining and verifying the secret from the confirmed Arbitrum `SwapClaimed` event. When Alice clicks claim in the web app, the preimage is first handed to the local HTTP service for validation, encoding and fee estimation, and the fee-estimation RPC also receives call parameters containing the secret; therefore it cannot be claimed that only the browser knows the secret before broadcast. The service does not write the secret to files or request logs; the public setup and browser localStorage do not store the preimage.

ABI files are `config/abi/ERC20HTLC.json` and `config/abi/ETHHTLC.json`. After modifying the contracts, run `npm run abi:export`; interface changes should be synchronized across scripts, frontend and this document. Deployment and swap share `runtime.assertCode`: it passes if the full runtime bytecode matches; if, after reliable decoding, only the metadata hash differs and the executable part matches the compiler marker, it passes with a warning; if the executable part differs or no reliable judgment can be made, it blocks. A metadata warning does not prove that the source and the full compile settings are identical; see TASK_C.md for the detailed boundaries. After Task A changes the executable implementation, the corresponding version must be recompiled and redeployed; a metadata-hash-only difference does not automatically require redeployment.

## How B and C Connect

C calls the contracts actually deployed by the team members; no separate frontend HTLC contract or copy of an HTLC ABI file was created. `frontend/main.js` directly imports `deployments/sepolia.json`, `deployments/arbitrumSepolia.json` and the two shared ABIs under `config/abi/`; the HTTP service also reads the same set of files. The frontend additionally has a small standard ERC20 ABI declaration for querying Rain balance and allowance and encoding approve; this is the token interface, not another HTLC implementation.

C calls B through local HTTP: `chainActions.js → serveFrontend.mjs → webCoordinator.mjs → protocol.js / recovery.js / runtime.js`. Pre-operation on-chain verification, per-transaction fee estimation, transaction preparation and confirmation verification run in Node.js; C still does form preview, identity/network checks, review of returned transaction parameters, backup management and MetaMask signing requests, so it cannot be said that the frontend does no checking at all.

`serveFrontend.mjs`, `webCoordinator.mjs` and `webProtocol.mjs` are HTTP/single-step adapters added when integrating the web app; they are not three files the team members originally had. They call the original B functionality; lock-creation parameters use the shared `protocol.lockCall`, and input parsing and expected fields use `shared/swapInputs.mjs`. B's original CLI can still run a whole swap independently, while the web app has participants confirm step by step. The local service is not a deployed remote multi-user backend.

Responsibilities, reuse and adjustments to original files are covered in [Task C notes](TASK_C.md); startup and operation steps are in [the Task C section of the README](../README.md#task-c-browser-frontend). This file keeps the interface contract shared by A/B/C.


## Errors and State Flow

`InvalidInput`, `SwapAlreadyExists`, `SwapNotFound`, `NotReceiver`, `NotSender`, `InvalidSecret`, `ClaimExpired`, `RefundNotReady`, `AlreadyCompleted`, and, for failed ETH payments, `ETHTransferFailed`. Both contracts inherit ReentrancyGuard, so reentrancy may throw `ReentrancyGuardReentrantCall`; ERC20 transfers use SafeERC20 and may throw the token's own errors or SafeERC20's errors.

```text
None --create--> Active --claim before expiry--> Claimed
                       --refund at/after expiry--> Refunded
```

Task B3/B4 and Task C use `swaps(id)` and each chain's block time. At the contract level: when Active and not yet expired, the designated receiver can claim with the correct secret; when Active and expired, the designated sender can refund. Expiry does not automatically change Active or automatically refund. C additionally checks the agreement between the parties, the cross-chain window, the current account/network and the required backup, and disables the corresponding button when conditions are not met even if the swap is Active; a swap that does not exist or is in a terminal state can no longer be claimed or refunded. B's status and refund entry points are `scripts/status.js` and `scripts/refund.js`; C uses B's status classification and operation verification over HTTP. For the current acceptance status and historical evidence see [TEST_RESULTS.md](TEST_RESULTS.md); one cannot claim that all scenarios have passed testing merely because the interface is implemented.

## B2 Coordination Order

1. Check chain ID, contract code, account and balance on each of the two chains separately.
2. Generate an independent swapId, a random secret and a shared hashlock, and save the secret to a separate local file; check the allowance, and only when it is insufficient have Alice approve and wait for confirmation. In the web app this corresponds to downloading/verifying the private backup in Prepare, then approving as needed in Lock Rain.
3. Alice creates the Rain lock on Sepolia and waits for confirmation. Bob reads that chain and checks the two parties' addresses, token, amount, hashlock, deadline and Active status.
4. Bob creates the ETH lock on Arbitrum Sepolia and waits for confirmation. The ETH deadline is shorter; the script checks both the absolute time gap and the remaining-time gap on each chain.
5. Alice checks the two locks again, confirms there is still a claim window, claims ETH, and waits for confirmation.
6. Bob reads the secret from the confirmed ETH claim event, claims Rain, and waits for confirmation.
7. Read the two chains separately to confirm Claimed. The B CLI records each step's transaction in the public run report and the terminal; C shows a readable result/transaction link at the point of operation and in the completion dialog, and carries the ETH claim hash into the next step. C persists only the current public setup and at most one pending hash, with no full transaction history list, so evidence must be saved separately while following the [README Task C section](../README.md#task-c-browser-frontend).

Defaults: Rain=7200 seconds, ETH=3600 seconds, minimum gap=600 seconds, minimum claim window=120 seconds. The B CLI's configuration is read by `runtime.settings`; the web app lets you enter this round's durations, but the HTTP's current default bounds come from DEFAULT_POLICY in `shared/swapInputs.mjs` and do not change automatically when the CLI's `.env` bounds are modified. The planned ETH duration must be strictly greater than 120 seconds; the normal two-sided Active flow requires at least 120 seconds of remaining window on both sides, and checks both the absolute deadline gap and the remaining-window gap. These are the coordinator's test policy, not cross-chain constants enforced by any single Task A contract.

The number of confirmation blocks only represents confirmation on each network; an L2 confirmation on Arbitrum does not mean L1 final settlement. Automatic completion is not guaranteed under network congestion or RPC failure; a transaction that has been submitted but not yet verified should first have its receipt and both chains' states checked before deciding the next step, and must not be blindly resent.

## Challenge Part: Point-Lock Contract Interface

The point-lock version is two separate contracts, with source in `contracts/challenge/` and deployment records in `deployments/point/`; it does not replace the basic-version interface above. See [CHALLENGE.md](CHALLENGE.md) for the protocol and privacy boundary.

| Asset | Network | Contract | Sender | Receiver |
|---|---|---|---|---|
| Rain ERC20 | Ethereum Sepolia | ERC20PointHTLC | Alice | Bob |
| Native ETH | Arbitrum Sepolia | ETHPointHTLC | Bob | Alice |

```solidity
// ERC20PointHTLC: Alice first calls approve(ERC20PointHTLC address, amount).
function createERC20Swap(
    bytes32 swapId, address receiver, address token, uint256 amount,
    address pointLock, uint256 timelock
) external;

// ETHPointHTLC: the amount is msg.value.
function createETHSwap(
    bytes32 swapId, address receiver, address pointLock, uint256 timelock
) external payable;

// Identical in both contracts.
function claim(bytes32 swapId, uint256 secret) external;
function refund(bytes32 swapId) external;
function swaps(bytes32 swapId) external view returns (
    address sender, address receiver, address token, uint256 amount,
    address pointLock, uint256 timelock, uint8 status
);

event SwapCreated(bytes32 indexed swapId, address indexed sender, address indexed receiver,
    address token, uint256 amount, address pointLock, uint256 timelock);
event SwapClaimed(bytes32 indexed swapId, uint256 secret);
event SwapRefunded(bytes32 indexed swapId);
```

The only differences from the basic version are the lock and the claim value: `bytes32 hashlock` is replaced by `address pointLock`, and the second parameter of `claim` changes from a `bytes32` preimage to a `uint256` scalar; the contract requires that the address derived from multiplying that scalar by the secp256k1 base point equal `pointLock`. Error names, status values and expiry boundaries are the same as in the basic version.

The only entry points are the CLI: `npm run deploy:point` and `npm run swap:point`, coordinated by `scripts/lib/pointProtocol.js`. `scripts/status.js`, `scripts/refund.js`, `config/abi/` and the browser frontend still connect only to the basic-version contracts.
