/** Reads VALIDATORS / THRESHOLD from env. On the local hardhat network falls back to test accounts. */
async function loadValidatorConfig(ethers) {
  let validators = (process.env.VALIDATORS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (validators.length === 0) {
    const { chainId } = await ethers.provider.getNetwork();
    if (chainId !== 31337n) throw new Error("Set VALIDATORS=addr1,addr2,... for live networks");
    const signers = await ethers.getSigners();
    validators = await Promise.all(signers.slice(1, 4).map((s) => s.getAddress()));
  }

  for (const v of validators) {
    if (!ethers.isAddress(v)) throw new Error(`Invalid validator address: ${v}`);
  }
  if (new Set(validators.map((v) => v.toLowerCase())).size !== validators.length) {
    throw new Error("Duplicate validator address");
  }

  const threshold = Number(process.env.THRESHOLD || Math.floor(validators.length / 2) + 1);
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > validators.length) {
    throw new Error(`THRESHOLD must be between 1 and ${validators.length}`);
  }
  return { validators, threshold };
}

module.exports = { loadValidatorConfig };
