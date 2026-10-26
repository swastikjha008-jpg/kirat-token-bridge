// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title BridgeBase
/// @notice Shared logic for both sides of the bridge:
///         - validator set with an M-of-N signature threshold (the "relayers" in the diagram)
///         - EIP-712 typed approvals (bound to chain id + contract address)
///         - per-message replay protection
///         - pause switch and reentrancy guard
///
/// Message flow:
///   chain A: user locks / burns  -> event with a unique nonce
///   validators observe the event, each signs `Transfer(recipient, amount, nonce, sourceChainId)`
///   chain B: anyone submits >= threshold signatures -> bridge releases / mints
abstract contract BridgeBase is Ownable, Pausable, ReentrancyGuard, EIP712 {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    bytes32 public constant TRANSFER_TYPEHASH =
        keccak256("Transfer(address recipient,uint256 amount,uint256 nonce,uint256 sourceChainId)");

    uint256 public constant MAX_VALIDATORS = 50;

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    /// @notice Chain id of the other side of the bridge.
    uint256 public immutable remoteChainId;

    /// @notice Outgoing message counter (lock on source / burn on destination).
    uint256 public nonce;

    /// @notice Incoming nonces (from the remote chain) that were already executed.
    mapping(uint256 remoteNonce => bool) public processed;

    mapping(address => bool) public isValidator;
    uint256 public validatorCount;
    uint256 public threshold;

    // ---------------------------------------------------------------------
    // Events / errors
    // ---------------------------------------------------------------------

    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);
    event ThresholdChanged(uint256 threshold);

    error ZeroAddress();
    error ZeroAmount();
    error InvalidThreshold();
    error AlreadyValidator();
    error NotValidator();
    error TooManyValidators();
    error AlreadyProcessed();
    error NotEnoughSignatures();
    error InvalidSignatureOrder();
    error InvalidSigner();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(
        string memory eip712Name,
        uint256 remoteChainId_,
        address[] memory validators_,
        uint256 threshold_,
        address owner_
    ) Ownable(owner_) EIP712(eip712Name, "1") {
        remoteChainId = remoteChainId_;

        for (uint256 i = 0; i < validators_.length; i++) {
            _addValidator(validators_[i]);
        }
        _setThreshold(threshold_);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function addValidator(address validator) external onlyOwner {
        _addValidator(validator);
    }

    /// @dev Reverts if removal would leave fewer validators than the threshold.
    function removeValidator(address validator) external onlyOwner {
        if (!isValidator[validator]) revert NotValidator();
        if (validatorCount - 1 < threshold) revert InvalidThreshold();
        isValidator[validator] = false;
        validatorCount--;
        emit ValidatorRemoved(validator);
    }

    function setThreshold(uint256 newThreshold) external onlyOwner {
        _setThreshold(newThreshold);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice EIP-712 digest validators must sign for a given transfer.
    function hashTransfer(address recipient, uint256 amount, uint256 remoteNonce) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(TRANSFER_TYPEHASH, recipient, amount, remoteNonce, remoteChainId))
        );
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _addValidator(address validator) internal {
        if (validator == address(0)) revert ZeroAddress();
        if (isValidator[validator]) revert AlreadyValidator();
        if (validatorCount >= MAX_VALIDATORS) revert TooManyValidators();
        isValidator[validator] = true;
        validatorCount++;
        emit ValidatorAdded(validator);
    }

    function _setThreshold(uint256 newThreshold) internal {
        if (newThreshold == 0 || newThreshold > validatorCount) revert InvalidThreshold();
        threshold = newThreshold;
        emit ThresholdChanged(newThreshold);
    }

    /// @dev Verifies the approval, marks `remoteNonce` as processed (checks-effects-interactions:
    ///      callers perform the token movement AFTER this returns).
    ///      Signatures must be from distinct validators, sorted by ascending signer address.
    function _consume(address recipient, uint256 amount, uint256 remoteNonce, bytes[] calldata signatures) internal {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (processed[remoteNonce]) revert AlreadyProcessed();
        if (signatures.length < threshold) revert NotEnoughSignatures();

        bytes32 digest = hashTransfer(recipient, amount, remoteNonce);

        address last = address(0);
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = ECDSA.recover(digest, signatures[i]);
            if (signer <= last) revert InvalidSignatureOrder();
            if (!isValidator[signer]) revert InvalidSigner();
            last = signer;
        }

        processed[remoteNonce] = true;
    }
}
