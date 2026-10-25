// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Shared interface for independent escrows. No cross-chain calls.
/// @dev AI-assisted integration baseline; see docs/AI_ASSISTANCE.md.
abstract contract HTLCBase is ReentrancyGuard {
    enum Status { None, Active, Claimed, Refunded }
    struct Swap {
        address sender;
        address receiver;
        address token;
        uint256 amount;
        bytes32 hashlock;
        uint256 timelock;
        Status status;
    }
    mapping(bytes32 => Swap) public swaps;
    event SwapCreated(bytes32 indexed swapId, address indexed sender, address indexed receiver,
        address token, uint256 amount, bytes32 hashlock, uint256 timelock);
    event SwapClaimed(bytes32 indexed swapId, bytes32 preimage);
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
        bytes32 hashlock, uint256 timelock) internal {
        if (swapId == bytes32(0) || hashlock == bytes32(0) || receiver == address(0)
            || receiver == msg.sender || amount == 0 || timelock <= block.timestamp) revert InvalidInput();
        if (swaps[swapId].status != Status.None) revert SwapAlreadyExists();
        swaps[swapId] = Swap(msg.sender, receiver, token, amount, hashlock, timelock, Status.Active);
        emit SwapCreated(swapId, msg.sender, receiver, token, amount, hashlock, timelock);
    }
    function claim(bytes32 swapId, bytes32 preimage) external nonReentrant {
        Swap storage swap = swaps[swapId];
        if (swap.status == Status.None) revert SwapNotFound();
        if (msg.sender != swap.receiver) revert NotReceiver();
        if (swap.status != Status.Active) revert AlreadyCompleted();
        if (block.timestamp >= swap.timelock) revert ClaimExpired();
        if (keccak256(abi.encodePacked(preimage)) != swap.hashlock) revert InvalidSecret();
        swap.status = Status.Claimed;
        _pay(swap.token, swap.receiver, swap.amount);
        emit SwapClaimed(swapId, preimage);
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
