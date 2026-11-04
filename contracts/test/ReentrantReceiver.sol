// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice TEST ONLY — never deployed to a public network.
/// Malicious swap participant. When the HTLC pays it (ETH via receive(), or a
/// HookToken via onTokenReceived()), it immediately calls back into the HTLC's
/// claim() or refund(). HTLCBase marks both functions nonReentrant, so the
/// nested call must revert with ReentrancyGuardReentrantCall.
///
/// bubble = false: swallow the nested failure and record it in lastError, so
///                 the test can check *why* it failed while the outer payment succeeds.
/// bubble = true : re-throw the nested failure, so the test can check that the
///                 outer claim/refund is rolled back as a whole.
interface IERC20Approve {
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IHTLCLike {
    function createERC20Swap(bytes32 swapId, address receiver, address token, uint256 amount,
        bytes32 hashlock, uint256 timelock) external;
    function createETHSwap(bytes32 swapId, address receiver, bytes32 hashlock, uint256 timelock) external payable;
    function claim(bytes32 swapId, bytes32 preimage) external;
    function refund(bytes32 swapId) external;
}

contract ReentrantReceiver {
    enum Attack { None, Claim, Refund }

    IHTLCLike public immutable htlc;

    Attack public attack;
    bytes32 public targetId;
    bytes32 public targetPreimage;
    bool public bubble;

    uint256 public attempts; // how many times a re-entry was tried
    bool public reentrySucceeded; // must stay false
    bytes public lastError; // revert data of the nested call

    constructor(address htlc_) {
        htlc = IHTLCLike(htlc_);
    }

    function setAttack(Attack attack_, bytes32 id, bytes32 preimage, bool bubble_) external {
        attack = attack_;
        targetId = id;
        targetPreimage = preimage;
        bubble = bubble_;
    }

    function lockETH(bytes32 swapId, address receiver, bytes32 hashlock, uint256 timelock) external payable {
        htlc.createETHSwap{value: msg.value}(swapId, receiver, hashlock, timelock);
    }

    /// Lock tokens this contract owns, with this contract as the swap sender (so it can refund).
    function lockERC20(bytes32 swapId, address receiver, address token, uint256 amount, bytes32 hashlock,
        uint256 timelock) external {
        IERC20Approve(token).approve(address(htlc), amount);
        htlc.createERC20Swap(swapId, receiver, token, amount, hashlock, timelock);
    }

    function claim(bytes32 swapId, bytes32 preimage) external {
        htlc.claim(swapId, preimage);
    }

    function refund(bytes32 swapId) external {
        htlc.refund(swapId);
    }

    /// ETH payment callback.
    receive() external payable {
        _reenter();
    }

    /// Token payment callback, called by HookToken after a transfer to this contract.
    function onTokenReceived(address, uint256) external {
        _reenter();
    }

    function _reenter() internal {
        if (attack == Attack.None) return;
        Attack current = attack;
        attack = Attack.None; // one shot, avoids infinite recursion if the guard were missing
        attempts += 1;

        bool ok;
        bytes memory err;
        if (current == Attack.Claim) {
            try htlc.claim(targetId, targetPreimage) { ok = true; } catch (bytes memory e) { err = e; }
        } else {
            try htlc.refund(targetId) { ok = true; } catch (bytes memory e) { err = e; }
        }

        if (ok) {
            reentrySucceeded = true;
            return;
        }
        lastError = err;
        if (bubble) {
            assembly {
                revert(add(err, 32), mload(err))
            }
        }
    }
}
