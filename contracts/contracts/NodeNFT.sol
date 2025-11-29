// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title NodeNFT
 * @notice NFT representing node operator licenses in the Noderr decentralized network
 * @dev Each NFT grants the holder the right to run a specific type of node
 */
contract NodeNFT is ERC721Enumerable, AccessControl {
    using Strings for uint256;
    
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    
    enum NodeType {
        Oracle,    // ML inference nodes
        Guardian,  // Consensus validation nodes
        Validator  // Execution nodes
    }
    
    struct NodeMetadata {
        NodeType nodeType;
        uint256 tier;           // 1-3 (Bronze, Silver, Gold)
        uint256 stakingAmount;  // Required staking amount
        bool isActive;
        uint256 activatedAt;
        string hardwareHash;    // Hash of verified hardware specs
    }
    
    mapping(uint256 => NodeMetadata) public nodeMetadata;
    mapping(address => bool) public approvedOperators;
    mapping(NodeType => uint256) public nodeTypeCount;
    
    uint256 private _nextTokenId = 1;
    string private _baseTokenURI;
    
    uint256 public constant ORACLE_STAKE = 1000 ether;
    uint256 public constant GUARDIAN_STAKE = 500 ether;
    uint256 public constant VALIDATOR_STAKE = 250 ether;
    
    event NodeMinted(
        uint256 indexed tokenId,
        address indexed operator,
        NodeType nodeType,
        uint256 tier
    );
    
    event NodeActivated(uint256 indexed tokenId, string hardwareHash);
    event NodeDeactivated(uint256 indexed tokenId);
    event OperatorApproved(address indexed operator);
    event OperatorRevoked(address indexed operator);
    
    constructor(
        string memory name,
        string memory symbol,
        string memory baseURI,
        address admin
    ) ERC721(name, symbol) {
        _baseTokenURI = baseURI;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(VERIFIER_ROLE, admin);
    }
    
    /**
     * @notice Approve an operator to receive a node NFT
     * @param operator Address of the operator to approve
     */
    function approveOperator(address operator) external onlyRole(VERIFIER_ROLE) {
        require(operator != address(0), "Invalid operator");
        require(!approvedOperators[operator], "Already approved");
        
        approvedOperators[operator] = true;
        emit OperatorApproved(operator);
    }
    
    /**
     * @notice Mint a new node NFT to an approved operator
     * @param to Address of the approved operator
     * @param nodeType Type of node (Oracle, Guardian, Validator)
     * @param tier Tier level (1-3)
     * @return tokenId ID of the minted NFT
     */
    function mintNode(
        address to,
        NodeType nodeType,
        uint256 tier
    ) external payable returns (uint256 tokenId) {
        require(approvedOperators[to], "Operator not approved");
        require(tier >= 1 && tier <= 3, "Invalid tier");
        
        // Verify staking amount
        uint256 requiredStake = getRequiredStake(nodeType);
        require(msg.value >= requiredStake, "Insufficient stake");
        
        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        
        nodeMetadata[tokenId] = NodeMetadata({
            nodeType: nodeType,
            tier: tier,
            stakingAmount: msg.value,
            isActive: false,
            activatedAt: 0,
            hardwareHash: ""
        });
        
        nodeTypeCount[nodeType]++;
        
        emit NodeMinted(tokenId, to, nodeType, tier);
        
        return tokenId;
    }
    
    /**
     * @notice Activate a node after hardware verification
     * @param tokenId ID of the node NFT
     * @param hardwareHash Hash of verified hardware specifications
     */
    function activateNode(
        uint256 tokenId,
        string memory hardwareHash
    ) external onlyRole(VERIFIER_ROLE) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        require(!nodeMetadata[tokenId].isActive, "Node already active");
        require(bytes(hardwareHash).length > 0, "Invalid hardware hash");
        
        nodeMetadata[tokenId].isActive = true;
        nodeMetadata[tokenId].activatedAt = block.timestamp;
        nodeMetadata[tokenId].hardwareHash = hardwareHash;
        
        emit NodeActivated(tokenId, hardwareHash);
    }
    
    /**
     * @notice Deactivate a node
     * @param tokenId ID of the node NFT
     */
    function deactivateNode(uint256 tokenId) external {
        require(
            ownerOf(tokenId) == msg.sender || hasRole(VERIFIER_ROLE, msg.sender),
            "Not authorized"
        );
        require(nodeMetadata[tokenId].isActive, "Node not active");
        
        nodeMetadata[tokenId].isActive = false;
        
        emit NodeDeactivated(tokenId);
    }
    
    /**
     * @notice Get required stake for a node type
     * @param nodeType Type of node
     * @return uint256 Required stake amount
     */
    function getRequiredStake(NodeType nodeType) public pure returns (uint256) {
        if (nodeType == NodeType.Oracle) return ORACLE_STAKE;
        if (nodeType == NodeType.Guardian) return GUARDIAN_STAKE;
        if (nodeType == NodeType.Validator) return VALIDATOR_STAKE;
        revert("Invalid node type");
    }
    
    /**
     * @notice Get node metadata
     * @param tokenId ID of the node NFT
     * @return metadata Node metadata struct
     */
    function getNodeMetadata(uint256 tokenId) external view returns (NodeMetadata memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        return nodeMetadata[tokenId];
    }
    
    /**
     * @notice Get all active nodes of a specific type
     * @param nodeType Type of node to query
     * @return tokenIds Array of active token IDs
     */
    function getActiveNodesByType(NodeType nodeType) external view returns (uint256[] memory) {
        uint256 totalSupply = totalSupply();
        uint256[] memory temp = new uint256[](totalSupply);
        uint256 count = 0;
        
        for (uint256 i = 0; i < totalSupply; i++) {
            uint256 tokenId = tokenByIndex(i);
            if (nodeMetadata[tokenId].nodeType == nodeType && nodeMetadata[tokenId].isActive) {
                temp[count] = tokenId;
                count++;
            }
        }
        
        uint256[] memory result = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = temp[i];
        }
        
        return result;
    }
    
    /**
     * @notice Get all nodes owned by an address
     * @param owner Address of the owner
     * @return tokenIds Array of token IDs
     */
    function getNodesByOwner(address owner) external view returns (uint256[] memory) {
        uint256 balance = balanceOf(owner);
        uint256[] memory tokenIds = new uint256[](balance);
        
        for (uint256 i = 0; i < balance; i++) {
            tokenIds[i] = tokenOfOwnerByIndex(owner, i);
        }
        
        return tokenIds;
    }
    
    /**
     * @notice Check if a node is eligible to operate
     * @param tokenId ID of the node NFT
     * @return bool True if eligible
     */
    function isNodeEligible(uint256 tokenId) external view returns (bool) {
        if (_ownerOf(tokenId) == address(0)) return false;
        NodeMetadata memory metadata = nodeMetadata[tokenId];
        return metadata.isActive && metadata.stakingAmount >= getRequiredStake(metadata.nodeType);
    }
    
    /**
     * @notice Update base URI for token metadata
     * @param baseURI New base URI
     */
    function setBaseURI(string memory baseURI) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _baseTokenURI = baseURI;
    }
    
    /**
     * @notice Get token URI
     * @param tokenId ID of the token
     * @return string Token URI
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        
        string memory baseURI = _baseURI();
        return bytes(baseURI).length > 0
            ? string(abi.encodePacked(baseURI, tokenId.toString(), ".json"))
            : "";
    }
    
    /**
     * @notice Get base URI
     * @return string Base URI
     */
    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
    
    /**
     * @notice Required override for AccessControl
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Enumerable, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
