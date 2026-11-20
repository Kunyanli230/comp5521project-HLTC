// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Challenge Part helper: on-chain check for a secp256k1 point lock.
/// @dev AI-assisted (function-level); see docs/AI_ASSISTANCE.md.
library PointLock {
    uint256 private constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
    uint256 private constant GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798;

    /// @dev Returns the Ethereum address of scalar*G, or address(0) if scalar is not in [1, n-1].
    function pointAddress(uint256 scalar) internal pure returns (address) {
        if (scalar == 0 || scalar >= N) return address(0);

        // With hash zero and R = G (even y, v = 27), recovery gives (s / GX) * G.
        bytes32 s = bytes32(mulmod(scalar, GX, N));
        return ecrecover(bytes32(0), 27, bytes32(GX), s);
    }
}
