# Original Single-Chain Example

The original step-by-step tutorial scripts were moved to `scripts/legacy/`, and their token references were unified as Rain. They connect to `SimpleHTLC` and use the historical variables `SEPOLIA_SIMPLE_HTLC_ADDRESS`, `SWAP_PREIMAGE`, `SWAP_HASHLOCK`, `RAIN_SWAP_ID`, `ETH_SWAP_ID`, `TIMELOCK_SECONDS`. They are not part of the current two-chain flow and should not be used as the project demo entry.

The current web entry is `npm.cmd run server` together with the frontend's `npm.cmd run dev`; the B command-line entries include `deploy`, `swap:success`, `status`, and `refund`, see the root README. For the new contracts and ABIs, see `docs/INTERFACE.md`.
