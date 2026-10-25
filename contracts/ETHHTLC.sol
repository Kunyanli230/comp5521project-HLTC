// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "./HTLCBase.sol";
/// @dev AI-assisted integration baseline for Task A/B integration.
contract ETHHTLC is HTLCBase {
    error ETHTransferFailed();
    function createETHSwap(bytes32 swapId, address receiver, bytes32 hashlock, uint256 timelock)
        external payable nonReentrant {
        _create(swapId, receiver, address(0), msg.value, hashlock, timelock);
    }
    function _pay(address, address receiver, uint256 amount) internal override {
        (bool ok, ) = payable(receiver).call{value: amount}("");
        if (!ok) revert ETHTransferFailed();
    }
}
