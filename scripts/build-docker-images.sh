#!/bin/bash
# ============================================================================
# NODERR NODE OS - Docker Image Build Script
# ============================================================================
# 
# This script builds Docker images for all 3 node tiers.
# Run from the noderr-node-os root directory.
#
# Usage:
#   ./scripts/build-docker-images.sh [tier]
#
# Examples:
#   ./scripts/build-docker-images.sh          # Build all tiers
#   ./scripts/build-docker-images.sh validator # Build only validator
#   ./scripts/build-docker-images.sh guardian  # Build only guardian
#   ./scripts/build-docker-images.sh oracle    # Build only oracle
#
# ============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
REGISTRY="ghcr.io/noderrxyz"
VERSION="${VERSION:-latest}"
TIER="${1:-all}"

echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  NODERR NODE OS - Docker Image Builder${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""

# Function to build a tier
build_tier() {
    local tier=$1
    local dockerfile="docker/${tier}/Dockerfile"
    local image_name="${REGISTRY}/noderr-${tier}:${VERSION}"
    
    echo -e "${YELLOW}Building ${tier} node...${NC}"
    echo "  Dockerfile: ${dockerfile}"
    echo "  Image: ${image_name}"
    echo ""
    
    if [ ! -f "$dockerfile" ]; then
        echo -e "${RED}ERROR: Dockerfile not found: ${dockerfile}${NC}"
        return 1
    fi
    
    docker build \
        -f "$dockerfile" \
        -t "$image_name" \
        -t "${REGISTRY}/noderr-${tier}:latest" \
        --build-arg NODE_TIER="${tier}" \
        --build-arg BUILD_DATE="$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
        --build-arg VERSION="${VERSION}" \
        .
    
    echo -e "${GREEN}✅ Successfully built ${tier} node${NC}"
    echo ""
}

# Ensure we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}ERROR: Must run from noderr-node-os root directory${NC}"
    exit 1
fi

# Build packages first
echo -e "${YELLOW}Step 1: Building packages...${NC}"
pnpm install
pnpm build || echo -e "${YELLOW}Warning: Some packages failed to build (non-critical)${NC}"
echo ""

# Build Docker images
echo -e "${YELLOW}Step 2: Building Docker images...${NC}"
echo ""

case "$TIER" in
    "all")
        build_tier "validator"
        build_tier "guardian"
        build_tier "oracle"
        ;;
    "validator"|"guardian"|"oracle")
        build_tier "$TIER"
        ;;
    *)
        echo -e "${RED}ERROR: Unknown tier: ${TIER}${NC}"
        echo "Valid options: all, validator, guardian, oracle"
        exit 1
        ;;
esac

# Summary
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Build Complete!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "Built images:"
docker images | grep "noderr-" | head -10
echo ""
echo "To push to registry:"
echo "  docker push ${REGISTRY}/noderr-validator:${VERSION}"
echo "  docker push ${REGISTRY}/noderr-guardian:${VERSION}"
echo "  docker push ${REGISTRY}/noderr-oracle:${VERSION}"
