/**
 * Validator-side helper: signs the EIP-712 `Transfer` approval and returns
 * signatures sorted by ascending signer address (the order the contracts require).
 */
const TRANSFER_TYPES = {
  Transfer: [
    { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "sourceChainId", type: "uint256" },
  ],
};

/**
 * @param {import("ethers").Signer[]} validators  signers that approve
 * @param {import("ethers").Contract} bridge      bridge that will EXECUTE the message (destination of the transfer)
 * @param {string} recipient
 * @param {bigint} amount
 * @param {bigint|number} nonce                   nonce of the Locked / Burned event on the other chain
 * @returns {Promise<string[]>}
 */
async function signTransfer(validators, bridge, recipient, amount, nonce) {
  const { chainId } = await bridge.runner.provider.getNetwork();
  const domain = {
    name: await getEip712Name(bridge),
    version: "1",
    chainId,
    verifyingContract: await bridge.getAddress(),
  };
  const value = {
    recipient,
    amount,
    nonce,
    sourceChainId: await bridge.remoteChainId(),
  };

  const signed = [];
  for (const v of validators) {
    signed.push({ signer: BigInt(await v.getAddress()), sig: await v.signTypedData(domain, TRANSFER_TYPES, value) });
  }
  signed.sort((a, b) => (a.signer < b.signer ? -1 : a.signer > b.signer ? 1 : 0));
  return signed.map((s) => s.sig);
}

// EIP-712 domain name is fixed per contract; read it from eip712Domain() (EIP-5267).
async function getEip712Name(bridge) {
  const d = await bridge.eip712Domain();
  return d.name;
}

module.exports = { signTransfer, TRANSFER_TYPES };
