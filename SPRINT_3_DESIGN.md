# Sprint 3: Authentication & Installation - Design Document

**Date:** November 28, 2025  
**Status:** 🔄 **IN PROGRESS**  
**Quality Standard:** PhD-Level Excellence

---

## 1. Executive Summary

Sprint 3 focuses on creating a **secure, hardware-attested authentication system** and **one-command installation scripts** for both Linux and Windows. The system will use **TPM (Trusted Platform Module)** for hardware-based key generation and attestation, ensuring that each node has a unique, cryptographically verifiable identity.

### Core Objectives

1. **TPM-Based Key Generation** - Hardware-attested cryptographic keys
2. **Secure Authentication API** - Backend service for node registration and verification
3. **Linux Installation Script** - One-command installation with full automation
4. **Windows Installation Script** - PowerShell-based installation with TPM support
5. **Installation Token System** - Secure, single-use tokens for node provisioning

---

## 2. TPM-Based Authentication Architecture

### 2.1 Why TPM?

**Trusted Platform Module (TPM)** provides:
- ✅ **Hardware-based key storage** - Keys never leave the TPM chip
- ✅ **Attestation** - Cryptographic proof of hardware identity
- ✅ **Secure boot verification** - Ensures system integrity
- ✅ **Anti-tampering** - Detects unauthorized modifications
- ✅ **Industry standard** - Widely supported on modern hardware

### 2.2 Key Generation Flow

```
┌─────────────────────────────────────────────────────────────┐
│  1. Installation Script Starts                              │
│     - Validates hardware requirements                       │
│     - Checks for TPM 2.0 availability                       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  2. TPM Key Generation                                      │
│     - Generate ECC P-256 key pair in TPM                    │
│     - Public key exported for registration                  │
│     - Private key NEVER leaves TPM                          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  3. Attestation                                             │
│     - TPM signs a challenge with private key                │
│     - Attestation includes PCR values (system state)        │
│     - Creates cryptographic proof of hardware identity      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  4. Registration with Backend                               │
│     - Send: Installation token + Public key + Attestation   │
│     - Backend validates token and attestation               │
│     - Backend stores node identity and issues credentials   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  5. Node Starts with Credentials                            │
│     - Node uses TPM for all signing operations              │
│     - Periodic re-attestation for ongoing verification      │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 Security Properties

| Property | Implementation | Verification |
|----------|----------------|--------------|
| **Unique Identity** | TPM-generated ECC key | Public key hash = Node ID |
| **Hardware Binding** | Key stored in TPM | Attestation proves TPM ownership |
| **Anti-Cloning** | Private key never exported | TPM hardware protection |
| **Tamper Detection** | PCR measurements | Boot state verification |
| **Revocation** | Backend blacklist | Token/key revocation API |

---

## 3. Authentication API Design

### 3.1 Architecture

**Technology Stack:**
- **Runtime:** Node.js 20.x with TypeScript
- **Framework:** Fastify (high-performance, secure)
- **Database:** PostgreSQL (Supabase)
- **Crypto:** Node crypto + TPM libraries
- **Validation:** Zod schemas

### 3.2 Database Schema

#### Table: `install_tokens`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `token` | TEXT | Unique installation token (32 bytes hex) |
| `application_id` | UUID | FK to node_applications |
| `tier` | TEXT | Node tier (ALL/ORACLE/GUARDIAN) |
| `os` | TEXT | Operating system (linux/windows) |
| `is_used` | BOOLEAN | Whether token has been consumed |
| `created_at` | TIMESTAMP | Token creation time |
| `expires_at` | TIMESTAMP | Token expiration (7 days) |

#### Table: `node_identities`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `node_id` | TEXT | Unique node ID (hash of public key) |
| `public_key` | TEXT | TPM-generated public key (PEM format) |
| `attestation_data` | JSONB | TPM attestation data |
| `tier` | TEXT | Node tier |
| `os` | TEXT | Operating system |
| `install_token_id` | UUID | FK to install_tokens |
| `status` | TEXT | active/suspended/revoked |
| `last_seen` | TIMESTAMP | Last heartbeat |
| `created_at` | TIMESTAMP | Registration time |
| `updated_at` | TIMESTAMP | Last update time |

#### Table: `node_credentials`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `node_id` | TEXT | FK to node_identities |
| `api_key_hash` | TEXT | Hashed API key for authentication |
| `jwt_secret` | TEXT | Secret for JWT signing |
| `created_at` | TIMESTAMP | Credential creation time |
| `expires_at` | TIMESTAMP | Credential expiration (1 year) |

### 3.3 API Endpoints

#### `POST /api/v1/install/config`

**Purpose:** Get installation configuration using installation token

**Request:**
```json
{
  "installToken": "a1b2c3d4e5f6..."
}
```

**Response:**
```json
{
  "nodeId": "temp-node-id-123",
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

#### `POST /api/v1/auth/register`

**Purpose:** Register node with TPM-attested public key

**Request:**
```json
{
  "installToken": "a1b2c3d4e5f6...",
  "publicKey": "-----BEGIN PUBLIC KEY-----\n...",
  "attestation": {
    "quote": "base64-encoded-tpm-quote",
    "signature": "base64-encoded-signature",
    "pcrValues": {
      "0": "sha256-hash",
      "7": "sha256-hash"
    }
  },
  "systemInfo": {
    "hostname": "node-server-01",
    "cpuCores": 8,
    "memoryGB": 32,
    "diskGB": 500
  }
}
```

**Response:**
```json
{
  "nodeId": "0x1a2b3c4d...",
  "apiKey": "ndr_live_...",
  "jwtToken": "eyJhbGciOiJIUzI1NiIs...",
  "status": "registered"
}
```

#### `POST /api/v1/auth/verify`

**Purpose:** Verify node credentials and get fresh JWT

**Request:**
```json
{
  "nodeId": "0x1a2b3c4d...",
  "apiKey": "ndr_live_...",
  "challenge": "random-challenge-string"
}
```

**Response:**
```json
{
  "jwtToken": "eyJhbGciOiJIUzI1NiIs...",
  "expiresAt": "2025-12-28T00:00:00Z",
  "status": "verified"
}
```

#### `POST /api/v1/auth/heartbeat`

**Purpose:** Node heartbeat to maintain active status

**Request:**
```json
{
  "nodeId": "0x1a2b3c4d...",
  "jwtToken": "eyJhbGciOiJIUzI1NiIs...",
  "metrics": {
    "uptime": 86400,
    "cpu": 45.2,
    "memory": 62.8,
    "version": "0.1.0"
  }
}
```

**Response:**
```json
{
  "acknowledged": true,
  "shouldUpdate": false,
  "targetVersion": "0.1.0"
}
```

---

## 4. Linux Installation Script

### 4.1 Requirements

- **OS:** Ubuntu 22.04 LTS or newer, Debian 11+, RHEL 8+
- **TPM:** TPM 2.0 (physical or firmware)
- **Docker:** Will be installed if not present
- **Privileges:** sudo access required

### 4.2 Installation Flow

```bash
curl -fsSL https://install.noderr.xyz/linux | bash -s -- <INSTALL_TOKEN>
```

**Script Steps:**

1. **Validate Environment**
   - Check OS compatibility
   - Verify sudo access
   - Check internet connectivity

2. **Hardware Validation**
   - Detect TPM 2.0 presence
   - Verify CPU cores (min 4)
   - Verify RAM (min 8GB)
   - Verify disk space (min 100GB)

3. **Install Dependencies**
   - Install Docker if not present
   - Install TPM tools (tpm2-tools, tpm2-tss)
   - Install required system packages

4. **TPM Key Generation**
   - Initialize TPM (if needed)
   - Generate ECC P-256 key pair
   - Export public key
   - Create attestation quote

5. **Node Registration**
   - Call `/api/v1/install/config` with token
   - Call `/api/v1/auth/register` with public key
   - Store credentials securely

6. **Docker Setup**
   - Pull appropriate Docker image for tier
   - Create Docker network
   - Configure environment variables
   - Set up systemd service

7. **Start Node**
   - Start Docker container
   - Verify health check
   - Enable auto-restart

8. **Post-Install**
   - Display node ID and status
   - Show logs command
   - Provide troubleshooting info

### 4.3 Script Structure

```bash
#!/bin/bash
set -euo pipefail

# Constants
SCRIPT_VERSION="1.0.0"
MIN_CPU_CORES=4
MIN_RAM_GB=8
MIN_DISK_GB=100
AUTH_API_URL="https://auth.noderr.xyz"
INSTALL_DIR="/opt/noderr"

# Functions
log() { echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*"; }
error() { log "ERROR: $*" >&2; exit 1; }
check_root() { [[ $EUID -eq 0 ]] || error "This script must be run as root"; }
check_tpm() { ... }
install_docker() { ... }
generate_tpm_key() { ... }
register_node() { ... }
setup_docker() { ... }
start_node() { ... }

# Main execution
main() {
  log "Noderr Node OS Installer v${SCRIPT_VERSION}"
  check_root
  validate_hardware
  install_dependencies
  generate_tpm_key
  register_node
  setup_docker
  start_node
  log "Installation complete!"
}

main "$@"
```

---

## 5. Windows Installation Script

### 5.1 Requirements

- **OS:** Windows 10/11 Pro or Server 2019+
- **TPM:** TPM 2.0 (required on modern Windows)
- **Docker:** Docker Desktop or Docker Engine
- **Privileges:** Administrator access required

### 5.2 Installation Flow

```powershell
Invoke-WebRequest -Uri "https://install.noderr.xyz/windows.ps1" -OutFile "install-noderr.ps1"
.\install-noderr.ps1 -InstallToken "<INSTALL_TOKEN>"
```

**Script Steps:**

1. **Validate Environment**
   - Check Windows version
   - Verify Administrator privileges
   - Check internet connectivity

2. **Hardware Validation**
   - Detect TPM 2.0 via Get-Tpm
   - Verify CPU cores
   - Verify RAM
   - Verify disk space

3. **Install Dependencies**
   - Install Docker Desktop (if needed)
   - Enable WSL2 (if needed)
   - Install TPM PowerShell module

4. **TPM Key Generation**
   - Use Windows TPM API
   - Generate ECC P-256 key
   - Export public key
   - Create attestation

5. **Node Registration**
   - Call authentication API
   - Store credentials in Windows Credential Manager

6. **Docker Setup**
   - Pull Docker image
   - Create Docker network
   - Configure environment
   - Set up Windows Service

7. **Start Node**
   - Start Docker container
   - Verify health
   - Enable auto-start

8. **Post-Install**
   - Display status
   - Show management commands

### 5.3 Script Structure

```powershell
#Requires -RunAsAdministrator
#Requires -Version 5.1

param(
    [Parameter(Mandatory=$true)]
    [string]$InstallToken
)

$ErrorActionPreference = "Stop"
$ScriptVersion = "1.0.0"

function Write-Log {
    param([string]$Message)
    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
}

function Test-TPM { ... }
function Install-Docker { ... }
function New-TPMKey { ... }
function Register-Node { ... }
function Install-DockerContainer { ... }
function Start-NodeService { ... }

# Main execution
Write-Log "Noderr Node OS Installer v$ScriptVersion"
Test-Administrator
Test-Hardware
Install-Dependencies
New-TPMKey
Register-Node
Install-DockerContainer
Start-NodeService
Write-Log "Installation complete!"
```

---

## 6. Installation Token System

### 6.1 Token Generation

**Backend Service:** Part of existing dApp backend

**Token Format:**
```
ndr_install_<32-byte-hex>
Example: ndr_install_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

**Generation Logic:**
```typescript
import { randomBytes } from 'crypto';

function generateInstallToken(): string {
  const tokenBytes = randomBytes(32);
  return `ndr_install_${tokenBytes.toString('hex')}`;
}
```

### 6.2 Token Lifecycle

1. **Creation** - Admin approves application, backend generates token
2. **Email** - Token sent to operator in welcome email
3. **Usage** - Installation script consumes token during registration
4. **Expiration** - Token expires after 7 days if unused
5. **Revocation** - Admin can revoke unused tokens

### 6.3 Security Properties

- ✅ **Single-use** - Token marked as used after registration
- ✅ **Time-limited** - 7-day expiration
- ✅ **Cryptographically random** - 256 bits of entropy
- ✅ **Prefix-based** - Easy to identify and validate
- ✅ **Revocable** - Admin can invalidate tokens

---

## 7. Implementation Plan

### Phase 1: Authentication API (Days 1-2)
- [ ] Create auth-api directory structure
- [ ] Implement database schema in Supabase
- [ ] Build Fastify server with endpoints
- [ ] Add TPM attestation verification
- [ ] Create comprehensive tests

### Phase 2: Linux Installation Script (Days 3-4)
- [ ] Write bash script with all functions
- [ ] Implement TPM key generation (tpm2-tools)
- [ ] Add hardware validation
- [ ] Test on Ubuntu 22.04
- [ ] Test on Debian 11

### Phase 3: Windows Installation Script (Days 4-5)
- [ ] Write PowerShell script
- [ ] Implement TPM key generation (Windows API)
- [ ] Add hardware validation
- [ ] Test on Windows 10/11
- [ ] Test on Windows Server 2019

### Phase 4: Integration Testing (Day 6)
- [ ] Test complete flow: Token → Install → Register → Start
- [ ] Verify TPM attestation end-to-end
- [ ] Test error handling and rollback
- [ ] Load test authentication API
- [ ] Security audit

### Phase 5: Documentation (Day 7)
- [ ] API documentation
- [ ] Installation guide
- [ ] Troubleshooting guide
- [ ] Sprint 3 completion report

---

## 8. Quality Gates

### Code Quality
- ✅ TypeScript strict mode
- ✅ 100% test coverage for API
- ✅ Linting with no errors
- ✅ Security audit passed

### Security
- ✅ TPM attestation verified
- ✅ Token validation robust
- ✅ No secrets in logs
- ✅ Secure credential storage

### Usability
- ✅ One-command installation
- ✅ Clear error messages
- ✅ Progress indicators
- ✅ Comprehensive logging

### Reliability
- ✅ Idempotent installation
- ✅ Rollback on failure
- ✅ Health check verification
- ✅ Auto-restart configured

---

## 9. Success Criteria

Sprint 3 is complete when:

1. ✅ Authentication API deployed and tested
2. ✅ Linux installation script works on Ubuntu/Debian
3. ✅ Windows installation script works on Win10/11
4. ✅ TPM attestation verified end-to-end
5. ✅ Installation tokens working correctly
6. ✅ All tests passing (100%)
7. ✅ Documentation complete
8. ✅ Security audit passed

---

**Status:** 🔄 IN PROGRESS  
**Target Completion:** 7 days  
**Quality Standard:** PhD-Level Excellence  
**No Compromises:** 100% Verification Required
