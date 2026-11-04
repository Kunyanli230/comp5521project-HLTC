// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice TEST ONLY — never deployed to a public network.
/// A contract account that refuses all incoming ETH. Used to show that when
/// ETHHTLC._pay() cannot deliver ETH it reverts with ETHTransferFailed, the
/// whole claim/refund is rolled back, and the swap stays Active (funds not lost).
interface IETHHTLCLike {
    function createETHSwap(bytes32 swapId, address receiver, bytes32 hashlock, uint256 timelock) external payable;
    function claim(bytes32 swapId, bytes32 preimage) external;
    function refund(bytes32 swapId) external;
}

contract ETHRejecter {
    IETHHTLCLike public immutable htlc;

    constructor(address htlc_) {
        htlc = IETHHTLCLike(htlc_);
    }

    /// Lock ETH with this contract as the swap sender (so it can later call refund).
    function lockETH(bytes32 swapId, address receiver, bytes32 hashlock, uint256 timelock) external payable {
        htlc.createETHSwap{value: msg.value}(swapId, receiver, hashlock, timelock);
    }

    /// Forward claim/refund so that msg.sender inside the HTLC is this contract.
    function claim(bytes32 swapId, bytes32 preimage) external {
        htlc.claim(swapId, preimage);
    }

    function refund(bytes32 swapId) external {
        htlc.refund(swapId);
    }

    receive() external payable {
        revert("ETHRejecter: no ETH accepted");
    }
}
