require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { PRIVATE_KEY, ETHEREUM_RPC_URL, BASE_RPC_URL, POLYGON_RPC_URL, ARBITRUM_RPC_URL, ETHERSCAN_API_KEY } =
  process.env;

const accounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {},
    ...(ETHEREUM_RPC_URL && { sepolia: { url: ETHEREUM_RPC_URL, accounts } }),
    ...(BASE_RPC_URL && { baseSepolia: { url: BASE_RPC_URL, accounts } }),
    ...(POLYGON_RPC_URL && { polygonAmoy: { url: POLYGON_RPC_URL, accounts } }),
    ...(ARBITRUM_RPC_URL && { arbitrumSepolia: { url: ARBITRUM_RPC_URL, accounts } }),
  },
  etherscan: { apiKey: ETHERSCAN_API_KEY || "" },
  gasReporter: { enabled: process.env.REPORT_GAS === "true" },
};
