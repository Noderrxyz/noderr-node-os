#!/bin/bash
set -e

echo "========================================="
echo "Noderr Node Deployment - Google Cloud"
echo "========================================="
echo ""

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-noderr-testnet}"
REGION="${GCP_REGION:-us-central1}"
ZONE="${GCP_ZONE:-us-central1-a}"

# Node configuration
ORACLE_COUNT="${ORACLE_COUNT:-3}"
GUARDIAN_COUNT="${GUARDIAN_COUNT:-2}"
VALIDATOR_COUNT="${VALIDATOR_COUNT:-1}"

echo "Configuration:"
echo "  Project:    $PROJECT_ID"
echo "  Region:     $REGION"
echo "  Zone:       $ZONE"
echo "  Oracles:    $ORACLE_COUNT"
echo "  Guardians:  $GUARDIAN_COUNT"
echo "  Validators: $VALIDATOR_COUNT"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ ERROR: gcloud CLI not found"
    echo ""
    echo "Install from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check authentication
echo "Checking GCP authentication..."
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo "❌ Not authenticated to GCP"
    echo "Run: gcloud auth login"
    exit 1
fi

ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)")
echo "✅ Authenticated as: $ACCOUNT"
echo ""

# Set project
echo "Setting project..."
gcloud config set project "$PROJECT_ID"
echo ""

# Create deployment directory
DEPLOYMENT_DIR="/home/ubuntu/noderr-node-os/deployment/gcp"
mkdir -p "$DEPLOYMENT_DIR"

# Function to create VM instance
create_node() {
    local node_type=$1
    local node_id=$2
    local instance_name="noderr-${node_type}-${node_id}"
    
    echo "Creating $instance_name..."
    
    # Machine type based on node type
    local machine_type
    case $node_type in
        oracle)
            machine_type="n2-standard-4"  # 4 vCPUs, 16GB RAM
            ;;
        guardian)
            machine_type="n2-standard-2"  # 2 vCPUs, 8GB RAM
            ;;
        validator)
            machine_type="n2-standard-2"  # 2 vCPUs, 8GB RAM
            ;;
    esac
    
    # Create startup script
    cat > "${DEPLOYMENT_DIR}/startup-${instance_name}.sh" << 'EOF'
#!/bin/bash
set -e

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Pull node image
docker pull gcr.io/${PROJECT_ID}/noderr-${NODE_TYPE}:latest

# Run node
docker run -d \
  --name noderr-node \
  --restart unless-stopped \
  -e NODE_ID=${NODE_ID} \
  -e NODE_TYPE=${NODE_TYPE} \
  -e DEPLOYMENT_ENGINE_URL=${DEPLOYMENT_ENGINE_URL} \
  -e NODE_NFT_ADDRESS=${NODE_NFT_ADDRESS} \
  -e ORACLE_VERIFIER_ADDRESS=${ORACLE_VERIFIER_ADDRESS} \
  -e GOVERNANCE_VOTING_ADDRESS=${GOVERNANCE_VOTING_ADDRESS} \
  -e RPC_URL=${RPC_URL} \
  -e WALLET_PRIVATE_KEY=${WALLET_PRIVATE_KEY} \
  -p 3000:3000 \
  -p 9090:9090 \
  gcr.io/${PROJECT_ID}/noderr-${NODE_TYPE}:latest

echo "Node started successfully"
EOF
    
    # Replace variables in startup script
    sed -i "s/\${PROJECT_ID}/$PROJECT_ID/g" "${DEPLOYMENT_DIR}/startup-${instance_name}.sh"
    sed -i "s/\${NODE_TYPE}/$node_type/g" "${DEPLOYMENT_DIR}/startup-${instance_name}.sh"
    sed -i "s/\${NODE_ID}/$instance_name/g" "${DEPLOYMENT_DIR}/startup-${instance_name}.sh"
    
    # Create instance
    gcloud compute instances create "$instance_name" \
        --zone="$ZONE" \
        --machine-type="$machine_type" \
        --image-family=ubuntu-2204-lts \
        --image-project=ubuntu-os-cloud \
        --boot-disk-size=50GB \
        --boot-disk-type=pd-ssd \
        --metadata-from-file startup-script="${DEPLOYMENT_DIR}/startup-${instance_name}.sh" \
        --tags=noderr-node,http-server,https-server \
        --scopes=cloud-platform
    
    echo "✅ Created $instance_name"
    echo ""
}

# Create firewall rules
echo "Creating firewall rules..."
gcloud compute firewall-rules create noderr-api \
    --allow tcp:3000-3002 \
    --target-tags noderr-node \
    --description "Noderr API ports" \
    --quiet || echo "Firewall rule already exists"

gcloud compute firewall-rules create noderr-metrics \
    --allow tcp:9090-9092 \
    --target-tags noderr-node \
    --description "Noderr metrics ports" \
    --quiet || echo "Firewall rule already exists"

echo ""

# Deploy Oracle nodes
echo "========================================="
echo "Deploying Oracle Nodes"
echo "========================================="
for i in $(seq 1 $ORACLE_COUNT); do
    create_node "oracle" "$i"
done

# Deploy Guardian nodes
echo "========================================="
echo "Deploying Guardian Nodes"
echo "========================================="
for i in $(seq 1 $GUARDIAN_COUNT); do
    create_node "guardian" "$i"
done

# Deploy Validator nodes
echo "========================================="
echo "Deploying Validator Nodes"
echo "========================================="
for i in $(seq 1 $VALIDATOR_COUNT); do
    create_node "validator" "$i"
done

# List all instances
echo "========================================="
echo "DEPLOYMENT SUMMARY"
echo "========================================="
echo ""
echo "Deployed instances:"
gcloud compute instances list --filter="tags.items=noderr-node" --format="table(name,zone,machineType,status,networkInterfaces[0].accessConfigs[0].natIP)"
echo ""

# Save deployment info
cat > "${DEPLOYMENT_DIR}/deployment-info.json" << EOF
{
  "project_id": "$PROJECT_ID",
  "region": "$REGION",
  "zone": "$ZONE",
  "deployed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "oracle_count": $ORACLE_COUNT,
  "guardian_count": $GUARDIAN_COUNT,
  "validator_count": $VALIDATOR_COUNT
}
EOF

echo "Deployment info saved to: ${DEPLOYMENT_DIR}/deployment-info.json"
echo ""

echo "========================================="
echo "✅ DEPLOYMENT COMPLETE"
echo "========================================="
echo ""
echo "Next steps:"
echo "1. Check node status: gcloud compute instances list --filter='tags.items=noderr-node'"
echo "2. SSH to node: gcloud compute ssh noderr-oracle-1 --zone=$ZONE"
echo "3. View logs: gcloud compute ssh noderr-oracle-1 --zone=$ZONE --command='sudo docker logs noderr-node'"
echo ""
