#!/bin/bash
#
# Noderr Validator Node - Update Script
# Run this inside the Validator LXC container as root.
#
# Usage (from inside the container):
#   bash /tmp/update_validator.sh
#
# Usage (from the Proxmox host shell — replace CT_ID with your Validator CT ID):
#   pct exec <CT_ID> -- bash -s < /tmp/update_validator.sh
#
# To find your Validator CT ID on Proxmox:
#   pct list | grep -i validator
#
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
readonly R2_PUBLIC_URL="https://pub-66ad852cb9e54582bd0af64bce8d0a04.r2.dev"
readonly IMAGE_URL="${R2_PUBLIC_URL}/validator/validator-latest.tar.gz"
readonly TMP_IMAGE="/tmp/noderr-validator-latest.tar.gz"
readonly CONTAINER_NAME="noderr-node"
readonly CONFIG_DIR="/etc/noderr"
readonly LOG_FILE="/var/log/noderr-update.log"

# ── Colours ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; RESET='\033[0m'
log()     { echo -e "${GREEN}[$(date '+%H:%M:%S')] ✓ $*${RESET}" | tee -a "$LOG_FILE"; }
warn()    { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠ $*${RESET}" | tee -a "$LOG_FILE"; }
die()     { echo -e "${RED}[$(date '+%H:%M:%S')] ✗ $*${RESET}" | tee -a "$LOG_FILE"; exit 1; }

echo "=========================================================="
echo "  Noderr Validator Node - Image Update"
echo "  $(date)"
echo "=========================================================="

# ── Pre-flight checks ─────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && die "Must be run as root"
command -v docker >/dev/null 2>&1 || die "Docker not found"
command -v curl   >/dev/null 2>&1 || die "curl not found"

log "Pre-flight checks passed"

# ── Show current container state ──────────────────────────────────────────────
log "Current container state:"
docker ps -a --filter "name=${CONTAINER_NAME}" --format "  ID: {{.ID}}  Status: {{.Status}}  Image: {{.Image}}" 2>/dev/null || true

# ── Download new image from R2 ────────────────────────────────────────────────
log "Downloading new validator image from R2..."
log "  URL: ${IMAGE_URL}"

rm -f "${TMP_IMAGE}"
if ! curl -fsSL --progress-bar "${IMAGE_URL}" -o "${TMP_IMAGE}"; then
    die "Failed to download image from R2. Check network connectivity."
fi

FILESIZE=$(du -sh "${TMP_IMAGE}" | cut -f1)
log "Downloaded ${FILESIZE} → ${TMP_IMAGE}"

# ── Verify checksum (optional but recommended) ────────────────────────────────
log "Verifying SHA256 checksum..."
CHECKSUM_URL="${R2_PUBLIC_URL}/validator/validator-latest.tar.gz.sha256"
if curl -fsSL "${CHECKSUM_URL}" -o /tmp/validator-latest.tar.gz.sha256 2>/dev/null; then
    # R2 checksum file format: "<hash>  <filename>"
    EXPECTED_HASH=$(awk '{print $1}' /tmp/validator-latest.tar.gz.sha256)
    ACTUAL_HASH=$(sha256sum "${TMP_IMAGE}" | awk '{print $1}')
    if [[ "${EXPECTED_HASH}" == "${ACTUAL_HASH}" ]]; then
        log "Checksum verified: ${ACTUAL_HASH:0:16}..."
    else
        warn "Checksum mismatch! Expected: ${EXPECTED_HASH:0:16}... Got: ${ACTUAL_HASH:0:16}..."
        warn "Proceeding anyway (image may still be valid)"
    fi
else
    warn "Could not fetch checksum file — skipping verification"
fi

# ── Load image into Docker ────────────────────────────────────────────────────
log "Loading image into Docker..."
docker load < "${TMP_IMAGE}" | tee -a "$LOG_FILE"
log "Image loaded successfully"

# ── Verify the image is now available ────────────────────────────────────────
docker images noderr-validator:latest --format "  Repository: {{.Repository}}  Tag: {{.Tag}}  Size: {{.Size}}  Created: {{.CreatedAt}}" | tee -a "$LOG_FILE"

# ── Stop and remove the old container ────────────────────────────────────────
log "Stopping existing container (${CONTAINER_NAME})..."
docker stop "${CONTAINER_NAME}" 2>/dev/null && log "Container stopped" || warn "Container was not running"
docker rm   "${CONTAINER_NAME}" 2>/dev/null && log "Container removed" || warn "Container did not exist"

# ── Restart via systemd (preserves all env vars and volume mounts) ────────────
if systemctl is-enabled noderr-node >/dev/null 2>&1; then
    log "Restarting via systemd service (noderr-node)..."
    systemctl start noderr-node
    sleep 8

    if systemctl is-active noderr-node >/dev/null 2>&1; then
        log "systemd service is active"
    else
        warn "systemd service did not come up cleanly — checking docker directly..."
    fi
else
    # Fallback: start manually using the saved env file
    warn "systemd service not found — starting container manually"

    if [[ ! -f "${CONFIG_DIR}/node.env" ]]; then
        die "No env file at ${CONFIG_DIR}/node.env — cannot start container"
    fi

    docker run -d \
        --name "${CONTAINER_NAME}" \
        --network noderr-network \
        --env-file "${CONFIG_DIR}/node.env" \
        --volume "${CONFIG_DIR}/credentials.json:/app/config/credentials.json:rw" \
        --restart unless-stopped \
        noderr-validator:latest

    sleep 8
fi

# ── Health check ──────────────────────────────────────────────────────────────
log "Checking container health..."
RUNNING=$(docker ps --filter "name=${CONTAINER_NAME}" --filter "status=running" --format "{{.Names}}" 2>/dev/null)

if [[ -n "$RUNNING" ]]; then
    log "Container is running ✓"
    docker ps --filter "name=${CONTAINER_NAME}" --format "  ID: {{.ID}}  Status: {{.Status}}  Image: {{.Image}}"
else
    warn "Container is NOT running. Showing last 50 log lines:"
    docker logs --tail 50 "${CONTAINER_NAME}" 2>&1 | tee -a "$LOG_FILE" || true
    die "Container failed to start. Review logs above."
fi

# ── Show PM2 service status inside container ──────────────────────────────────
log "Checking PM2 services inside container (waiting 15s for startup)..."
sleep 15
docker exec "${CONTAINER_NAME}" pm2 list 2>/dev/null | tee -a "$LOG_FILE" || warn "Could not query PM2 (container may still be initialising)"

# ── Tail logs for 10 seconds ──────────────────────────────────────────────────
log "Tailing container logs for 10 seconds..."
timeout 10 docker logs -f "${CONTAINER_NAME}" 2>&1 | tee -a "$LOG_FILE" || true

# ── Cleanup ───────────────────────────────────────────────────────────────────
rm -f "${TMP_IMAGE}" /tmp/validator-latest.tar.gz.sha256
log "Temporary files cleaned up"

echo ""
echo "=========================================================="
echo "  Update complete. Full log: ${LOG_FILE}"
echo "  To follow live logs:  docker logs -f ${CONTAINER_NAME}"
echo "  To check PM2 status:  docker exec ${CONTAINER_NAME} pm2 list"
echo "=========================================================="
