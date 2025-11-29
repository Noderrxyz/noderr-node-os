#!/bin/bash
set -e

echo "========================================="
echo "Noderr Node OS - Complete Docker Build"
echo "========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Build directory
BUILD_DIR="/home/ubuntu/noderr-node-os"
cd "$BUILD_DIR"

# Version
VERSION="${VERSION:-1.0.0}"
echo "Building version: $VERSION"
echo ""

# Function to build image
build_image() {
    local name=$1
    local dockerfile=$2
    local tag="noderr-${name}:${VERSION}"
    
    echo -e "${YELLOW}Building ${name} image...${NC}"
    echo "Dockerfile: $dockerfile"
    echo "Tag: $tag"
    echo ""
    
    if sudo docker build -f "$dockerfile" -t "$tag" . ; then
        echo -e "${GREEN}✅ Successfully built ${name} image${NC}"
        
        # Also tag as latest
        sudo docker tag "$tag" "noderr-${name}:latest"
        echo -e "${GREEN}✅ Tagged as noderr-${name}:latest${NC}"
        echo ""
        return 0
    else
        echo -e "${RED}❌ Failed to build ${name} image${NC}"
        echo ""
        return 1
    fi
}

# Track build results
BUILDS_SUCCEEDED=0
BUILDS_FAILED=0

# Build base image
echo "========================================="
echo "1/4 Building Base Image"
echo "========================================="
if build_image "base" "docker/base/Dockerfile"; then
    ((BUILDS_SUCCEEDED++))
else
    ((BUILDS_FAILED++))
fi

# Build oracle image
echo "========================================="
echo "2/4 Building Oracle Image"
echo "========================================="
if build_image "oracle" "docker/oracle/Dockerfile"; then
    ((BUILDS_SUCCEEDED++))
else
    ((BUILDS_FAILED++))
fi

# Build guardian image
echo "========================================="
echo "3/4 Building Guardian Image"
echo "========================================="
if build_image "guardian" "docker/guardian/Dockerfile"; then
    ((BUILDS_SUCCEEDED++))
else
    ((BUILDS_FAILED++))
fi

# Build all-in-one image
echo "========================================="
echo "4/4 Building All-in-One Image"
echo "========================================="
if build_image "all" "docker/all/Dockerfile"; then
    ((BUILDS_SUCCEEDED++))
else
    ((BUILDS_FAILED++))
fi

# Summary
echo ""
echo "========================================="
echo "BUILD SUMMARY"
echo "========================================="
echo -e "Succeeded: ${GREEN}${BUILDS_SUCCEEDED}/4${NC}"
echo -e "Failed:    ${RED}${BUILDS_FAILED}/4${NC}"
echo ""

# List built images
echo "Built images:"
sudo docker images | grep noderr | grep -E "(${VERSION}|latest)"
echo ""

# Save build info
cat > docker/build-info.json << EOF
{
  "version": "${VERSION}",
  "build_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "builds_succeeded": ${BUILDS_SUCCEEDED},
  "builds_failed": ${BUILDS_FAILED},
  "images": [
    "noderr-base:${VERSION}",
    "noderr-oracle:${VERSION}",
    "noderr-guardian:${VERSION}",
    "noderr-all:${VERSION}"
  ]
}
EOF

echo "Build info saved to docker/build-info.json"
echo ""

# Export images if successful
if [ $BUILDS_FAILED -eq 0 ]; then
    echo "========================================="
    echo "EXPORTING IMAGES"
    echo "========================================="
    
    mkdir -p docker/exports
    
    echo "Exporting oracle image..."
    sudo docker save noderr-oracle:${VERSION} | gzip > docker/exports/oracle-${VERSION}.tar.gz
    echo -e "${GREEN}✅ Exported oracle-${VERSION}.tar.gz${NC}"
    
    echo "Exporting guardian image..."
    sudo docker save noderr-guardian:${VERSION} | gzip > docker/exports/guardian-${VERSION}.tar.gz
    echo -e "${GREEN}✅ Exported guardian-${VERSION}.tar.gz${NC}"
    
    echo "Exporting all-in-one image..."
    sudo docker save noderr-all:${VERSION} | gzip > docker/exports/all-${VERSION}.tar.gz
    echo -e "${GREEN}✅ Exported all-${VERSION}.tar.gz${NC}"
    
    echo ""
    echo "Exported images:"
    ls -lh docker/exports/*.tar.gz
    echo ""
fi

# Final status
if [ $BUILDS_FAILED -eq 0 ]; then
    echo -e "${GREEN}=========================================${NC}"
    echo -e "${GREEN}✅ ALL BUILDS SUCCESSFUL${NC}"
    echo -e "${GREEN}=========================================${NC}"
    exit 0
else
    echo -e "${RED}=========================================${NC}"
    echo -e "${RED}❌ SOME BUILDS FAILED${NC}"
    echo -e "${RED}=========================================${NC}"
    exit 1
fi
