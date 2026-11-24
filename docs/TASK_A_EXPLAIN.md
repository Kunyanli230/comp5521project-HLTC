# Task A1 / A2 / A5 Function Notes

Scope: the locking functions `createERC20Swap()` and `createETHSwap()`, the shared validation `_create()`, the payout `_pay()`, and the corresponding safety tests. `claim()` / `refund()` are owned by A3/A4; this document only explains how locking guarantees that the data they receive is reliable.

For the interface (signatures, events, `swaps()` fields, status codes 0 to 3), see `docs/INTERFACE.md`; this task did not change it.

## 1. `HTLCBase._create()`: Shared Validation and Bookkeeping for Both Asset Types

```solidity
function _create(bytes32 swapId, address receiver, address token, uint256 amount,
    bytes32 hashlock, uint256 timelock) internal
```

Each check below is applied in turn, and any failure does `revert InvalidInput()`:

| Condition | Why it is rejected |
|---|---|
| `swapId == 0` | `0` is the default key of a mapping, so the frontend/scripts can easily pass it by mistake; it also cannot be distinguished from "no ID generated" |
| `hashlock == 0` | No known preimage exists, so the funds can only wait for a refund, which is pointless |
| `receiver == address(0)` | Nobody can call `claim` as the zero address, which amounts to burning the claim path |
| `receiver == msg.sender` | Swapping with oneself has no counterparty and is a mistaken operation |
| `amount == 0` | An empty lock only occupies the swapId and pollutes state |
| `timelock <= block.timestamp` | `claim` requires `block.timestamp < timelock`, so such a lock has already expired when created and the receiver can never claim |

Then:

1. `if (swaps[swapId].status != Status.None) revert SwapAlreadyExists();`
   Once an ID has been used (Active / Claimed / Refunded), it cannot be used again. This prevents accidental duplicate submissions, and also prevents someone else from overwriting an existing lock with the same ID and making themselves the sender.
2. Write `Swap(msg.sender, receiver, token, amount, hashlock, timelock, Active)`. The sender is always `msg.sender`; a caller cannot impersonate someone else.
3. Emit the `SwapCreated` event, so that scripts on the counterparty's chain can cross-check it.

## 2. `ERC20HTLC.createERC20Swap()`

```solidity
function createERC20Swap(bytes32 swapId, address receiver, address token, uint256 amount,
    bytes32 hashlock, uint256 timelock) external nonReentrant
```

1. `if (token.code.length == 0) revert InvalidInput();`
   The token address must be a contract. The zero address and ordinary accounts have no code: calling such an address with a low-level `call` "succeeds" but transfers nothing, a classic vulnerability in ERC20 escrow.
   The later `balanceOf` call in this contract and OpenZeppelin 5.x's `SafeERC20` would in fact also revert because there is no code, so this line is an "early, explicit failure":
   it rejects with the uniform `InvalidInput` before any state is touched, instead of relying on a later call to report an unclear error.
2. `_create(...)`: runs all the validation above and does the bookkeeping.
3. Record the contract's token balance before the transfer, `beforeBalance`.
4. `safeTransferFrom(msg.sender, address(this), amount)`: pulls the tokens from the sender into escrow.
   - The sender must `approve` beforehand; if the allowance is insufficient, the token contract throws `ERC20InsufficientAllowance`.
   - If the balance is insufficient, it throws `ERC20InsufficientBalance`.
   - `SafeERC20` is used because some tokens return `false` on failure instead of reverting, and `SafeERC20` turns that case into a revert too.
5. `if (balanceOf(this) - beforeBalance != amount) revert InvalidInput();`
   Checks the amount actually received. Fee-on-transfer tokens (transferring 1000 but only 990 arriving) are rejected; otherwise `swaps(id).amount` would record 1000 while escrow could not pay it out at claim time.

**Why record first and transfer afterwards?** The whole function runs in one transaction, and a revert at any step rolls back all state, including the record and event written in step 2. So a lock with a record but no funds is never left behind.

**What `nonReentrant` does**: step 4 calls an external token contract. If the token is malicious, it can call back into `createERC20Swap` from within `transferFrom`; the reentrancy guard makes that callback fail (`ReentrancyGuardReentrantCall`), and the whole transaction reverts.

## 3. `ETHHTLC.createETHSwap()`

```solidity
function createETHSwap(bytes32 swapId, address receiver, bytes32 hashlock, uint256 timelock)
    external payable nonReentrant
```

- The amount is `msg.value`, with no separate `amount` parameter, so "recorded amount = amount actually received" holds by construction.
- The `token` field is fixed to `address(0)`, meaning native ETH.
- `msg.value == 0` is caught in `_create` by `amount == 0`.
- This function calls no external contract; `nonReentrant` is mainly there for consistency with the other functions: during the payout in `claim`/`refund`, a callback into this function to create a new lock is also not possible.

## 4. `_pay()`: Payout (Called by `claim` / `refund`)

- `ERC20HTLC._pay`: `safeTransfer(receiver, amount)`.
- `ETHHTLC._pay`: `payable(receiver).call{value: amount}("")`, and `revert ETHTransferFailed()` on failure.
  `call` is used instead of `transfer` because `transfer` forwards only 2300 gas and can fail when the receiver is a contract wallet. The cost is that the receiver can execute arbitrary code, so `claim`/`refund` must first set the state to a terminal one before paying, and add `nonReentrant`.

If the payout fails, the whole `claim`/`refund` rolls back and the state stays Active: when the receiver refuses payment, the sender can still refund after expiry, and the funds do not get stuck.

## 5. Test Mapping (`test/TaskA_LockSafety.js`)

| Test group | Rule it proves | Helper contracts used |
|---|---|---|
| successful locks | Recorded fields, events, and balance changes match exactly; a deadline of current time + 1 passes | none |
| input validation (both asset types) | Every row of the table in Section 1, and after a failure there is no record and the escrow balance is unchanged | none |
| duplicate swapId | Duplicates, overwriting by others, and reuse of terminal states are all rejected | none |
| ERC20 token transfer safety | Zero-address/ordinary-account token, insufficient allowance, insufficient balance, fee-on-transfer token, malicious token reentering `createERC20Swap` | `FeeOnTransferToken`, `HookToken` |
| ETH rejects | Receiver or sender refusing ETH → `ETHTransferFailed`, the lock stays Active and refundable | `ETHRejecter` |
| re-entrancy | Reentry in the payout callbacks of both ETH and ERC20 `claim` and `refund` fails, and the attacker is paid only once | `ReentrantReceiver`, `HookToken` |

The helper contracts are all in `contracts/test/`, are used only for local tests, and are not deployed by the deployment scripts:

- `FeeOnTransferToken`: burns 1% on every transfer (when the amount is below 100, the fee rounds to 0).
- `ETHRejecter`: `receive()` always reverts.
- `ReentrantReceiver`: calls back into `claim`/`refund` when it receives ETH or HookToken; with `bubble=false` it swallows the error and records it in `lastError`, and with `bubble=true` it rethrows the error.
- `HookToken`: when transferring to a specified address, calls that address's `onTokenReceived()`; or, when transferring into the HTLC, calls back into `createERC20Swap`.

Run: `npm test`.
