# Sprint 3 Testing Guide

This document provides comprehensive testing procedures for the Authentication & Installation system.

---

## Test Environment Setup

### Prerequisites

1. **Supabase Project**
   - Create a test Supabase project
   - Run the database migration: `auth-api/scripts/create-tables.sql`
   - Get the Supabase URL and service key

2. **Test Server** (for installation script testing)
   - Linux: Ubuntu 22.04 VM with TPM 2.0
   - Windows: Windows 10/11 VM with TPM 2.0
   - Both should meet minimum hardware requirements

3. **Docker Registry**
   - Access to Docker images (or use local builds)

---

## Unit Tests

### Auth-API Unit Tests

```bash
cd auth-api
npm install
npm test
```

**Expected Results:**
- ✅ All tests pass
- ✅ Coverage >70% for all metrics
- ✅ No TypeScript errors

### Test Coverage

```bash
npm run test:coverage
```

**Coverage Targets:**
- Branches: 70%+
- Functions: 70%+
- Lines: 70%+
- Statements: 70%+

---

## Integration Tests

### 1. Database Integration

**Test: Create Install Token**

```typescript
import { tokenService } from './src/services/token.service';

const token = await tokenService.generateInstallToken(
  'test-app-id',
  'ORACLE',
  'linux'
);

console.log('Generated token:', token);
// Expected: ndr_install_[64-char-hex]
```

**Verification:**
```sql
SELECT * FROM install_tokens WHERE token = 'ndr_install_...';
```

Expected fields:
- `is_used`: false
- `expires_at`: 7 days from now
- `tier`: ORACLE
- `os`: linux

---

### 2. Authentication API Integration

**Test: Get Install Config**

```bash
curl -X POST https://auth.noderr.xyz/api/v1/install/config \
  -H "Content-Type: application/json" \
  -d '{"installToken": "ndr_install_..."}'
```

**Expected Response:**
```json
{
  "nodeId": "temp-...",
  "tier": "ORACLE",
  "os": "linux",
  "config": {
    "deploymentEngineUrl": "https://deploy.noderr.xyz",
    "authApiUrl": "https://auth.noderr.xyz",
    "dockerRegistry": "ghcr.io/noderrxyz",
    "telemetryEndpoint": "https://telemetry.noderr.xyz"
  }
}
```

**Test: Register Node** (requires TPM-generated keys)

```bash
curl -X POST https://auth.noderr.xyz/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "installToken": "ndr_install_...",
    "publicKey": "-----BEGIN PUBLIC KEY-----\n...",
    "attestation": {
      "quote": "base64...",
      "signature": "base64...",
      "pcrValues": {"0": "sha256...", "7": "sha256..."},
      "timestamp": "2025-11-28T00:00:00Z"
    },
    "systemInfo": {
      "hostname": "test-node",
      "cpuCores": 8,
      "memoryGB": 16,
      "diskGB": 500
    }
  }'
```

**Expected Response:**
```json
{
  "nodeId": "0x...",
  "apiKey": "ndr_live_...",
  "jwtToken": "eyJ...",
  "status": "registered"
}
```

**Verification:**
```sql
-- Check node identity
SELECT * FROM node_identities WHERE node_id = '0x...';

-- Check credentials
SELECT * FROM node_credentials WHERE node_id = '0x...';

-- Check token is marked as used
SELECT is_used FROM install_tokens WHERE token = 'ndr_install_...';
-- Expected: true
```

---

## End-to-End Tests

### Linux Installation Test

**Environment:**
- Ubuntu 22.04 LTS
- 4+ CPU cores
- 8+ GB RAM
- 100+ GB disk
- TPM 2.0 enabled

**Test Steps:**

1. **Generate Installation Token**
   ```typescript
   const token = await tokenService.generateInstallToken(
     'test-app-id',
     'ALL',
     'linux'
   );
   ```

2. **Run Installation Script**
   ```bash
   curl -fsSL https://install.noderr.xyz/linux | sudo bash -s -- <TOKEN>
   ```

3. **Monitor Installation**
   - Watch for progress messages
   - Check for errors
   - Verify all steps complete

4. **Verify Installation**
   ```bash
   # Check Docker container is running
   docker ps | grep noderr-node
   
   # Check systemd service
   systemctl status noderr-node
   
   # Check logs
   journalctl -u noderr-node -n 50
   
   # Verify configuration files
   ls -la /etc/noderr/
   cat /etc/noderr/credentials.json
   ```

5. **Verify Database**
   ```sql
   -- Check node is registered
   SELECT * FROM node_identities WHERE node_id = '0x...';
   
   -- Check node is active
   SELECT status FROM node_identities WHERE node_id = '0x...';
   -- Expected: active
   
   -- Check last_seen is recent
   SELECT last_seen FROM node_identities WHERE node_id = '0x...';
   ```

**Expected Results:**
- ✅ Installation completes without errors
- ✅ Docker container is running
- ✅ Systemd service is active
- ✅ Node is registered in database
- ✅ Credentials file exists and is secure (600 permissions)
- ✅ TPM keys are generated and stored

---

### Windows Installation Test

**Environment:**
- Windows 10/11 Pro or Server 2019+
- 4+ CPU cores
- 8+ GB RAM
- 100+ GB disk
- TPM 2.0 enabled

**Test Steps:**

1. **Generate Installation Token**
   ```typescript
   const token = await tokenService.generateInstallToken(
     'test-app-id',
     'ORACLE',
     'windows'
   );
   ```

2. **Download Installation Script**
   ```powershell
   Invoke-WebRequest -Uri "https://install.noderr.xyz/windows.ps1" -OutFile "install-noderr.ps1"
   ```

3. **Run Installation Script** (as Administrator)
   ```powershell
   .\install-noderr.ps1 -InstallToken "<TOKEN>"
   ```

4. **Monitor Installation**
   - Watch for progress messages
   - Check for errors
   - Verify all steps complete

5. **Verify Installation**
   ```powershell
   # Check Docker container is running
   docker ps | Select-String "noderr-node"
   
   # Check logs
   docker logs noderr-node
   
   # Verify configuration files
   Get-ChildItem "C:\ProgramData\Noderr"
   Get-Content "C:\ProgramData\Noderr\credentials.json"
   ```

6. **Verify Database**
   ```sql
   -- Same as Linux verification
   SELECT * FROM node_identities WHERE node_id = '0x...';
   ```

**Expected Results:**
- ✅ Installation completes without errors
- ✅ Docker Desktop is installed (if not present)
- ✅ Docker container is running
- ✅ Node is registered in database
- ✅ Credentials file exists with restricted ACLs
- ✅ TPM certificate is created

---

## Error Handling Tests

### Test: Invalid Token

```bash
curl -X POST https://auth.noderr.xyz/api/v1/install/config \
  -H "Content-Type: application/json" \
  -d '{"installToken": "invalid-token"}'
```

**Expected Response:**
```json
{
  "error": "Bad Request",
  "message": "Invalid installation token"
}
```

### Test: Expired Token

1. Create token with past expiry date
2. Attempt to use token
3. Verify error message

**Expected:**
- HTTP 400
- Error: "Installation token has expired"

### Test: Already Used Token

1. Use token to register a node
2. Attempt to use same token again
3. Verify error message

**Expected:**
- HTTP 400
- Error: "Installation token has already been used"

### Test: Invalid Public Key

1. Generate token
2. Attempt registration with malformed public key
3. Verify error message

**Expected:**
- HTTP 400
- Error: "Invalid public key format"

### Test: Invalid Attestation

1. Generate token
2. Attempt registration with invalid attestation signature
3. Verify error message

**Expected:**
- HTTP 400
- Error: "TPM attestation verification failed"

---

## Performance Tests

### Token Generation Performance

```typescript
const start = Date.now();
const tokens = [];

for (let i = 0; i < 100; i++) {
  const token = await tokenService.generateInstallToken(
    `test-app-${i}`,
    'ALL',
    'linux'
  );
  tokens.push(token);
}

const duration = Date.now() - start;
console.log(`Generated 100 tokens in ${duration}ms`);
console.log(`Average: ${duration / 100}ms per token`);
```

**Expected:**
- <1000ms total for 100 tokens
- <10ms average per token

### Registration Performance

```bash
# Use Apache Bench or similar
ab -n 100 -c 10 -p register.json -T application/json \
  https://auth.noderr.xyz/api/v1/auth/register
```

**Expected:**
- >10 requests/second
- <1000ms average response time
- 0% error rate

---

## Security Tests

### Test: SQL Injection

```bash
curl -X POST https://auth.noderr.xyz/api/v1/install/config \
  -H "Content-Type: application/json" \
  -d '{"installToken": "ndr_install_\"; DROP TABLE install_tokens; --"}'
```

**Expected:**
- No database modification
- Error response (invalid token)

### Test: XSS in System Info

```bash
curl -X POST https://auth.noderr.xyz/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "installToken": "...",
    "publicKey": "...",
    "attestation": {...},
    "systemInfo": {
      "hostname": "<script>alert(1)</script>",
      "cpuCores": 8,
      "memoryGB": 16,
      "diskGB": 500
    }
  }'
```

**Expected:**
- Registration succeeds or fails based on other validation
- Hostname is stored as-is (no script execution)
- No XSS vulnerability

### Test: Rate Limiting

```bash
# Send 200 requests rapidly
for i in {1..200}; do
  curl -X POST https://auth.noderr.xyz/api/v1/install/config \
    -H "Content-Type: application/json" \
    -d '{"installToken": "test"}' &
done
wait
```

**Expected:**
- First 100 requests succeed (or fail with validation error)
- Subsequent requests return HTTP 429 (Too Many Requests)
- Rate limit resets after 1 minute

---

## Rollback Tests

### Test: Installation Failure Recovery

1. **Simulate Docker Pull Failure**
   - Modify script to use non-existent image
   - Run installation
   - Verify cleanup occurs

2. **Simulate TPM Failure**
   - Run on system without TPM
   - Verify graceful error message
   - Verify no partial installation

3. **Simulate Network Failure**
   - Disconnect network during registration
   - Verify error handling
   - Verify retry logic (if implemented)

---

## Monitoring Tests

### Test: Node Heartbeat

```bash
curl -X POST https://auth.noderr.xyz/api/v1/auth/heartbeat \
  -H "Content-Type: application/json" \
  -d '{
    "nodeId": "0x...",
    "jwtToken": "eyJ...",
    "metrics": {
      "uptime": 86400,
      "cpu": 45.2,
      "memory": 62.8,
      "version": "0.1.0"
    }
  }'
```

**Expected Response:**
```json
{
  "acknowledged": true,
  "shouldUpdate": false,
  "targetVersion": "0.1.0"
}
```

**Verification:**
```sql
SELECT last_seen FROM node_identities WHERE node_id = '0x...';
-- Should be updated to current timestamp
```

---

## Test Checklist

### Pre-Deployment

- [ ] All unit tests pass
- [ ] Code coverage >70%
- [ ] TypeScript compilation successful
- [ ] Linting passes with no errors
- [ ] Database migration tested

### Integration Testing

- [ ] Token generation works
- [ ] Install config API works
- [ ] Node registration works
- [ ] Node verification works
- [ ] Heartbeat works

### End-to-End Testing

- [ ] Linux installation succeeds
- [ ] Windows installation succeeds
- [ ] TPM key generation works
- [ ] Attestation verification works
- [ ] Docker container starts
- [ ] Node appears in database

### Error Handling

- [ ] Invalid token rejected
- [ ] Expired token rejected
- [ ] Used token rejected
- [ ] Invalid public key rejected
- [ ] Invalid attestation rejected
- [ ] Duplicate node rejected

### Security

- [ ] SQL injection prevented
- [ ] XSS prevented
- [ ] Rate limiting works
- [ ] Credentials stored securely
- [ ] RLS policies enforced

### Performance

- [ ] Token generation <10ms
- [ ] Registration <1000ms
- [ ] Heartbeat <100ms
- [ ] API handles 10+ req/sec

---

## Troubleshooting

### Common Issues

**Issue: "TPM not found"**
- Solution: Enable TPM in BIOS/UEFI
- Verify: `ls /dev/tpm*` (Linux) or `Get-Tpm` (Windows)

**Issue: "Docker installation failed"**
- Solution: Install Docker manually
- Verify: `docker --version`

**Issue: "Attestation verification failed"**
- Solution: Check TPM is initialized
- Verify: `tpm2_getcap properties-fixed`

**Issue: "Database connection failed"**
- Solution: Check Supabase credentials
- Verify: Test connection with Supabase client

---

## Success Criteria

Sprint 3 testing is complete when:

1. ✅ All unit tests pass (100%)
2. ✅ All integration tests pass (100%)
3. ✅ Linux E2E test passes
4. ✅ Windows E2E test passes
5. ✅ All error handling tests pass
6. ✅ All security tests pass
7. ✅ Performance benchmarks met
8. ✅ No critical bugs found

---

**Testing Status:** Ready for Execution  
**Last Updated:** November 28, 2025
