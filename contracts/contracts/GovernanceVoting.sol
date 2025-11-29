// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/**
 * @title GovernanceVoting
 * @notice Decentralized governance for Noderr protocol parameters and strategy approval
 * @dev NFT-based voting with quadratic voting mechanism
 */
contract GovernanceVoting is AccessControl {
    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    
    enum ProposalType {
        PARAMETER_CHANGE,
        STRATEGY_APPROVAL,
        ORACLE_ADDITION,
        ORACLE_REMOVAL,
        EMERGENCY_ACTION
    }
    
    enum ProposalStatus {
        Pending,
        Active,
        Succeeded,
        Defeated,
        Executed,
        Cancelled
    }
    
    struct Proposal {
        uint256 id;
        address proposer;
        ProposalType proposalType;
        string description;
        bytes callData;
        uint256 startBlock;
        uint256 endBlock;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        ProposalStatus status;
        mapping(address => bool) hasVoted;
        mapping(address => uint256) voteWeight;
    }
    
    struct ProposalInfo {
        uint256 id;
        address proposer;
        ProposalType proposalType;
        string description;
        uint256 startBlock;
        uint256 endBlock;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        ProposalStatus status;
    }
    
    IERC721 public nodeNFT;
    
    uint256 public proposalCount;
    uint256 public votingPeriod = 50400; // ~7 days in blocks (12s blocks)
    uint256 public votingDelay = 1; // 1 block delay before voting starts
    uint256 public proposalThreshold = 1; // Minimum NFTs to propose
    uint256 public quorumPercentage = 40; // 40% quorum required
    
    mapping(uint256 => Proposal) public proposals;
    mapping(address => uint256) public nftHoldings;
    
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        ProposalType proposalType,
        string description,
        uint256 startBlock,
        uint256 endBlock
    );
    
    event VoteCast(
        address indexed voter,
        uint256 indexed proposalId,
        bool support,
        uint256 weight
    );
    
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCancelled(uint256 indexed proposalId);
    event QuorumUpdated(uint256 newQuorum);
    event VotingPeriodUpdated(uint256 newPeriod);
    
    constructor(address _nodeNFT, address admin) {
        require(_nodeNFT != address(0), "Invalid NFT address");
        nodeNFT = IERC721(_nodeNFT);
        
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, admin);
        _grantRole(PROPOSER_ROLE, admin);
    }
    
    /**
     * @notice Create a new governance proposal
     * @param proposalType Type of proposal
     * @param description Human-readable description
     * @param callData Encoded function call to execute if passed
     * @return proposalId ID of the created proposal
     */
    function propose(
        ProposalType proposalType,
        string memory description,
        bytes memory callData
    ) external returns (uint256 proposalId) {
        require(
            hasRole(PROPOSER_ROLE, msg.sender) || 
            nftHoldings[msg.sender] >= proposalThreshold,
            "Insufficient NFTs to propose"
        );
        
        proposalId = ++proposalCount;
        Proposal storage proposal = proposals[proposalId];
        
        proposal.id = proposalId;
        proposal.proposer = msg.sender;
        proposal.proposalType = proposalType;
        proposal.description = description;
        proposal.callData = callData;
        proposal.startBlock = block.number + votingDelay;
        proposal.endBlock = block.number + votingDelay + votingPeriod;
        proposal.status = ProposalStatus.Pending;
        
        emit ProposalCreated(
            proposalId,
            msg.sender,
            proposalType,
            description,
            proposal.startBlock,
            proposal.endBlock
        );
        
        return proposalId;
    }
    
    /**
     * @notice Cast a vote on a proposal
     * @param proposalId ID of the proposal
     * @param support True for yes, false for no
     */
    function castVote(uint256 proposalId, bool support) external {
        Proposal storage proposal = proposals[proposalId];
        
        require(proposal.id != 0, "Proposal does not exist");
        require(block.number >= proposal.startBlock, "Voting not started");
        require(block.number <= proposal.endBlock, "Voting ended");
        require(!proposal.hasVoted[msg.sender], "Already voted");
        require(nftHoldings[msg.sender] > 0, "No voting power");
        
        // Update status to Active if still Pending
        if (proposal.status == ProposalStatus.Pending) {
            proposal.status = ProposalStatus.Active;
        }
        
        // Calculate quadratic voting weight: sqrt(NFT count)
        uint256 weight = sqrt(nftHoldings[msg.sender]);
        
        proposal.hasVoted[msg.sender] = true;
        proposal.voteWeight[msg.sender] = weight;
        
        if (support) {
            proposal.forVotes += weight;
        } else {
            proposal.againstVotes += weight;
        }
        
        emit VoteCast(msg.sender, proposalId, support, weight);
    }
    
    /**
     * @notice Execute a successful proposal
     * @param proposalId ID of the proposal to execute
     */
    function execute(uint256 proposalId) external onlyRole(GUARDIAN_ROLE) {
        Proposal storage proposal = proposals[proposalId];
        
        require(proposal.id != 0, "Proposal does not exist");
        require(block.number > proposal.endBlock, "Voting not ended");
        require(proposal.status == ProposalStatus.Active, "Proposal not active");
        
        // Check if proposal succeeded
        uint256 totalVotes = proposal.forVotes + proposal.againstVotes + proposal.abstainVotes;
        uint256 totalPossibleVotes = getTotalVotingPower();
        uint256 quorum = (totalPossibleVotes * quorumPercentage) / 100;
        
        if (totalVotes >= quorum && proposal.forVotes > proposal.againstVotes) {
            proposal.status = ProposalStatus.Succeeded;
            
            // Execute the proposal's callData
            if (proposal.callData.length > 0) {
                (bool success, ) = address(this).call(proposal.callData);
                require(success, "Proposal execution failed");
            }
            
            proposal.status = ProposalStatus.Executed;
            emit ProposalExecuted(proposalId);
        } else {
            proposal.status = ProposalStatus.Defeated;
        }
    }
    
    /**
     * @notice Cancel a proposal
     * @param proposalId ID of the proposal to cancel
     */
    function cancel(uint256 proposalId) external {
        Proposal storage proposal = proposals[proposalId];
        
        require(proposal.id != 0, "Proposal does not exist");
        require(
            msg.sender == proposal.proposer || hasRole(GUARDIAN_ROLE, msg.sender),
            "Not authorized to cancel"
        );
        require(
            proposal.status == ProposalStatus.Pending || 
            proposal.status == ProposalStatus.Active,
            "Cannot cancel"
        );
        
        proposal.status = ProposalStatus.Cancelled;
        emit ProposalCancelled(proposalId);
    }
    
    /**
     * @notice Update NFT holdings for a voter (called when NFTs are transferred)
     * @param voter Address of the voter
     * @param amount New NFT balance
     */
    function updateNFTHoldings(address voter, uint256 amount) external onlyRole(GUARDIAN_ROLE) {
        nftHoldings[voter] = amount;
    }
    
    /**
     * @notice Get proposal information
     * @param proposalId ID of the proposal
     * @return info Proposal information struct
     */
    function getProposal(uint256 proposalId) external view returns (ProposalInfo memory info) {
        Proposal storage proposal = proposals[proposalId];
        
        return ProposalInfo({
            id: proposal.id,
            proposer: proposal.proposer,
            proposalType: proposal.proposalType,
            description: proposal.description,
            startBlock: proposal.startBlock,
            endBlock: proposal.endBlock,
            forVotes: proposal.forVotes,
            againstVotes: proposal.againstVotes,
            abstainVotes: proposal.abstainVotes,
            status: proposal.status
        });
    }
    
    /**
     * @notice Check if an address has voted on a proposal
     * @param proposalId ID of the proposal
     * @param voter Address to check
     * @return bool True if voted
     */
    function hasVoted(uint256 proposalId, address voter) external view returns (bool) {
        return proposals[proposalId].hasVoted[voter];
    }
    
    /**
     * @notice Get total voting power across all NFT holders
     * @return uint256 Total quadratic voting power
     */
    function getTotalVotingPower() public view returns (uint256) {
        // In production, this would aggregate all NFT holders
        // For now, return a placeholder
        return 100; // This should be calculated from actual NFT distribution
    }
    
    /**
     * @notice Update quorum percentage
     * @param newQuorum New quorum percentage (0-100)
     */
    function updateQuorum(uint256 newQuorum) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newQuorum <= 100, "Invalid quorum");
        quorumPercentage = newQuorum;
        emit QuorumUpdated(newQuorum);
    }
    
    /**
     * @notice Update voting period
     * @param newPeriod New voting period in blocks
     */
    function updateVotingPeriod(uint256 newPeriod) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newPeriod > 0, "Invalid period");
        votingPeriod = newPeriod;
        emit VotingPeriodUpdated(newPeriod);
    }
    
    /**
     * @notice Calculate square root for quadratic voting
     * @param x Number to calculate square root of
     * @return y Square root
     */
    function sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}
