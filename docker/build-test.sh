#!/bin/bash
set -e

echo "========================================="
echo "Noderr Docker Build Test Script"
echo "========================================="

cd /home/ubuntu/noderr-node-os

echo ""
echo "Building base image..."
docker build -f docker/base/Dockerfile -t noderr-base:test . 2>&1 | tail -20

echo ""
echo "========================================="
echo "Build complete!"
echo "========================================="
echo ""
echo "Image info:"
docker images | grep noderr

echo ""
echo "To test the image:"
echo "  docker run --rm noderr-base:test"
