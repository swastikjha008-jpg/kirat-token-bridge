// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {BridgeBase} from "./BridgeBase.sol";

/// @title BridgeSource
/// @notice Home-chain side (e.g. Ethereum) of the bridge.
///         - `lock`    : user deposits Kirat -> validators sign -> WKirat is minted on the other chain
///         - `release` : WKirat was burned on the other chain -> validators sign -> Kirat is unlocked here
contract BridgeSource is BridgeBase {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    /// @notice Total Kirat currently locked (backs 1:1 the WKirat supply on the remote chain).
    uint256 public totalLocked;

    event Locked(uint256 indexed nonce, address indexed sender, address indexed recipient, uint256 amount, uint256 dstChainId);
    event Released(uint256 indexed remoteNonce, address indexed recipient, uint256 amount);

    error TransferAmountMismatch();
    error InsufficientLocked();

    constructor(
        IERC20 token_,
        uint256 remoteChainId_,
        address[] memory validators_,
        uint256 threshold_,
        address owner_
    ) BridgeBase("KiratBridgeSource", remoteChainId_, validators_, threshold_, owner_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
    }

    /// @notice Lock `amount` Kirat and request WKirat for `recipient` on the remote chain.
    /// @dev Caller must `approve` this contract first. Fee-on-transfer tokens are rejected.
    function lock(uint256 amount, address recipient) external nonReentrant whenNotPaused returns (uint256 id) {
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();

        uint256 balBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - balBefore != amount) revert TransferAmountMismatch();

        totalLocked += amount;
        id = nonce++;
        emit Locked(id, msg.sender, recipient, amount, remoteChainId);
    }

    /// @notice Unlock Kirat for `recipient` after WKirat was burned on the remote chain.
    /// @param burnNonce Nonce of the `Burned` event on the remote chain.
    /// @param signatures Validator signatures (sorted by ascending signer address).
    function release(address recipient, uint256 amount, uint256 burnNonce, bytes[] calldata signatures)
        external
        nonReentrant
        whenNotPaused
    {
        _consume(recipient, amount, burnNonce, signatures);
        if (amount > totalLocked) revert InsufficientLocked();

        totalLocked -= amount;
        token.safeTransfer(recipient, amount);
        emit Released(burnNonce, recipient, amount);
    }
}
