// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title WrappedKirat (WKirat)
/// @notice Wrapped representation of Kirat on a destination chain
///         (Base / Polygon / Arbitrum). Only the bridge may mint and burn.
contract WrappedKirat is ERC20 {
    address public immutable bridge;

    error NotBridge();
    error ZeroAddress();

    modifier onlyBridge() {
        if (msg.sender != bridge) revert NotBridge();
        _;
    }

    constructor(address bridge_) ERC20("Wrapped Kirat", "WKIRAT") {
        if (bridge_ == address(0)) revert ZeroAddress();
        bridge = bridge_;
    }

    /// @notice Mint wrapped tokens. Called by the bridge after a lock on the home chain.
    function mint(address to, uint256 amount) external onlyBridge {
        _mint(to, amount);
    }

    /// @notice Burn `amount` from `from`. Called by the bridge on behalf of the
    ///         user who initiated the bridge-back (msg.sender of `BridgeDestination.burn`),
    ///         so no allowance is required.
    function burnFrom(address from, uint256 amount) external onlyBridge {
        _burn(from, amount);
    }
}
