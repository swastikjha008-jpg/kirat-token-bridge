// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BridgeBase} from "./BridgeBase.sol";
import {WrappedKirat} from "./WrappedKirat.sol";

/// @title BridgeDestination
/// @notice Destination-chain side (Base / Polygon / Arbitrum) of the bridge.
///         - `mint` : Kirat was locked on the home chain -> validators sign -> WKirat is minted here
///         - `burn` : user burns WKirat -> validators sign -> Kirat is released on the home chain
///         Deploys and owns the WrappedKirat token (it is the only minter / burner).
contract BridgeDestination is BridgeBase {
    WrappedKirat public immutable wrappedToken;

    event Minted(uint256 indexed remoteNonce, address indexed recipient, uint256 amount);
    event Burned(uint256 indexed nonce, address indexed sender, address indexed recipient, uint256 amount, uint256 dstChainId);

    constructor(uint256 remoteChainId_, address[] memory validators_, uint256 threshold_, address owner_)
        BridgeBase("KiratBridgeDestination", remoteChainId_, validators_, threshold_, owner_)
    {
        wrappedToken = new WrappedKirat(address(this));
    }

    /// @notice Mint WKirat for `recipient` after a lock on the home chain.
    /// @param lockNonce Nonce of the `Locked` event on the home chain.
    function mint(address recipient, uint256 amount, uint256 lockNonce, bytes[] calldata signatures)
        external
        nonReentrant
        whenNotPaused
    {
        _consume(recipient, amount, lockNonce, signatures);
        wrappedToken.mint(recipient, amount);
        emit Minted(lockNonce, recipient, amount);
    }

    /// @notice Burn the caller's WKirat and request the original Kirat for `recipient` on the home chain.
    function burn(uint256 amount, address recipient) external nonReentrant whenNotPaused returns (uint256 id) {
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();

        wrappedToken.burnFrom(msg.sender, amount);

        id = nonce++;
        emit Burned(id, msg.sender, recipient, amount, remoteChainId);
    }
}
