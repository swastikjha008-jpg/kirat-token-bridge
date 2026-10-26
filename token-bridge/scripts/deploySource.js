// Deploy the home-chain side: Kirat (optional) + BridgeSource.
//
//   npx hardhat run scripts/deploySource.js --network sepolia
//
// Env:
//   VALIDATORS       comma-separated validator addresses (required on live networks)
//   THRESHOLD        signatures required (default: majority)
//   REMOTE_CHAIN_ID  chain id of the destination chain, e.g. 84532 for Base Sepolia (required)
//   KIRAT_ADDRESS    existing ERC-20 to bridge; if empty, a new Kirat token is deployed
//   INITIAL_SUPPLY   supply (in whole tokens) when deploying a new Kirat (default 1,000,000)
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");
const { loadValidatorConfig } = require("./lib/config");

async function main() {
  const [deployer] = await ethers.getSigners();
  const { validators, threshold } = await loadValidatorConfig(ethers);
  const remoteChainId = BigInt(process.env.REMOTE_CHAIN_ID || "0");
  if (remoteChainId === 0n) throw new Error("Set REMOTE_CHAIN_ID");

  let tokenAddress = process.env.KIRAT_ADDRESS;
  if (!tokenAddress) {
    const supply = ethers.parseEther(process.env.INITIAL_SUPPLY || "1000000");
    const kirat = await (await ethers.getContractFactory("Kirat")).deploy(supply, deployer.address);
    await kirat.waitForDeployment();
    tokenAddress = await kirat.getAddress();
    console.log("Kirat deployed:", tokenAddress);
  }

  const source = await (await ethers.getContractFactory("BridgeSource")).deploy(
    tokenAddress,
    remoteChainId,
    validators,
    threshold,
    deployer.address
  );
  await source.waitForDeployment();
  const sourceAddress = await source.getAddress();
  console.log("BridgeSource deployed:", sourceAddress);

  save(network.name, { chainId: Number((await ethers.provider.getNetwork()).chainId), kirat: tokenAddress, bridgeSource: sourceAddress, remoteChainId: Number(remoteChainId), validators, threshold });
}

function save(name, data) {
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}-source.json`), JSON.stringify(data, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
