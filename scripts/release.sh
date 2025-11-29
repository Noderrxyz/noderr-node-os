#!/bin/bash
# Noderr Node OS - Automated Release Script
# Builds Docker images, exports tarballs, and uploads to R2

set -e  # Exit on error
set -u  # Exit on undefined variable
set -o pipefail  # Exit on pipe failure

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
VERSION="${1:-}"
REGISTRY="${DOCKER_REGISTRY:-ghcr.io/noderrxyz}"
BUILD_DIR="./build"
TIERS=("base" "oracle" "guardian" "all")

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}$1${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
}

print_usage() {
    cat << EOF
Noderr Node OS - Automated Release Script

Builds Docker images for all tiers, exports as tarballs, and uploads to R2.

Usage:
  ./scripts/release.sh <version>

Arguments:
  version    Release version (e.g., 0.2.0)

Environment Variables:
  DOCKER_REGISTRY       Docker registry (default: ghcr.io/noderrxyz)
  R2_ACCOUNT_ID         Cloudflare R2 account ID
  R2_ACCESS_KEY_ID      R2 access key ID
  R2_SECRET_ACCESS_KEY  R2 secret access key
  R2_BUCKET_NAME        R2 bucket name
  R2_PUBLIC_URL         Public URL for R2 bucket

Examples:
  # Release version 0.2.0
  ./scripts/release.sh 0.2.0
  
  # Release with custom registry
  DOCKER_REGISTRY=myregistry.com ./scripts/release.sh 0.2.0

EOF
}

validate_version() {
    if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        log_error "Invalid version format: $VERSION"
        log_info "Version must be in format X.Y.Z (e.g., 0.2.0)"
        exit 1
    fi
}

check_dependencies() {
    log_info "Checking dependencies..."
    
    local missing=()
    
    command -v docker >/dev/null 2>&1 || missing+=("docker")
    command -v node >/dev/null 2>&1 || missing+=("node")
    command -v pnpm >/dev/null 2>&1 || missing+=("pnpm")
    
    if [ ${#missing[@]} -ne 0 ]; then
        log_error "Missing required dependencies: ${missing[*]}"
        exit 1
    fi
    
    log_success "All dependencies present"
}

create_build_dir() {
    log_info "Creating build directory..."
    mkdir -p "$BUILD_DIR"
    log_success "Build directory ready: $BUILD_DIR"
}

build_docker_images() {
    print_header "Building Docker Images"
    
    log_info "Building all tier images with version $VERSION..."
    
    # Run Docker build script
    bash docker/build.sh "$VERSION"
    
    log_success "All Docker images built successfully"
}

export_docker_images() {
    print_header "Exporting Docker Images"
    
    for tier in "${TIERS[@]}"; do
        local image_name="${REGISTRY}/noderr-node-os:${VERSION}-${tier}"
        local tarball_name="noderr-${tier}-${VERSION}.tar"
        local tarball_path="${BUILD_DIR}/${tarball_name}"
        
        log_info "Exporting $tier tier image..."
        docker save "$image_name" -o "$tarball_path"
        
        # Calculate size
        local size=$(du -h "$tarball_path" | cut -f1)
        log_success "Exported $tier tier: $tarball_path ($size)"
    done
    
    echo ""
    log_success "All images exported to $BUILD_DIR"
}

upload_to_r2() {
    print_header "Uploading to Cloudflare R2"
    
    # Check environment variables
    if [ -z "${R2_ACCOUNT_ID:-}" ] || [ -z "${R2_ACCESS_KEY_ID:-}" ] || [ -z "${R2_SECRET_ACCESS_KEY:-}" ]; then
        log_warn "R2 credentials not set, skipping upload"
        log_info "To enable R2 upload, set: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY"
        return 0
    fi
    
    log_info "Installing deployment-engine dependencies..."
    cd deployment-engine
    npm install --silent
    cd ..
    
    for tier in "${TIERS[@]}"; do
        local tarball_name="noderr-${tier}-${VERSION}.tar"
        local tarball_path="${BUILD_DIR}/${tarball_name}"
        
        log_info "Uploading $tier tier to R2..."
        
        cd deployment-engine
        npm run upload-release -- \
            --version "$VERSION" \
            --tier "$tier" \
            --file "../${tarball_path}"
        cd ..
        
        log_success "Uploaded $tier tier to R2"
    done
    
    echo ""
    log_success "All images uploaded to R2"
}

generate_release_notes() {
    print_header "Generating Release Notes"
    
    local notes_file="${BUILD_DIR}/RELEASE_NOTES_${VERSION}.md"
    
    cat > "$notes_file" << EOF
# Noderr Node OS Release ${VERSION}

**Release Date:** $(date -u +"%Y-%m-%d %H:%M:%S UTC")
**Git Commit:** $(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

## Docker Images

| Tier | Image | Size |
|------|-------|------|
EOF
    
    for tier in "${TIERS[@]}"; do
        local image_name="${REGISTRY}/noderr-node-os:${VERSION}-${tier}"
        local tarball_path="${BUILD_DIR}/noderr-${tier}-${VERSION}.tar"
        local size=$(du -h "$tarball_path" | cut -f1)
        
        echo "| ${tier} | \`${image_name}\` | ${size} |" >> "$notes_file"
    done
    
    cat >> "$notes_file" << EOF

## Download URLs

EOF
    
    if [ -n "${R2_PUBLIC_URL:-}" ]; then
        for tier in "${TIERS[@]}"; do
            echo "- **${tier}**: ${R2_PUBLIC_URL}/releases/${VERSION}/${tier}/noderr-${tier}-${VERSION}.tar" >> "$notes_file"
        done
    else
        echo "*R2 upload not configured - download URLs not available*" >> "$notes_file"
    fi
    
    cat >> "$notes_file" << EOF

## Checksums (SHA-256)

\`\`\`
EOF
    
    for tier in "${TIERS[@]}"; do
        local tarball_path="${BUILD_DIR}/noderr-${tier}-${VERSION}.tar"
        local checksum=$(sha256sum "$tarball_path" | cut -d' ' -f1)
        echo "${checksum}  noderr-${tier}-${VERSION}.tar" >> "$notes_file"
    done
    
    echo "\`\`\`" >> "$notes_file"
    
    cat >> "$notes_file" << EOF

## Installation

### Pull from Docker Registry

\`\`\`bash
docker pull ${REGISTRY}/noderr-node-os:${VERSION}-oracle
docker pull ${REGISTRY}/noderr-node-os:${VERSION}-guardian
\`\`\`

### Load from Tarball

\`\`\`bash
# Download tarball
wget ${R2_PUBLIC_URL:-https://releases.noderr.xyz}/releases/${VERSION}/oracle/noderr-oracle-${VERSION}.tar

# Load into Docker
docker load -i noderr-oracle-${VERSION}.tar

# Run node
docker run -d --name noderr-oracle ${REGISTRY}/noderr-node-os:${VERSION}-oracle
\`\`\`

## Upgrade Instructions

1. **Backup current configuration**
   \`\`\`bash
   docker exec noderr-oracle cat /app/config.json > config-backup.json
   \`\`\`

2. **Stop current node**
   \`\`\`bash
   docker stop noderr-oracle
   docker rm noderr-oracle
   \`\`\`

3. **Pull new version**
   \`\`\`bash
   docker pull ${REGISTRY}/noderr-node-os:${VERSION}-oracle
   \`\`\`

4. **Start new node**
   \`\`\`bash
   docker run -d --name noderr-oracle \\
     -v \$(pwd)/config-backup.json:/app/config.json \\
     ${REGISTRY}/noderr-node-os:${VERSION}-oracle
   \`\`\`

5. **Verify health**
   \`\`\`bash
   docker logs noderr-oracle
   docker exec noderr-oracle node -e "require('./packages/telemetry/dist/health-check.js')"
   \`\`\`

## What's New

*TODO: Add release notes here*

## Breaking Changes

*TODO: Document any breaking changes*

## Known Issues

*TODO: Document any known issues*

---

For support, visit: https://docs.noderr.xyz
EOF
    
    log_success "Release notes generated: $notes_file"
    
    # Print release notes
    echo ""
    cat "$notes_file"
}

cleanup() {
    log_info "Cleaning up..."
    # Optional: Remove tarballs to save space
    # rm -rf "$BUILD_DIR"
    log_success "Cleanup complete"
}

main() {
    print_header "Noderr Node OS - Automated Release"
    
    # Validate arguments
    if [ -z "$VERSION" ]; then
        log_error "Version argument required"
        echo ""
        print_usage
        exit 1
    fi
    
    validate_version
    
    log_info "Release Version: $VERSION"
    log_info "Docker Registry: $REGISTRY"
    log_info "Build Directory: $BUILD_DIR"
    echo ""
    
    # Execute release steps
    check_dependencies
    create_build_dir
    build_docker_images
    export_docker_images
    upload_to_r2
    generate_release_notes
    
    print_header "Release Complete!"
    
    log_success "Version $VERSION has been built and released"
    log_info "Next steps:"
    echo "  1. Review release notes in ${BUILD_DIR}/RELEASE_NOTES_${VERSION}.md"
    echo "  2. Update VersionBeacon contract with new version"
    echo "  3. Test deployment on canary nodes"
    echo "  4. Monitor health metrics before rolling out to cohorts"
    echo ""
}

# Handle Ctrl+C gracefully
trap cleanup EXIT

# Run main function
main
