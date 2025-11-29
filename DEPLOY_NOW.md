# Deploy Noderr Nodes to Google Cloud - Quick Guide

## ✅ What's Ready

1. **Smart Contracts**: Deployed to Base Sepolia
   - NodeNFT: `0xEEE9178415A6b44916cbeF81de9Df2A4eEC735EE`
   - OracleVerifier: `0xf27e9DbBBFB520b8B4B25302cC5571BAE5397D9B`
   - GovernanceVoting: `0x6257ed4Fae49e504bf9a8ad9269909aCFcB9dBba`

2. **Deployment Script**: `deployment/deploy-gcp-vms.sh`

3. **Docker Images**: Ready to build (Dockerfiles in `/docker`)

## 🚀 Deploy in 3 Steps

### Step 1: Run the Deployment Script

Open Google Cloud Shell or run locally:

```bash
# Clone the repo (if not already)
gh repo clone Noderrxyz/noderr-node-os
cd noderr-node-os

# Run deployment
./deployment/deploy-gcp-vms.sh
```

This creates 3 VMs:
- **noderr-validator-1**: n2-standard-4 (4 vCPU, 16GB) - ~$100/month
- **noderr-guardian-1**: n2-standard-2 (2 vCPU, 8GB) - ~$50/month  
- **noderr-oracle-1**: n2-standard-8 (8 vCPU, 32GB) - ~$200/month

**Total**: ~$350/month = **$0.48/hour** (only when running)

### Step 2: Build Docker Images

On each VM:

```bash
# SSH into VM
gcloud compute ssh noderr-validator-1 --zone=us-central1-a --project=clean-outcome-479403-s4

# Clone repo
gh auth login  # Follow prompts
gh repo clone Noderrxyz/noderr-node-os
cd noderr-node-os

# Build appropriate image
cd docker
docker build -f validator/Dockerfile -t noderr-validator .
# OR
docker build -f guardian/Dockerfile -t noderr-guardian .
# OR  
docker build -f oracle/Dockerfile -t noderr-oracle .

# Run container
docker run -d --name noderr-node \
  --env-file /opt/noderr/.env \
  -p 8080:8080 \
  --restart unless-stopped \
  noderr-validator  # or noderr-guardian, noderr-oracle
```

### Step 3: Verify

Check logs:
```bash
docker logs -f noderr-node
```

Check if node is running:
```bash
curl localhost:8080/health
```

## 💰 Cost Management

**Stop VMs when not testing** (saves credits):
```bash
gcloud compute instances stop noderr-validator-1 noderr-guardian-1 noderr-oracle-1 \
  --zone=us-central1-a --project=clean-outcome-479403-s4
```

**Start VMs when ready to test**:
```bash
gcloud compute instances start noderr-validator-1 noderr-guardian-1 noderr-oracle-1 \
  --zone=us-central1-a --project=clean-outcome-479403-s4
```

**Delete VMs when done**:
```bash
gcloud compute instances delete noderr-validator-1 noderr-guardian-1 noderr-oracle-1 \
  --zone=us-central1-a --project=clean-outcome-479403-s4
```

## 🔧 Troubleshooting

### If Docker build fails
The VMs have Docker pre-installed via startup script. If it's not ready:
```bash
# Wait for startup script to complete
sudo journalctl -u google-startup-scripts.service -f

# Or install manually
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

### If you need GPU for Oracle node
1. Stop the oracle VM
2. Recreate with GPU:
```bash
gcloud compute instances create noderr-oracle-1 \
  --project=clean-outcome-479403-s4 \
  --zone=us-central1-a \
  --machine-type=n1-standard-4 \
  --accelerator=type=nvidia-tesla-t4,count=1 \
  --maintenance-policy=TERMINATE \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=50GB
```

Note: This requires upgrading from free trial to paid account (still uses credits).

## 📊 Monitor Costs

View current spend:
```bash
gcloud billing accounts list
gcloud billing projects describe clean-outcome-479403-s4
```

Or check: https://console.cloud.google.com/billing

## 🎯 What Each Node Does

**Validator** (noderr-validator-1):
- Executes trades based on consensus
- Handles settlement and order routing
- Validates transactions

**Guardian** (noderr-guardian-1):
- Participates in BFT consensus
- Validates oracle signatures
- Monitors network health

**Oracle** (noderr-oracle-1):
- Runs ML models for price predictions
- Generates trading signals
- Submits predictions to OracleVerifier contract

## 🔗 Useful Links

- **Basescan (contracts)**: https://sepolia.basescan.org/address/0xEEE9178415A6b44916cbeF81de9Df2A4eEC735EE
- **GitHub**: https://github.com/Noderrxyz/noderr-node-os
- **GCP Console**: https://console.cloud.google.com/compute/instances?project=clean-outcome-479403-s4

---

**Ready to deploy!** Just run `./deployment/deploy-gcp-vms.sh` when you're ready.
