# Task C frontend

- [Complete operation guide (Chinese)](../docs/TASK_C_FLOW.md): setup, exact inputs/buttons, swap, refunds and recovery.
- [Implementation and A/B integration (Chinese)](../docs/TASK_C.md): requirements, modules, HTTP, privacy and limitations.
- [Test evidence](../docs/TEST_RESULTS.md).
- [AI assistance record](../docs/AI_ASSISTANCE.md).

Start Task B from the repository root with `npm run server`, and run `npm run dev` in this directory in a second terminal. Full installation and restart steps are in the operation guide.

The **Current on-chain state** strip is drawn as a bridge: the Rain and ETH nodes on each side, two lanes in between. Lane styling only mirrors the status read from the contracts (dashed = not read or not created, flowing dots = Active, solid beam = Claimed, reversed dots = Refunded); `lib/bridge.js` sets the `data-rain-flow` / `data-eth-flow` attributes and never changes buttons or transactions. Animation stops under `prefers-reduced-motion`.

Demo shortcuts on the Inspect page: the **Load example swap (2026-10-25)** button fills both swap IDs and the hashlock from `deployments/successful-swap-2026-10-25.json`; a link of the form `#/inspect?rain=0x...&eth=0x...&hashlock=0x...` does the same when opened. Both only read the chains; they never touch the private backup.
