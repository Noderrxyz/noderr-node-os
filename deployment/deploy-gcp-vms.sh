#!/bin/bash

# Noderr Node Network - GCP VM Deployment Script
# This script creates 3 VMs: Validator, Guardian, and Oracle nodes

set -e

PROJECT_ID="clean-outcome-479403-s4"
REGION="us-central1"
ZONE="us-central1-a"

# Smart contract addresses on Base Sepolia
NODE_NFT_ADDRESS="0xEEE9178415A6b44916cbeF81de9Df2A4eEC735EE"
ORACLE_VERIFIER_ADDRESS="0xf27e9DbBBFB520b8B4B25302cC5571BAE5397D9B"
GOVERNANCE_VOTING_ADDRESS="0x6257ed4Fae49e504bf9a8ad9269909aCFcB9dBba"

echo "========================================="
echo "Noderr Node Network - GCP Deployment"
echo "========================================="
echo ""
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Zone: $ZONE"
echo ""
echo "Smart Contracts:"
echo "  NodeNFT: $NODE_NFT_ADDRESS"
echo "  OracleVerifier: $ORACLE_VERIFIER_ADDRESS"
echo "  GovernanceVoting: $GOVERNANCE_VOTING_ADDRESS"
echo ""
echo "========================================="
echo ""

# Function to create VM
create_vm() {
    local NAME=$1
    local MACHINE_TYPE=$2
    local DESCRIPTION=$3
    
    echo "Creating $DESCRIPTION ($NAME)..."
    echo "  Machine type: $MACHINE_TYPE"
    
    gcloud compute instances create $NAME \
        --project=$PROJECT_ID \
        --zone=$ZONE \
        --machine-type=$MACHINE_TYPE \
        --network-interface=network-tier=PREMIUM,stack-type=IPV4_ONLY,subnet=default \
        --maintenance-policy=MIGRATE \
        --provisioning-model=STANDARD \
        --scopes=https://www.googleapis.com/auth/cloud-platform \
        --tags=noderr-node,http-server,https-server \
        --create-disk=auto-delete=yes,boot=yes,device-name=$NAME,image=projects/ubuntu-os-cloud/global/images/ubuntu-2204-jammy-v20241119,mode=rw,size=50,type=pd-balanced \
        --no-shielded-secure-boot \
        --shielded-vtpm \
        --shielded-integrity-monitoring \
        --labels=project=noderr,node-type=${NAME%-*} \
        --reservation-affinity=any \
        --metadata=startup-script='#!/bin/bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
usermod -aG docker $USER

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Create environment file
cat > /opt/noderr/.env <<EOF
NODE_TYPE='${NAME%-*}'
NODE_NFT_ADDRESS='$NODE_NFT_ADDRESS'
ORACLE_VERIFIER_ADDRESS='$ORACLE_VERIFIER_ADDRESS'
GOVERNANCE_VOTING_ADDRESS='$GOVERNANCE_VOTING_ADDRESS'
RPC_URL=https://base-sepolia.g.alchemy.com/v2/Z6Vsdc0TcuwUWBvlIzOqT
NETWORK=base-sepolia
EOF

echo "Node setup complete. Ready for Docker deployment."
'
    
    if [ $? -eq 0 ]; then
        echo "✅ $NAME created successfully"
        echo ""
    else
        echo "❌ Failed to create $NAME"
        exit 1
    fi
}

# Create Validator Node (trade execution, settlement)
create_vm "noderr-validator-1" "n2-standard-4" "Validator Node"

# Create Guardian Node (consensus validation)
create_vm "noderr-guardian-1" "n2-standard-2" "Guardian Node"

# Create Oracle Node (ML inference - CPU only for now)
create_vm "noderr-oracle-1" "n2-standard-8" "Oracle Node"

echo "========================================="
echo "✅ All VMs created successfully!"
echo "========================================="
echo ""
echo "Next steps:"
echo "1. Wait 2-3 minutes for VMs to fully boot"
echo "2. SSH into each VM and deploy Docker containers"
echo "3. Monitor logs and verify network connectivity"
echo ""
echo "SSH commands:"
echo "  gcloud compute ssh noderr-validator-1 --zone=$ZONE --project=$PROJECT_ID"
echo "  gcloud compute ssh noderr-guardian-1 --zone=$ZONE --project=$PROJECT_ID"
echo "  gcloud compute ssh noderr-oracle-1 --zone=$ZONE --project=$PROJECT_ID"
echo ""
echo "To stop all VMs (save credits):"
echo "  gcloud compute instances stop noderr-validator-1 noderr-guardian-1 noderr-oracle-1 --zone=$ZONE --project=$PROJECT_ID"
echo ""
echo "To start all VMs:"
echo "  gcloud compute instances start noderr-validator-1 noderr-guardian-1 noderr-oracle-1 --zone=$ZONE --project=$PROJECT_ID"
echo ""
echo "To delete all VMs:"
echo "  gcloud compute instances delete noderr-validator-1 noderr-guardian-1 noderr-oracle-1 --zone=$ZONE --project=$PROJECT_ID"
echo ""
echo "========================================="
