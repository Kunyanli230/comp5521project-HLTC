// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../challenge/PointLock.sol";

/// @notice TEST ONLY — never deployed to a public network.
/// Exposes the internal PointLock.pointAddress() so tests can compare it with ethers.
contract PointLockHarness {
    function pointAddress(uint256 scalar) external pure returns (address) {
        return PointLock.pointAddress(scalar);
    }
}
