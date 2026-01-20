import { MerkleTree } from 'merkletreejs';
import { keccak256 } from 'ethers';
import { RewardEntry, MerkleProof } from '@noderr/types/src';

/**
 * Generate Merkle tree from reward entries
 */
export function generateMerkleTree(rewards: RewardEntry[]): {
  tree: MerkleTree;
  root: string;
  leaves: string[];
} {
  // Create leaves by hashing (address, amount) pairs
  const leaves = rewards.map(reward => {
    // Pack address and amount into a single hash
    // This matches the Solidity keccak256(abi.encodePacked(address, amount))
    const packed = reward.address.toLowerCase() + reward.amount.toString(16).padStart(64, '0');
    return keccak256('0x' + packed);
  });

  // Create Merkle tree
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const root = tree.getHexRoot();

  return { tree, root, leaves };
}

/**
 * Generate Merkle proof for a specific reward entry
 */
export function generateMerkleProof(
  tree: MerkleTree,
  address: string,
  amount: bigint | string
): MerkleProof {
  // Create leaf hash
  const packed = address.toLowerCase() + BigInt(amount).toString(16).padStart(64, '0');
  const leaf = keccak256('0x' + packed);

  // Get proof
  const proof = tree.getHexProof(leaf);

  return { leaf, proof };
}

/**
 * Verify a Merkle proof
 */
export function verifyMerkleProof(
  proof: string[],
  root: string,
  leaf: string
): boolean {
  return MerkleTree.verify(proof, leaf, root, keccak256, { sortPairs: true });
}

/**
 * Generate all proofs for a list of rewards
 */
export function generateAllProofs(
  tree: MerkleTree,
  rewards: RewardEntry[]
): Map<string, MerkleProof> {
  const proofs = new Map<string, MerkleProof>();

  for (const reward of rewards) {
    const proof = generateMerkleProof(tree, reward.address, reward.amount.toString());
    proofs.set(reward.address.toLowerCase(), proof);
  }

  return proofs;
}
