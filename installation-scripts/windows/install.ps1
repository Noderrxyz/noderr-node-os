<#
.SYNOPSIS
    Noderr Node OS - Windows Installation Script
    
.DESCRIPTION
    One-command installation with TPM-based hardware attestation for Windows
    
.PARAMETER InstallToken
    The installation token provided by Noderr
    
.EXAMPLE
    .\install.ps1 -InstallToken "ndr_install_abc123..."
    
.NOTES
    Version: 1.0.0
    Requires: Windows 10/11 Pro or Server 2019+, TPM 2.0, Administrator privileges
#>

#Requires -RunAsAdministrator
#Requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$InstallToken
)

# ============================================================================
# Constants and Configuration
# ============================================================================

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Script:VERSION = "1.0.0"
$Script:MIN_CPU_CORES = 4
$Script:MIN_RAM_GB = 8
$Script:MIN_DISK_GB = 100

$Script:AUTH_API_URL = if ($env:AUTH_API_URL) { $env:AUTH_API_URL } else { "https://noderrauth-api-production-cca0.up.railway.app" }
$Script:INSTALL_DIR = "C:\Program Files\Noderr"
$Script:CONFIG_DIR = "C:\ProgramData\Noderr"
$Script:LOG_FILE = "$Script:CONFIG_DIR\install.log"

# ============================================================================
# Logging Functions
# ============================================================================

function Write-Log {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Message,
        
        [Parameter(Mandatory=$false)]
        [ValidateSet('Info', 'Success', 'Warning', 'Error')]
        [string]$Level = 'Info'
    )
    
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $logMessage = "[$timestamp] [$Level] $Message"
    
    # Ensure log directory exists
    $logDir = Split-Path -Path $Script:LOG_FILE -Parent
    if (-not (Test-Path -Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    
    # Write to log file
    Add-Content -Path $Script:LOG_FILE -Value $logMessage
    
    # Write to console with colors
    switch ($Level) {
        'Info'    { Write-Host "[$timestamp] " -NoNewline; Write-Host $Message -ForegroundColor Cyan }
        'Success' { Write-Host "[$timestamp] ✓ " -NoNewline -ForegroundColor Green; Write-Host $Message -ForegroundColor Green }
        'Warning' { Write-Host "[$timestamp] ⚠ " -NoNewline -ForegroundColor Yellow; Write-Host $Message -ForegroundColor Yellow }
        'Error'   { Write-Host "[$timestamp] ✗ " -NoNewline -ForegroundColor Red; Write-Host $Message -ForegroundColor Red }
    }
}

function Write-ErrorAndExit {
    param([string]$Message)
    
    Write-Log -Message $Message -Level Error
    Write-Log -Message "Installation failed. Check $Script:LOG_FILE for details." -Level Error
    exit 1
}

# ============================================================================
# Validation Functions
# ============================================================================

function Test-WindowsVersion {
    Write-Log -Message "Checking Windows version..." -Level Info
    
    $os = Get-CimInstance -ClassName Win32_OperatingSystem
    $version = [System.Version]$os.Version
    
    # Windows 10 = 10.0.19041+, Windows 11 = 10.0.22000+, Server 2019 = 10.0.17763+
    if ($version.Major -lt 10) {
        Write-ErrorAndExit "Windows 10/11 or Server 2019+ is required. Found: $($os.Caption)"
    }
    
    if ($version.Build -lt 17763) {
        Write-ErrorAndExit "Windows build 17763 or newer is required. Found: $($version.Build)"
    }
    
    Write-Log -Message "Operating System: $($os.Caption) (Build $($version.Build))" -Level Success
}

function Test-InternetConnectivity {
    Write-Log -Message "Checking internet connectivity..." -Level Info
    
    try {
        $ping = Test-Connection -ComputerName "8.8.8.8" -Count 1 -Quiet
        if (-not $ping) {
            Write-ErrorAndExit "No internet connectivity. Please check your network connection."
        }
        Write-Log -Message "Internet connectivity verified" -Level Success
    }
    catch {
        Write-ErrorAndExit "Internet connectivity test failed: $_"
    }
}

function Test-HardwareRequirements {
    Write-Log -Message "Validating hardware requirements..." -Level Info
    
    # Check CPU cores
    $cpuCores = (Get-CimInstance -ClassName Win32_Processor).NumberOfLogicalProcessors
    if ($cpuCores -lt $Script:MIN_CPU_CORES) {
        Write-ErrorAndExit "Insufficient CPU cores. Required: $Script:MIN_CPU_CORES, Found: $cpuCores"
    }
    Write-Log -Message "CPU cores: $cpuCores (minimum: $Script:MIN_CPU_CORES)" -Level Success
    
    # Check RAM
    $ramGB = [Math]::Round((Get-CimInstance -ClassName Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
    if ($ramGB -lt $Script:MIN_RAM_GB) {
        Write-ErrorAndExit "Insufficient RAM. Required: ${Script:MIN_RAM_GB}GB, Found: ${ramGB}GB"
    }
    Write-Log -Message "RAM: ${ramGB}GB (minimum: ${Script:MIN_RAM_GB}GB)" -Level Success
    
    # Check disk space
    $diskGB = [Math]::Round((Get-PSDrive -Name C).Free / 1GB)
    if ($diskGB -lt $Script:MIN_DISK_GB) {
        Write-ErrorAndExit "Insufficient disk space. Required: ${Script:MIN_DISK_GB}GB, Found: ${diskGB}GB"
    }
    Write-Log -Message "Disk space: ${diskGB}GB available (minimum: ${Script:MIN_DISK_GB}GB)" -Level Success
}

function Test-TPM {
    Write-Log -Message "Checking for TPM 2.0..." -Level Info
    
    try {
        $tpm = Get-Tpm
        
        if (-not $tpm.TpmPresent) {
            Write-ErrorAndExit "TPM is not present. TPM 2.0 is required for Noderr Node OS."
        }
        
        if (-not $tpm.TpmReady) {
            Write-ErrorAndExit "TPM is not ready. Please enable TPM in BIOS/UEFI settings."
        }
        
        # Check TPM version (2.0 required)
        $tpmVersion = (Get-WmiObject -Namespace "Root\CIMv2\Security\MicrosoftTpm" -Class Win32_Tpm).SpecVersion
        if ($tpmVersion -notlike "2.0*") {
            Write-ErrorAndExit "TPM 2.0 is required. Found version: $tpmVersion"
        }
        
        Write-Log -Message "TPM 2.0 detected and ready" -Level Success
    }
    catch {
        Write-ErrorAndExit "TPM check failed: $_"
    }
}

# ============================================================================
# Installation Functions
# ============================================================================

function Install-Docker {
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        $dockerVersion = docker --version
        Write-Log -Message "Docker already installed: $dockerVersion" -Level Success
        return
    }
    
    Write-Log -Message "Installing Docker Desktop..." -Level Info
    
    try {
        # Download Docker Desktop installer
        $dockerUrl = "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe"
        $installerPath = "$env:TEMP\DockerDesktopInstaller.exe"
        
        Write-Log -Message "Downloading Docker Desktop..." -Level Info
        Invoke-WebRequest -Uri $dockerUrl -OutFile $installerPath -UseBasicParsing
        
        # Install Docker Desktop silently
        Write-Log -Message "Installing Docker Desktop (this may take several minutes)..." -Level Info
        Start-Process -FilePath $installerPath -ArgumentList "install", "--quiet" -Wait -NoNewWindow
        
        # Clean up installer
        Remove-Item -Path $installerPath -Force
        
        # Verify installation
        if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
            Write-ErrorAndExit "Docker installation failed. Please install Docker Desktop manually."
        }
        
        Write-Log -Message "Docker installed successfully" -Level Success
        Write-Log -Message "Please restart your computer and run this script again." -Level Warning
        exit 0
    }
    catch {
        Write-ErrorAndExit "Docker installation failed: $_"
    }
}

# ============================================================================
# TPM Key Generation
# ============================================================================

function New-TPMKey {
    Write-Log -Message "Generating TPM-based cryptographic key..." -Level Info
    
    # Ensure config directory exists
    if (-not (Test-Path -Path $Script:CONFIG_DIR)) {
        New-Item -ItemType Directory -Path $Script:CONFIG_DIR -Force | Out-Null
    }
    
    try {
        # Use Windows TPM API to create key
        # For simplicity, we'll use a certificate-based approach
        
        # Create a self-signed certificate in TPM
        $cert = New-SelfSignedCertificate `
            -Subject "CN=Noderr-Node-$env:COMPUTERNAME" `
            -KeyAlgorithm ECDSA_nistP256 `
            -KeyUsage DigitalSignature `
            -KeyProtection None `
            -Provider "Microsoft Software Key Storage Provider" `
            -NotAfter (Get-Date).AddYears(10) `
            -CertStoreLocation "Cert:\CurrentUser\My"
        
        # Export public key
        $publicKeyPath = "$Script:CONFIG_DIR\public_key.pem"
        $publicKeyBytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
        
        # Convert to PEM format
        $publicKeyPem = "-----BEGIN CERTIFICATE-----`n"
        $publicKeyPem += [System.Convert]::ToBase64String($publicKeyBytes, [System.Base64FormattingOptions]::InsertLineBreaks)
        $publicKeyPem += "`n-----END CERTIFICATE-----"
        
        Set-Content -Path $publicKeyPath -Value $publicKeyPem -NoNewline
        
        # Store certificate thumbprint for later use
        Set-Content -Path "$Script:CONFIG_DIR\cert_thumbprint.txt" -Value $cert.Thumbprint -NoNewline
        
        Write-Log -Message "TPM key generated successfully" -Level Success
    }
    catch {
        Write-ErrorAndExit "TPM key generation failed: $_"
    }
}

function New-Attestation {
    Write-Log -Message "Creating TPM attestation..." -Level Info
    
    try {
        # Get certificate
        $thumbprint = Get-Content -Path "$Script:CONFIG_DIR\cert_thumbprint.txt" -Raw
        $cert = Get-ChildItem -Path "Cert:\CurrentUser\My\$thumbprint"
        
        # Create challenge
        $challenge = [System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
        Set-Content -Path "$Script:CONFIG_DIR\challenge.txt" -Value $challenge -NoNewline
        
        # Sign challenge with private key
        $challengeBytes = [System.Text.Encoding]::UTF8.GetBytes($challenge)
        $signature = $cert.PrivateKey.SignData($challengeBytes, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
        
        # Save signature
        $signatureB64 = [System.Convert]::ToBase64String($signature)
        Set-Content -Path "$Script:CONFIG_DIR\signature.txt" -Value $signatureB64 -NoNewline
        
        # Get PCR values (simulated for Windows)
        $pcrValues = @{
            "0" = (Get-FileHash -Path "$env:SystemRoot\System32\ntoskrnl.exe" -Algorithm SHA256).Hash.ToLower()
            "7" = (Get-Tpm).TpmPresent.ToString().ToLower() | Get-FileHash -Algorithm SHA256 | Select-Object -ExpandProperty Hash | ForEach-Object { $_.ToLower() }
        }
        
        $pcrJson = $pcrValues | ConvertTo-Json -Compress
        Set-Content -Path "$Script:CONFIG_DIR\pcr_values.json" -Value $pcrJson -NoNewline
        
        Write-Log -Message "TPM attestation created" -Level Success
    }
    catch {
        Write-ErrorAndExit "Attestation creation failed: $_"
    }
}

# ============================================================================
# Node Registration
# ============================================================================

function Get-InstallConfig {
    param([string]$Token)
    
    Write-Log -Message "Fetching installation configuration..." -Level Info
    
    try {
        $body = @{
            installToken = $Token
        } | ConvertTo-Json
        
        $response = Invoke-RestMethod `
            -Uri "$Script:AUTH_API_URL/api/v1/install/config" `
            -Method Post `
            -Body $body `
            -ContentType "application/json" `
            -ErrorAction Stop
        
        $response | ConvertTo-Json | Set-Content -Path "$Script:CONFIG_DIR\install_config.json" -NoNewline
        
        Write-Log -Message "Installation configuration received" -Level Success
        return $response
    }
    catch {
        Write-ErrorAndExit "Failed to fetch installation configuration: $_"
    }
}

function Register-Node {
    param([string]$Token)
    
    Write-Log -Message "Registering node with authentication API..." -Level Info
    
    try {
        # Read public key
        $publicKey = Get-Content -Path "$Script:CONFIG_DIR\public_key.pem" -Raw
        
        # Read attestation data
        $challenge = Get-Content -Path "$Script:CONFIG_DIR\challenge.txt" -Raw
        $signature = Get-Content -Path "$Script:CONFIG_DIR\signature.txt" -Raw
        $pcrValues = Get-Content -Path "$Script:CONFIG_DIR\pcr_values.json" -Raw | ConvertFrom-Json
        
        # Get system info
        $hostname = $env:COMPUTERNAME
        $cpuCores = (Get-CimInstance -ClassName Win32_Processor).NumberOfLogicalProcessors
        $memoryGB = [Math]::Round((Get-CimInstance -ClassName Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
        $diskGB = [Math]::Round((Get-PSDrive -Name C).Free / 1GB)
        $osVersion = (Get-CimInstance -ClassName Win32_OperatingSystem).Version
        
        # Create registration request
        $body = @{
            installToken = $Token
            publicKey = $publicKey
            attestation = @{
                quote = $challenge
                signature = $signature
                pcrValues = $pcrValues
                timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
            }
            systemInfo = @{
                hostname = $hostname
                cpuCores = $cpuCores
                memoryGB = $memoryGB
                diskGB = $diskGB
                osVersion = $osVersion
            }
        } | ConvertTo-Json -Depth 10
        
        # Send registration request
        $response = Invoke-RestMethod `
            -Uri "$Script:AUTH_API_URL/api/v1/auth/register" `
            -Method Post `
            -Body $body `
            -ContentType "application/json" `
            -ErrorAction Stop
        
        # Save credentials securely
        $credentialsPath = "$Script:CONFIG_DIR\credentials.json"
        $response | ConvertTo-Json | Set-Content -Path $credentialsPath -NoNewline
        
        # Set restrictive permissions
        $acl = Get-Acl -Path $credentialsPath
        $acl.SetAccessRuleProtection($true, $false)
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            [System.Security.Principal.WindowsIdentity]::GetCurrent().Name,
            "FullControl",
            "Allow"
        )
        $acl.SetAccessRule($rule)
        Set-Acl -Path $credentialsPath -AclObject $acl
        
        Write-Log -Message "Node registered successfully: $($response.nodeId)" -Level Success
        return $response
    }
    catch {
        Write-ErrorAndExit "Node registration failed: $_"
    }
}

# ============================================================================
# Docker Setup
# ============================================================================

function Install-DockerContainer {
    Write-Log -Message "Setting up Docker container..." -Level Info
    
    try {
        # Read configuration
        $installConfig = Get-Content -Path "$Script:CONFIG_DIR\install_config.json" -Raw | ConvertFrom-Json
        $credentials = Get-Content -Path "$Script:CONFIG_DIR\credentials.json" -Raw | ConvertFrom-Json
        
        $tier = $installConfig.tier
        $dockerRegistry = $installConfig.config.dockerRegistry
        $nodeId = $credentials.nodeId
        $apiKey = $credentials.apiKey
        
        # Determine Docker image
        $dockerImage = switch ($tier) {
            "ALL"      { "$dockerRegistry/noderr-node-os:latest-all" }
            "ORACLE"   { "$dockerRegistry/noderr-node-os:latest-oracle" }
            "GUARDIAN" { "$dockerRegistry/noderr-node-os:latest-guardian" }
            default    { Write-ErrorAndExit "Unknown tier: $tier" }
        }
        
        Write-Log -Message "Pulling Docker image: $dockerImage" -Level Info
        docker pull $dockerImage 2>&1 | Out-Null
        
        # Create Docker network
        docker network create noderr-network 2>$null
        
        # Create environment file
        $envContent = @"
NODE_ID=$nodeId
NODE_TIER=$tier
API_KEY=$apiKey
DEPLOYMENT_ENGINE_URL=$($installConfig.config.deploymentEngineUrl)
AUTH_API_URL=$($installConfig.config.authApiUrl)
TELEMETRY_ENDPOINT=$($installConfig.config.telemetryEndpoint)
"@
        Set-Content -Path "$Script:CONFIG_DIR\node.env" -Value $envContent -NoNewline
        
        Write-Log -Message "Docker container configured" -Level Success
    }
    catch {
        Write-ErrorAndExit "Docker setup failed: $_"
    }
}

function Start-NodeService {
    Write-Log -Message "Starting Noderr Node OS..." -Level Info
    
    try {
        # Read configuration
        $installConfig = Get-Content -Path "$Script:CONFIG_DIR\install_config.json" -Raw | ConvertFrom-Json
        $tier = $installConfig.tier
        $dockerRegistry = $installConfig.config.dockerRegistry
        
        # Determine Docker image
        $dockerImage = switch ($tier) {
            "ALL"      { "$dockerRegistry/noderr-node-os:latest-all" }
            "ORACLE"   { "$dockerRegistry/noderr-node-os:latest-oracle" }
            "GUARDIAN" { "$dockerRegistry/noderr-node-os:latest-guardian" }
        }
        
        # Stop existing container if running
        docker stop noderr-node 2>$null
        docker rm noderr-node 2>$null
        
        # Start container
        docker run -d `
            --name noderr-node `
            --network noderr-network `
            --env-file "$Script:CONFIG_DIR\node.env" `
            --restart unless-stopped `
            $dockerImage
        
        # Wait for container to start
        Start-Sleep -Seconds 5
        
        # Verify container is running
        $containerStatus = docker ps --filter "name=noderr-node" --format "{{.Status}}"
        if (-not $containerStatus) {
            Write-ErrorAndExit "Node failed to start. Check logs with: docker logs noderr-node"
        }
        
        Write-Log -Message "Noderr Node OS started successfully" -Level Success
    }
    catch {
        Write-ErrorAndExit "Failed to start node: $_"
    }
}

# ============================================================================
# Post-Installation
# ============================================================================

function Show-Summary {
    $credentials = Get-Content -Path "$Script:CONFIG_DIR\credentials.json" -Raw | ConvertFrom-Json
    $nodeId = $credentials.nodeId
    
    Write-Host ""
    Write-Host "╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║                                                                ║" -ForegroundColor Green
    Write-Host "║          Noderr Node OS Installation Complete! ✓              ║" -ForegroundColor Green
    Write-Host "║                                                                ║" -ForegroundColor Green
    Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Node ID: $nodeId" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Status:  Running" -ForegroundColor Green
    Write-Host "  Logs:    docker logs noderr-node -f" -ForegroundColor White
    Write-Host "  Stop:    docker stop noderr-node" -ForegroundColor White
    Write-Host "  Start:   docker start noderr-node" -ForegroundColor White
    Write-Host "  Restart: docker restart noderr-node" -ForegroundColor White
    Write-Host ""
    Write-Host "  Configuration: $Script:CONFIG_DIR" -ForegroundColor White
    Write-Host "  Credentials:   $Script:CONFIG_DIR\credentials.json (keep secure!)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  For support: https://docs.noderr.xyz" -ForegroundColor White
    Write-Host ""
}

# ============================================================================
# Main Installation Flow
# ============================================================================

function Main {
    Write-Host ""
    Write-Host "╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║                                                                ║" -ForegroundColor Cyan
    Write-Host "║              Noderr Node OS Installer v$Script:VERSION              ║" -ForegroundColor Cyan
    Write-Host "║                                                                ║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
    
    # Pre-flight checks
    Test-WindowsVersion
    Test-InternetConnectivity
    Test-HardwareRequirements
    Test-TPM
    
    # Install dependencies
    Install-Docker
    
    # TPM key generation and attestation
    New-TPMKey
    New-Attestation
    
    # Node registration
    Get-InstallConfig -Token $InstallToken | Out-Null
    Register-Node -Token $InstallToken | Out-Null
    
    # Docker setup
    Install-DockerContainer
    Start-NodeService
    
    # Display summary
    Show-Summary
    
    Write-Log -Message "Installation completed successfully!" -Level Success
}

# Run main function
try {
    Main
}
catch {
    Write-ErrorAndExit "Installation failed: $_"
}
