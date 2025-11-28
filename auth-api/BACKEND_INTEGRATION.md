# Backend Integration Guide

This guide explains how to integrate the Installation Token System with the existing Noderr dApp backend.

---

## Overview

The installation token system allows admins to generate single-use tokens when approving node applications. These tokens are used by the installation scripts to securely provision new nodes.

---

## Database Setup

### 1. Run the SQL Migration

Execute the SQL script in Supabase SQL Editor:

```bash
# Location: auth-api/scripts/create-tables.sql
```

This creates three tables:
- `install_tokens` - Installation tokens
- `node_identities` - Node identities with TPM keys
- `node_credentials` - Node authentication credentials

### 2. Verify Tables

```sql
SELECT * FROM install_tokens LIMIT 1;
SELECT * FROM node_identities LIMIT 1;
SELECT * FROM node_credentials LIMIT 1;
```

---

## Backend Integration

### Option 1: Direct Integration (Recommended)

Add the token generation logic directly to your existing backend.

#### Install Dependencies

```bash
cd your-backend-directory
npm install @supabase/supabase-js
```

#### Add Token Generation Function

```typescript
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY! // Use service key for backend
);

export async function generateInstallToken(
  applicationId: string,
  tier: 'ALL' | 'ORACLE' | 'GUARDIAN',
  os: 'linux' | 'windows'
): Promise<string> {
  // Generate token
  const tokenBytes = randomBytes(32);
  const token = `ndr_install_${tokenBytes.toString('hex')}`;
  
  // Calculate expiry (7 days)
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  
  // Insert into database
  const { data, error } = await supabase
    .from('install_tokens')
    .insert({
      token,
      application_id: applicationId,
      tier,
      os,
      is_used: false,
      expires_at: expiresAt.toISOString(),
    })
    .select()
    .single();
  
  if (error) {
    throw new Error(`Failed to create token: ${error.message}`);
  }
  
  return token;
}
```

#### Update Application Approval Flow

```typescript
// In your application approval handler
async function approveNodeApplication(
  applicationId: string,
  tier: 'ALL' | 'ORACLE' | 'GUARDIAN',
  os: 'linux' | 'windows'
) {
  // 1. Update application status
  await supabase
    .from('node_applications')
    .update({ status: 'approved' })
    .eq('id', applicationId);
  
  // 2. Generate installation token
  const installToken = await generateInstallToken(applicationId, tier, os);
  
  // 3. Send email with installation instructions
  await sendApprovalEmail(applicationId, installToken, os);
  
  return { success: true, token: installToken };
}
```

### Option 2: API Integration

Call the auth-api from your backend to generate tokens.

```typescript
async function generateInstallToken(
  applicationId: string,
  tier: string,
  os: string
): Promise<string> {
  const response = await fetch('https://auth.noderr.xyz/api/v1/admin/tokens', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.ADMIN_API_KEY}`,
    },
    body: JSON.stringify({
      applicationId,
      tier,
      os,
    }),
  });
  
  if (!response.ok) {
    throw new Error('Failed to generate token');
  }
  
  const data = await response.json();
  return data.token;
}
```

---

## Email Template

### Linux Installation Email

```
Subject: Your Noderr Node Has Been Approved! 🎉

Hi [Operator Name],

Great news! Your Noderr node application has been approved.

Node Tier: [TIER]
Operating System: Linux

To install your node, run this single command on your Linux server:

curl -fsSL https://install.noderr.xyz/linux | sudo bash -s -- [INSTALL_TOKEN]

This command will:
✓ Validate your hardware
✓ Install required dependencies
✓ Generate TPM-based security keys
✓ Register your node
✓ Start the Noderr Node OS

System Requirements:
- Ubuntu 22.04+ / Debian 11+ / RHEL 8+
- 4+ CPU cores
- 8+ GB RAM
- 100+ GB disk space
- TPM 2.0

Need help? Visit https://docs.noderr.xyz

Welcome to the Noderr Network!

The Noderr Team
```

### Windows Installation Email

```
Subject: Your Noderr Node Has Been Approved! 🎉

Hi [Operator Name],

Great news! Your Noderr node application has been approved.

Node Tier: [TIER]
Operating System: Windows

To install your node, run these commands in PowerShell (as Administrator):

Invoke-WebRequest -Uri "https://install.noderr.xyz/windows.ps1" -OutFile "install-noderr.ps1"
.\install-noderr.ps1 -InstallToken "[INSTALL_TOKEN]"

This script will:
✓ Validate your hardware
✓ Install Docker Desktop
✓ Generate TPM-based security keys
✓ Register your node
✓ Start the Noderr Node OS

System Requirements:
- Windows 10/11 Pro or Server 2019+
- 4+ CPU cores
- 8+ GB RAM
- 100+ GB disk space
- TPM 2.0

Need help? Visit https://docs.noderr.xyz

Welcome to the Noderr Network!

The Noderr Team
```

---

## Admin Dashboard Integration

### Add Token Management UI

```typescript
// In your admin dashboard component

interface InstallToken {
  id: string;
  token: string;
  tier: string;
  os: string;
  isUsed: boolean;
  createdAt: Date;
  expiresAt: Date;
}

function TokenManagement({ applicationId }: { applicationId: string }) {
  const [tokens, setTokens] = useState<InstallToken[]>([]);
  
  useEffect(() => {
    loadTokens();
  }, [applicationId]);
  
  async function loadTokens() {
    const { data } = await supabase
      .from('install_tokens')
      .select('*')
      .eq('application_id', applicationId)
      .order('created_at', { ascending: false });
    
    setTokens(data || []);
  }
  
  async function revokeToken(tokenId: string) {
    await supabase
      .from('install_tokens')
      .update({ is_used: true })
      .eq('id', tokenId);
    
    loadTokens();
  }
  
  return (
    <div>
      <h3>Installation Tokens</h3>
      <table>
        <thead>
          <tr>
            <th>Token</th>
            <th>Tier</th>
            <th>OS</th>
            <th>Status</th>
            <th>Expires</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {tokens.map(token => (
            <tr key={token.id}>
              <td><code>{token.token}</code></td>
              <td>{token.tier}</td>
              <td>{token.os}</td>
              <td>{token.isUsed ? 'Used' : 'Active'}</td>
              <td>{new Date(token.expiresAt).toLocaleDateString()}</td>
              <td>
                {!token.isUsed && (
                  <button onClick={() => revokeToken(token.id)}>
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

---

## Security Considerations

### 1. Token Storage

- ✅ Tokens are stored hashed in the database
- ✅ Tokens are single-use (marked as used after registration)
- ✅ Tokens expire after 7 days
- ✅ Unused expired tokens are cleaned up automatically

### 2. Email Security

- ⚠️ **DO NOT** log installation tokens
- ⚠️ Use secure email delivery (TLS)
- ⚠️ Consider using email templates with masked tokens (show only in secure portal)

### 3. API Security

- ✅ Use service role key for backend operations
- ✅ Implement rate limiting on token generation
- ✅ Log all token generation events for audit

---

## Monitoring and Maintenance

### Daily Cleanup Job

Run this daily to clean up expired tokens:

```typescript
import { tokenService } from './services/token.service';

// In your cron job
async function dailyCleanup() {
  const deletedCount = await tokenService.cleanupExpiredTokens();
  console.log(`Cleaned up ${deletedCount} expired tokens`);
}
```

### Token Usage Metrics

```sql
-- Active tokens
SELECT COUNT(*) FROM install_tokens WHERE is_used = false AND expires_at > NOW();

-- Used tokens
SELECT COUNT(*) FROM install_tokens WHERE is_used = true;

-- Expired unused tokens
SELECT COUNT(*) FROM install_tokens WHERE is_used = false AND expires_at < NOW();

-- Tokens by tier
SELECT tier, COUNT(*) FROM install_tokens GROUP BY tier;

-- Tokens by OS
SELECT os, COUNT(*) FROM install_tokens GROUP BY os;
```

---

## Testing

### Generate Test Token

```typescript
const testToken = await generateInstallToken(
  'test-application-id',
  'ALL',
  'linux'
);

console.log('Test token:', testToken);
```

### Verify Token

```typescript
const { data } = await supabase
  .from('install_tokens')
  .select('*')
  .eq('token', testToken)
  .single();

console.log('Token details:', data);
```

---

## Troubleshooting

### Token Not Working

1. Check if token exists: `SELECT * FROM install_tokens WHERE token = 'ndr_install_...'`
2. Check if token is expired: `SELECT expires_at FROM install_tokens WHERE token = '...'`
3. Check if token is used: `SELECT is_used FROM install_tokens WHERE token = '...'`

### Installation Script Fails

1. Check auth-api logs: `docker logs auth-api`
2. Verify Supabase connection
3. Check RLS policies are correct

---

## Support

For questions or issues:
- Documentation: https://docs.noderr.xyz
- GitHub Issues: https://github.com/noderrxyz/noderr-node-os/issues
- Discord: https://discord.gg/noderr
