# NODERR Node OS - Production Deployment Guide
## Complete Guide for Mainnet Deployment

**Version:** 1.0.0  
**Last Updated:** November 28, 2025  
**Target Network:** Base Mainnet (Chain ID: 8453)  
**Quality Standard:** PhD-Level Production Ready

---

## Table of Contents

1. [Pre-Deployment Checklist](#1-pre-deployment-checklist)
2. [Infrastructure Setup](#2-infrastructure-setup)
3. [Smart Contract Deployment](#3-smart-contract-deployment)
4. [Backend Service Deployment](#4-backend-service-deployment)
5. [Database Configuration](#5-database-configuration)
6. [Frontend Deployment](#6-frontend-deployment)
7. [Monitoring Setup](#7-monitoring-setup)
8. [Security Hardening](#8-security-hardening)
9. [Post-Deployment Validation](#9-post-deployment-validation)
10. [Rollback Procedures](#10-rollback-procedures)

---

## 1. Pre-Deployment Checklist

### 1.1 Code Readiness

- [ ] All tests passing (unit, integration, E2E)
- [ ] Security audit completed and issues fixed
- [ ] Code review completed by at least 2 developers
- [ ] All dependencies updated to latest stable versions
- [ ] No console.log() or debug statements in production code
- [ ] Environment variables documented in .env.example
- [ ] Git repository tagged with release version (e.g., v1.0.0)

### 1.2 Infrastructure Readiness

- [ ] Production domain registered and DNS configured
- [ ] SSL/TLS certificates obtained (Let's Encrypt or commercial)
- [ ] Cloud provider account set up (AWS, GCP, or Railway)
- [ ] Database provisioned (Supabase production tier)
- [ ] CDN configured for static assets (Cloudflare or similar)
- [ ] Backup strategy defined and tested
- [ ] Disaster recovery plan documented

### 1.3 Team Readiness

- [ ] On-call rotation schedule defined
- [ ] Incident response procedures documented
- [ ] Communication channels set up (Slack, Discord, PagerDuty)
- [ ] Deployment window scheduled (low-traffic period)
- [ ] Rollback plan reviewed and understood by all team members
- [ ] Post-deployment monitoring plan defined

### 1.4 Security Readiness

- [ ] Multi-sig wallet set up for contract ownership
- [ ] Guardian keys generated and secured (hardware wallet or KMS)
- [ ] API keys rotated and stored in secret manager
- [ ] Rate limiting configured
- [ ] DDoS protection enabled (Cloudflare)
- [ ] Security monitoring alerts configured

---

## 2. Infrastructure Setup

### 2.1 Cloud Provider Selection

**Recommended Providers:**
- **Railway** - Easiest deployment, built-in CI/CD
- **AWS** - Most flexible, enterprise-grade
- **Google Cloud** - Good balance of features and ease
- **Vercel** - Best for frontend, limited backend support

**Recommended:** Railway for MVP, AWS for scale

### 2.2 Database Setup (Supabase)

#### Create Production Project

```bash
# 1. Create new Supabase project
# - Go to https://supabase.com/dashboard
# - Click "New Project"
# - Name: noderr-production
# - Region: us-east-1 (or closest to users)
# - Database Password: Generate strong password (save in password manager)
# - Pricing: Pro tier ($25/month minimum for production)

# 2. Configure database
# - Enable Point-in-Time Recovery (PITR)
# - Set up daily backups
# - Configure connection pooling (Supavisor)
# - Enable SSL enforcement
```

#### Apply Migrations

```bash
# Install Supabase CLI
npm install -g supabase

# Link to production project
supabase link --project-ref YOUR_PROJECT_REF

# Apply all migrations
supabase db push

# Verify migrations
supabase db diff
```

#### Configure RLS Policies

```sql
-- Verify RLS is enabled on all tables
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public';

-- All tables should have rowsecurity = true
```

### 2.3 Secret Management

**Option 1: AWS Secrets Manager (Recommended for AWS)**

```bash
# Install AWS CLI
pip install awscli

# Configure AWS credentials
aws configure

# Create secrets
aws secretsmanager create-secret \
  --name noderr/production/database-url \
  --secret-string "postgresql://..."

aws secretsmanager create-secret \
  --name noderr/production/guardian-private-key \
  --secret-string "0x..."

# Retrieve secrets in application
aws secretsmanager get-secret-value \
  --secret-id noderr/production/database-url \
  --query SecretString --output text
```

**Option 2: Railway Environment Variables (Recommended for Railway)**

```bash
# Set environment variables via Railway dashboard
# - Go to project settings
# - Add environment variables
# - Enable "Encrypted" for sensitive values
```

**Option 3: HashiCorp Vault (Enterprise)**

```bash
# Install Vault
brew install vault  # macOS
apt-get install vault  # Ubuntu

# Start Vault server
vault server -dev

# Store secrets
vault kv put secret/noderr/production \
  database_url="postgresql://..." \
  guardian_key="0x..."

# Retrieve secrets
vault kv get secret/noderr/production
```

### 2.4 Domain and SSL

#### Domain Configuration

```bash
# 1. Register domain (e.g., noderr.network)
# - Use Namecheap, Google Domains, or Cloudflare Registrar

# 2. Configure DNS records
# A record: @ -> Your server IP
# CNAME record: www -> @
# CNAME record: api -> @

# 3. Configure Cloudflare (optional but recommended)
# - Add site to Cloudflare
# - Update nameservers at registrar
# - Enable "Always Use HTTPS"
# - Enable "Auto Minify" for JS/CSS/HTML
# - Set SSL/TLS mode to "Full (strict)"
```

#### SSL Certificate

```bash
# Option 1: Let's Encrypt (Free)
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d noderr.network -d www.noderr.network

# Option 2: Cloudflare Origin Certificate (Free with Cloudflare)
# - Go to SSL/TLS -> Origin Server
# - Create certificate
# - Install on server

# Option 3: Commercial SSL (DigiCert, Sectigo)
# - Purchase certificate
# - Generate CSR
# - Install certificate
```

---

## 3. Smart Contract Deployment

### 3.1 Pre-Deployment Verification

```bash
# 1. Verify contract compilation
cd noderr-protocol/contracts
npx hardhat compile

# 2. Run tests
npx hardhat test

# 3. Check gas estimates
npx hardhat run scripts/gas-estimate.ts

# 4. Verify contract sizes (must be < 24KB)
npx hardhat size-contracts
```

### 3.2 Deploy to Base Mainnet

#### Environment Setup

```bash
# Create .env.mainnet file
cat > .env.mainnet << EOF
# Base Mainnet RPC
BASE_MAINNET_RPC_URL=https://mainnet.base.org

# Deployer private key (use hardware wallet or KMS)
DEPLOYER_PRIVATE_KEY=0x...

# Etherscan API key for verification
BASESCAN_API_KEY=your-api-key

# Multi-sig wallet address (Gnosis Safe)
MULTISIG_ADDRESS=0x...
EOF

# Load environment
source .env.mainnet
```

#### Deploy Contracts

```bash
# 1. Deploy MockERC20 (or use real NODERR token)
npx hardhat run scripts/deploy-token.ts --network base-mainnet

# Output: NODERR Token deployed to: 0x...

# 2. Deploy NodeStaking
npx hardhat run scripts/deploy-node-staking.ts --network base-mainnet

# Output: NodeStaking deployed to: 0x...

# 3. Deploy RewardDistributor
npx hardhat run scripts/deploy-reward-distributor.ts --network base-mainnet

# Output: RewardDistributor deployed to: 0x...
```

#### Verify Contracts on Basescan

```bash
# Verify NodeStaking
npx hardhat verify --network base-mainnet \
  0xNODE_STAKING_ADDRESS \
  "0xTOKEN_ADDRESS" \
  "1000000000000000000000" \
  "604800"

# Verify RewardDistributor
npx hardhat verify --network base-mainnet \
  0xREWARD_DISTRIBUTOR_ADDRESS \
  "0xTOKEN_ADDRESS" \
  "0xNODE_STAKING_ADDRESS" \
  "86400" \
  "10000000000000000000000"
```

#### Transfer Ownership to Multi-Sig

```bash
# Create transfer ownership script
cat > scripts/transfer-ownership.ts << 'EOF'
import { ethers } from "hardhat";

async function main() {
  const MULTISIG_ADDRESS = process.env.MULTISIG_ADDRESS;
  
  const nodeStaking = await ethers.getContractAt(
    "NodeStaking",
    "0xNODE_STAKING_ADDRESS"
  );
  
  const rewardDistributor = await ethers.getContractAt(
    "RewardDistributor",
    "0xREWARD_DISTRIBUTOR_ADDRESS"
  );
  
  // Transfer ownership
  await nodeStaking.transferOwnership(MULTISIG_ADDRESS);
  await rewardDistributor.transferOwnership(MULTISIG_ADDRESS);
  
  console.log("Ownership transferred to:", MULTISIG_ADDRESS);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
EOF

# Execute transfer
npx hardhat run scripts/transfer-ownership.ts --network base-mainnet
```

#### Fund Reward Pool

```bash
# Transfer NODERR tokens to RewardDistributor
# Amount: 1,000,000 NODERR for first 100 epochs

# Using Hardhat
npx hardhat run scripts/fund-reward-pool.ts --network base-mainnet

# Or using multi-sig wallet UI (Gnosis Safe)
# - Go to https://app.safe.global
# - Connect wallet
# - New Transaction -> Send Tokens
# - Token: NODERR
# - Recipient: RewardDistributor address
# - Amount: 1,000,000
# - Submit and collect signatures
```

### 3.3 Post-Deployment Contract Configuration

```bash
# Add authorized oracles to RewardDistributor
# This must be done via multi-sig

# Create proposal in Gnosis Safe:
# Contract: RewardDistributor
# Function: addOracle(address)
# Parameter: 0xORACLE_ADDRESS
```

---

## 4. Backend Service Deployment

### 4.1 Build Application

```bash
cd noderr-dapp

# Install dependencies
npm install

# Build frontend
npm run build

# Build backend
npm run build

# Output: dist/ directory with compiled code
```

### 4.2 Deploy to Railway

#### Create Railway Project

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Create new project
railway init

# Link to GitHub repository
railway link
```

#### Configure Environment Variables

```bash
# Set environment variables via Railway dashboard
# Or use CLI:

railway variables set DATABASE_URL="postgresql://..."
railway variables set SUPABASE_PROJECT_URL="https://..."
railway variables set SUPABASE_SERVICE_ROLE_KEY="..."
railway variables set NODE_STAKING_ADDRESS="0x..."
railway variables set REWARD_DISTRIBUTOR_ADDRESS="0x..."
railway variables set BASE_MAINNET_RPC_URL="https://mainnet.base.org"
railway variables set GUARDIAN_PRIVATE_KEY="0x..." # Use KMS instead
```

#### Deploy

```bash
# Deploy to Railway
railway up

# Or configure auto-deploy from GitHub
# - Go to Railway dashboard
# - Settings -> Deployments
# - Enable "Auto-deploy from GitHub"
# - Select branch: main
```

### 4.3 Deploy to AWS (Alternative)

#### Create EC2 Instance

```bash
# 1. Launch EC2 instance
# - AMI: Ubuntu 22.04 LTS
# - Instance type: t3.medium (2 vCPU, 4GB RAM)
# - Storage: 30GB SSD
# - Security group: Allow 22 (SSH), 80 (HTTP), 443 (HTTPS)

# 2. Connect to instance
ssh -i your-key.pem ubuntu@your-instance-ip

# 3. Install Node.js
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 4. Install PM2 (process manager)
sudo npm install -g pm2

# 5. Clone repository
git clone https://github.com/Noderrxyz/noderr-dapp.git
cd noderr-dapp

# 6. Install dependencies
npm install

# 7. Build application
npm run build

# 8. Create .env file
nano .env
# (Paste environment variables)

# 9. Start with PM2
pm2 start dist/index.js --name noderr-dapp

# 10. Configure PM2 to start on boot
pm2 startup
pm2 save

# 11. Install Nginx
sudo apt-get install nginx

# 12. Configure Nginx reverse proxy
sudo nano /etc/nginx/sites-available/noderr

# Paste:
server {
    listen 80;
    server_name noderr.network www.noderr.network;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

# Enable site
sudo ln -s /etc/nginx/sites-available/noderr /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# 13. Install SSL certificate
sudo certbot --nginx -d noderr.network -d www.noderr.network
```

---

## 5. Database Configuration

### 5.1 Production Database Settings

```sql
-- Connect to production database
psql $DATABASE_URL

-- Set connection limits
ALTER DATABASE postgres SET max_connections = 100;

-- Set statement timeout (30 seconds)
ALTER DATABASE postgres SET statement_timeout = '30s';

-- Set idle transaction timeout (10 minutes)
ALTER DATABASE postgres SET idle_in_transaction_session_timeout = '10min';

-- Enable query logging for slow queries
ALTER DATABASE postgres SET log_min_duration_statement = 1000; -- 1 second
```

### 5.2 Create Database Indexes

```sql
-- Verify all indexes exist
SELECT schemaname, tablename, indexname 
FROM pg_indexes 
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- Add additional performance indexes if needed
CREATE INDEX CONCURRENTLY idx_node_stakes_operator_active 
  ON node_stakes(operator_address, active);

CREATE INDEX CONCURRENTLY idx_node_rewards_node_claimed 
  ON node_rewards(node_id, claimed);
```

### 5.3 Configure Backups

```bash
# Enable Point-in-Time Recovery (PITR) in Supabase dashboard
# - Go to Database -> Backups
# - Enable PITR
# - Retention: 7 days minimum

# Schedule manual backups (optional)
# Create backup script
cat > backup-db.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump $DATABASE_URL | gzip > backup_$DATE.sql.gz
aws s3 cp backup_$DATE.sql.gz s3://noderr-backups/
EOF

chmod +x backup-db.sh

# Add to crontab (daily at 2 AM)
crontab -e
0 2 * * * /path/to/backup-db.sh
```

---

## 6. Frontend Deployment

### 6.1 Build Optimization

```bash
# Optimize build
npm run build

# Analyze bundle size
npx vite-bundle-visualizer

# Check for large dependencies
npm ls --depth=0 | sort -k2 -n
```

### 6.2 Deploy to Vercel (Recommended for Frontend)

```bash
# Install Vercel CLI
npm install -g vercel

# Login
vercel login

# Deploy
vercel --prod

# Configure custom domain
vercel domains add noderr.network
```

### 6.3 Deploy to Cloudflare Pages (Alternative)

```bash
# 1. Go to Cloudflare Pages dashboard
# 2. Create new project
# 3. Connect GitHub repository
# 4. Configure build settings:
#    - Build command: npm run build
#    - Build output directory: dist
#    - Root directory: (leave empty)
# 5. Add environment variables
# 6. Deploy
```

---

## 7. Monitoring Setup

### 7.1 Application Monitoring

#### Sentry (Error Tracking)

```bash
# Install Sentry
npm install @sentry/node @sentry/tracing

# Configure Sentry
# In server/_core/index.ts
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: "production",
  tracesSampleRate: 0.1, // 10% of transactions
});
```

#### DataDog (APM)

```bash
# Install DataDog
npm install dd-trace

# Configure DataDog
# In server/_core/index.ts
import tracer from 'dd-trace';

tracer.init({
  service: 'noderr-dapp',
  env: 'production',
  logInjection: true
});
```

### 7.2 Infrastructure Monitoring

#### Grafana + Prometheus (Self-Hosted)

```bash
# Use monitoring stack from Sprint 5
cd monitoring
docker-compose up -d

# Access Grafana
# http://your-server:3001
# Default credentials: admin/admin
```

#### Datadog (Managed)

```bash
# Install Datadog agent
DD_API_KEY=your-api-key DD_SITE="datadoghq.com" bash -c "$(curl -L https://s3.amazonaws.com/dd-agent/scripts/install_script.sh)"

# Configure agent
sudo nano /etc/datadog-agent/datadog.yaml

# Add:
logs_enabled: true
apm_enabled: true
```

### 7.3 Uptime Monitoring

#### UptimeRobot (Free)

```bash
# 1. Go to https://uptimerobot.com
# 2. Create account
# 3. Add monitors:
#    - HTTP(s): https://noderr.network
#    - HTTP(s): https://api.noderr.network/health
#    - Keyword: Check for "healthy" in response
# 4. Configure alerts (email, Slack, webhook)
```

#### Pingdom (Paid)

```bash
# 1. Go to https://www.pingdom.com
# 2. Create account
# 3. Add uptime checks
# 4. Add transaction checks (user flows)
# 5. Configure alerts
```

---

## 8. Security Hardening

### 8.1 Rate Limiting

```typescript
// Install express-rate-limit
npm install express-rate-limit

// In server/_core/index.ts
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window per IP
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', limiter);
```

### 8.2 DDoS Protection

```bash
# Enable Cloudflare DDoS protection
# 1. Go to Cloudflare dashboard
# 2. Security -> DDoS
# 3. Enable "HTTP DDoS Attack Protection"
# 4. Enable "Network-layer DDoS Attack Protection"
# 5. Set sensitivity to "High"
```

### 8.3 WAF (Web Application Firewall)

```bash
# Configure Cloudflare WAF
# 1. Go to Security -> WAF
# 2. Enable "Managed Rules"
# 3. Enable "OWASP Core Ruleset"
# 4. Create custom rules:
#    - Block countries with high fraud rates
#    - Block known bad IPs
#    - Rate limit API endpoints
```

### 8.4 Secret Rotation

```bash
# Rotate secrets every 90 days
# 1. Generate new API keys
# 2. Update in secret manager
# 3. Deploy new version
# 4. Verify new keys work
# 5. Revoke old keys
```

---

## 9. Post-Deployment Validation

### 9.1 Smoke Tests

```bash
# 1. Test homepage loads
curl -I https://noderr.network
# Expected: HTTP/2 200

# 2. Test API health endpoint
curl https://api.noderr.network/health
# Expected: {"healthy": true, ...}

# 3. Test tRPC endpoint
curl -X POST https://api.noderr.network/api/trpc/services.healthCheck \
  -H "Content-Type: application/json" \
  -d '{}'
# Expected: {"result": {"data": {"healthy": true}}}

# 4. Test smart contract
cast call 0xNODE_STAKING_ADDRESS "minimumStake()" --rpc-url https://mainnet.base.org
# Expected: 1000000000000000000000 (1000 NODERR)
```

### 9.2 End-to-End Tests

```bash
# Run E2E test suite
npm run test:e2e

# Expected: All tests pass
```

### 9.3 Performance Tests

```bash
# Install k6
brew install k6  # macOS
sudo apt-get install k6  # Ubuntu

# Run load test
k6 run load-test.js

# Expected:
# - 95th percentile response time < 200ms
# - Error rate < 0.1%
# - Throughput > 100 req/s
```

### 9.4 Security Validation

```bash
# Run security scan
npm audit --production

# Expected: 0 vulnerabilities

# SSL test
curl https://www.ssllabs.com/ssltest/analyze.html?d=noderr.network

# Expected: A+ rating
```

---

## 10. Rollback Procedures

### 10.1 Application Rollback

#### Railway

```bash
# Rollback to previous deployment
railway rollback

# Or via dashboard:
# - Go to Deployments
# - Find previous successful deployment
# - Click "Redeploy"
```

#### AWS EC2

```bash
# SSH to server
ssh -i your-key.pem ubuntu@your-instance-ip

# Stop current version
pm2 stop noderr-dapp

# Checkout previous version
git checkout v1.0.0  # or previous tag

# Install dependencies
npm install

# Rebuild
npm run build

# Restart
pm2 restart noderr-dapp
```

### 10.2 Database Rollback

```bash
# Restore from backup
# 1. Download backup
aws s3 cp s3://noderr-backups/backup_YYYYMMDD.sql.gz .

# 2. Decompress
gunzip backup_YYYYMMDD.sql.gz

# 3. Restore (WARNING: This will overwrite current data)
psql $DATABASE_URL < backup_YYYYMMDD.sql

# 4. Verify
psql $DATABASE_URL -c "SELECT COUNT(*) FROM node_stakes;"
```

### 10.3 Smart Contract Rollback

**Note:** Smart contracts cannot be rolled back once deployed. Options:

1. **Pause contracts** (if pausable)
   ```bash
   # Via multi-sig wallet
   # Call: pause()
   ```

2. **Deploy new version** (if upgradeable)
   ```bash
   # Deploy new implementation
   # Update proxy to point to new implementation
   ```

3. **Emergency migration**
   ```bash
   # Deploy new contracts
   # Migrate state from old to new
   # Update frontend to use new addresses
   ```

---

## Appendix A: Environment Variables

### Production .env Template

```bash
# ====================================================================
# PRODUCTION ENVIRONMENT VARIABLES
# ====================================================================

# --- Node Environment ---
NODE_ENV=production
PORT=3000

# --- Database (Supabase) ---
DATABASE_URL="postgresql://postgres.PROJECT_ID:PASSWORD@aws-1-us-east-1.pooler.supabase.com:5432/postgres"
SUPABASE_PROJECT_ID="your-project-id"
SUPABASE_PROJECT_URL="https://your-project-id.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# --- Smart Contracts (Base Mainnet) ---
NODE_STAKING_ADDRESS="0x..."
REWARD_DISTRIBUTOR_ADDRESS="0x..."

# --- Blockchain ---
BASE_MAINNET_RPC_URL="https://mainnet.base.org"
GUARDIAN_PRIVATE_KEY="use-kms-instead"  # DO NOT USE PLAINTEXT IN PRODUCTION

# --- Backend Services ---
DEPLOYMENT_ENGINE_URL="https://deploy.noderr.network"
DEPLOYMENT_ENGINE_API_KEY="your-api-key"

# --- Monitoring ---
SENTRY_DSN="https://...@sentry.io/..."
DATADOG_API_KEY="your-datadog-api-key"

# --- Security ---
RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
RATE_LIMIT_MAX=100  # 100 requests per window

# --- Frontend (Vite) ---
VITE_API_URL="https://api.noderr.network"
VITE_CHAIN_ID=8453  # Base Mainnet
```

---

## Appendix B: Deployment Checklist

### Pre-Deployment

- [ ] All tests passing
- [ ] Security audit completed
- [ ] Dependencies updated
- [ ] Environment variables configured
- [ ] SSL certificates obtained
- [ ] Backups configured
- [ ] Monitoring set up
- [ ] Team notified

### Deployment

- [ ] Deploy smart contracts to mainnet
- [ ] Verify contracts on Basescan
- [ ] Transfer ownership to multi-sig
- [ ] Fund reward pool
- [ ] Deploy backend services
- [ ] Deploy frontend
- [ ] Configure DNS
- [ ] Enable SSL
- [ ] Configure CDN

### Post-Deployment

- [ ] Smoke tests passed
- [ ] E2E tests passed
- [ ] Performance tests passed
- [ ] Security scan passed
- [ ] Monitoring alerts configured
- [ ] Team trained on rollback procedures
- [ ] Documentation updated
- [ ] Announcement published

---

## Appendix C: Contact Information

**On-Call Rotation:**
- Primary: [Name] - [Phone] - [Email]
- Secondary: [Name] - [Phone] - [Email]
- Escalation: [Name] - [Phone] - [Email]

**External Support:**
- Supabase Support: https://supabase.com/support
- Railway Support: https://railway.app/help
- Cloudflare Support: https://www.cloudflare.com/support

**Emergency Contacts:**
- CEO: [Email]
- CTO: [Email]
- Security Lead: [Email]

---

**Document Version:** 1.0.0  
**Last Updated:** November 28, 2025  
**Next Review:** December 28, 2025
