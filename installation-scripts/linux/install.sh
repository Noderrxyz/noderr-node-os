#!/bin/bash
#
# Noderr Node OS - Linux Installation Script
# One-command installation with TPM-based hardware attestation
#
# Usage: curl -fsSL https://install.noderr.xyz/linux | bash -s -- <INSTALL_TOKEN>
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
readonly MIN_DISK_GB=100

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
    log "Validating hardware requirements..."
    
    # Check CPU cores
    local cpu_cores
    cpu_cores=$(nproc)
    if [[ ${cpu_cores} -lt ${MIN_CPU_CORES} ]]; then
        error_exit "Insufficient CPU cores. Required: ${MIN_CPU_CORES}, Found: ${cpu_cores}"
    fi
    log_success "CPU cores: ${cpu_cores} (minimum: ${MIN_CPU_CORES})"
    
    # Check RAM
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
    fi
    log_success "Disk space: ${disk_gb}GB available (minimum: ${MIN_DISK_GB}GB)"
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
            tpm2-tools \
            tpm2-tss \
            jq \
            systemd
    elif command -v yum >/dev/null 2>&1; then
        yum install -y -q \
            curl \
            ca-certificates \
            gnupg \
            tpm2-tools \
            tpm2-tss \
            jq \
            systemd
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
# TPM Key Generation
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

# ============================================================================
# Node Registration
# ============================================================================

get_install_config() {
    local install_token="$1"
    
    log "Fetching installation configuration..."
    
    local response
    response=$(curl -s -X POST "${AUTH_API_URL}/api/v1/install/config" \
        -H "Content-Type: application/json" \
        -d "{\"installToken\": \"${install_token}\"}")
    
    if [[ -z "${response}" ]]; then
        error_exit "Failed to fetch installation configuration"
    fi
    
    # Check for error in response
    if echo "${response}" | jq -e '.error' >/dev/null 2>&1; then
        local error_msg
        error_msg=$(echo "${response}" | jq -r '.message')
        error_exit "API error: ${error_msg}"
    fi
    
    echo "${response}" > "${CONFIG_DIR}/install_config.json"
    log_success "Installation configuration received"
}

register_node() {
    local install_token="$1"
    local no_tpm_flag=${2:-}
    
    log "Registering node with authentication API..."
    
    # Read public key
    local public_key
    public_key=$(cat "${CONFIG_DIR}/public_key.pem" | tr -d '\n')
    
    # Read attestation data
    local quote_b64
    local sig_b64
    quote_b64=$(base64 -w 0 "${CONFIG_DIR}/quote.msg")
    sig_b64=$(base64 -w 0 "${CONFIG_DIR}/quote.sig")
    
    # Parse PCR values
    local pcr_json
    pcr_json=$(tpm2_pcrread sha256:0,7 -o - 2>/dev/null | \
        awk '/sha256:/{getline; print}' | \
        jq -R -s 'split("\n") | map(select(length > 0)) | map(split(":") | {(.[0]): .[1]}) | add')
    
    # Get system info
    local hostname
    local cpu_cores
    local memory_gb
    local disk_gb
    hostname=$(hostname)
    cpu_cores=$(nproc)
    memory_gb=$(free -g | awk '/^Mem:/{print $2}')
    disk_gb=$(df -BG / | awk 'NR==2 {print $4}' | tr -d 'G')
    
    # Create registration request
    local request
    if [[ -z "${no_tpm_flag}" ]]; then
        # Read public key
        local public_key
        public_key=$(cat "${CONFIG_DIR}/public_key.pem" | tr -d ' ')
        
        # Read attestation data
        local quote_b64
        local sig_b64
        quote_b64=$(base64 -w 0 "${CONFIG_DIR}/quote.msg")
        sig_b64=$(base64 -w 0 "${CONFIG_DIR}/quote.sig")
        
        # Parse PCR values
        local pcr_json
        pcr_json=$(tpm2_pcrread sha256:0,7 -o - 2>/dev/null | \
            awk '/sha256:/{getline; print}' | \
            jq -R -s 'split("\n") | map(select(length > 0)) | map(split(":") | {(.[0]): .[1]}) | add')

        request=$(jq -n \
            --arg token "${install_token}" \
            --arg pubkey "${public_key}" \
            --arg quote "${quote_b64}" \
            --arg sig "${sig_b64}" \
            --argjson pcr "${pcr_json}" \
            --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
            --arg hostname "${hostname}" \
            --argjson cpu "${cpu_cores}" \
            --argjson mem "${memory_gb}" \
            --argjson disk "${disk_gb}" \
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
                }
            }')
    else
        request=$(jq -n \
            --arg token "${install_token}" \
            --arg hostname "${hostname}" \
            --argjson cpu "${cpu_cores}" \
            --argjson mem "${memory_gb}" \
            --argjson disk "${disk_gb}" \
            '{
                installToken: $token,
                systemInfo: {
                    hostname: $hostname,
                    cpuCores: $cpu,
                    memoryGB: $mem,
                    diskGB: $disk
                }
            }')
    fi
    request=$(jq -n \
        --arg token "${install_token}" \
        --arg pubkey "${public_key}" \
        --arg quote "${quote_b64}" \
        --arg sig "${sig_b64}" \
        --argjson pcr "${pcr_json}" \
        --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --arg hostname "${hostname}" \
        --argjson cpu "${cpu_cores}" \
        --argjson mem "${memory_gb}" \
        --argjson disk "${disk_gb}" \
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
            }
        }')
    
    # Send registration request
    local response
    response=$(curl -s -X POST "${AUTH_API_URL}/api/v1/auth/register" \
        -H "Content-Type: application/json" \
        -d "${request}")
    
    if [[ -z "${response}" ]]; then
        error_exit "Failed to register node"
    fi
    
    # Check for error
    if echo "${response}" | jq -e '.error' >/dev/null 2>&1; then
        local error_msg
        error_msg=$(echo "${response}" | jq -r '.message')
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
    tier=$(echo "${install_config}" | jq -r '.tier')
    docker_registry=$(echo "${install_config}" | jq -r '.config.dockerRegistry')
    node_id=$(echo "${credentials}" | jq -r '.nodeId')
    api_key=$(echo "${credentials}" | jq -r '.apiKey')
    
    # Determine Docker image based on tier
    local docker_image
    case "${tier}" in

        ORACLE)
            docker_image="${docker_registry}/noderr-node-os:latest-oracle"
            ;;
        GUARDIAN)
            docker_image="${docker_registry}/noderr-node-os:latest-guardian"
            ;;
        VALIDATOR)
            docker_image="${docker_registry}/noderr-node-os:latest-validator"
            ;;
        *)
            error_exit "Unknown tier: ${tier}"
            ;;
    esac
    
    log "Pulling Docker image: ${docker_image}"
    docker pull "${docker_image}" >/dev/null 2>&1
    
    # Create Docker network
    docker network create noderr-network 2>/dev/null || true
    
    # Create environment file
    cat > "${CONFIG_DIR}/node.env" <<EOF
NODE_ID=${node_id}
NODE_TIER=${tier}
API_KEY=${api_key}
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
            docker_image="${docker_registry}/noderr-node-os:latest-oracle"
            ;;
        GUARDIAN)
            docker_image="${docker_registry}/noderr-node-os:latest-guardian"
            ;;
        VALIDATOR)
            docker_image="${docker_registry}/noderr-node-os:latest-validator"
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
        error_exit "Installation token is required. Usage: bash install.sh <INSTALL_TOKEN>"
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
    
    # TPM key generation and attestation
    if [[ -e /dev/tpm0 ]] || [[ -e /dev/tpmrm0 ]]; then
        generate_tpm_key
        create_attestation
    fi
    
    # Node registration
    get_install_config "${install_token}"
        if [[ -e /dev/tpm0 ]] || [[ -e /dev/tpmrm0 ]]; then
        register_node "${install_token}"
    else
        register_node "${install_token}" "--no-tpm"
    fi
    
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
