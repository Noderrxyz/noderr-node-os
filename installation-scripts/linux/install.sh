#!/bin/bash
#
# Noderr Node OS - Linux Installation Script
# One-command installation with TPM-based hardware attestation
#
# Usage: curl -fsSL https://install.noderr.xyz/linux | bash -s -- <INSTALL_TOKEN> [WALLET_ADDRESS]
#


# Bootstrap: ensure curl is available before anything else
if ! command -v curl &>/dev/null; then
    echo "[NODERR] curl not found. Installing curl..."
    if command -v apt-get &>/dev/null; then
        apt-get update -qq && apt-get install -y -qq curl
    elif command -v yum &>/dev/null; then
        yum install -y curl
    elif command -v dnf &>/dev/null; then
        dnf install -y curl
    else
        echo "[ERROR] Please install curl manually and re-run this script."
        exit 1
    fi
fi

set -euo pipefail

# ============================================================================
# Constants and Configuration
# ============================================================================

readonly SCRIPT_VERSION="1.0.0"
readonly MIN_CPU_CORES=4
readonly MIN_RAM_GB=8
readonly MIN_DISK_GB=80

readonly AUTH_API_URL="${AUTH_API_URL:-https://noderrauth-api-production-cca0.up.railway.app}"
readonly INSTALL_DIR="/opt/noderr"
readonly CONFIG_DIR="/etc/noderr"
readonly LOG_FILE="/var/log/noderr-install.log"

# Colors for output
readonly COLOR_RESET='\033[0m'
readonly COLOR_RED='\033[0;31m'
readonly COLOR_GREEN='\033[0;32m'
readonly COLOR_YELLOW='\033[1;33m'
readonly COLOR_BLUE='\033[0;34m'

# ============================================================================
# Logging Functions
# ============================================================================

log() {
    local message="$*"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${COLOR_BLUE}[${timestamp}]${COLOR_RESET} ${message}"
    echo "[${timestamp}] ${message}" >> "${LOG_FILE}" 2>/dev/null || true
}

log_success() {
    local message="$*"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${COLOR_GREEN}[${timestamp}] ✓${COLOR_RESET} ${message}"
    echo "[${timestamp}] SUCCESS: ${message}" >> "${LOG_FILE}" 2>/dev/null || true
}

log_warning() {
    local message="$*"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${COLOR_YELLOW}[${timestamp}] ⚠${COLOR_RESET} ${message}"
    echo "[${timestamp}] WARNING: ${message}" >> "${LOG_FILE}" 2>/dev/null || true
}

log_error() {
    local message="$*"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${COLOR_RED}[${timestamp}] ✗${COLOR_RESET} ${message}" >&2
    echo "[${timestamp}] ERROR: ${message}" >> "${LOG_FILE}" 2>/dev/null || true
}

error_exit() {
    log_error "$*"
    log_error "Installation failed. Check ${LOG_FILE} for details."
    exit 1
}

# ============================================================================
# Validation Functions
# ============================================================================

check_root() {
    if [[ $EUID -ne 0 ]]; then
        error_exit "This script must be run as root. Please use 'sudo bash install.sh <TOKEN>'"
    fi
}

check_os() {
    log "Checking operating system compatibility..."
    
    if [[ ! -f /etc/os-release ]]; then
        error_exit "Cannot detect operating system. /etc/os-release not found."
    fi
    
    source /etc/os-release
    
    case "${ID}" in
        ubuntu)
            if [[ "${VERSION_ID}" < "22.04" ]]; then
                error_exit "Ubuntu 22.04 LTS or newer is required. Found: ${VERSION_ID}"
            fi
            ;;
        debian)
            if [[ "${VERSION_ID}" -lt 11 ]]; then
                error_exit "Debian 11 or newer is required. Found: ${VERSION_ID}"
            fi
            ;;
        rhel|centos|rocky|almalinux)
            if [[ "${VERSION_ID%%.*}" -lt 8 ]]; then
                error_exit "RHEL/CentOS 8 or newer is required. Found: ${VERSION_ID}"
            fi
            ;;
        *)
            log_warning "Unsupported OS: ${ID}. Proceeding anyway..."
            ;;
    esac
    
    log_success "Operating system: ${PRETTY_NAME}"
}

check_internet() {
    log "Checking internet connectivity..."
    
    if ! ping -c 1 -W 5 8.8.8.8 >/dev/null 2>&1; then
        error_exit "No internet connectivity. Please check your network connection."
    fi
    
    log_success "Internet connectivity verified"
}

check_hardware() {
    # Initial basic check (OS-level sanity). Tier-specific checks happen in check_hardware_for_tier()
    log "Validating hardware requirements..."
    
    # Check CPU cores (minimum 4 for any tier)
    local cpu_cores
    cpu_cores=$(nproc)
    if [[ ${cpu_cores} -lt ${MIN_CPU_CORES} ]]; then
        error_exit "Insufficient CPU cores. Required: ${MIN_CPU_CORES}, Found: ${cpu_cores}"
    fi
    log_success "CPU cores: ${cpu_cores} (minimum: ${MIN_CPU_CORES})"
    
    # Check RAM (minimum 8GB for any tier)
    local ram_gb
    ram_gb=$(free -g | awk '/^Mem:/{print $2}')
    if [[ ${ram_gb} -lt ${MIN_RAM_GB} ]]; then
        error_exit "Insufficient RAM. Required: ${MIN_RAM_GB}GB, Found: ${ram_gb}GB"
    fi
    log_success "RAM: ${ram_gb}GB (minimum: ${MIN_RAM_GB}GB)"
    
    # Check disk space
    local disk_gb
    disk_gb=$(df -BG / | awk 'NR==2 {print $4}' | tr -d 'G')
    if [[ ${disk_gb} -lt ${MIN_DISK_GB} ]]; then
        error_exit "Insufficient disk space. Required: ${MIN_DISK_GB}GB, Found: ${disk_gb}GB"
    elif [[ ${disk_gb} -lt 100 ]]; then
        log_warning "Disk space: ${disk_gb}GB available (recommended: 100GB, minimum: ${MIN_DISK_GB}GB). Consider expanding storage."
    else
        log_success "Disk space: ${disk_gb}GB available (minimum: ${MIN_DISK_GB}GB)"
    fi
}

check_hardware_for_tier() {
    # Tier-specific hardware validation using API-provided requirements
    local tier
    tier=$(echo "${install_config}" | jq -r '.tier')
    
    # Use API-provided requirements if available, otherwise fall back to built-in defaults
    local required_cpu required_ram required_disk
    if echo "${install_config}" | jq -e '.hardwareRequirements' >/dev/null 2>&1; then
        required_cpu=$(echo "${install_config}" | jq -r '.hardwareRequirements.minCpuCores')
        required_ram=$(echo "${install_config}" | jq -r '.hardwareRequirements.minRamGb')
        required_disk=$(echo "${install_config}" | jq -r '.hardwareRequirements.minDiskGb')
    else
        # Fallback defaults (should not be needed with updated auth API)
        case "${tier}" in
            ORACLE)
                required_cpu=8
                required_ram=24
                required_disk=200
                ;;
            GUARDIAN)
                required_cpu=16
                required_ram=32
                required_disk=200
                ;;
            VALIDATOR)
                required_cpu=4
                required_ram=8
                required_disk=80
                ;;
            *)
                log_warning "Unknown tier '${tier}' - skipping tier-specific hardware check"
                return 0
                ;;
        esac
    fi
    
    log "Validating hardware requirements for ${tier} tier..."
    
    local cpu_cores ram_gb disk_gb
    cpu_cores=$(nproc)
    ram_gb=$(free -g | awk '/^Mem:/{print $2}')
    disk_gb=$(df -BG / | awk 'NR==2 {print $4}' | tr -d 'G')
    
    local failed=0
    
    if [[ ${cpu_cores} -lt ${required_cpu} ]]; then
        log_error "Insufficient CPU for ${tier} node. Required: ${required_cpu} cores, Found: ${cpu_cores} cores"
        failed=1
    else
        log_success "CPU: ${cpu_cores} cores (${tier} minimum: ${required_cpu})"
    fi
    
    if [[ ${ram_gb} -lt ${required_ram} ]]; then
        log_error "Insufficient RAM for ${tier} node. Required: ${required_ram}GB, Found: ${ram_gb}GB"
        failed=1
    else
        log_success "RAM: ${ram_gb}GB (${tier} minimum: ${required_ram}GB)"
    fi
    
    if [[ ${disk_gb} -lt ${required_disk} ]]; then
        log_error "Insufficient disk for ${tier} node. Required: ${required_disk}GB, Found: ${disk_gb}GB"
        failed=1
    else
        log_success "Disk: ${disk_gb}GB (${tier} minimum: ${required_disk}GB)"
    fi
    
    if [[ ${failed} -eq 1 ]]; then
        error_exit "Hardware requirements not met for ${tier} node. See above for details."
    fi
}

check_tpm() {
    log "Checking for TPM 2.0..."
    
    # Check if TPM device exists
    if [[ ! -e /dev/tpm0 ]] && [[ ! -e /dev/tpmrm0 ]]; then
        log_warning "TPM device not found. Proceeding without TPM-based attestation."; return 0
    fi
    
    # Check TPM version using tpm2_getcap (will be installed if needed)
    if command -v tpm2_getcap >/dev/null 2>&1; then
        local tpm_version
        tpm_version=$(tpm2_getcap properties-fixed | grep TPM2_PT_FAMILY_INDICATOR | awk '{print $2}')
        if [[ "${tpm_version}" != "2.0" ]]; then
            error_exit "TPM 2.0 is required. Found version: ${tpm_version}"
        fi
        log_success "TPM 2.0 detected"
    else
        log_warning "TPM tools not installed yet. Will verify after installation."
    fi
}

# ============================================================================
# Installation Functions
# ============================================================================

install_dependencies() {
    log "Installing system dependencies..."
    
    # Detect package manager
    if command -v apt-get >/dev/null 2>&1; then
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -qq
        apt-get install -y -qq \
            curl \
            ca-certificates \
            gnupg \
            lsb-release \
            jq
        # Install TPM tools only if TPM hardware is present
        if [[ -e /dev/tpm0 ]] || [[ -e /dev/tpmrm0 ]]; then
            log "TPM device detected, installing TPM tools..."
            apt-get install -y -qq tpm2-tools libtss2-dev libtss2-tcti-device0 || \
                log_warning "TPM tools installation failed. TPM attestation will be skipped."
        else
            log_warning "No TPM device found. Skipping TPM tools installation."
        fi
    elif command -v yum >/dev/null 2>&1; then
        yum install -y -q \
            curl \
            ca-certificates \
            gnupg \
            jq
        # Install TPM tools only if TPM hardware is present
        if [[ -e /dev/tpm0 ]] || [[ -e /dev/tpmrm0 ]]; then
            log "TPM device detected, installing TPM tools..."
            yum install -y -q tpm2-tools tpm2-tss || \
                log_warning "TPM tools installation failed. TPM attestation will be skipped."
        else
            log_warning "No TPM device found. Skipping TPM tools installation."
        fi
    else
        error_exit "Unsupported package manager. Please install dependencies manually."
    fi
    
    log_success "System dependencies installed"
}

install_docker() {
    if command -v docker >/dev/null 2>&1; then
        log_success "Docker already installed: $(docker --version)"
        return 0
    fi
    
    log "Installing Docker..."
    
    # Install Docker using official script
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    sh /tmp/get-docker.sh >/dev/null 2>&1
    rm /tmp/get-docker.sh
    
    # Start Docker service
    systemctl enable docker >/dev/null 2>&1
    systemctl start docker
    
    # Verify Docker installation
    if ! docker --version >/dev/null 2>&1; then
        error_exit "Docker installation failed"
    fi
    
    log_success "Docker installed: $(docker --version)"
}

# ============================================================================
# Key Generation (TPM or Software Fallback)
# ============================================================================

generate_tpm_key() {
    log "Generating TPM-based cryptographic key..."
    
    mkdir -p "${CONFIG_DIR}"
    
    # Initialize TPM (if needed)
    tpm2_clear -c p 2>/dev/null || true
    
    # Create primary key
    tpm2_createprimary -C e -g sha256 -G rsa -c "${CONFIG_DIR}/primary.ctx" >/dev/null 2>&1
    
    # Create ECC P-256 key pair
    tpm2_create -C "${CONFIG_DIR}/primary.ctx" \
        -g sha256 \
        -G ecc:ecdsa \
        -u "${CONFIG_DIR}/key.pub" \
        -r "${CONFIG_DIR}/key.priv" \
        >/dev/null 2>&1
    
    # Load key into TPM
    tpm2_load -C "${CONFIG_DIR}/primary.ctx" \
        -u "${CONFIG_DIR}/key.pub" \
        -r "${CONFIG_DIR}/key.priv" \
        -c "${CONFIG_DIR}/key.ctx" \
        >/dev/null 2>&1
    
    # Export public key in PEM format
    tpm2_readpublic -c "${CONFIG_DIR}/key.ctx" \
        -f pem \
        -o "${CONFIG_DIR}/public_key.pem" \
        >/dev/null 2>&1
    
    log_success "TPM key generated successfully"
}

create_attestation() {
    log "Creating TPM attestation..."
    
    # Create a quote (attestation)
    local challenge
    challenge=$(openssl rand -hex 32)
    echo -n "${challenge}" > "${CONFIG_DIR}/challenge.txt"
    
    # Generate quote with PCR values
    tpm2_quote -c "${CONFIG_DIR}/key.ctx" \
        -l sha256:0,7 \
        -q "${challenge}" \
        -m "${CONFIG_DIR}/quote.msg" \
        -s "${CONFIG_DIR}/quote.sig" \
        -o "${CONFIG_DIR}/quote.pcr" \
        >/dev/null 2>&1
    
    # Read PCR values
    tpm2_pcrread sha256:0,7 -o "${CONFIG_DIR}/pcr_values.txt" >/dev/null 2>&1
    
    log_success "TPM attestation created"
}

generate_software_key() {
    log "Generating software cryptographic key (no TPM detected)..."
    
    mkdir -p "${CONFIG_DIR}"
    chmod 700 "${CONFIG_DIR}"
    
    # Generate RSA-2048 private key
    openssl genrsa -out "${CONFIG_DIR}/private_key.pem" 2048 2>/dev/null
    chmod 600 "${CONFIG_DIR}/private_key.pem"
    
    # Extract public key
    openssl rsa -in "${CONFIG_DIR}/private_key.pem" \
        -pubout -out "${CONFIG_DIR}/public_key.pem" 2>/dev/null
    
    log_success "Software key generated successfully"
}

create_software_attestation() {
    log "Creating software attestation (no TPM detected)..."
    
    # Create a random quote message
    local challenge
    challenge=$(openssl rand -hex 32)
    echo -n "${challenge}" > "${CONFIG_DIR}/quote.msg"
    
    # Sign the quote with the software private key
    openssl dgst -sha256 -sign "${CONFIG_DIR}/private_key.pem" \
        -out "${CONFIG_DIR}/quote.sig" \
        "${CONFIG_DIR}/quote.msg" 2>/dev/null
    
    log_success "Software attestation created"
}

# ============================================================================
# Node Registration
# ============================================================================

get_install_config() {
    local install_token="$1"
    
    log "Fetching installation configuration..."
    
    # Ensure config directory exists before writing
    mkdir -p "${CONFIG_DIR}"
    chmod 700 "${CONFIG_DIR}"
    
    local response
    response=$(curl -s -X POST "${AUTH_API_URL}/api/v1/install/config" \
        -H "Content-Type: application/json" \
        -d "{\"installToken\": \"${install_token}\"}")
    
    if [[ -z "${response}" ]]; then
        error_exit "Failed to fetch installation configuration. Check network connectivity."
    fi
    
    # Check for error in response
    if echo "${response}" | jq -e '.error' >/dev/null 2>&1; then
        local error_msg
        error_msg=$(echo "${response}" | jq -r '.message // .error')
        error_exit "API error: ${error_msg}"
    fi
    
    echo "${response}" > "${CONFIG_DIR}/install_config.json"
    log_success "Installation configuration received"
}

register_node() {
    local install_token="$1"
    local wallet_address="${2:-}"
    
    log "Registering node with authentication API..."
    
    # Read install config to get tier
    local install_config
    install_config=$(cat "${CONFIG_DIR}/install_config.json")
    local node_tier
    node_tier=$(echo "${install_config}" | jq -r '.tier' | tr '[:upper:]' '[:lower:]')
    
    # Read public key
    local public_key
    public_key=$(cat "${CONFIG_DIR}/public_key.pem")
    
    # Read attestation data
    local quote_b64
    local sig_b64
    quote_b64=$(base64 -w 0 "${CONFIG_DIR}/quote.msg")
    sig_b64=$(base64 -w 0 "${CONFIG_DIR}/quote.sig")
    
    # Build PCR values - use real TPM values if available, otherwise use zeroed values
    local pcr_json
    if [[ -e /dev/tpm0 ]] || [[ -e /dev/tpmrm0 ]]; then
        pcr_json=$(tpm2_pcrread sha256:0,7 2>/dev/null | \
            grep -E '^\s+[0-9]+:' | \
            awk '{gsub(":",""); printf "{\"" NR-1 "\": \"%s\"}\n", $2}' | \
            jq -s 'add // {}')
    else
        # Software attestation: use deterministic zeroed PCR values
        pcr_json='{"0": "0000000000000000000000000000000000000000000000000000000000000000", "7": "0000000000000000000000000000000000000000000000000000000000000000"}'
    fi
    
    # Get system info
    local node_hostname
    local cpu_cores
    local memory_gb
    local disk_gb
    node_hostname=$(hostname)
    cpu_cores=$(nproc)
    memory_gb=$(free -g | awk '/^Mem:/{print $2}')
    disk_gb=$(df -BG / | awk 'NR==2 {print $4}' | tr -d 'G')
    
    # Build registration request
    local request
    request=$(jq -n \
        --arg token "${install_token}" \
        --arg pubkey "${public_key}" \
        --arg quote "${quote_b64}" \
        --arg sig "${sig_b64}" \
        --argjson pcr "${pcr_json}" \
        --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --arg hostname "${node_hostname}" \
        --argjson cpu "${cpu_cores}" \
        --argjson mem "${memory_gb}" \
        --argjson disk "${disk_gb}" \
        --arg wallet "${wallet_address}" \
        --arg tier "${node_tier}" \
        '{
            installToken: $token,
            publicKey: $pubkey,
            attestation: {
                quote: $quote,
                signature: $sig,
                pcrValues: $pcr,
                timestamp: $timestamp
            },
            systemInfo: {
                hostname: $hostname,
                cpuCores: $cpu,
                memoryGB: $mem,
                diskGB: $disk
            },
            walletAddress: $wallet,
            nodeTier: $tier
        }')
    
    # Send registration request
    local response
    response=$(curl -s -X POST "${AUTH_API_URL}/api/v1/auth/register" \
        -H "Content-Type: application/json" \
        -d "${request}")
    
    if [[ -z "${response}" ]]; then
        error_exit "Failed to register node. Check network connectivity."
    fi
    
    # Check for error
    if echo "${response}" | jq -e '.error' >/dev/null 2>&1; then
        local error_msg
        error_msg=$(echo "${response}" | jq -r '.message // .error')
        error_exit "Registration failed: ${error_msg}"
    fi
    
    # Save credentials
    echo "${response}" > "${CONFIG_DIR}/credentials.json"
    chmod 600 "${CONFIG_DIR}/credentials.json"
    
    local node_id
    node_id=$(echo "${response}" | jq -r '.nodeId')
    log_success "Node registered successfully: ${node_id}"
}

# ============================================================================
# Docker Setup
# ============================================================================

setup_docker_container() {
    log "Setting up Docker container..."
    
    # Read configuration
    local install_config
    local credentials
    install_config=$(cat "${CONFIG_DIR}/install_config.json")
    credentials=$(cat "${CONFIG_DIR}/credentials.json")
    
    local tier
    local docker_registry
    local node_id
    local api_key
    local jwt_token
    tier=$(echo "${install_config}" | jq -r '.tier')
    docker_registry=$(echo "${install_config}" | jq -r '.config.dockerRegistry')
    node_id=$(echo "${credentials}" | jq -r '.nodeId')
    api_key=$(echo "${credentials}" | jq -r '.apiKey')
    jwt_token=$(echo "${credentials}" | jq -r '.jwtToken')
    
    # Determine Docker image based on tier
    # Images are distributed via R2, not GHCR
    readonly R2_PUBLIC_URL="https://pub-66ad852cb9e54582bd0af64bce8d0a04.r2.dev"
    local docker_image_name
    local r2_image_url
    case "${tier}" in
        ORACLE)
            docker_image_name="noderr-oracle:latest"
            r2_image_url="${R2_PUBLIC_URL}/oracle/oracle-latest.tar.gz"
            ;;
        GUARDIAN)
            docker_image_name="noderr-guardian:latest"
            r2_image_url="${R2_PUBLIC_URL}/guardian/guardian-latest.tar.gz"
            ;;
        VALIDATOR)
            docker_image_name="noderr-validator:latest"
            r2_image_url="${R2_PUBLIC_URL}/validator/validator-latest.tar.gz"
            ;;
        *)
            error_exit "Unknown tier: ${tier}"
            ;;
    esac
    
    log "Downloading Docker image from R2: ${r2_image_url}"
    local tmp_image="/tmp/noderr-${tier,,}-image.tar.gz"
    if ! curl -fsSL --progress-bar "${r2_image_url}" -o "${tmp_image}"; then
        error_exit "Failed to download Docker image from R2"
    fi
    log "Loading Docker image..."
    if ! docker load < "${tmp_image}"; then
        error_exit "Failed to load Docker image"
    fi
    rm -f "${tmp_image}"
    local docker_image="${docker_image_name}"
    
    # Create Docker network
    docker network create noderr-network 2>/dev/null || true
    
    # Create environment file for the node container
    # JWT_TOKEN is included so the heartbeat client can authenticate immediately
    # CREDENTIALS_PATH points to the mounted credentials file inside the container
    cat > "${CONFIG_DIR}/node.env" <<EOF
NODE_ID=${node_id}
NODE_TIER=${tier}
API_KEY=${api_key}
JWT_TOKEN=${jwt_token}
CREDENTIALS_PATH=/app/config/credentials.json
DEPLOYMENT_ENGINE_URL=$(echo "${install_config}" | jq -r '.config.deploymentEngineUrl')
AUTH_API_URL=$(echo "${install_config}" | jq -r '.config.authApiUrl')
TELEMETRY_ENDPOINT=$(echo "${install_config}" | jq -r '.config.telemetryEndpoint')
EOF
    chmod 600 "${CONFIG_DIR}/node.env"
    
    log_success "Docker container configured"
}

create_systemd_service() {
    log "Creating systemd service..."
    
    local install_config
    local tier
    local docker_registry
    install_config=$(cat "${CONFIG_DIR}/install_config.json")
    tier=$(echo "${install_config}" | jq -r '.tier')
    docker_registry=$(echo "${install_config}" | jq -r '.config.dockerRegistry')
    
    local docker_image
    case "${tier}" in
        ORACLE)
            docker_image="noderr-oracle:latest"
            ;;
        GUARDIAN)
            docker_image="noderr-guardian:latest"
            ;;
        VALIDATOR)
            docker_image="noderr-validator:latest"
            ;;
        *)
            error_exit "Unknown tier: ${tier}"
            ;;
    esac
    
    cat > /etc/systemd/system/noderr-node.service <<EOF
[Unit]
Description=Noderr Node OS
After=docker.service
Requires=docker.service

[Service]
Type=simple
Restart=always
RestartSec=10
EnvironmentFile=${CONFIG_DIR}/node.env
ExecStartPre=-/usr/bin/docker stop noderr-node
ExecStartPre=-/usr/bin/docker rm noderr-node
ExecStart=/usr/bin/docker run \\
    --name noderr-node \\
    --network noderr-network \\
    --env-file ${CONFIG_DIR}/node.env \\
    --volume ${CONFIG_DIR}/credentials.json:/app/config/credentials.json:ro \\
    --restart unless-stopped \\
    ${docker_image}
ExecStop=/usr/bin/docker stop noderr-node

[Install]
WantedBy=multi-user.target
EOF
    
    systemctl daemon-reload
    log_success "Systemd service created"
}

start_node() {
    log "Starting Noderr Node OS..."
    
    systemctl enable noderr-node >/dev/null 2>&1
    systemctl start noderr-node
    
    # Wait for node to start
    sleep 5
    
    # Check if container is running
    if ! docker ps | grep -q noderr-node; then
        error_exit "Node failed to start. Check logs with: journalctl -u noderr-node -f"
    fi
    
    log_success "Noderr Node OS started successfully"
}

# ============================================================================
# Post-Installation
# ============================================================================

display_summary() {
    local credentials
    local node_id
    credentials=$(cat "${CONFIG_DIR}/credentials.json")
    node_id=$(echo "${credentials}" | jq -r '.nodeId')
    
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║                                                                ║"
    echo "║          Noderr Node OS Installation Complete! ✓              ║"
    echo "║                                                                ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""
    echo "  Node ID: ${node_id}"
    echo ""
    echo "  Status:  Running"
    echo "  Logs:    journalctl -u noderr-node -f"
    echo "  Stop:    systemctl stop noderr-node"
    echo "  Start:   systemctl start noderr-node"
    echo "  Restart: systemctl restart noderr-node"
    echo ""
    echo "  Configuration: ${CONFIG_DIR}/"
    echo "  Credentials:   ${CONFIG_DIR}/credentials.json (keep secure!)"
    echo ""
    echo "  For support: https://docs.noderr.xyz"
    echo ""
}

# ============================================================================
# Main Installation Flow
# ============================================================================

main() {
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║                                                                ║"
    echo "║              Noderr Node OS Installer v${SCRIPT_VERSION}              ║"
    echo "║                                                                ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""
    
    # Get installation token from arguments
    local install_token="${1:-}"
    if [[ -z "${install_token}" ]]; then
        error_exit "Installation token is required. Usage: bash install.sh <INSTALL_TOKEN> [WALLET_ADDRESS]"
    fi
    
    # Get optional wallet address from arguments
    local wallet_address="${2:-}"
    if [[ -z "${wallet_address}" ]]; then
        log_warning "No wallet address provided. Node will be registered without staking verification."
        log_warning "Usage: bash install.sh <INSTALL_TOKEN> <WALLET_ADDRESS>"
        wallet_address="0x0000000000000000000000000000000000000000"
    fi
    
    # Pre-flight checks
    check_root
    check_os
    check_internet
    check_hardware
    
    # Install dependencies
    install_dependencies
    check_tpm
    install_docker
    
    # Key generation and attestation (TPM or software fallback)
    if [[ -e /dev/tpm0 ]] || [[ -e /dev/tpmrm0 ]]; then
        generate_tpm_key
        create_attestation
    else
        log_warning "No TPM detected. Using software-based key generation."
        generate_software_key
        create_software_attestation
    fi
    
    # Node registration
    get_install_config "${install_token}"
    check_hardware_for_tier
    register_node "${install_token}" "${wallet_address}"
    
    # Docker setup
    setup_docker_container
    create_systemd_service
    start_node
    
    # Display summary
    display_summary
    
    log_success "Installation completed successfully!"
}

# Run main function with all arguments
main "$@"
