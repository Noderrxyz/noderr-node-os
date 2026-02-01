# NFT Token ID Mapping Guide

## Overview

This document explains how to map NFT token IDs to node IDs in the Noderr system. This mapping is essential for the dApp frontend to query telemetry data using the NFT token ID.

---

## Database Schema

The `node_identities` table now includes an `nft_token_id` column:

```sql
ALTER TABLE node_identities 
ADD COLUMN nft_token_id BIGINT UNIQUE;
```

---

## Workflow

### 1. Node Registration

When a node is registered, it does NOT yet have an NFT token ID:

```typescript
// In auth-api
const nodeIdentity = await db.createNodeIdentity({
  nodeId: 'node-123',
  publicKey: '0x...',
  tier: 'GUARDIAN',
  os: 'linux',
  // nft_token_id is NULL at this point
});
```

### 2. NFT Minting

After the node is approved and the NFT is minted on-chain, update the node_identity with the token ID:

```typescript
// After minting NFT on-chain
const tokenId = await mintNodeNFT(ownerWallet, tier);

// Update database
await db.updateNodeTokenId(nodeIdentity.nodeId, tokenId);
```

### 3. Telemetry Queries

The dApp frontend can now query telemetry using the token ID:

```typescript
// Frontend
const response = await fetch(`/api/telemetry/${tokenId}`);
const telemetry = await response.json();
```

---

## API Methods

### Database Service Methods

#### `updateNodeTokenId(nodeId: string, tokenId: number): Promise<void>`

Updates a node with its NFT token ID after minting.

**Parameters:**
- `nodeId` - The node's unique identifier
- `tokenId` - The NFT token ID from the UtilityNFT contract

**Example:**
```typescript
await db.updateNodeTokenId('node-123', 1);
```

#### `getNodeByTokenId(tokenId: number): Promise<NodeIdentity | null>`

Retrieves a node identity by its NFT token ID.

**Parameters:**
- `tokenId` - The NFT token ID

**Returns:**
- `NodeIdentity` object if found
- `null` if not found

**Example:**
```typescript
const node = await db.getNodeByTokenId(1);
if (node) {
  console.log(`Node ID: ${node.nodeId}`);
}
```

---

## Supabase Functions

### `get_node_by_token_id(p_token_id BIGINT)`

Database function to get node info by token ID.

**Usage:**
```typescript
const { data } = await supabase
  .rpc('get_node_by_token_id', { p_token_id: 1 });
```

### `get_telemetry_by_token_id(p_token_id BIGINT)`

Database function to get full telemetry data by token ID (includes JOIN with node_identities).

**Usage:**
```typescript
const { data } = await supabase
  .rpc('get_telemetry_by_token_id', { p_token_id: 1 });
```

---

## Integration Points

### 1. Node Provisioning System

When a node operator is approved and an NFT is minted:

```typescript
// In node provisioning flow
async function provisionNode(applicationId: string) {
  // 1. Generate install token
  const installToken = await generateInstallToken(applicationId);
  
  // 2. Node installs and registers (happens on node side)
  // ... wait for node to register ...
  
  // 3. Mint NFT for the node
  const tokenId = await mintNodeNFT(operatorWallet, tier);
  
  // 4. Update database with token ID
  await db.updateNodeTokenId(nodeId, tokenId);
  
  return { nodeId, tokenId };
}
```

### 2. Admin Dashboard

Admins can view the token ID mapping:

```typescript
// Get node details including token ID
const { data } = await supabase
  .from('node_identities')
  .select('node_id, nft_token_id, tier, status')
  .eq('node_id', nodeId)
  .single();

console.log(`Node ${data.node_id} → NFT #${data.nft_token_id}`);
```

### 3. Frontend Telemetry Display

The frontend queries telemetry using the NFT token ID from the user's wallet:

```typescript
// Get user's NFTs
const nfts = await getUserNFTs(walletAddress);

// For each NFT, get telemetry
for (const nft of nfts) {
  const telemetry = await fetch(`/api/telemetry/${nft.tokenId}`);
  // Display telemetry data
}
```

---

## Migration Steps

### For Existing Nodes

If you have existing nodes without token IDs, you need to backfill the data:

1. **Query existing nodes:**
```sql
SELECT node_id, tier FROM node_identities WHERE nft_token_id IS NULL;
```

2. **For each node, find the corresponding NFT:**
```typescript
// Query the UtilityNFT contract for tokens owned by the operator
const tokens = await utilityNFT.tokensOfOwner(operatorWallet);

// Match by tier and other metadata
for (const tokenId of tokens) {
  const metadata = await utilityNFT.getNodeMetadata(tokenId);
  if (metadata.tier === node.tier) {
    await db.updateNodeTokenId(node.nodeId, tokenId);
  }
}
```

3. **Verify the mapping:**
```sql
SELECT 
  node_id, 
  nft_token_id, 
  tier 
FROM node_identities 
WHERE nft_token_id IS NOT NULL;
```

---

## Testing

### Test 1: Update Token ID

```typescript
// Create a test node
const node = await db.createNodeIdentity({
  nodeId: 'test-node-1',
  publicKey: '0xtest',
  tier: 'GUARDIAN',
  os: 'linux',
  installTokenId: 'token-123',
  status: 'active',
});

// Update with token ID
await db.updateNodeTokenId('test-node-1', 999);

// Verify
const retrieved = await db.getNodeByTokenId(999);
assert(retrieved.nodeId === 'test-node-1');
```

### Test 2: Query Telemetry by Token ID

```bash
# Send heartbeat
curl -X POST http://auth-api/api/v1/auth/heartbeat \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "test-node-1",
    "jwtToken": "...",
    "metrics": {
      "uptime": 3600,
      "cpu": 45.2,
      "memory": 62.8,
      "version": "1.0.0"
    }
  }'

# Query by token ID
curl http://dapp/api/telemetry/999

# Should return telemetry data
```

---

## Troubleshooting

### Issue: "No node found for token ID"

**Cause:** The `nft_token_id` column is NULL for the node.

**Solution:**
```typescript
// Update the node with the correct token ID
await db.updateNodeTokenId(nodeId, tokenId);
```

### Issue: "Duplicate key violation on nft_token_id"

**Cause:** Trying to assign the same token ID to multiple nodes.

**Solution:**
- Each token ID must be unique
- Check if the token ID is already assigned:
```sql
SELECT node_id FROM node_identities WHERE nft_token_id = 123;
```

### Issue: "Node has no telemetry data"

**Cause:** The node hasn't sent a heartbeat yet.

**Solution:**
- Wait for the node to send its first heartbeat
- Check auth-api logs for heartbeat errors
- Verify the node is running and connected

---

## Security Considerations

1. **Token ID Validation:** Always validate that the token ID exists on-chain before updating the database.

2. **Ownership Verification:** When updating token IDs, verify that the operator owns the NFT.

3. **RLS Policies:** The `nft_token_id` column is readable by authenticated users but only writable by the service role.

4. **Audit Trail:** Log all token ID updates for security auditing:
```typescript
logger.info(`[NFT Mapping] Updated node ${nodeId} with token ID ${tokenId}`, {
  nodeId,
  tokenId,
  updatedBy: adminAddress,
  timestamp: new Date().toISOString(),
});
```

---

## Future Enhancements

1. **Automatic Mapping:** Implement a background job that automatically maps token IDs when NFTs are minted.

2. **Smart Contract Events:** Listen to `Transfer` events on the UtilityNFT contract to detect new mints and update the database.

3. **Multi-Node Support:** Allow operators to have multiple nodes, each with its own NFT.

4. **Token Metadata Sync:** Periodically sync token metadata from the contract to the database.

---

## References

- Database Migration: `/supabase/migrations/20260124_add_nft_token_mapping.sql`
- Database Service: `/auth-api/src/services/database.service.ts`
- Telemetry Route: `/server/routes/telemetry.ts`
- Smart Contract: `NodeRegistry.sol`, `UtilityNFT.sol`
