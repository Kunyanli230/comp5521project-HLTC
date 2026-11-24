# Challenge Part · Point-Lock Swap on Two Chains

On 2026-11-17 (UTC), Alice locked 10 MST on Ethereum Sepolia and Bob locked 0.001 ETH on Arbitrum Sepolia. Each received the agreed asset, and both contracts reached `Claimed`. This swap removes the lock values and claim values that could be matched directly across chains in the basic version, but the same pair of accounts is still easy to recognize. [Public report for this swap](../deployments/point/successful-swap-2026-11-17.json)

## 1. What does each chain make public?

The creation transaction publishes the contract, asset, amount, payer, payee, swap ID, expiry time and a 20-byte address lock. The claim transaction publishes that chain's scalar, which the contract writes into `SwapClaimed(swapId, secret)`. Transaction time, originating address and final status can also be looked up. The scalars in the table are taken from the claim receipts; the report records only the corresponding transactions and locks.

| On-chain record for this swap | Ethereum Sepolia · MST | Arbitrum Sepolia · ETH |
|---|---|---|
| Payer → payee | Alice → Bob, 10 MST | Bob → Alice, 0.001 ETH |
| Swap ID (abbreviated) | `0x5f3e8f0a…b52c5825` | `0x4a2d4895…8eee5bde` |
| `pointLock` | `0x8605f390451E0554321bD98229e8f1e6ed1a9B06` | `0x80f50bB4b8736879aeCB28806a22623EA0a4c3F5` |
| Claim scalar (abbreviated) | `0x7052b8af…1745763a` | `0xbc5fefe6…725fb468` |
| Expiry time (Unix seconds) | `1794898200` | `1794894629` |
| Transaction evidence | [Deploy](https://sepolia.etherscan.io/tx/0x7c186ebeccfb36e1199ef95558bf328fc34871e13cbc1456b22ba9951ff67818) · [Approve](https://sepolia.etherscan.io/tx/0x0a0454f448a319a95cc5f2aee6077f097f0a24f2974aecb4c17bbd3cb0bb7cc6) · [Lock](https://sepolia.etherscan.io/tx/0x7cfbc41e9838569284fdb633ff7bd9c8e05c9135e5506a4ba7c30bb75cd82fc5) · [Claim](https://sepolia.etherscan.io/tx/0xe3da1b554b1af64fca32793f6a432011715c9fe62d4d459426738ff98f763f37) | [Deploy](https://sepolia.arbiscan.io/tx/0x912a82183d267246ac449a26df017e91592e8660568d04c84773590e71440fee) · [Lock](https://sepolia.arbiscan.io/tx/0x0beaf8aff60012e7608dceb906acc1c183a4709f66561c4696c55fed1e2bc653) · [Claim](https://sepolia.arbiscan.io/tx/0xb248bb665c82121c72371c4fefa3fc5f63454462852f2e80a8bb3a028c2c6e61) |

**Basic version for comparison.** The 2026-10-25 report records one shared `hashlock` (`0xc1449bbb…e9596c92`). Decoding the inputs of the two `claim(bytes32,bytes32)` transactions separately shows different swap IDs but a second parameter that is byte-for-byte identical (`0xba0a3845…05a8cc03`); its Keccak-256 is exactly the lock in the report. An observer only needs to compare whether two public values are equal to find the match. [Basic version report](../deployments/successful-swap-2026-10-25.json) · [Alice claims ETH](https://sepolia.arbiscan.io/tx/0xe6110e61d5acc2d17aae909840ff1afd043e5e1bc88d31bd68f9c6cf4a8cfcb1) · [Bob claims MST](https://sepolia.etherscan.io/tx/0xed0d9ac507c3c58633d843cacdfcc67e1f11ae12b9fc0b4a59281960af596110)

## 2. Why can Bob verify and claim, even though the two claims publish different values?

Let `G` be the secp256k1 generator, `n` the group order, and `addr(P)` the Ethereum address corresponding to a public key point. Alice randomly chooses a secret scalar `t` and a non-zero blinding value `r`, and ensures that `u = (t + r) mod n` is non-zero.

| Step | Who does what, where | Information visible externally |
|---|---|---|
| 1 | Alice locks MST for Bob on Sepolia, and sends `T = t·G` and `r` to Bob through an off-chain channel. | The chain records `addr(u·G)`; the offer goes only to Bob. |
| 2 | Bob reads the valid MST lock and its terms, checks that `addr(T + r·G)` equals the lock address he read, and only after it passes locks ETH for Alice. | Another lock, `addr(T)`, appears on Arbitrum. |
| 3 | Alice checks both locks and the deadlines, and claims ETH with `t`. | The ETH claim event publishes `t`. |
| 4 | Bob reads `t` from the confirmed event, combines it with the `r` he holds to compute `u`, checks the address, and claims MST with `u`. | The MST claim event publishes `u`. |

**CH1** rests on the group identity `T + r·G = u·G`. Bob can check it independently before committing ETH; knowing the point `T` does not reveal its discrete logarithm `t`. This construction uses point addition as the cryptographic check and needs no zero-knowledge proof system. The key to **CH2** is that a non-zero `r` makes `u ≠ t`. The contract only compares the address derived from the submitted scalar with the lock address; point addition and the cross-chain check are both done off-chain. The two scalars actually claimed each derive the corresponding lock address in the table above. [Off-chain computation](../scripts/lib/pointLock.js) · [Lock and claim order](../scripts/lib/pointProtocol.js) · [On-chain address check](../contracts/challenge/PointHTLCBase.sol)

## 3. How else can an observer pair the transactions?

From the scalars alone, any ETH claim and any MST claim you pick will yield a candidate difference. No original `r` that can be checked independently is published on-chain. A participant holding the original offer can show it afterwards so that a third party can check the two locks; a difference computed backwards from two already-public claims cannot by itself prove that they were a pair agreed in advance.

| Linking clue | Evidence given by this swap |
|---|---|
| **Same pair of accounts** | Both chains use Alice (`0x6BdC…Fa79`) and Bob (`0x8466…4eE8`), with the locking and receiving roles exactly swapped. |
| **Only one candidate transaction** | Searching from each contract's deployment block to the claim block of this swap, Sepolia (12152137-12152147) and Arbitrum Sepolia (329992253-329992577) each contain only one `SwapCreated`. Within this range there is only one possible pairing. |
| Close timing | By the two chains' block times, the two locks were created 21 seconds apart and the two claims happened 18 seconds apart. |
| Directional deadlines | MST expires 3,571 seconds after ETH, matching the order in which Bob still needs time to claim MST after the ETH claim. |
| Amount combination | If it is known that the two parties agreed on 10 MST for 0.001 ETH, amounts can be used to filter candidate transactions; a single amount alone is not enough to confirm a pairing. |

The public run report also directly lists the swap IDs and transaction links of both chains. Anyone who reads this report can know the pairing; the analysis above targets someone who observes only on-chain data. [Deployment and transaction records](../deployments/point/successful-swap-2026-11-17.json)

## 4. When verification fails, whose funds are still locked?

| Case | Actual check and result |
|---|---|
| Alice sends the wrong `r`, Bob reads an unrelated MST lock, or the offer uses a 32-byte scalar as a public key point | All three local test cases are rejected before Bob creates the ETH lock. The test compares the ETH chain's block height before and after each rejection, and no new block was added in any of the three; the MST already locked is refunded to Alice one by one after expiry. [Two-chain integration test](../test/integration/pointSwap.js) |
| The receiver submits a neighbouring scalar, zero or an out-of-range value | The contract returns `InvalidSecret` and the lock stays `Active`. The corresponding test is `rejects a neighbouring scalar, zero and out-of-range scalars with InvalidSecret`. [Contract test](../test/Challenge_PointHTLC.js) |
| A third party knows the correct scalar, or the receiver misses the deadline | Only the designated receiver can claim before expiry. From the block of expiry onward, the sender can refund, and a refunded lock cannot be claimed again. The corresponding tests are `rejects a non-receiver with the correct scalar`, `rejects claims at and after the deadline` and `refunds at the deadline and keeps the refund final`. The coordinator's `assertTimelocks` also checks the deadline gap between the two chains and the remaining claim window. [Permission and refund test](../test/Challenge_PointClaimRefund.js) · [Deadline check](../scripts/lib/protocol.js) |

Run `npm test` in the project root to re-check the contract and protocol cases; `npm run test:point` verifies the swap, post-failure refunds and deployment reuse on two independent local chains.
