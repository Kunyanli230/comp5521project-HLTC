// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Local test helper only. Public testnets use the configured Rain deployment.
contract TestToken is ERC20 {
    constructor(address owner, uint256 supply) ERC20("Test Rain", "tRAIN") {
        _mint(owner, supply);
    }
}
