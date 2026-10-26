# Kirat Token Bridge

A **lock-and-mint / burn-and-release** ERC-20 bridge between a home chain (Ethereum) and a destination chain (Base / Polygon / Arbitrum), secured by an **M-of-N validator signature** scheme. Built with Hardhat and OpenZeppelin v5.

```
        HOME CHAIN (ETH)                                  DESTINATION (Base / Polygon / Arb)
 ┌─────────────────────────────┐                        ┌──────────────────────────────────┐
 │ BridgeSource                │                        │ BridgeDestination                │
 │   lock(amount, recipient)   │──── Locked event ─────▶│   mint(to, amount, nonce, sigs)  │
 │   release(..., nonce, sigs) │◀─── Burned event ──────│   burn(amount, recipient)        │
 │ Kirat (ERC-20)              │      ┌───────────┐     │ WrappedKirat / WKIRAT (ERC-20)   │
 └─────────────────────────────┘      │ validators│     └──────────────────────────────────┘
                                      │ (M-of-N)  │
                                      └───────────┘
```

## Flow

| Step | Chain | Call | Effect |
|------|-------|------|--------|
| 1 | Home | `BridgeSource.lock(amount, recipient)` | Kirat is locked in the bridge, `Locked(nonce, …)` is emitted |
| 2 | Off-chain | validators sign the EIP-712 `Transfer` message | one signature each |
| 3 | Destination | `BridgeDestination.mint(recipient, amount, lockNonce, sigs)` | WKirat is minted 1:1 |
| 4 | Destination | `BridgeDestination.burn(amount, recipient)` | WKirat is burned, `Burned(nonce, …)` is emitted |
| 5 | Off-chain | validators sign again | one signature each |
| 6 | Home | `BridgeSource.release(recipient, amount, burnNonce, sigs)` | Kirat is unlocked to `recipient` |

`mint` and `release` can be called by anyone (a relayer, or the user) — the signatures are the authorization.

**Invariant:** `BridgeSource.totalLocked == WrappedKirat.totalSupply` (and the Kirat balance of `BridgeSource` is at least `totalLocked`).

## Contracts

| File | Purpose |
|------|---------|
| `contracts/Kirat.sol` | Canonical ERC-20 on the home chain |
| `contracts/WrappedKirat.sol` | Wrapped ERC-20; only the bridge can mint/burn |
| `contracts/BridgeBase.sol` | Validator set, threshold, EIP-712 verification, replay protection, pause, reentrancy guard |
| `contracts/BridgeSource.sol` | Home side: `lock` / `release` |
| `contracts/BridgeDestination.sol` | Destination side: `mint` / `burn` (deploys `WrappedKirat` itself) |
| `contracts/mocks/FeeOnTransferToken.sol` | Test-only mock |

### Security design

- **Threshold signatures** — at least `threshold` distinct validators must sign. Signatures must be sorted by ascending signer address, which makes duplicates impossible to count twice.
- **EIP-712 domain separation** — the signed digest binds the chain id and the verifying contract, so a signature for one bridge cannot be replayed on the other (tested).
- **Replay protection** — each incoming `nonce` can be executed once (`processed[nonce]`), set before tokens move.
- **Checks-effects-interactions + `ReentrancyGuard`**, `SafeERC20`, custom errors.
- **Fee-on-transfer tokens are rejected** on lock so the 1:1 backing can't be broken.
- **`release` can never exceed `totalLocked`.**
- **Pausable** by the owner (emergency stop).

### Trust model and limits (read before mainnet)

- The bridge is only as trustworthy as its validators. A malicious majority (≥ threshold) can mint unbacked WKirat or drain locked Kirat. Use independent validators and a high threshold.
- The `owner` can add/remove validators, change the threshold and pause. On a live deployment make the owner a multisig / timelock, not an EOA.
- Validators must wait for sufficient block confirmations before signing, to avoid reorg attacks. This repo has the on-chain contracts and a signing helper (`scripts/lib/signing.js`); it does **not** include a production validator/relayer service.
- No per-transfer limits or rate limiting. Consider adding them.
- **Not audited.** Treat this as a learning / reference implementation.

## Getting started

```bash
npm install
npx hardhat compile
npx hardhat test
npx hardhat run scripts/demo.js     # end-to-end lock → mint → burn → release
npm run coverage                    # optional
```

## Deploy

```bash
cp .env.example .env     # fill PRIVATE_KEY, RPC URLs, VALIDATORS, THRESHOLD, REMOTE_CHAIN_ID

# 1) Home chain (e.g. Sepolia). REMOTE_CHAIN_ID = destination chain id (Base Sepolia = 84532)
REMOTE_CHAIN_ID=84532 npx hardhat run scripts/deploySource.js --network sepolia

# 2) Destination chain. REMOTE_CHAIN_ID = home chain id (Sepolia = 11155111)
REMOTE_CHAIN_ID=11155111 npx hardhat run scripts/deployDestination.js --network baseSepolia
```

Addresses are written to `deployments/<network>-{source,destination}.json` (git-ignored).

Available networks in `hardhat.config.js` appear when their RPC variable is set: `sepolia`, `baseSepolia`, `polygonAmoy`, `arbitrumSepolia`.

## Validator signing

```js
const { signTransfer } = require("./scripts/lib/signing");

// After a Locked event on the home chain, authorise the mint on the destination:
const sigs = await signTransfer([v1, v2, v3], destinationBridge, recipient, amount, lockNonce);
await destinationBridge.mint(recipient, amount, lockNonce, sigs);
```

`signTransfer` returns signatures already sorted the way the contracts expect.

## Project layout

```
contracts/   Solidity sources
test/        Hardhat tests (33 cases)
scripts/     deploy scripts, demo, signing helper
.github/     CI workflow
```

## License

MIT
