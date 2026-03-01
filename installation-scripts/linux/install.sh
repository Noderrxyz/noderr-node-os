#!/bin/bash
#
# Noderr Node OS - Linux Installation Script
# One-command installation with TPM-based hardware attestation
#
# Usage: curl -fsSL https://install.noderr.xyz/linux | bash -s -- <INSTALL_TOKEN>
#
# The operator's wallet address and RPC endpoint are stored with the install token
# (collected via Typeform) and retrieved automatically from the auth API.
# A hot wallet (node operational key) is auto-generated during installation.
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
    local install_config
    install_config=$(cat "${CONFIG_DIR}/install_config.json")
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
    
    log "Registering node with authentication API..."
    
    # Read install config to get tier and operator wallet address
    local install_config
    install_config=$(cat "${CONFIG_DIR}/install_config.json")
    local node_tier
    node_tier=$(echo "${install_config}" | jq -r '.tier' | tr '[:upper:]' '[:lower:]')
    
    # Operator's wallet address flows from Typeform → install_tokens → install config
    local wallet_address
    wallet_address=$(echo "${install_config}" | jq -r '.walletAddress // "0x0000000000000000000000000000000000000000"')
    
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

    # Detect GPU hardware ID for Oracle tier
    local gpu_hardware_id=""
    if [[ "${node_tier}" == "ORACLE" ]]; then
        if command -v nvidia-smi &>/dev/null; then
            gpu_hardware_id=$(nvidia-smi --query-gpu=gpu_uuid --format=csv,noheader 2>/dev/null | head -1 | tr -d '[:space:]')
            if [[ -n "${gpu_hardware_id}" ]]; then
                log_success "GPU detected: $(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1) (${gpu_hardware_id})"
            else
                log_warning "nvidia-smi found but no GPU UUID returned. Proceeding without GPU ID."
            fi
        else
            log_warning "No NVIDIA GPU detected (nvidia-smi not found). Oracle ML inference will run on CPU."
        fi
    fi
    
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
        --arg gpu_id "${gpu_hardware_id}" \
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
                diskGB: $disk,
                gpuHardwareId: (if $gpu_id != "" then $gpu_id else null end)
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
    
    # Download with retry logic (P2-2) and checksum verification (P1-3)
    download_with_retry() {
        local url="$1"
        local output="$2"
        local max_attempts=3
        local attempt=1
        local backoff=5

        while [ $attempt -le $max_attempts ]; do
            log "Download attempt ${attempt}/${max_attempts}: ${url}"
            if curl -fsSL --progress-bar --retry 3 --retry-delay 5 "${url}" -o "${output}"; then
                return 0
            fi
            log_warning "Download attempt ${attempt} failed. Retrying in ${backoff}s..."
            sleep $backoff
            backoff=$((backoff * 2))
            attempt=$((attempt + 1))
        done
        return 1
    }

    log "Downloading Docker image from R2: ${r2_image_url}"
    local tmp_image="/tmp/noderr-${tier,,}-image.tar.gz"
    if ! download_with_retry "${r2_image_url}" "${tmp_image}"; then
        error_exit "Failed to download Docker image from R2 after multiple attempts"
    fi

    # Verify SHA256 checksum if available (P1-3)
    local checksum_url="${r2_image_url}.sha256"
    local tmp_checksum="/tmp/noderr-${tier,,}-image.tar.gz.sha256"
    if curl -fsSL "${checksum_url}" -o "${tmp_checksum}" 2>/dev/null; then
        log "Verifying image checksum..."
        local expected_hash
        expected_hash=$(awk '{print $1}' "${tmp_checksum}")
        local actual_hash
        actual_hash=$(sha256sum "${tmp_image}" | awk '{print $1}')
        if [ "${expected_hash}" != "${actual_hash}" ]; then
            rm -f "${tmp_image}" "${tmp_checksum}"
            error_exit "Image checksum verification failed! Expected: ${expected_hash}, Got: ${actual_hash}. The download may be corrupted."
        fi
        log_success "Image checksum verified"
        rm -f "${tmp_checksum}"
    else
        log_warning "No checksum file found at ${checksum_url} — skipping verification"
    fi

    log "Loading Docker image..."
    if ! docker load < "${tmp_image}"; then
        error_exit "Failed to load Docker image"
    fi
    rm -f "${tmp_image}"

    # For Oracle tier: also download and load the ML service image
    if [[ "${tier}" == "ORACLE" ]]; then
        log "Downloading ML service image from R2 (this may take several minutes — the image is large)..."
        local ml_image_url="${R2_PUBLIC_URL}/ml-service/ml-service-latest.tar.gz"
        local tmp_ml_image="/tmp/noderr-ml-service-image.tar.gz"
        if ! download_with_retry "${ml_image_url}" "${tmp_ml_image}"; then
            error_exit "Failed to download ML service image from R2 after multiple attempts"
        fi

        # Verify ML service image checksum
        local ml_checksum_url="${ml_image_url}.sha256"
        local tmp_ml_checksum="/tmp/noderr-ml-service-image.tar.gz.sha256"
        if curl -fsSL "${ml_checksum_url}" -o "${tmp_ml_checksum}" 2>/dev/null; then
            log "Verifying ML service image checksum..."
            local ml_expected
            ml_expected=$(awk '{print $1}' "${tmp_ml_checksum}")
            local ml_actual
            ml_actual=$(sha256sum "${tmp_ml_image}" | awk '{print $1}')
            if [ "${ml_expected}" != "${ml_actual}" ]; then
                rm -f "${tmp_ml_image}" "${tmp_ml_checksum}"
                error_exit "ML service image checksum failed! Expected: ${ml_expected}, Got: ${ml_actual}"
            fi
            log_success "ML service image checksum verified"
            rm -f "${tmp_ml_checksum}"
        else
            log_warning "No ML service checksum file found — skipping verification"
        fi

        log "Loading ML service image..."
        if ! docker load < "${tmp_ml_image}"; then
            error_exit "Failed to load ML service image"
        fi
        rm -f "${tmp_ml_image}"
        log_success "ML service image loaded"
    fi

    local docker_image="${docker_image_name}"
    
    # Create Docker network
    docker network create noderr-network 2>/dev/null || true
    
    # =========================================================================
    # Auto-generate Hot Wallet (node operational key)
    # This is NOT the operator's personal wallet — it's a per-node key used for
    # signing P2P messages, attestations, and on-chain interactions.
    # The operator's personal wallet (for staking/rewards) comes from Typeform.
    # =========================================================================
    log "Generating node hot wallet..."
    local hot_wallet_private_key
    local hot_wallet_address
    hot_wallet_private_key=$(openssl rand -hex 32)
    # Derive Ethereum address from private key using Python (keccak256 of public key)
    hot_wallet_address=$(python3 -c "
import hashlib, struct
try:
    from eth_keys import keys
    pk = keys.PrivateKey(bytes.fromhex('${hot_wallet_private_key}'))
    print(pk.public_key.to_checksum_address())
except ImportError:
    # Fallback: store private key without address derivation
    # The node software will derive the address at runtime
    print('0x' + hashlib.sha256(bytes.fromhex('${hot_wallet_private_key}')).hexdigest()[:40])
" 2>/dev/null || echo "address-pending")
    
    # Save hot wallet info securely
    cat > "${CONFIG_DIR}/hot_wallet.json" <<WALLET_EOF
{
  "privateKey": "0x${hot_wallet_private_key}",
  "address": "${hot_wallet_address}",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "note": "Auto-generated node operational key. NOT the operator personal wallet."
}
WALLET_EOF
    chmod 600 "${CONFIG_DIR}/hot_wallet.json"
    log_success "Hot wallet generated: ${hot_wallet_address}"
    
    # Create environment file for the node container
    # JWT_TOKEN is included so the heartbeat client can authenticate immediately
    # CREDENTIALS_PATH points to the mounted credentials file inside the container
    cat > "${CONFIG_DIR}/node.env" <<EOF
NODE_ID=${node_id}
NODE_TIER=${tier}
NODE_VERSION=$(echo "${install_config}" | jq -r '.config.latestVersion // "1.0.0"')
API_KEY=${api_key}
JWT_TOKEN=${jwt_token}
CREDENTIALS_PATH=/app/config/credentials.json
DEPLOYMENT_ENGINE_URL=$(echo "${install_config}" | jq -r '.config.deploymentEngineUrl')
AUTH_API_URL=$(echo "${install_config}" | jq -r '.config.authApiUrl')
TELEMETRY_ENDPOINT=$(echo "${install_config}" | jq -r '.config.telemetryEndpoint')

# P2P Network Configuration
BOOTSTRAP_NODES=$(echo "${install_config}" | jq -r '.config.bootstrapNodes // empty')
P2P_LISTEN_PORT=4001
P2P_WS_PORT=4002

# Trading Safety Defaults (testnet)
SIMULATION_MODE=true
PAPER_TRADING=true

# Auto-Updater Configuration
VERSION_BEACON_ADDRESS=0xA5Be5522bb3C748ea262a2A7d877d00AE387FDa6
# RPC_ENDPOINT is set below from the operator's Typeform-provided endpoint
DOCKER_REGISTRY=$(echo "${install_config}" | jq -r '.config.dockerRegistry')
DOCKER_IMAGE_PREFIX=noderr-node-os
HEALTH_CHECK_URL=http://localhost:8080/health
BACKUP_DIRECTORY=/app/backups
CHECK_INTERVAL=300000
AUTO_UPDATE_ENABLED=true
CURRENT_VERSION=$(echo "${install_config}" | jq -r '.config.latestVersion // "1.0.0"')

# Operator's RPC Endpoint (from Typeform — each operator provides their own for decentralization)
RPC_ENDPOINT=$(echo "${install_config}" | jq -r '.rpcEndpoint')

# Node Hot Wallet (auto-generated during install — NOT the operator's personal wallet)
PRIVATE_KEY=${hot_wallet_private_key}
EOF

    # For Oracle tier: append oracle-specific env vars from install config
    if [[ "${tier}" == "ORACLE" ]]; then
        local oracle_verifier_address
        oracle_verifier_address=$(echo "${install_config}" | jq -r '.config.oracleVerifierAddress // empty')
        # Oracle RPC_URL uses the same operator-provided RPC endpoint (decentralized)
        local operator_rpc
        operator_rpc=$(echo "${install_config}" | jq -r '.rpcEndpoint')
        cat >> "${CONFIG_DIR}/node.env" <<ORACLE_EOF

# Oracle Consensus (Oracle tier only)
ORACLE_VERIFIER_ADDRESS=${oracle_verifier_address}
RPC_URL=${operator_rpc}
# ORACLE_PRIVATE_KEY uses the same auto-generated hot wallet as PRIVATE_KEY
ORACLE_PRIVATE_KEY=${hot_wallet_private_key}
# ML Service connection (Docker network hostname — do not change)
ML_SERVICE_HOST=ml-service
ML_SERVICE_PORT=50051
ORACLE_EOF
        log "Oracle-specific env vars written to node.env"
    fi

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
    
    # Oracle uses Docker Compose (two containers: oracle + ml-service)
    # All other tiers use a single-container systemd service
    if [[ "${tier}" == "ORACLE" ]]; then
        # Detect GPU for compose deploy section
        local gpu_deploy_section=""
        if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null 2>&1; then
            gpu_deploy_section="    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]"
            log_success "NVIDIA GPU detected — ml-service will use GPU acceleration"
        else
            log_warning "No NVIDIA GPU detected — ml-service will run in CPU mode"
        fi

        cat > "${CONFIG_DIR}/docker-compose.yml" <<COMPOSE_EOF
version: '3.8'
services:
  ml-service:
    image: noderr-ml-service:latest
    container_name: noderr-ml-service
    restart: unless-stopped
    environment:
      - GRPC_PORT=50051
      - MODEL_PATH=/app/models
      - LOG_LEVEL=INFO
      - CUDA_VISIBLE_DEVICES=0
    volumes:
      - noderr_ml_models:/app/models
      - noderr_ml_logs:/app/logs
    networks:
      - noderr-network
    healthcheck:
      test: ["CMD", "python3", "-c", "import socket; s=socket.socket(); s.connect(('localhost',50051)); s.close()"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 90s
${gpu_deploy_section}

  oracle:
    image: noderr-oracle:latest
    container_name: noderr-node
    restart: unless-stopped
    env_file:
      - ${CONFIG_DIR}/node.env
    ports:
      - "4001:4001/tcp"
      - "4002:4002/tcp"
    volumes:
      - ${CONFIG_DIR}/credentials.json:/app/config/credentials.json:rw
      - /var/run/docker.sock:/var/run/docker.sock:ro
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "5"
    depends_on:
      ml-service:
        condition: service_healthy
    networks:
      - noderr-network

volumes:
  noderr_ml_models:
    driver: local
  noderr_ml_logs:
    driver: local

networks:
  noderr-network:
    external: true
COMPOSE_EOF
        chmod 600 "${CONFIG_DIR}/docker-compose.yml"

        cat > /etc/systemd/system/noderr-node.service <<EOF
[Unit]
Description=Noderr Oracle Node (oracle + ml-service)
After=docker.service
Requires=docker.service

[Service]
Type=simple
Restart=always
RestartSec=10
WorkingDirectory=${CONFIG_DIR}
ExecStartPre=-/usr/bin/docker compose -f ${CONFIG_DIR}/docker-compose.yml down --remove-orphans
ExecStart=/usr/bin/docker compose -f ${CONFIG_DIR}/docker-compose.yml up
ExecStop=/usr/bin/docker compose -f ${CONFIG_DIR}/docker-compose.yml down

[Install]
WantedBy=multi-user.target
EOF
        log_success "Oracle docker-compose.yml and systemd service created"
    else
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
    --publish 4001:4001/tcp \\
    --publish 4002:4002/tcp \\
    --volume ${CONFIG_DIR}/credentials.json:/app/config/credentials.json:rw \\
    --volume /var/run/docker.sock:/var/run/docker.sock:ro \\
    --log-driver json-file \\
    --log-opt max-size=50m \\
    --log-opt max-file=5 \\
    --restart unless-stopped \\
    ${docker_image}
ExecStop=/usr/bin/docker stop noderr-node

[Install]
WantedBy=multi-user.target
EOF
        log_success "Systemd service created"
    fi
    
    systemctl daemon-reload
}

# ============================================================================
# Private Key Configuration (REMOVED)
# Hot wallet is now auto-generated during installation.
# The prompt_private_key() function has been removed.
# ============================================================================

# ============================================================================
# Firewall Configuration
# ============================================================================

configure_firewall() {
    log "Configuring firewall for P2P networking..."

    if command -v ufw &>/dev/null; then
        # UFW is installed — open P2P ports
        ufw allow 4001/tcp comment 'Noderr P2P TCP' >/dev/null 2>&1
        ufw allow 4002/tcp comment 'Noderr P2P WebSocket' >/dev/null 2>&1

        # Check if UFW is active; if not, don't force-enable it
        if ufw status | grep -q "Status: active"; then
            log_success "Firewall rules added (ufw): ports 4001/tcp, 4002/tcp"
        else
            log_warning "UFW is installed but not active. Rules added but will only take effect when UFW is enabled."
            log_warning "To enable: sudo ufw enable"
        fi
    elif command -v firewall-cmd &>/dev/null; then
        # firewalld (CentOS/RHEL/Fedora)
        firewall-cmd --permanent --add-port=4001/tcp >/dev/null 2>&1
        firewall-cmd --permanent --add-port=4002/tcp >/dev/null 2>&1
        firewall-cmd --reload >/dev/null 2>&1
        log_success "Firewall rules added (firewalld): ports 4001/tcp, 4002/tcp"
    else
        log_warning "No firewall manager detected (ufw/firewalld). Ensure ports 4001/tcp and 4002/tcp are open for P2P networking."
    fi
}

start_node() {
    log "Starting Noderr Node OS..."
    
    systemctl enable noderr-node >/dev/null 2>&1
    systemctl start noderr-node

    # P1-9: Install auto-update timer (heartbeat-driven updates are primary,
    # but this timer provides a safety net for nodes that miss heartbeat signals)
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -f "${script_dir}/noderr-update.service" ] && [ -f "${script_dir}/noderr-update.timer" ]; then
        cp "${script_dir}/noderr-update.service" /etc/systemd/system/noderr-update.service
        cp "${script_dir}/noderr-update.timer" /etc/systemd/system/noderr-update.timer
        systemctl daemon-reload
        systemctl enable noderr-update.timer >/dev/null 2>&1
        systemctl start noderr-update.timer >/dev/null 2>&1
        log_success "Auto-update timer installed"
    fi
    
    # Wait for node to start
    sleep 5
    
    # Check if container is running
    local start_tier
    start_tier=$(cat "${CONFIG_DIR}/install_config.json" 2>/dev/null | jq -r '.tier' 2>/dev/null || echo "UNKNOWN")
    if ! docker ps | grep -q noderr-node; then
        error_exit "Node failed to start. Check logs with: journalctl -u noderr-node -f"
    fi
    if [[ "${start_tier}" == "ORACLE" ]]; then
        log "ML service is starting (model loading takes ~60–90s)..."
        log "Check status with: docker ps | grep noderr-ml-service"
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
    local summary_tier
    summary_tier=$(cat "${CONFIG_DIR}/install_config.json" 2>/dev/null | jq -r '.tier' 2>/dev/null || echo "UNKNOWN")
    
    # Show hot wallet address
    local hot_wallet_addr
    hot_wallet_addr=$(jq -r '.address // "unknown"' "${CONFIG_DIR}/hot_wallet.json" 2>/dev/null || echo "unknown")
    echo "  Hot Wallet: ${hot_wallet_addr}"
    echo "  (Auto-generated operational key — NOT your personal wallet)"
    echo ""
    echo "  Status:  Running"
    echo "  Logs:    journalctl -u noderr-node -f"
    echo "  Stop:    systemctl stop noderr-node"
    echo "  Start:   systemctl start noderr-node"
    echo "  Restart: systemctl restart noderr-node"
    if [[ "${summary_tier}" == "ORACLE" ]]; then
        echo ""
        echo "  Oracle ML Service:"
        echo "    Logs:   docker logs noderr-ml-service -f"
        echo "    Status: docker ps | grep noderr-ml"
        echo "    Note:   ML service takes ~60–90s to load models on first start"
    fi
    echo ""
    echo "  Configuration: ${CONFIG_DIR}/"
    echo "  Credentials:   ${CONFIG_DIR}/credentials.json (keep secure!)"
    echo "  Hot Wallet:    ${CONFIG_DIR}/hot_wallet.json (keep secure!)"
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
    # The operator's wallet address and RPC endpoint are embedded in the token
    # (collected via Typeform) and retrieved automatically from the auth API.
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
    # Wallet address and RPC endpoint are retrieved from install config (Typeform → auth API)
    get_install_config "${install_token}"
    check_hardware_for_tier
    register_node "${install_token}"
    
    # Docker setup
    setup_docker_container
    create_systemd_service

    # Configure firewall for P2P ports
    configure_firewall

    # Hot wallet is auto-generated — no manual private key configuration needed
    start_node
    
    # Display summary
    display_summary
    
    log_success "Installation completed successfully!"
}

# Run main function with all arguments
main "$@"
