# AI Assistance Record

This file documents the AI-assisted contracts, scripts, frontend modules, tests, and documentation in this repository, compiled from Git history and inline `AI-assisted` source annotations for teammate review and course report disclosure.

| Phase / Branch / Date | Files / Functions |
|---|---|
| **1. Initial Baseline & Task B1/B2**<br>`codex/cross-chain-htlc`<br>2026-10-25 | some parts in `contracts/HTLCBase.sol` , `contracts/ERC20HTLC.sol`  `contracts/ETHHTLC.sol` |
| Same as above | `scripts/lib/runtime.js`  |
| Same as above | `README.md`, `.env.example`, `docs/INTERFACE.md`, `docs/LEGACY.md` |
| **2. Task A Tests & Documentation**<br>`taskA-1` & `taskA/lock-safety`<br>2026-11-04 | some parts in `test/TaskA_ClaimRefund.js` |
| Same as above | `test/TaskA_LockSafety.js` |
| Same as above | `contracts/test/FeeOnTransferToken.sol`, `contracts/test/ETHRejecter.sol` |
| Same as above | `docs/TASK_A_EXPLAIN.md` |
| **3. Task B3/B4 Status & Timeout Recovery**<br>`b3-b4-recovery`<br>2026-11-05 |some parts in `scripts/lib/recovery.js` |
| Same as above | `scripts/status.js`, some parts in `scripts/refund.js`, some parts in `scripts/lockOnly.js`, `scripts/lib/protocol.js`  |
| Same as above | `test/Recovery.js`, `test/integration/refundPath.js`, `package.json`, `README.md` |
| **4. Task C Frontend & Task B HTTP Adapter**<br>`task-c-frontend`<br>2026-11-07 to 2026-11-09 | `scripts/lib/runtime.js` (`splitSolidityMetadata`, `compareBytecode`, `assertCode`) |
| Same as above | some parts in `scripts/lib/webCoordinator.mjs`, some parts in `scripts/lib/webProtocol.mjs`, some parts in `scripts/serveFrontend.mjs`,some parts in `shared/swapInputs.mjs` |
| Same as above | some parts in `frontend/lib/guide.js`, some parts in `frontend/lib/workflow.js`, some parts in `frontend/index.html`, `frontend/style.css` (lines 111-156) |
| Same as above | `docs/TASK_C.md`, `docs/TEST_RESULTS.md` |
| **5. Challenge Part: Point-Lock Swap**<br>`challenge-pointlock`<br>2026-11-16 to 2026-11-17 | some parts in `contracts/challenge/PointLock.sol`, some parts in `contracts/challenge/PointHTLCBase.sol`, some parts in `contracts/challenge/ERC20PointHTLC.sol`, some parts in `contracts/challenge/ETHPointHTLC.sol`, some parts in `contracts/test/PointLockHarness.sol` |
| Same as above | some parts in `scripts/lib/pointProtocol.js` |
| Same as above | some parts in `test/Challenge_PointLock.js`, `test/Challenge_PointHTLC.js`|
