// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice A deliberately small, single-chain HTLC used in class.
/// It can escrow either the Rain token or native Sepolia ETH.
contract SimpleHTLC is ReentrancyGuard {
    enum AssetType { ERC20, ETH }

    struct Swap {
        address sender;
        address receiver;
        address token;
        uint256 amount;
        bytes32 hashlock;
        uint256 timelock;
        AssetType assetType;
        bool claimed;
    }

    mapping(bytes32 => Swap) public swaps;

    event SwapCreated(bytes32 indexed swapId, address indexed sender, address indexed receiver,
        AssetType assetType, address token, uint256 amount, bytes32 hashlock, uint256 timelock);
    event SwapClaimed(bytes32 indexed swapId, bytes32 preimage);

    error InvalidInput();
    error SwapAlreadyExists();
    error SwapNotFound();
    error NotReceiver();
    error InvalidSecret();
    error ClaimExpired();
    error AlreadyCompleted();

    function createERC20Swap(bytes32 swapId, address receiver, address token, uint256 amount,
        bytes32 hashlock, uint256 timelock) external nonReentrant {
        if (receiver == address(0) || token == address(0) || amount == 0 || timelock <= block.timestamp) revert InvalidInput();
        if (swaps[swapId].sender != address(0)) revert SwapAlreadyExists();
        if (!IERC20(token).transferFrom(msg.sender, address(this), amount)) revert InvalidInput();
        swaps[swapId] = Swap(msg.sender, receiver, token, amount, hashlock, timelock, AssetType.ERC20, false);
        emit SwapCreated(swapId, msg.sender, receiver, AssetType.ERC20, token, amount, hashlock, timelock);
    }

    function createETHSwap(bytes32 swapId, address receiver, bytes32 hashlock, uint256 timelock)
        external payable nonReentrant {
        if (receiver == address(0) || msg.value == 0 || timelock <= block.timestamp) revert InvalidInput();
        if (swaps[swapId].sender != address(0)) revert SwapAlreadyExists();
        swaps[swapId] = Swap(msg.sender, receiver, address(0), msg.value, hashlock, timelock, AssetType.ETH, false);
        emit SwapCreated(swapId, msg.sender, receiver, AssetType.ETH, address(0), msg.value, hashlock, timelock);
    }

    function claim(bytes32 swapId, bytes32 preimage) external nonReentrant {
        Swap storage swap = swaps[swapId];
        if (swap.sender == address(0)) revert SwapNotFound();
        if (msg.sender != swap.receiver) revert NotReceiver();
        if (swap.claimed) revert AlreadyCompleted();
        if (block.timestamp >= swap.timelock) revert ClaimExpired();
        if (keccak256(abi.encodePacked(preimage)) != swap.hashlock) revert InvalidSecret();
        swap.claimed = true;
        if (swap.assetType == AssetType.ERC20) {
            if (!IERC20(swap.token).transfer(swap.receiver, swap.amount)) revert InvalidInput();
        } else {
            (bool ok, ) = payable(swap.receiver).call{value: swap.amount}("");
            require(ok, "ETH transfer failed");
        }
        emit SwapClaimed(swapId, preimage);
    }

}
