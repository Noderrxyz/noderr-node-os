#!/bin/bash
set -e

# Noderr Node OS - Docker Build Script
# Builds tier-specific Docker images with proper tagging

VERSION=${1:-"0.1.0"}
REGISTRY=${DOCKER_REGISTRY:-"ghcr.io/noderrxyz"}

echo "========================================="
echo "Building Noderr Node OS Docker Images"
echo "========================================="
echo "Version: $VERSION"
echo "Registry: $REGISTRY"
echo "========================================="

# Build ALL tier image
echo ""
echo "Building ALL tier image..."
docker build \
  -f docker/all/Dockerfile \
  -t ${REGISTRY}/noderr-node-os:${VERSION}-all \
  -t ${REGISTRY}/noderr-node-os:latest-all \
  --build-arg VERSION=${VERSION} \
  .

echo "✅ ALL tier image built successfully"

# Build ORACLE tier image
echo ""
echo "Building ORACLE tier image..."
docker build \
  -f docker/oracle/Dockerfile \
  -t ${REGISTRY}/noderr-node-os:${VERSION}-oracle \
  -t ${REGISTRY}/noderr-node-os:latest-oracle \
  --build-arg VERSION=${VERSION} \
  .

echo "✅ ORACLE tier image built successfully"

# Build GUARDIAN tier image
echo ""
echo "Building GUARDIAN tier image..."
docker build \
  -f docker/guardian/Dockerfile \
  -t ${REGISTRY}/noderr-node-os:${VERSION}-guardian \
  -t ${REGISTRY}/noderr-node-os:latest-guardian \
  --build-arg VERSION=${VERSION} \
  .

echo "✅ GUARDIAN tier image built successfully"

# Build VALIDATOR tier image
echo ""
echo "Building VALIDATOR tier image..."
docker build \
  -f docker/validator/Dockerfile \
  -t ${REGISTRY}/noderr-node-os:${VERSION}-validator \
  -t ${REGISTRY}/noderr-node-os:latest-validator \
  --build-arg VERSION=${VERSION} \
  .

echo ""
echo "========================================="
echo "All images built successfully!"
echo "========================================="
echo ""
echo "Images:"
echo "  - ${REGISTRY}/noderr-node-os:${VERSION}-all"
echo "  - ${REGISTRY}/noderr-node-os:${VERSION}-oracle"
echo "  - ${REGISTRY}/noderr-node-os:${VERSION}-guardian"
echo "  - ${REGISTRY}/noderr-node-os:${VERSION}-validator"
echo ""
echo "To push images:"
echo "  docker push ${REGISTRY}/noderr-node-os:${VERSION}-all"
echo "  docker push ${REGISTRY}/noderr-node-os:${VERSION}-oracle"
echo "  docker push ${REGISTRY}/noderr-node-os:${VERSION}-guardian"
echo "  docker push ${REGISTRY}/noderr-node-os:${VERSION}-validator"
echo "========================================="
