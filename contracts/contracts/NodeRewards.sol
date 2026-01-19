// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./NodeNFT.sol";

/**
 * @title NodeRewards
 * @notice Manages reward distribution for node operators based on performance
 * @dev Integrates with NodeNFT for reputation and node metadata
 */
contract NodeRewards is AccessControl, ReentrancyGuard {
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    
    NodeNFT public immutable nodeNFT;
    
    // Reward pools by node type
    mapping(NodeNFT.NodeType => uint256) public rewardPools;
    
    // Reward rates per epoch (1 epoch = 1 day)
    mapping(NodeNFT.NodeType => uint256) public baseRewardRates;
    
    // Pending rewards for each node
    mapping(uint256 => uint256) public pendingRewards;
    
    // Last reward calculation timestamp for each node
    mapping(uint256 => uint256) public lastRewardUpdate;
    
    // Total rewards distributed
    uint256 public totalRewardsDistributed;
    
    // Reward multipliers based on reputation (in basis points, 10000 = 1x)
    uint256 public constant MIN_REPUTATION_MULTIPLIER = 5000;  // 0.5x at 0 reputation
    uint256 public constant MAX_REPUTATION_MULTIPLIER = 15000; // 1.5x at 1000 reputation
    
    event RewardPoolFunded(NodeNFT.NodeType indexed nodeType, uint256 amount);
    event RewardCalculated(uint256 indexed tokenId, uint256 amount, uint256 reputation);
    event RewardClaimed(uint256 indexed tokenId, address indexed operator, uint256 amount);
    event BaseRewardRateUpdated(NodeNFT.NodeType indexed nodeType, uint256 newRate);
    
    constructor(address _nodeNFT, address admin) {
        require(_nodeNFT != address(0), "Invalid NodeNFT address");
        
        nodeNFT = NodeNFT(_nodeNFT);
        
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(DISTRIBUTOR_ROLE, admin);
        
        // Set initial base reward rates (per day, in wei)
        baseRewardRates[NodeNFT.NodeType.Oracle] = 10 ether;
        baseRewardRates[NodeNFT.NodeType.Guardian] = 5 ether;
        baseRewardRates[NodeNFT.NodeType.Validator] = 3 ether;
    }
    
    /**
     * @notice Fund reward pool for a specific node type
     * @param nodeType Type of node to fund rewards for
     */
    function fundRewardPool(NodeNFT.NodeType nodeType) external payable onlyRole(DEFAULT_ADMIN_ROLE) {
        require(msg.value > 0, "Must send ETH");
        
        rewardPools[nodeType] += msg.value;
        
        emit RewardPoolFunded(nodeType, msg.value);
    }
    
    /**
     * @notice Update base reward rate for a node type
     * @param nodeType Type of node
     * @param newRate New reward rate per day (in wei)
     */
    function setBaseRewardRate(NodeNFT.NodeType nodeType, uint256 newRate) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        require(newRate > 0, "Rate must be > 0");
        
        baseRewardRates[nodeType] = newRate;
        
        emit BaseRewardRateUpdated(nodeType, newRate);
    }
    
    /**
     * @notice Calculate reputation multiplier (0.5x to 1.5x based on reputation)
     * @param reputation Reputation score (0-1000)
     * @return uint256 Multiplier in basis points
     */
    function calculateReputationMultiplier(uint256 reputation) public pure returns (uint256) {
        require(reputation <= 1000, "Invalid reputation");
        
        // Linear interpolation: 0 rep = 0.5x, 500 rep = 1x, 1000 rep = 1.5x
        // multiplier = 5000 + (reputation * 10)
        return MIN_REPUTATION_MULTIPLIER + (reputation * 10);
    }
    
    /**
     * @notice Calculate pending rewards for a node
     * @param tokenId ID of the node NFT
     * @return uint256 Pending reward amount
     */
    function calculatePendingRewards(uint256 tokenId) public view returns (uint256) {
        NodeNFT.NodeMetadata memory metadata = nodeNFT.getNodeMetadata(tokenId);
        
        // Only active nodes earn rewards
        if (!metadata.isActive) {
            return pendingRewards[tokenId];
        }
        
        // Calculate time since last update (in days)
        uint256 lastUpdate = lastRewardUpdate[tokenId];
        if (lastUpdate == 0) {
            lastUpdate = metadata.activatedAt;
        }
        
        uint256 daysSinceUpdate = (block.timestamp - lastUpdate) / 1 days;
        
        if (daysSinceUpdate == 0) {
            return pendingRewards[tokenId];
        }
        
        // Get base reward rate for this node type
        uint256 baseRate = baseRewardRates[metadata.nodeType];
        
        // Calculate reputation multiplier
        uint256 multiplier = calculateReputationMultiplier(metadata.reputationScore);
        
        // Calculate new rewards: baseRate * days * multiplier
        uint256 newRewards = (baseRate * daysSinceUpdate * multiplier) / 10000;
        
        return pendingRewards[tokenId] + newRewards;
    }
    
    /**
     * @notice Update pending rewards for a node (called by distributor service)
     * @param tokenId ID of the node NFT
     */
    function updatePendingRewards(uint256 tokenId) 
        public 
        onlyRole(DISTRIBUTOR_ROLE) 
    {
        NodeNFT.NodeMetadata memory metadata = nodeNFT.getNodeMetadata(tokenId);
        
        // Calculate new pending rewards
        uint256 newPending = calculatePendingRewards(tokenId);
        pendingRewards[tokenId] = newPending;
        lastRewardUpdate[tokenId] = block.timestamp;
        
        emit RewardCalculated(tokenId, newPending, metadata.reputationScore);
    }
    
    /**
     * @notice Claim rewards for a node
     * @param tokenId ID of the node NFT
     */
    function claimRewards(uint256 tokenId) external nonReentrant {
        address owner = nodeNFT.ownerOf(tokenId);
        require(msg.sender == owner, "Not node owner");
        
        // Update pending rewards first
        updatePendingRewards(tokenId);
        
        uint256 amount = pendingRewards[tokenId];
        require(amount > 0, "No rewards to claim");
        
        NodeNFT.NodeMetadata memory metadata = nodeNFT.getNodeMetadata(tokenId);
        
        // Check if reward pool has enough funds
        require(rewardPools[metadata.nodeType] >= amount, "Insufficient reward pool");
        
        // Reset pending rewards
        pendingRewards[tokenId] = 0;
        
        // Deduct from reward pool
        rewardPools[metadata.nodeType] -= amount;
        totalRewardsDistributed += amount;
        
        // Record claim in NodeNFT
        nodeNFT.recordRewardClaim(tokenId, amount);
        
        // Transfer rewards
        (bool success, ) = payable(owner).call{value: amount}("");
        require(success, "Transfer failed");
        
        emit RewardClaimed(tokenId, owner, amount);
    }
    
    /**
     * @notice Batch update rewards for multiple nodes (gas optimization)
     * @param tokenIds Array of node NFT IDs
     */
    function batchUpdateRewards(uint256[] calldata tokenIds) 
        external 
        onlyRole(DISTRIBUTOR_ROLE) 
    {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            updatePendingRewards(tokenIds[i]);
        }
    }
    
    /**
     * @notice Emergency withdraw (admin only)
     * @param nodeType Node type to withdraw from
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(NodeNFT.NodeType nodeType, uint256 amount) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        require(rewardPools[nodeType] >= amount, "Insufficient balance");
        
        rewardPools[nodeType] -= amount;
        
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");
    }
    
    /**
     * @notice Get reward pool balance for a node type
     * @param nodeType Type of node
     * @return uint256 Pool balance
     */
    function getRewardPoolBalance(NodeNFT.NodeType nodeType) external view returns (uint256) {
        return rewardPools[nodeType];
    }
    
    /**
     * @notice Check if rewards can be claimed for a node
     * @param tokenId ID of the node NFT
     * @return bool Whether rewards can be claimed
     * @return uint256 Claimable amount
     */
    function canClaimRewards(uint256 tokenId) external view returns (bool, uint256) {
        uint256 pending = calculatePendingRewards(tokenId);
        
        if (pending == 0) {
            return (false, 0);
        }
        
        NodeNFT.NodeMetadata memory metadata = nodeNFT.getNodeMetadata(tokenId);
        bool hasBalance = rewardPools[metadata.nodeType] >= pending;
        
        return (hasBalance, pending);
    }
    
    receive() external payable {
        // Accept direct ETH transfers (distribute manually)
    }
}
