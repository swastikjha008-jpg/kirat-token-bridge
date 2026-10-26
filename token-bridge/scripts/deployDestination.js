// Deploy the destination-chain side: BridgeDestination (which deploys WrappedKirat).
//
//   npx hardhat run scripts/deployDestination.js --network baseSepolia
//
// Env:
//   VALIDATORS       comma-separated validator addresses (required on live networks)
//   THRESHOLD        signatures required (default: majority)
//   REMOTE_CHAIN_ID  chain id of the HOME chain, e.g. 11155111 for Sepolia (required)
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");
const { loadValidatorConfig } = require("./lib/config");

async function main() {
  const [deployer] = await ethers.getSigners();
  const { validators, threshold } = await loadValidatorConfig(ethers);
  const remoteChainId = BigInt(process.env.REMOTE_CHAIN_ID || "0");
  if (remoteChainId === 0n) throw new Error("Set REMOTE_CHAIN_ID");

  const dest = await (await ethers.getContractFactory("BridgeDestination")).deploy(
    remoteChainId,
    validators,
    threshold,
    deployer.address
  );
  await dest.waitForDeployment();
  const destAddress = await dest.getAddress();
  const wrapped = await dest.wrappedToken();
  console.log("BridgeDestination deployed:", destAddress);
  console.log("WrappedKirat deployed:", wrapped);

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${network.name}-destination.json`),
    JSON.stringify(
      { chainId: Number((await ethers.provider.getNetwork()).chainId), bridgeDestination: destAddress, wrappedKirat: wrapped, remoteChainId: Number(remoteChainId), validators, threshold },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
