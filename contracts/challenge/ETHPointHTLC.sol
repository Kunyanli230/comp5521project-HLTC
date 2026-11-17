// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "./PointHTLCBase.sol";
/// @dev AI-assisted point-lock variant of ETHHTLC.
contract ETHPointHTLC is PointHTLCBase {
    error ETHTransferFailed();
    function createETHSwap(bytes32 swapId, address receiver, address pointLock, uint256 timelock)
        external payable nonReentrant {
        _create(swapId, receiver, address(0), msg.value, pointLock, timelock);
    }
    function _pay(address, address receiver, uint256 amount) internal override {
        (bool ok, ) = payable(receiver).call{value: amount}("");
        if (!ok) revert ETHTransferFailed();
    }
}
