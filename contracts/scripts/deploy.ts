import { ethers } from "hardhat";

async function main() {
  console.log("🚀 Deploying Noderr Protocol Smart Contracts to Testnet...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  // Deploy NodeNFT
  console.log("📝 Deploying NodeNFT...");
  const NodeNFT = await ethers.getContractFactory("NodeNFT");
  const nodeNFT = await NodeNFT.deploy(
    "Noderr Node License",
    "NODERR",
    "https://api.noderr.xyz/metadata/",
    deployer.address
  );
  await nodeNFT.waitForDeployment();
  const nodeNFTAddress = await nodeNFT.getAddress();
  console.log("✅ NodeNFT deployed to:", nodeNFTAddress);

  // Deploy OracleVerifier
  console.log("\n📝 Deploying OracleVerifier...");
  const OracleVerifier = await ethers.getContractFactory("OracleVerifier");
  const oracleVerifier = await OracleVerifier.deploy(deployer.address);
  await oracleVerifier.waitForDeployment();
  const oracleVerifierAddress = await oracleVerifier.getAddress();
  console.log("✅ OracleVerifier deployed to:", oracleVerifierAddress);

  // Deploy GovernanceVoting
  console.log("\n📝 Deploying GovernanceVoting...");
  const GovernanceVoting = await ethers.getContractFactory("GovernanceVoting");
  const governanceVoting = await GovernanceVoting.deploy(
    nodeNFTAddress,
    deployer.address
  );
  await governanceVoting.waitForDeployment();
  const governanceVotingAddress = await governanceVoting.getAddress();
  console.log("✅ GovernanceVoting deployed to:", governanceVotingAddress);

  // Summary
  console.log("\n" + "=".repeat(80));
  console.log("📋 DEPLOYMENT SUMMARY");
  console.log("=".repeat(80));
  console.log("Network:", (await ethers.provider.getNetwork()).name);
  console.log("Chain ID:", (await ethers.provider.getNetwork()).chainId);
  console.log("Deployer:", deployer.address);
  console.log("\nContract Addresses:");
  console.log("  NodeNFT:          ", nodeNFTAddress);
  console.log("  OracleVerifier:   ", oracleVerifierAddress);
  console.log("  GovernanceVoting: ", governanceVotingAddress);
  console.log("=".repeat(80));

  // Save deployment addresses
  const fs = require("fs");
  const deploymentInfo = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      NodeNFT: nodeNFTAddress,
      OracleVerifier: oracleVerifierAddress,
      GovernanceVoting: governanceVotingAddress,
    },
  };

  fs.writeFileSync(
    "deployment-info.json",
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log("\n✅ Deployment info saved to deployment-info.json");

  // Verification instructions
  console.log("\n📌 To verify contracts on Etherscan:");
  console.log(`npx hardhat verify --network sepolia ${nodeNFTAddress} "Noderr Node License" "NODERR" "https://api.noderr.xyz/metadata/" ${deployer.address}`);
  console.log(`npx hardhat verify --network sepolia ${oracleVerifierAddress} ${deployer.address}`);
  console.log(`npx hardhat verify --network sepolia ${governanceVotingAddress} ${nodeNFTAddress} ${deployer.address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
