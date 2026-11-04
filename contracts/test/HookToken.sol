// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice TEST ONLY — never deployed to a public network.
/// An ERC20 with transfer callbacks (similar in spirit to ERC777 hooks), used to
/// give an attacker a chance to run code in the middle of an ERC20HTLC call:
///  - hookReceiver: after tokens arrive there, call onTokenReceived() on it
///    (lets ReentrantReceiver re-enter claim/refund during an ERC20 payout).
///  - lockReentryTarget: when tokens arrive at that HTLC (i.e. inside
///    createERC20Swap's transferFrom), the token itself calls createERC20Swap
///    again, simulating a malicious token re-entering the lock function.
interface ITokenReceiver {
    function onTokenReceived(address from, uint256 amount) external;
}

interface IERC20HTLCLike {
    function createERC20Swap(bytes32 swapId, address receiver, address token, uint256 amount,
        bytes32 hashlock, uint256 timelock) external;
}

contract HookToken is ERC20 {
    address public hookReceiver;
    address public lockReentryTarget;

    constructor(address owner, uint256 supply) ERC20("Hook Rain", "hRAIN") {
        _mint(owner, supply);
    }

    function setHookReceiver(address receiver) external {
        hookReceiver = receiver;
    }

    function setLockReentryTarget(address htlc) external {
        lockReentryTarget = htlc;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (from == address(0) || to == address(0)) return; // no hooks on mint/burn

        if (to == hookReceiver) {
            ITokenReceiver(to).onTokenReceived(from, value);
        }
        if (to == lockReentryTarget) {
            // Any revert here (expected: ReentrancyGuardReentrantCall) bubbles up through
            // SafeERC20 and makes the outer createERC20Swap fail.
            IERC20HTLCLike(to).createERC20Swap(keccak256("reentry"), address(0xBEEF), address(this), 1,
                keccak256("hash"), block.timestamp + 1 days);
        }
    }
}
