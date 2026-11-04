// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice TEST ONLY — never deployed to a public network.
/// Simulates a "fee-on-transfer" token: every transfer burns 1% of the amount,
/// so the recipient receives less than `amount`. ERC20HTLC.createERC20Swap()
/// measures its own balance before/after transferFrom and must reject this,
/// otherwise swaps(id).amount would promise more tokens than the escrow holds.
contract FeeOnTransferToken is ERC20 {
    uint256 public constant FEE_BPS = 100; // 100 / 10_000 = 1%

    constructor(address owner, uint256 supply) ERC20("Fee Rain", "fRAIN") {
        _mint(owner, supply);
    }

    function _update(address from, address to, uint256 value) internal override {
        // Mint and burn are not charged, otherwise the constructor would recurse into fees.
        if (from == address(0) || to == address(0)) {
            super._update(from, to, value);
            return;
        }
        uint256 fee = (value * FEE_BPS) / 10_000; // rounds down: amounts < 100 pay no fee
        super._update(from, address(0), fee); // burn the fee
        super._update(from, to, value - fee); // recipient gets the remainder
    }
}
