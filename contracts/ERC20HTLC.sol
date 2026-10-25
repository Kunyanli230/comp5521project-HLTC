// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "./HTLCBase.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
/// @dev AI-assisted integration baseline for Task A/B integration.
contract ERC20HTLC is HTLCBase {
    using SafeERC20 for IERC20;
    function createERC20Swap(bytes32 swapId, address receiver, address token, uint256 amount,
        bytes32 hashlock, uint256 timelock) external nonReentrant {
        if (token.code.length == 0) revert InvalidInput();
        _create(swapId, receiver, token, amount, hashlock, timelock);
        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        if (IERC20(token).balanceOf(address(this)) - beforeBalance != amount) revert InvalidInput();
    }
    function _pay(address token, address receiver, uint256 amount) internal override {
        IERC20(token).safeTransfer(receiver, amount);
    }
}
