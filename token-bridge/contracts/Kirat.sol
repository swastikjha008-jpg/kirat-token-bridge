// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Kirat
/// @notice Canonical ERC-20 on the home chain (e.g. Ethereum). Tokens are
///         locked in `BridgeSource` when bridged out.
contract Kirat is ERC20 {
    constructor(uint256 initialSupply, address initialHolder) ERC20("Kirat", "KIRAT") {
        _mint(initialHolder, initialSupply);
    }
}
