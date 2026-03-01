#!/usr/bin/env bash
# ============================================================================
# Noderr Node OS — Optional Monitoring Stack Deployment
#
# Deploys Prometheus, Grafana, Loki, Promtail, cAdvisor, and Alertmanager
# alongside the running Noderr node for advanced operators.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Noderrxyz/noderr-node-os/master/monitoring/deploy-monitoring.sh | sudo bash
#
# Requirements:
#   - Docker and Docker Compose installed (already present from node install)
#   - At least 2 GB free RAM and 10 GB free disk
#   - Noderr node already running
# ============================================================================

set -euo pipefail

MONITORING_DIR="/opt/noderr/monitoring"
REPO_URL="https://raw.githubusercontent.com/Noderrxyz/noderr-node-os/master/monitoring"

log()   { echo -e "\033[0;36m[MONITORING]\033[0m $1"; }
ok()    { echo -e "\033[0;32m[✓]\033[0m $1"; }
warn()  { echo -e "\033[0;33m[!]\033[0m $1"; }
fail()  { echo -e "\033[0;31m[✗]\033[0m $1"; exit 1; }

# ── Pre-flight checks ──────────────────────────────────────────────────────

if [ "$(id -u)" -ne 0 ]; then
    fail "This script must be run as root (sudo)."
fi

if ! command -v docker &>/dev/null; then
    fail "Docker is not installed. Install the Noderr node first."
fi

if ! docker compose version &>/dev/null && ! docker-compose version &>/dev/null; then
    fail "Docker Compose is not available."
fi

# Check available memory (need at least 2 GB free)
free_mem_mb=$(free -m | awk '/^Mem:/{print $7}')
if [ "${free_mem_mb}" -lt 1500 ]; then
    warn "Low available memory (${free_mem_mb} MB). Monitoring stack needs ~2 GB. Proceeding anyway..."
fi

# ── Download monitoring configuration ──────────────────────────────────────

log "Creating monitoring directory at ${MONITORING_DIR}..."
mkdir -p "${MONITORING_DIR}/config/grafana/provisioning/dashboards"
mkdir -p "${MONITORING_DIR}/config/grafana/provisioning/datasources"
mkdir -p "${MONITORING_DIR}/alerts"
mkdir -p "${MONITORING_DIR}/dashboards"

log "Downloading monitoring configuration..."

# Core compose file
curl -fsSL "${REPO_URL}/docker-compose.yml" -o "${MONITORING_DIR}/docker-compose.yml"

# Configuration files
curl -fsSL "${REPO_URL}/config/prometheus.yml" -o "${MONITORING_DIR}/config/prometheus.yml"
curl -fsSL "${REPO_URL}/config/loki-config.yml" -o "${MONITORING_DIR}/config/loki-config.yml"
curl -fsSL "${REPO_URL}/config/promtail-config.yml" -o "${MONITORING_DIR}/config/promtail-config.yml"
curl -fsSL "${REPO_URL}/config/alertmanager.yml" -o "${MONITORING_DIR}/config/alertmanager.yml"
curl -fsSL "${REPO_URL}/config/grafana/provisioning/dashboards/dashboards.yml" -o "${MONITORING_DIR}/config/grafana/provisioning/dashboards/dashboards.yml"
curl -fsSL "${REPO_URL}/config/grafana/provisioning/datasources/datasources.yml" -o "${MONITORING_DIR}/config/grafana/provisioning/datasources/datasources.yml"

# Alerts
curl -fsSL "${REPO_URL}/alerts/node-alerts.yml" -o "${MONITORING_DIR}/alerts/node-alerts.yml" 2>/dev/null || true
curl -fsSL "${REPO_URL}/alerts/noderr-alerts.yml" -o "${MONITORING_DIR}/alerts/noderr-alerts.yml" 2>/dev/null || true
curl -fsSL "${REPO_URL}/alerts/resilience-alerts.yml" -o "${MONITORING_DIR}/alerts/resilience-alerts.yml" 2>/dev/null || true

# Dashboards
curl -fsSL "${REPO_URL}/dashboards/node-operations.json" -o "${MONITORING_DIR}/dashboards/node-operations.json" 2>/dev/null || true

ok "Configuration downloaded"

# ── Generate secure Grafana password ───────────────────────────────────────

GRAFANA_PASSWORD=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 16)

cat > "${MONITORING_DIR}/.env" <<EOF
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=${GRAFANA_PASSWORD}
EOF

chmod 600 "${MONITORING_DIR}/.env"

# ── Fix volume mount typo in compose if present ────────────────────────────

# The original compose has a space in "/:/ host:ro,rslave" — fix it
sed -i 's|/:/ host:ro,rslave|/:/host:ro,rslave|g' "${MONITORING_DIR}/docker-compose.yml"

# ── Connect to Noderr node network ─────────────────────────────────────────

# If the Noderr node is running, connect the monitoring network to it
if docker network ls | grep -q noderr-monitoring; then
    log "Monitoring network already exists"
else
    log "Monitoring network will be created by docker compose"
fi

# ── Start the monitoring stack ─────────────────────────────────────────────

log "Starting monitoring stack..."
cd "${MONITORING_DIR}"

if docker compose version &>/dev/null; then
    docker compose up -d
else
    docker-compose up -d
fi

ok "Monitoring stack started"

# ── Display access information ─────────────────────────────────────────────

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║          Noderr Monitoring Stack Deployed! ✓                  ║"
echo "╠════════════════════════════════════════════════════════════════╣"
echo "║                                                                ║"
echo "║  Grafana:      http://localhost:3000                          ║"
echo "║  Prometheus:   http://localhost:9090                          ║"
echo "║  Alertmanager: http://localhost:9093                          ║"
echo "║  Loki:         http://localhost:3100                          ║"
echo "║                                                                ║"
echo "║  Grafana Login:                                               ║"
echo "║    Username: admin                                            ║"
echo "║    Password: ${GRAFANA_PASSWORD}                              ║"
echo "║                                                                ║"
echo "║  Credentials saved to: ${MONITORING_DIR}/.env                 ║"
echo "║                                                                ║"
echo "║  To stop:  cd ${MONITORING_DIR} && docker compose down        ║"
echo "║  To logs:  cd ${MONITORING_DIR} && docker compose logs -f     ║"
echo "║                                                                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
