// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../contracts/NodeNFT.sol";
import "../contracts/OracleVerifier.sol";
import "../contracts/GovernanceVoting.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("Deploying contracts with address:", deployer);
        console.log("Account balance:", deployer.balance);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy NodeNFT
        console.log("\nDeploying NodeNFT...");
        NodeNFT nodeNFT = new NodeNFT(
            "Noderr Node License",
            "NODERR",
            "https://api.noderr.xyz/metadata/",
            deployer
        );
        console.log("NodeNFT deployed to:", address(nodeNFT));
        
        // Deploy OracleVerifier
        console.log("\nDeploying OracleVerifier...");
        OracleVerifier oracleVerifier = new OracleVerifier(deployer);
        console.log("OracleVerifier deployed to:", address(oracleVerifier));
        
        // Deploy GovernanceVoting
        console.log("\nDeploying GovernanceVoting...");
        GovernanceVoting governance = new GovernanceVoting(
            address(nodeNFT),
            deployer
        );
        console.log("GovernanceVoting deployed to:", address(governance));
        
        vm.stopBroadcast();
        
        // Save deployment addresses
        console.log("\n========================================");
        console.log("DEPLOYMENT SUMMARY");
        console.log("========================================");
        console.log("Network: Base Sepolia");
        console.log("Deployer:", deployer);
        console.log("");
        console.log("Contract Addresses:");
        console.log("  NodeNFT:          ", address(nodeNFT));
        console.log("  OracleVerifier:   ", address(oracleVerifier));
        console.log("  GovernanceVoting: ", address(governance));
        console.log("========================================");
    }
}
