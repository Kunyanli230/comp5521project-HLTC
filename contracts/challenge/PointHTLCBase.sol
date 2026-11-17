// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PointLock} from "./PointLock.sol";

/// @notice Shared settlement rules for escrows locked to a secp256k1 point address.
/// @dev AI-assisted adaptation of HTLCBase for point locks.
abstract contract PointHTLCBase is ReentrancyGuard {
    enum Status { None, Active, Claimed, Refunded }
    struct Swap {
        address sender;
        address receiver;
        address token;
        uint256 amount;
        address pointLock;
        uint256 timelock;
        Status status;
    }
    mapping(bytes32 => Swap) public swaps;
    event SwapCreated(bytes32 indexed swapId, address indexed sender, address indexed receiver,
        address token, uint256 amount, address pointLock, uint256 timelock);
    event SwapClaimed(bytes32 indexed swapId, uint256 secret);
    event SwapRefunded(bytes32 indexed swapId);
    error InvalidInput();
    error SwapAlreadyExists();
    error SwapNotFound();
    error NotReceiver();
    error NotSender();
    error InvalidSecret();
    error ClaimExpired();
    error RefundNotReady();
    error AlreadyCompleted();
    function _create(bytes32 swapId, address receiver, address token, uint256 amount,
        address pointLock, uint256 timelock) internal {
        if (swapId == bytes32(0) || pointLock == address(0) || receiver == address(0)
            || receiver == msg.sender || amount == 0 || timelock <= block.timestamp) revert InvalidInput();
        if (swaps[swapId].status != Status.None) revert SwapAlreadyExists();
        swaps[swapId] = Swap(msg.sender, receiver, token, amount, pointLock, timelock, Status.Active);
        emit SwapCreated(swapId, msg.sender, receiver, token, amount, pointLock, timelock);
    }
    function claim(bytes32 swapId, uint256 secret) external nonReentrant {
        Swap storage swap = swaps[swapId];
        if (swap.status == Status.None) revert SwapNotFound();
        if (msg.sender != swap.receiver) revert NotReceiver();
        if (swap.status != Status.Active) revert AlreadyCompleted();
        if (block.timestamp >= swap.timelock) revert ClaimExpired();
        if (PointLock.pointAddress(secret) != swap.pointLock) revert InvalidSecret();
        swap.status = Status.Claimed;
        _pay(swap.token, swap.receiver, swap.amount);
        emit SwapClaimed(swapId, secret);
    }
    function refund(bytes32 swapId) external nonReentrant {
        Swap storage swap = swaps[swapId];
        if (swap.status == Status.None) revert SwapNotFound();
        if (msg.sender != swap.sender) revert NotSender();
        if (swap.status != Status.Active) revert AlreadyCompleted();
        if (block.timestamp < swap.timelock) revert RefundNotReady();
        swap.status = Status.Refunded;
        _pay(swap.token, swap.sender, swap.amount);
        emit SwapRefunded(swapId);
    }
    function _pay(address token, address receiver, uint256 amount) internal virtual;
}
