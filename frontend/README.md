# Task C frontend

- [Implementation and A/B integration (Chinese)](../docs/TASK_C.md): requirements, modules, HTTP, privacy and limitations.
- [Test evidence](../docs/TEST_RESULTS.md).
- [AI assistance record](../docs/AI_ASSISTANCE.md).

Start Task B from the repository root with `npm run server`, and run `npm run dev` in this directory in a second terminal. Installation and restart steps are in the [repository README](../README.md).

The **Current on-chain state** strip is drawn as a bridge: the Rain and ETH nodes on each side, two lanes in between. Lane styling only mirrors the status read from the contracts (dashed = not read or not created, flowing dots = Active, solid beam = Claimed, reversed dots = Refunded); `lib/bridge.js` sets the `data-rain-flow` / `data-eth-flow` attributes and never changes buttons or transactions. Animation stops under `prefers-reduced-motion`.

On the Inspect page, enter the public swap IDs or open a link of the form `#/inspect?rain=0x...&eth=0x...&hashlock=0x...` to fill the lookup fields. These queries only read the chains and never touch the private backup. The historical exchange record remains in `deployments/successful-swap-2026-10-25.json`.

**Read Both Locks** is beside the **Current on-chain state** heading. The step footer provides the next action; each transaction button has its own progress message and explorer link. **Most recent transaction** keeps the latest link and opens for a pending transaction restored after reload. Metadata-only deployment warnings are inside **Inspect locks → Configured networks and contracts**; blocking deployment errors remain visible above the current step.
