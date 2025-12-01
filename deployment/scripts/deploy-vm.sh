#!/bin/bash
set -euo pipefail

# Noderr Node OS - VM Deployment Script
# PhD-level production deployment automation

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
REPO_URL="${REPO_URL:-https://github.com/Noderrxyz/noderr-work.git}"
BRANCH="${BRANCH:-master}"
INSTALL_DIR="${INSTALL_DIR:-/opt/noderr}"
DATA_DIR="${DATA_DIR:-/var/lib/noderr}"
LOG_DIR="${LOG_DIR:-/var/log/noderr}"

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root"
        exit 1
    fi
}

check_system() {
    log_info "Checking system requirements..."
    
    # Check OS
    if [[ ! -f /etc/os-release ]]; then
        log_error "Cannot determine OS version"
        exit 1
    fi
    
    source /etc/os-release
    if [[ "$ID" != "ubuntu" ]] && [[ "$ID" != "debian" ]]; then
        log_warn "This script is optimized for Ubuntu/Debian. Your OS: $ID"
    fi
    
    # Check resources
    local total_mem=$(free -g | awk '/^Mem:/{print $2}')
    if [[ $total_mem -lt 8 ]]; then
        log_warn "Recommended minimum RAM is 8GB. Current: ${total_mem}GB"
    fi
    
    local cpu_cores=$(nproc)
    if [[ $cpu_cores -lt 4 ]]; then
        log_warn "Recommended minimum CPU cores is 4. Current: ${cpu_cores}"
    fi
    
    log_info "System check complete"
}

install_dependencies() {
    log_info "Installing system dependencies..."
    
    apt-get update
    apt-get install -y \
        apt-transport-https \
        ca-certificates \
        curl \
        gnupg \
        lsb-release \
        git \
        make \
        jq \
        htop \
        net-tools
    
    log_info "Dependencies installed"
}

install_docker() {
    log_info "Installing Docker..."
    
    if command -v docker &> /dev/null; then
        log_info "Docker already installed: $(docker --version)"
        return
    fi
    
    # Add Docker's official GPG key
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
    
    # Set up stable repository
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu \
      $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    # Install Docker Engine
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    
    # Start and enable Docker
    systemctl start docker
    systemctl enable docker
    
    log_info "Docker installed: $(docker --version)"
}

install_docker_compose() {
    log_info "Installing Docker Compose..."
    
    if command -v docker-compose &> /dev/null; then
        log_info "Docker Compose already installed: $(docker-compose --version)"
        return
    fi
    
    local version="2.24.0"
    curl -L "https://github.com/docker/compose/releases/download/v${version}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    
    log_info "Docker Compose installed: $(docker-compose --version)"
}

setup_directories() {
    log_info "Setting up directories..."
    
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$DATA_DIR"/{postgres,redis,ml-models,node-data}
    mkdir -p "$LOG_DIR"/{node,ml,nginx,postgres}
    
    # Set permissions
    chown -R 1000:1000 "$DATA_DIR"
    chown -R 1000:1000 "$LOG_DIR"
    
    log_info "Directories created"
}

clone_repository() {
    log_info "Cloning repository..."
    
    if [[ -d "$INSTALL_DIR/.git" ]]; then
        log_info "Repository already exists, pulling latest changes..."
        cd "$INSTALL_DIR"
        git pull origin "$BRANCH"
    else
        git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi
    
    log_info "Repository ready"
}

configure_environment() {
    log_info "Configuring environment..."
    
    cd "$INSTALL_DIR"
    
    if [[ ! -f .env ]]; then
        cp .env.example .env
        
        # Generate secure passwords
        local postgres_pass=$(openssl rand -base64 32)
        local jwt_secret=$(openssl rand -base64 64)
        local encryption_key=$(openssl rand -base64 32)
        
        # Update .env file
        sed -i "s/change_this_in_production/${postgres_pass}/g" .env
        sed -i "s/JWT_SECRET=.*/JWT_SECRET=${jwt_secret}/" .env
        sed -i "s/ENCRYPTION_KEY=.*/ENCRYPTION_KEY=${encryption_key}/" .env
        
        log_info "Environment configured with secure credentials"
    else
        log_info "Environment file already exists"
    fi
}

setup_firewall() {
    log_info "Configuring firewall..."
    
    if command -v ufw &> /dev/null; then
        ufw --force enable
        ufw default deny incoming
        ufw default allow outgoing
        ufw allow 22/tcp comment 'SSH'
        ufw allow 80/tcp comment 'HTTP'
        ufw allow 443/tcp comment 'HTTPS'
        ufw allow 50052/tcp comment 'P2P'
        
        log_info "Firewall configured"
    else
        log_warn "UFW not available, skipping firewall configuration"
    fi
}

deploy_services() {
    log_info "Deploying services..."
    
    cd "$INSTALL_DIR"
    
    # Build images
    log_info "Building Docker images..."
    make build
    
    # Start services
    log_info "Starting services..."
    make up
    
    # Wait for services to be healthy
    log_info "Waiting for services to be healthy..."
    sleep 30
    
    # Check health
    local retries=0
    local max_retries=10
    while [[ $retries -lt $max_retries ]]; do
        if curl -f http://localhost/health &> /dev/null; then
            log_info "Services are healthy!"
            return 0
        fi
        
        retries=$((retries + 1))
        log_info "Waiting for services... ($retries/$max_retries)"
        sleep 10
    done
    
    log_error "Services failed to become healthy"
    return 1
}

setup_systemd() {
    log_info "Setting up systemd service..."
    
    cat > /etc/systemd/system/noderr.service <<EOF
[Unit]
Description=Noderr Node OS
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/make up
ExecStop=/usr/bin/make down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF
    
    systemctl daemon-reload
    systemctl enable noderr.service
    
    log_info "Systemd service configured"
}

setup_monitoring() {
    log_info "Setting up monitoring..."
    
    # Create monitoring script
    cat > /usr/local/bin/noderr-monitor <<'EOF'
#!/bin/bash
cd /opt/noderr
docker-compose ps --format json | jq -r '.[] | "\(.Name): \(.State)"'
EOF
    
    chmod +x /usr/local/bin/noderr-monitor
    
    # Create health check cron job
    (crontab -l 2>/dev/null; echo "*/5 * * * * /usr/local/bin/noderr-monitor >> /var/log/noderr/monitor.log 2>&1") | crontab -
    
    log_info "Monitoring configured"
}

print_summary() {
    log_info "Deployment complete!"
    echo ""
    echo "========================================="
    echo "Noderr Node OS Deployment Summary"
    echo "========================================="
    echo "Installation Directory: $INSTALL_DIR"
    echo "Data Directory: $DATA_DIR"
    echo "Log Directory: $LOG_DIR"
    echo ""
    echo "Services:"
    cd "$INSTALL_DIR"
    docker-compose ps
    echo ""
    echo "Access Points:"
    echo "  - HTTP: http://$(hostname -I | awk '{print $1}')"
    echo "  - Health: http://$(hostname -I | awk '{print $1}')/health"
    echo ""
    echo "Useful Commands:"
    echo "  - View logs: cd $INSTALL_DIR && make logs"
    echo "  - Restart: cd $INSTALL_DIR && make restart"
    echo "  - Health check: cd $INSTALL_DIR && make health"
    echo "  - Monitor: noderr-monitor"
    echo ""
    echo "========================================="
}

# Main execution
main() {
    log_info "Starting Noderr Node OS deployment..."
    
    check_root
    check_system
    install_dependencies
    install_docker
    install_docker_compose
    setup_directories
    clone_repository
    configure_environment
    setup_firewall
    deploy_services
    setup_systemd
    setup_monitoring
    print_summary
    
    log_info "Deployment successful!"
}

# Run main function
main "$@"
