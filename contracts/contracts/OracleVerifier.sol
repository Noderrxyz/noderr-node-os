// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title OracleVerifier
 * @notice Verifies BFT consensus signatures from Oracle nodes for ML trading signals
 * @dev Implements Byzantine Fault Tolerant consensus verification on-chain
 */
contract OracleVerifier is AccessControl {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    
    uint256 public constant MIN_CONSENSUS_THRESHOLD = 67; // 67% for BFT (2f+1)
    uint256 public constant MAX_SIGNAL_AGE = 60; // 60 seconds max age
    
    struct OracleSignal {
        string symbol;
        int256 prediction;
        uint256 confidence;
        uint256 timestamp;
        bytes32 modelHash;
    }
    
    struct ConsensusProof {
        OracleSignal signal;
        address[] signers;
        bytes[] signatures;
        uint256 totalWeight;
    }
    
    mapping(address => uint256) public oracleWeights;
    mapping(bytes32 => bool) public verifiedSignals;
    mapping(address => uint256) public oracleStake;
    
    uint256 public totalOracleWeight;
    uint256 public activeOracleCount;
    uint256 public minStakeRequired = 1000 ether; // Minimum stake to become oracle
    
    event OracleRegistered(address indexed oracle, uint256 weight, uint256 stake);
    event OracleRemoved(address indexed oracle);
    event SignalVerified(bytes32 indexed signalHash, string symbol, int256 prediction, uint256 confidence);
    event ConsensusReached(bytes32 indexed signalHash, uint256 signerCount, uint256 totalWeight);
    event SlashingExecuted(address indexed oracle, uint256 amount, string reason);
    
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, admin);
    }
    
    /**
     * @notice Register a new oracle node with staking
     * @param oracle Address of the oracle node
     * @param weight Voting weight for this oracle
     */
    function registerOracle(address oracle, uint256 weight) external payable onlyRole(GUARDIAN_ROLE) {
        require(oracle != address(0), "Invalid oracle address");
        require(weight > 0, "Weight must be positive");
        require(msg.value >= minStakeRequired, "Insufficient stake");
        require(oracleWeights[oracle] == 0, "Oracle already registered");
        
        oracleWeights[oracle] = weight;
        oracleStake[oracle] = msg.value;
        totalOracleWeight += weight;
        activeOracleCount++;
        
        _grantRole(ORACLE_ROLE, oracle);
        
        emit OracleRegistered(oracle, weight, msg.value);
    }
    
    /**
     * @notice Remove an oracle node and return stake
     * @param oracle Address of the oracle to remove
     */
    function removeOracle(address oracle) external onlyRole(GUARDIAN_ROLE) {
        require(oracleWeights[oracle] > 0, "Oracle not registered");
        
        uint256 weight = oracleWeights[oracle];
        uint256 stake = oracleStake[oracle];
        
        totalOracleWeight -= weight;
        activeOracleCount--;
        
        delete oracleWeights[oracle];
        delete oracleStake[oracle];
        
        _revokeRole(ORACLE_ROLE, oracle);
        
        // Return stake
        if (stake > 0) {
            payable(oracle).transfer(stake);
        }
        
        emit OracleRemoved(oracle);
    }
    
    /**
     * @notice Verify BFT consensus for an ML trading signal
     * @param signal The oracle signal to verify
     * @param signers Array of oracle addresses that signed
     * @param signatures Array of signatures from oracles
     * @return signalHash Hash of the verified signal
     */
    function verifyConsensus(
        OracleSignal calldata signal,
        address[] calldata signers,
        bytes[] calldata signatures
    ) external returns (bytes32 signalHash) {
        require(signers.length == signatures.length, "Mismatched arrays");
        require(signers.length >= 3, "Minimum 3 signers required");
        require(block.timestamp - signal.timestamp <= MAX_SIGNAL_AGE, "Signal too old");
        
        // Compute signal hash
        signalHash = keccak256(abi.encode(
            signal.symbol,
            signal.prediction,
            signal.confidence,
            signal.timestamp,
            signal.modelHash
        ));
        
        require(!verifiedSignals[signalHash], "Signal already verified");
        
        // Verify signatures and calculate consensus weight
        uint256 consensusWeight = 0;
        address lastSigner = address(0);
        
        for (uint256 i = 0; i < signers.length; i++) {
            address signer = signers[i];
            
            // Ensure signers are sorted and unique
            require(signer > lastSigner, "Signers must be sorted and unique");
            lastSigner = signer;
            
            // Verify oracle is registered
            require(hasRole(ORACLE_ROLE, signer), "Signer not registered oracle");
            
            // Verify signature
            bytes32 messageHash = signalHash.toEthSignedMessageHash();
            address recovered = messageHash.recover(signatures[i]);
            require(recovered == signer, "Invalid signature");
            
            // Add oracle weight to consensus
            consensusWeight += oracleWeights[signer];
        }
        
        // Check if consensus threshold is met (67% for BFT)
        uint256 consensusPercentage = (consensusWeight * 100) / totalOracleWeight;
        require(consensusPercentage >= MIN_CONSENSUS_THRESHOLD, "Consensus threshold not met");
        
        // Mark signal as verified
        verifiedSignals[signalHash] = true;
        
        emit ConsensusReached(signalHash, signers.length, consensusWeight);
        emit SignalVerified(signalHash, signal.symbol, signal.prediction, signal.confidence);
        
        return signalHash;
    }
    
    /**
     * @notice Slash an oracle for malicious behavior
     * @param oracle Address of the oracle to slash
     * @param amount Amount to slash from stake
     * @param reason Reason for slashing
     */
    function slashOracle(
        address oracle,
        uint256 amount,
        string calldata reason
    ) external onlyRole(GUARDIAN_ROLE) {
        require(oracleStake[oracle] >= amount, "Insufficient stake to slash");
        
        oracleStake[oracle] -= amount;
        
        // Transfer slashed amount to treasury (admin)
        payable(msg.sender).transfer(amount);
        
        emit SlashingExecuted(oracle, amount, reason);
    }
    
    /**
     * @notice Check if a signal has been verified
     * @param signalHash Hash of the signal
     * @return bool True if verified
     */
    function isSignalVerified(bytes32 signalHash) external view returns (bool) {
        return verifiedSignals[signalHash];
    }
    
    /**
     * @notice Get oracle information
     * @param oracle Address of the oracle
     * @return weight Voting weight
     * @return stake Staked amount
     * @return isActive Whether oracle is active
     */
    function getOracleInfo(address oracle) external view returns (
        uint256 weight,
        uint256 stake,
        bool isActive
    ) {
        return (
            oracleWeights[oracle],
            oracleStake[oracle],
            hasRole(ORACLE_ROLE, oracle)
        );
    }
    
    /**
     * @notice Update minimum stake requirement
     * @param newMinStake New minimum stake amount
     */
    function updateMinStake(uint256 newMinStake) external onlyRole(DEFAULT_ADMIN_ROLE) {
        minStakeRequired = newMinStake;
    }
    
    /**
     * @notice Emergency pause - revoke all oracle roles
     */
    function emergencyPause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        // This would require iterating over all oracles
        // In production, implement a pausable pattern
        activeOracleCount = 0;
    }
}
