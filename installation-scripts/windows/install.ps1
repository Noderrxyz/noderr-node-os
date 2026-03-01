<#
.SYNOPSIS
    Noderr Node OS - Windows Installation Script

.DESCRIPTION
    One-command installation with TPM-based hardware attestation for Windows.
    Supports all node tiers: VALIDATOR, GUARDIAN, ORACLE.
    Oracle nodes require an NVIDIA GPU (RTX 3000+ recommended) and Docker Desktop
    with WSL2 backend. NVIDIA drivers v525+ are required for GPU passthrough.

.PARAMETER InstallToken
    The installation token provided by Noderr (from the operator dashboard).

.PARAMETER WalletAddress
    Your EVM-compatible wallet address for staking verification (optional).

.EXAMPLE
    # Run as Administrator in PowerShell:
    irm https://install.noderr.xyz/windows | iex  # (prompts for token)

    # Or with token directly:
    .\install.ps1 -InstallToken "ndr_install_abc123..." -WalletAddress "0xYourWallet"

.NOTES
    Version:  1.1.0
    Requires: Windows 10 21H2+ / Windows 11, Docker Desktop with WSL2, Administrator privileges
    Oracle:   NVIDIA GPU + drivers v525+ required for GPU acceleration
#>

#Requires -RunAsAdministrator
#Requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$InstallToken,

    [Parameter(Mandatory=$false)]
    [string]$WalletAddress = ""
)

# ============================================================================
# Constants and Configuration
# ============================================================================

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$Script:VERSION    = "1.1.0"
$Script:AUTH_API_URL = if ($env:AUTH_API_URL) { $env:AUTH_API_URL } else { "https://noderrauth-api-production-cca0.up.railway.app" }
$Script:R2_PUBLIC_URL = "https://pub-66ad852cb9e54582bd0af64bce8d0a04.r2.dev"
$Script:INSTALL_DIR  = "C:\Program Files\Noderr"
$Script:CONFIG_DIR   = "C:\ProgramData\Noderr"
$Script:LOG_FILE     = "$Script:CONFIG_DIR\install.log"

# Minimum baseline requirements (tier-specific requirements come from the API)
$Script:MIN_CPU_CORES = 4
$Script:MIN_RAM_GB    = 8
$Script:MIN_DISK_GB   = 80

# ============================================================================
# Logging Functions
# ============================================================================

function Write-Log {
    param(
        [Parameter(Mandatory=$true)]  [string]$Message,
        [Parameter(Mandatory=$false)] [ValidateSet('Info','Success','Warning','Error')] [string]$Level = 'Info'
    )
    $timestamp  = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $logMessage = "[$timestamp] [$Level] $Message"
    $logDir = Split-Path -Path $Script:LOG_FILE -Parent
    if (-not (Test-Path -Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    Add-Content -Path $Script:LOG_FILE -Value $logMessage
    switch ($Level) {
        'Info'    { Write-Host "[$timestamp] "      -NoNewline; Write-Host $Message -ForegroundColor Cyan }
        'Success' { Write-Host "[$timestamp] [OK] " -NoNewline -ForegroundColor Green;  Write-Host $Message -ForegroundColor Green }
        'Warning' { Write-Host "[$timestamp] [!!] " -NoNewline -ForegroundColor Yellow; Write-Host $Message -ForegroundColor Yellow }
        'Error'   { Write-Host "[$timestamp] [XX] " -NoNewline -ForegroundColor Red;    Write-Host $Message -ForegroundColor Red }
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
    Write-Log -Message "Checking Windows version..."
    $os      = Get-CimInstance -ClassName Win32_OperatingSystem
    $version = [System.Version]$os.Version
    # Windows 10 21H2 = build 19044; Windows 11 = 22000; Server 2019 = 17763
    if ($version.Major -lt 10 -or $version.Build -lt 17763) {
        Write-ErrorAndExit "Windows 10 21H2+ / Windows 11 / Server 2019+ required. Found: $($os.Caption) (Build $($version.Build))"
    }
    Write-Log -Message "Operating System: $($os.Caption) (Build $($version.Build))" -Level Success
}

function Test-InternetConnectivity {
    Write-Log -Message "Checking internet connectivity..."
    try {
        $null = Invoke-WebRequest -Uri "https://8.8.8.8" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    } catch {
        # Fallback: try DNS resolution
        try { $null = [System.Net.Dns]::GetHostAddresses("google.com") }
        catch { Write-ErrorAndExit "No internet connectivity. Please check your network connection." }
    }
    Write-Log -Message "Internet connectivity verified" -Level Success
}

function Test-HardwareBaseline {
    # Baseline check before we know the tier. Tier-specific checks run after fetching install config.
    Write-Log -Message "Validating baseline hardware requirements..."
    $cpuCores = (Get-CimInstance -ClassName Win32_Processor | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
    $ramGB    = [Math]::Round((Get-CimInstance -ClassName Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
    $diskGB   = [Math]::Round((Get-PSDrive -Name C).Free / 1GB)
    if ($cpuCores -lt $Script:MIN_CPU_CORES) { Write-ErrorAndExit "Insufficient CPU cores. Required: $Script:MIN_CPU_CORES, Found: $cpuCores" }
    if ($ramGB    -lt $Script:MIN_RAM_GB)    { Write-ErrorAndExit "Insufficient RAM. Required: ${Script:MIN_RAM_GB}GB, Found: ${ramGB}GB" }
    if ($diskGB   -lt $Script:MIN_DISK_GB)   { Write-ErrorAndExit "Insufficient disk space. Required: ${Script:MIN_DISK_GB}GB free, Found: ${diskGB}GB" }
    Write-Log -Message "CPU: $cpuCores cores | RAM: ${ramGB}GB | Disk: ${diskGB}GB free" -Level Success
}

function Test-HardwareForTier {
    param([PSObject]$InstallConfig)
    $tier = $InstallConfig.tier
    Write-Log -Message "Validating hardware requirements for $tier tier..."

    # Use API-provided requirements if present
    if ($InstallConfig.hardwareRequirements) {
        $reqCpu  = $InstallConfig.hardwareRequirements.minCpuCores
        $reqRam  = $InstallConfig.hardwareRequirements.minRamGb
        $reqDisk = $InstallConfig.hardwareRequirements.minDiskGb
    } else {
        # Fallback defaults
        switch ($tier) {
            "ORACLE"    { $reqCpu = 8;  $reqRam = 16; $reqDisk = 100 }
            "GUARDIAN"  { $reqCpu = 16; $reqRam = 32; $reqDisk = 200 }
            default     { $reqCpu = 4;  $reqRam = 8;  $reqDisk = 80  }
        }
    }

    $cpuCores = (Get-CimInstance -ClassName Win32_Processor | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
    $ramGB    = [Math]::Round((Get-CimInstance -ClassName Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
    $diskGB   = [Math]::Round((Get-PSDrive -Name C).Free / 1GB)
    $failed   = $false

    if ($cpuCores -lt $reqCpu)  { Write-Log -Message "Insufficient CPU for $($tier). Required: $($reqCpu) cores, Found: $($cpuCores)" -Level Error;   $failed = $true }
    else                        { Write-Log -Message "CPU: $($cpuCores) cores ($($tier) minimum: $($reqCpu))" -Level Success }
    if ($ramGB -lt $reqRam)     { Write-Log -Message "Insufficient RAM for $($tier). Required: $($reqRam)GB, Found: $($ramGB)GB" -Level Error;     $failed = $true }
    else                        { Write-Log -Message "RAM: $($ramGB)GB ($($tier) minimum: $($reqRam)GB)" -Level Success }
    if ($diskGB -lt $reqDisk)   { Write-Log -Message "Insufficient disk for $($tier). Required: $($reqDisk)GB free, Found: $($diskGB)GB" -Level Error; $failed = $true }
    else                        { Write-Log -Message "Disk: $($diskGB)GB free ($($tier) minimum: $($reqDisk)GB)" -Level Success }

    if ($failed) { Write-ErrorAndExit "Hardware requirements not met for $tier node. See above for details." }
}

function Test-TPM {
    Write-Log -Message "Checking for TPM 2.0..."
    try {
        $tpm = Get-Tpm -ErrorAction Stop
        if (-not $tpm.TpmPresent) {
            Write-Log -Message "TPM not present. Proceeding with software-based attestation." -Level Warning
            return $false
        }
        if (-not $tpm.TpmReady) {
            Write-Log -Message "TPM present but not ready. Proceeding with software-based attestation." -Level Warning
            return $false
        }
        Write-Log -Message "TPM 2.0 detected and ready" -Level Success
        return $true
    } catch {
        Write-Log -Message "TPM check failed ($($_)). Proceeding with software-based attestation." -Level Warning
        return $false
    }
}

function Test-DockerRunning {
    try {
        $null = docker info 2>&1
        if ($LASTEXITCODE -ne 0) { return $false }
        return $true
    } catch { return $false }
}

function Test-NvidiaGpu {
    <#
    .SYNOPSIS
        Detects NVIDIA GPU and returns hardware info.
        Returns $null if no NVIDIA GPU is found.
    #>
    try {
        $gpus = Get-CimInstance -ClassName Win32_VideoController | Where-Object { $_.Name -like "*NVIDIA*" }
        if (-not $gpus) { return $null }
        $gpu = $gpus | Select-Object -First 1
        # Build a stable hardware ID from the PNP device ID (hardware-level identifier)
        $rawId = $gpu.PNPDeviceID
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($rawId)
        $sha   = [System.Security.Cryptography.SHA256]::Create()
        $hash  = $sha.ComputeHash($bytes)
        $gpuId = "GPU-" + ([System.BitConverter]::ToString($hash) -replace "-","").Substring(0,32).ToLower()
        return @{
            Name     = $gpu.Name
            HardwareId = $gpuId
            PnpId    = $rawId
        }
    } catch { return $null }
}

function Test-NvidiaDriverVersion {
    <#
    .SYNOPSIS
        Checks if NVIDIA driver version is >= 525 (required for WSL2 GPU passthrough).
    #>
    try {
        $gpu = Get-CimInstance -ClassName Win32_VideoController | Where-Object { $_.Name -like "*NVIDIA*" } | Select-Object -First 1
        if (-not $gpu) { return $false }
        # DriverVersion is in format "31.0.15.xxxx" on Windows; last segment maps to NVIDIA driver
        $driverParts = $gpu.DriverVersion -split "\."
        # NVIDIA driver 525.xx maps to Windows driver version 31.0.15.2500 (last 4 digits / 10)
        if ($driverParts.Count -ge 4) {
            $nvidiaVersion = [int]($driverParts[-1]) / 10
            if ($nvidiaVersion -ge 525) {
                Write-Log -Message "NVIDIA driver version: $([int]$nvidiaVersion) (>= 525 required)" -Level Success
                return $true
            } else {
                Write-Log -Message "NVIDIA driver version $([int]$nvidiaVersion) is too old. Version 525+ required for GPU passthrough." -Level Warning
                Write-Log -Message "Download latest drivers from: https://www.nvidia.com/drivers" -Level Warning
                return $false
            }
        }
        return $false
    } catch { return $false }
}

# ============================================================================
# Installation Functions
# ============================================================================

function Install-Docker {
    if (Test-DockerRunning) {
        $dockerVersion = docker --version
        Write-Log -Message "Docker already installed and running: $dockerVersion" -Level Success
        return
    }

    # Docker is installed but not running (e.g., Docker Desktop not started)
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        Write-ErrorAndExit "Docker is installed but not running. Please start Docker Desktop and re-run this script."
    }

    Write-Log -Message "Docker Desktop not found. Installing Docker Desktop..."
    try {
        $dockerUrl       = "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe"
        $installerPath   = "$env:TEMP\DockerDesktopInstaller.exe"
        Write-Log -Message "Downloading Docker Desktop installer (~600MB)..."
        Invoke-WebRequest -Uri $dockerUrl -OutFile $installerPath -UseBasicParsing
        Write-Log -Message "Installing Docker Desktop (this may take several minutes)..."
        Start-Process -FilePath $installerPath -ArgumentList "install", "--quiet", "--accept-license" -Wait -NoNewWindow
        Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue

        Write-Log -Message "Docker Desktop installed." -Level Success

        # P1-2: Configure Docker Desktop to start on Windows login
        Write-Log -Message "Configuring Docker Desktop to start automatically on login..."
        try {
            $dockerDesktopPath = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
            if (-not (Test-Path $dockerDesktopPath)) {
                $dockerDesktopPath = "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe"
            }
            if (Test-Path $dockerDesktopPath) {
                # Create a startup registry entry for Docker Desktop
                $regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
                Set-ItemProperty -Path $regPath -Name "Docker Desktop" -Value "`"$dockerDesktopPath`"" -ErrorAction Stop
                Write-Log -Message "Docker Desktop configured to start on login." -Level Success
            } else {
                Write-Log -Message "Could not locate Docker Desktop executable for auto-start. Please enable 'Start Docker Desktop when you sign in' manually in Docker Desktop Settings." -Level Warning
            }
        } catch {
            Write-Log -Message "Could not configure Docker Desktop auto-start: $_. Please enable it manually in Docker Desktop Settings > General." -Level Warning
        }

        Write-Log -Message "IMPORTANT: You must restart your computer and re-run this script to continue." -Level Warning
        Write-Host ""
        Write-Host "  After restarting, open Docker Desktop, complete setup, then re-run:" -ForegroundColor Yellow
        Write-Host "  .\install.ps1 -InstallToken `"$InstallToken`"" -ForegroundColor Cyan
        Write-Host ""
        exit 0
    } catch {
        Write-ErrorAndExit "Docker Desktop installation failed: $_. Please install Docker Desktop manually from https://docs.docker.com/desktop/install/windows-install/"
    }
}

# ============================================================================
# Key Generation and Attestation
# ============================================================================

function New-SoftwareKey {
    Write-Log -Message "Generating software-based cryptographic key..."
    if (-not (Test-Path -Path $Script:CONFIG_DIR)) { New-Item -ItemType Directory -Path $Script:CONFIG_DIR -Force | Out-Null }
    try {
        # Reuse existing key if present (avoids re-registration on retry after partial failure)
        if ((Test-Path "$Script:CONFIG_DIR\private_key.xml") -and (Test-Path "$Script:CONFIG_DIR\public_key.pem")) {
            $existingHash = Get-Content "$Script:CONFIG_DIR\public_key_hash.txt" -Raw -ErrorAction SilentlyContinue
            if ($existingHash) {
                Write-Log -Message "Reusing existing key (fingerprint: $($existingHash.Substring(0,16))...)" -Level Success
                return
            }
        }
        # Use RSA 2048 for compatibility with Windows PowerShell 5.1 (.NET Framework 4.x)
        # ECDsa.Create(ECCurve) and Export*() methods require .NET Core 3+ / .NET 5+
        $rsa = [System.Security.Cryptography.RSACryptoServiceProvider]::new(2048)

        # Export public key as XML (used for signing/verification internally)
        $pubKeyXml = $rsa.ToXmlString($false)  # $false = public key only
        Set-Content -Path "$Script:CONFIG_DIR\public_key.xml" -Value $pubKeyXml -NoNewline

        # Export private key as XML for signing
        $privKeyXml = $rsa.ToXmlString($true)   # $true = include private key
        Set-Content -Path "$Script:CONFIG_DIR\private_key.xml" -Value $privKeyXml -NoNewline

        # Export public key as PEM (required by auth API: -----BEGIN PUBLIC KEY-----)
        # Build SubjectPublicKeyInfo DER encoding manually (.NET Framework 4.x compatible)
        # Note: inline (if ...) inside @() array concat does not work in PS 5.1 - use separate variables
        $params   = $rsa.ExportParameters($false)
        $modBytes = [byte[]]$params.Modulus
        $expBytes = [byte[]]$params.Exponent

        # Prepend 0x00 to modulus if high bit is set (DER positive integer encoding)
        if ($modBytes[0] -band 0x80) { $modBytes = ([byte[]]@(0x00)) + $modBytes }

        # Encode INTEGER for modulus (RSA-2048 modulus is always 256 bytes, needs 2-byte DER length)
        $modLen  = $modBytes.Length
        # Use 2-byte length: 0x82 <hi> <lo> for lengths > 127
        $modDer  = ([byte[]]@(0x02, 0x82, [byte]($modLen -shr 8), [byte]($modLen -band 0xFF))) + $modBytes

        # Encode INTEGER for exponent (always 3 bytes: 0x01 0x00 0x01)
        $expLen  = $expBytes.Length
        $expDer  = ([byte[]]@(0x02, [byte]$expLen)) + $expBytes

        # Encode SEQUENCE (RSAPublicKey) - length > 127, use 2-byte encoding
        $rsaSeq    = $modDer + $expDer
        $rsaSeqLen = $rsaSeq.Length
        $rsaSeqDer = ([byte[]]@(0x30, 0x82, [byte]($rsaSeqLen -shr 8), [byte]($rsaSeqLen -band 0xFF))) + $rsaSeq

        # SubjectPublicKeyInfo: SEQUENCE { AlgorithmIdentifier, BIT STRING }
        # AlgorithmIdentifier for rsaEncryption OID 1.2.840.113549.1.1.1
        $algId   = [byte[]]@(0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00)
        # BIT STRING wrapping RSAPublicKey: 03 82 <hi> <lo> 00 <rsaSeqDer>
        $bitLen  = $rsaSeqDer.Length + 1
        $bitStr  = ([byte[]]@(0x03, 0x82, [byte]($bitLen -shr 8), [byte]($bitLen -band 0xFF), 0x00)) + $rsaSeqDer
        # Outer SEQUENCE (SubjectPublicKeyInfo) - always ~294 bytes for RSA-2048
        $spki    = $algId + $bitStr
        $spkiLen = $spki.Length
        $spkiDer = ([byte[]]@(0x30, 0x82, [byte]($spkiLen -shr 8), [byte]($spkiLen -band 0xFF))) + $spki

        $pemB64  = [System.Convert]::ToBase64String([byte[]]$spkiDer)
        # Wrap at 64 chars per line
        $pemLines = for ($i = 0; $i -lt $pemB64.Length; $i += 64) {
            $pemB64.Substring($i, [Math]::Min(64, $pemB64.Length - $i))
        }
        $pemContent = "-----BEGIN PUBLIC KEY-----`r`n" + ($pemLines -join "`r`n") + "`r`n-----END PUBLIC KEY-----"
        Set-Content -Path "$Script:CONFIG_DIR\public_key.pem" -Value $pemContent -NoNewline

        # Fingerprint: SHA256 of PEM content
        $pubKeyBytes  = [System.Text.Encoding]::UTF8.GetBytes($pemContent)
        $sha          = [System.Security.Cryptography.SHA256]::Create()
        $hashBytes    = $sha.ComputeHash($pubKeyBytes)
        $pubKeyHash   = [System.BitConverter]::ToString($hashBytes) -replace "-",""
        Set-Content -Path "$Script:CONFIG_DIR\public_key_hash.txt" -Value $pubKeyHash.ToLower() -NoNewline

        Write-Log -Message "Software key generated (RSA-2048, fingerprint: $($pubKeyHash.Substring(0,16).ToLower())...)" -Level Success
    } catch {
        Write-ErrorAndExit "Key generation failed: $_"
    }
}

function New-SoftwareAttestation {
    Write-Log -Message "Creating software attestation..."
    try {
        # Generate random challenge using .NET Framework 4.x compatible API
        $rng           = [System.Security.Cryptography.RNGCryptoServiceProvider]::new()
        $challengeRaw  = New-Object byte[] 32
        $rng.GetBytes($challengeRaw)
        $challenge     = [System.Convert]::ToBase64String($challengeRaw)
        Set-Content -Path "$Script:CONFIG_DIR\challenge.txt" -Value $challenge -NoNewline

        # Sign challenge with RSA private key (PS 5.1 / .NET Framework 4.x compatible)
        $privKeyXml    = Get-Content -Path "$Script:CONFIG_DIR\private_key.xml" -Raw
        $rsa           = [System.Security.Cryptography.RSACryptoServiceProvider]::new()
        $rsa.FromXmlString($privKeyXml)

        # API verifies: createVerify('SHA256').update(rawQuoteBytes).verify(pubKey, sig)
        # So we must sign the raw challenge bytes (not the base64 string's UTF-8 bytes)
        $sha256         = [System.Security.Cryptography.SHA256]::Create()
        $hashBytes      = $sha256.ComputeHash($challengeRaw)
        $signature      = $rsa.SignHash($hashBytes, [System.Security.Cryptography.CryptoConfig]::MapNameToOID("SHA256"))
        $signatureB64   = [System.Convert]::ToBase64String($signature)
        Set-Content -Path "$Script:CONFIG_DIR\signature.txt" -Value $signatureB64 -NoNewline

        $pcrValues = @{ "0" = ("0" * 64); "7" = ("0" * 64) } | ConvertTo-Json -Compress
        Set-Content -Path "$Script:CONFIG_DIR\pcr_values.json" -Value $pcrValues -NoNewline

        Write-Log -Message "Software attestation created" -Level Success
    } catch {
        Write-ErrorAndExit "Attestation creation failed: $_"
    }
}

# ============================================================================
# Node Registration
# ============================================================================

function Invoke-ApiPost {
    param([string]$Url, [string]$JsonBody)
    # Use curl.exe (bypasses WinHTTP/proxy issues that cause Invoke-RestMethod and WebClient to hang)
    $tmpBody = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllText($tmpBody, $JsonBody, [System.Text.Encoding]::UTF8)
    try {
        $result = & "$env:SystemRoot\System32\curl.exe" `
            --silent --show-error --max-time 30 `
            -X POST $Url `
            -H "Content-Type: application/json" `
            -H "User-Agent: Noderr-Installer/1.1.0" `
            --data-binary "@$tmpBody" `
            --write-out "`n__HTTP_STATUS__%{http_code}" 2>&1
        $lines      = $result -split "`n"
        $statusLine = $lines | Where-Object { $_ -match '^__HTTP_STATUS__' } | Select-Object -Last 1
        $body       = ($lines | Where-Object { $_ -notmatch '^__HTTP_STATUS__' }) -join "`n"
        $statusCode = [int]($statusLine -replace '__HTTP_STATUS__', '')
        if ($statusCode -ge 400) {
            throw "HTTP $statusCode from $Url`: $body"
        }
        return $body
    } finally {
        Remove-Item -Path $tmpBody -Force -ErrorAction SilentlyContinue
    }
}

function Get-InstallConfig {
    param([string]$Token)
    # Reuse cached config on retry (avoids hitting the token-used check again)
    $configCache = "$Script:CONFIG_DIR\install_config.json"
    if (Test-Path $configCache) {
        try {
            $cached = Get-Content $configCache -Raw | ConvertFrom-Json
            if ($cached.tier) {
                Write-Log -Message "Install config loaded from cache (tier: $($cached.tier))" -Level Success
                return $cached
            }
        } catch { <# corrupt cache - re-fetch #> }
    }
    Write-Log -Message "Fetching installation configuration..."
    try {
        $body     = "{`"installToken`":`"$Token`"}"
        $rawJson  = Invoke-ApiPost -Url "$Script:AUTH_API_URL/api/v1/install/config" -JsonBody $body
        $response = $rawJson | ConvertFrom-Json
        if ($response.error) { Write-ErrorAndExit "API error: $($response.message)" }
        $rawJson | Set-Content -Path $configCache -NoNewline
        Write-Log -Message "Install config received (tier: $($response.tier))" -Level Success
        return $response
    } catch {
        Write-ErrorAndExit "Failed to fetch installation configuration: $_"
    }
}

function Register-Node {
    param([string]$Token, [PSObject]$InstallConfig, [string]$WalletAddress)
    Write-Log -Message "Registering node..."
    # Skip re-registration if credentials already exist (idempotent on retry)
    $credPath = "$Script:CONFIG_DIR\credentials.json"
    if (Test-Path $credPath) {
        try {
            $existing = Get-Content $credPath -Raw | ConvertFrom-Json
            if ($existing.nodeId -and $existing.apiKey) {
                Write-Log -Message "Node already registered (ID: $($existing.nodeId)) - reusing credentials" -Level Success
                return $existing
            }
        } catch { <# corrupt file - re-register #> }
    }
    try {
        $publicKey  = Get-Content -Path "$Script:CONFIG_DIR\public_key.pem" -Raw
        $challenge  = Get-Content -Path "$Script:CONFIG_DIR\challenge.txt"  -Raw
        $signature  = Get-Content -Path "$Script:CONFIG_DIR\signature.txt"  -Raw
        $pcrValues  = Get-Content -Path "$Script:CONFIG_DIR\pcr_values.json" -Raw | ConvertFrom-Json

        $cpuCores   = (Get-CimInstance -ClassName Win32_Processor | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
        $memoryGB   = [Math]::Round((Get-CimInstance -ClassName Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
        $diskGB     = [Math]::Round((Get-PSDrive -Name C).Free / 1GB)
        $osVersion  = (Get-CimInstance -ClassName Win32_OperatingSystem).Version

        $systemInfo = @{
            hostname    = $env:COMPUTERNAME
            cpuCores    = $cpuCores
            memoryGB    = $memoryGB
            diskGB      = $diskGB
            osVersion   = $osVersion
        }

        # Detect GPU for Oracle tier
        if ($InstallConfig.tier -eq "ORACLE") {
            $gpuInfo = Test-NvidiaGpu
            if ($gpuInfo) {
                Write-Log -Message "GPU detected: $($gpuInfo.Name) (ID: $($gpuInfo.HardwareId))" -Level Success
                $systemInfo.gpuHardwareId = $gpuInfo.HardwareId
                $systemInfo.gpuName       = $gpuInfo.Name
            } else {
                Write-Log -Message "No NVIDIA GPU detected. Oracle ML inference will run in CPU mode." -Level Warning
            }
        }

        # Build JSON body as raw string to avoid PS 5.1 ConvertTo-Json hang on PSCustomObject
        $timestamp    = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        $pubKeyEsc    = $publicKey.Replace('\', '\\').Replace('"', '\"').Replace("`r", '\r').Replace("`n", '\n')
        $challengeEsc = $challenge.Trim().Replace('"', '\"')
        $signatureEsc = $signature.Trim().Replace('"', '\"')
        $hostnameEsc  = $env:COMPUTERNAME.Replace('"', '\"')
        $osVersionEsc = $osVersion.Replace('"', '\"')
        $tierEsc      = ([string]$InstallConfig.tier).ToLower().Replace('"', '\"')
        $walletEsc    = $WalletAddress.Replace('"', '\"')
        $tokenEsc     = $Token.Replace('"', '\"')

        # Build systemInfo JSON fragment
        $sysInfoJson = "{`"hostname`":`"$hostnameEsc`",`"cpuCores`":$cpuCores,`"memoryGB`":$memoryGB,`"diskGB`":$diskGB,`"osVersion`":`"$osVersionEsc`""
        if ($systemInfo.gpuHardwareId) {
            $gpuIdEsc   = $systemInfo.gpuHardwareId.Replace('"', '\"')
            $gpuNameEsc = $systemInfo.gpuName.Replace('"', '\"')
            $sysInfoJson += ",`"gpuHardwareId`":`"$gpuIdEsc`",`"gpuName`":`"$gpuNameEsc`""
        }
        $sysInfoJson += "}"

        $body = "{`"installToken`":`"$tokenEsc`",`"publicKey`":`"$pubKeyEsc`",`"attestation`":{`"quote`":`"$challengeEsc`",`"signature`":`"$signatureEsc`",`"pcrValues`":{`"0`":`"$('0' * 64)`",`"7`":`"$('0' * 64)`"},`"timestamp`":`"$timestamp`"},`"systemInfo`":$sysInfoJson,`"walletAddress`":`"$walletEsc`",`"nodeTier`":`"$tierEsc`"}"

        Write-Log -Message "Sending registration request to $Script:AUTH_API_URL..."
        $rawJson  = Invoke-ApiPost -Url "$Script:AUTH_API_URL/api/v1/auth/register" -JsonBody $body
        $response = $rawJson | ConvertFrom-Json
        if ($response.error) { Write-ErrorAndExit "Registration API error: $($response.message)" }

        $credPath = "$Script:CONFIG_DIR\credentials.json"
        $response | ConvertTo-Json | Set-Content -Path $credPath -NoNewline

        # Restrict file permissions to current user only
        try {
            $acl  = Get-Acl -Path $credPath
            $acl.SetAccessRuleProtection($true, $false)
            $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
                [System.Security.Principal.WindowsIdentity]::GetCurrent().Name, "FullControl", "Allow"
            )
            $acl.SetAccessRule($rule)
            Set-Acl -Path $credPath -AclObject $acl
        } catch {
            Write-Log -Message "Could not restrict credentials.json permissions: $_" -Level Warning
        }

        Write-Log -Message "Node registered: $($response.nodeId)" -Level Success
        return $response
    } catch {
        Write-ErrorAndExit "Node registration failed: $_"
    }
}

# ============================================================================
# Docker Image Download and Container Setup
# ============================================================================

function Get-DockerImageFromR2 {
    param([string]$Tier, [string]$ImageName, [string]$R2Path)
    # Skip download if image already exists in Docker (idempotent on retry)
    $existing = docker images --format "{{.Repository}}:{{.Tag}}" 2>$null | Where-Object { $_ -eq $ImageName }
    if ($existing) {
        Write-Log -Message "$ImageName already loaded in Docker - skipping download" -Level Success
        return
    }
    $tmpPath = "$env:TEMP\noderr-$($Tier.ToLower())-image.tar.gz"
    $url     = "$Script:R2_PUBLIC_URL/$R2Path"
    Write-Log -Message "Downloading $ImageName from R2 (this may take several minutes for large images)..."
    Write-Log -Message "  URL: $url"
    Write-Log -Message "  Saving to: $tmpPath"
    # Retry loop with exponential backoff (P2-2)
    $maxAttempts = 3
    $downloaded  = $false
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        try {
            Write-Log -Message "Download attempt ${attempt}/${maxAttempts}..."
            & "$env:SystemRoot\System32\curl.exe" --location --progress-bar --max-time 3600 `
                --retry 3 --retry-delay 5 `
                -H "User-Agent: Noderr-Installer/1.1.0" `
                -o $tmpPath $url
            if ($LASTEXITCODE -eq 0) {
                $downloaded = $true
                break
            }
        } catch {
            Write-Log -Message "Download attempt ${attempt} failed: $_" -Level Warning
        }
        if ($attempt -lt $maxAttempts) {
            $backoff = [Math]::Pow(2, $attempt) * 5
            Write-Log -Message "Retrying in ${backoff}s..." -Level Warning
            Start-Sleep -Seconds $backoff
        }
    }
    if (-not $downloaded) {
        Write-ErrorAndExit "Failed to download $ImageName from R2 after $maxAttempts attempts"
    }

    # Verify SHA256 checksum if available (P1-3)
    $checksumUrl  = "${url}.sha256"
    $checksumPath = "${tmpPath}.sha256"
    try {
        & "$env:SystemRoot\System32\curl.exe" --location --silent --fail `
            -o $checksumPath $checksumUrl 2>$null
        if ($LASTEXITCODE -eq 0 -and (Test-Path $checksumPath)) {
            Write-Log -Message "Verifying image checksum..."
            $expectedHash = (Get-Content $checksumPath -Raw).Trim().Split(' ')[0]
            $actualHash   = (Get-FileHash -Path $tmpPath -Algorithm SHA256).Hash.ToLower()
            if ($expectedHash -ne $actualHash) {
                Remove-Item -Path $tmpPath, $checksumPath -Force -ErrorAction SilentlyContinue
                Write-ErrorAndExit "Image checksum verification failed! Expected: $expectedHash, Got: $actualHash"
            }
            Write-Log -Message "Image checksum verified" -Level Success
            Remove-Item -Path $checksumPath -Force -ErrorAction SilentlyContinue
        } else {
            Write-Log -Message "No checksum file available at $checksumUrl - skipping verification" -Level Warning
        }
    } catch {
        Write-Log -Message "Checksum verification skipped: $_" -Level Warning
    }

    try {
        $sizeMB = [Math]::Round((Get-Item $tmpPath).Length / 1MB)
        Write-Log -Message "Download complete ($($sizeMB)MB). Loading $ImageName into Docker..." -Level Success
        $result = docker load -i $tmpPath 2>&1
        if ($LASTEXITCODE -ne 0) { Write-ErrorAndExit "Failed to load Docker image: $result" }
        Remove-Item -Path $tmpPath -Force -ErrorAction SilentlyContinue
        Write-Log -Message "$ImageName loaded successfully" -Level Success
    } catch {
        Write-ErrorAndExit "Failed to load $ImageName into Docker: $_"
    }
}

function Install-DockerContainer {
    param([PSObject]$InstallConfig, [PSObject]$Credentials, [hashtable]$Wallet)
    Write-Log -Message "Setting up Docker container(s)..."

    $tier     = $InstallConfig.tier
    $nodeId   = $Credentials.nodeId
    $apiKey   = $Credentials.apiKey
    $jwtToken = $Credentials.jwtToken

    # Download the main node image from R2
    switch ($tier) {
        "ORACLE"   { Get-DockerImageFromR2 -Tier $tier -ImageName "noderr-oracle:latest"    -R2Path "oracle/oracle-latest.tar.gz" }
        "GUARDIAN" { Get-DockerImageFromR2 -Tier $tier -ImageName "noderr-guardian:latest"  -R2Path "guardian/guardian-latest.tar.gz" }
        "VALIDATOR"{ Get-DockerImageFromR2 -Tier $tier -ImageName "noderr-validator:latest" -R2Path "validator/validator-latest.tar.gz" }
        default    { Write-ErrorAndExit "Unknown tier: $tier" }
    }

    # For Oracle: also download the ML service image
    if ($tier -eq "ORACLE") {
        Write-Log -Message "Downloading ML service image (this is large - please wait)..."
        Get-DockerImageFromR2 -Tier "ml-service" -ImageName "noderr-ml-service:latest" -R2Path "ml-service/ml-service-latest.tar.gz"
    }

    # Create Docker network (idempotent - skip if already exists)
    $netExists = docker network ls --filter "name=noderr-network" --format "{{.Name}}" 2>$null | Where-Object { $_ -eq "noderr-network" }
    if (-not $netExists) {
        docker network create noderr-network 2>&1 | Out-Null
        Write-Log -Message "Docker network noderr-network created" -Level Success
    } else {
        Write-Log -Message "Docker network noderr-network already exists - reusing" -Level Success
    }

    # Build node.env content
    $nodeVersion = if ($InstallConfig.config.latestVersion) { $InstallConfig.config.latestVersion } else { "1.0.0" }
    $envLines = @(
        "NODE_ID=$nodeId",
        "NODE_TIER=$tier",
        "NODE_VERSION=$nodeVersion",
        "API_KEY=$apiKey",
        "JWT_TOKEN=$jwtToken",
        "CREDENTIALS_PATH=/app/config/credentials.json",
        "DEPLOYMENT_ENGINE_URL=$($InstallConfig.config.deploymentEngineUrl)",
        "AUTH_API_URL=$($InstallConfig.config.authApiUrl)",
        "TELEMETRY_ENDPOINT=$($InstallConfig.config.telemetryEndpoint)",
        "",
        "# P2P Network Configuration",
        "BOOTSTRAP_NODES=$($InstallConfig.config.bootstrapNodes)",
        "P2P_LISTEN_PORT=4001",
        "P2P_WS_PORT=4002",
        "",
        "# Trading Safety Defaults (testnet)",
        "SIMULATION_MODE=true",
        "PAPER_TRADING=true",
        "",
        "# Auto-Updater Configuration",
        "VERSION_BEACON_ADDRESS=0xA5Be5522bb3C748ea262a2A7d877d00AE387FDa6",
        "RPC_ENDPOINT=https://sepolia.base.org",
        "DOCKER_REGISTRY=$($InstallConfig.config.dockerRegistry)",
        "DOCKER_IMAGE_PREFIX=noderr-node-os",
        "HEALTH_CHECK_URL=http://localhost:8080/health",
        "BACKUP_DIRECTORY=/app/backups",
        "CHECK_INTERVAL=300000",
        "AUTO_UPDATE_ENABLED=true",
        "CURRENT_VERSION=$nodeVersion",
        "",
        "# Node Wallet (Hot Wallet) - auto-generated unique key for this node",
        "PRIVATE_KEY=$($Wallet.PrivateKey)"
    )

    if ($tier -eq "ORACLE") {
        $oracleVerifier = if ($InstallConfig.config.oracleVerifierAddress) { $InstallConfig.config.oracleVerifierAddress } else { "" }
        $rpcUrl         = if ($InstallConfig.config.rpcUrl)                { $InstallConfig.config.rpcUrl }                else { "https://sepolia.base.org" }
        $envLines += @(
            "",
            "# Oracle Consensus (Oracle tier only)",
            "ORACLE_VERIFIER_ADDRESS=$oracleVerifier",
            "RPC_URL=$rpcUrl",
            "ORACLE_PRIVATE_KEY=$($Wallet.PrivateKey)",
            "",
            "# ML Service connection (Docker network hostname - do not change)",
            "ML_SERVICE_HOST=ml-service",
            "ML_SERVICE_PORT=50051"
        )
    }

    $envContent = $envLines -join "`n"
    Set-Content -Path "$Script:CONFIG_DIR\node.env" -Value $envContent -NoNewline

    # For Oracle: write docker-compose.yml
    if ($tier -eq "ORACLE") {
        $gpuInfo       = Test-NvidiaGpu
        $driverOk      = Test-NvidiaDriverVersion
        $gpuDeployYaml = ""

        if ($gpuInfo -and $driverOk) {
            Write-Log -Message "NVIDIA GPU ($($gpuInfo.Name)) detected with compatible drivers - GPU passthrough enabled" -Level Success
            $gpuDeployYaml = @"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
"@
        } else {
            Write-Log -Message "GPU passthrough not available - ML service will run in CPU mode" -Level Warning
            if ($gpuInfo -and -not $driverOk) {
                Write-Log -Message "Update NVIDIA drivers to v525+ from https://www.nvidia.com/drivers to enable GPU acceleration" -Level Warning
            }
        }

        $configDir = $Script:CONFIG_DIR
        $composeContent = @"
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
$gpuDeployYaml
  oracle:
    image: noderr-oracle:latest
    container_name: noderr-node
    restart: unless-stopped
    env_file:
      - $configDir\node.env
    ports:
      - "4001:4001/tcp"
      - "4002:4002/tcp"
    volumes:
      - $configDir\credentials.json:/app/config/credentials.json:rw
      - //var/run/docker.sock:/var/run/docker.sock:ro
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
"@
        Set-Content -Path "$Script:CONFIG_DIR\docker-compose.yml" -Value $composeContent -NoNewline
        Write-Log -Message "docker-compose.yml written to $Script:CONFIG_DIR" -Level Success
    }

    Write-Log -Message "Docker container(s) configured" -Level Success
}

# ============================================================================
# Private Key Configuration
# ============================================================================

function New-NodeWallet {
    <#
    .SYNOPSIS
        Generates a unique Ethereum private key for this node using
        cryptographically secure random bytes. The corresponding wallet
        address is derived on first boot inside the container where
        ethers.js is available.
    #>
    Write-Log -Message "Generating unique node wallet (hot wallet)..."

    # 32 cryptographically secure random bytes -> private key
    $rng   = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $privateKeyHex = "0x" + [System.BitConverter]::ToString($bytes).Replace("-", "").ToLower()

    Write-Log -Message "Node wallet generated successfully" -Level Success
    Write-Log -Message "  Private Key: $($privateKeyHex.Substring(0,10))...(stored in node.env - keep secure!)" -Level Info
    Write-Log -Message "  The wallet address will be derived and displayed on first boot." -Level Info
    Write-Log -Message "  You will need to fund it with testnet ETH for gas fees." -Level Warning

    return @{
        PrivateKey = $privateKeyHex
    }
}

# ============================================================================
# Start Node
# ============================================================================

function Start-NodeService {
    param([string]$Tier)
    Write-Log -Message "Starting Noderr Node OS..."

    if ($Tier -eq "ORACLE") {
        # Stop and remove any existing containers before starting fresh
        # Wrap in try/catch to completely suppress all output and warnings from docker compose down
        try {
            $null = & docker compose -f "$Script:CONFIG_DIR\docker-compose.yml" down --timeout 30 2>&1
        } catch { <# ignore - containers may not exist yet #> }
        # Use docker compose for Oracle (two containers)
        # Capture exit code separately - do NOT use 2>&1 as it mixes status messages into error detection
        $upOutput = & docker compose -f "$Script:CONFIG_DIR\docker-compose.yml" up -d 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            # Only fail on actual errors, not informational status messages
            $actualErrors = $upOutput | Where-Object { $_ -match 'Error response|cannot|failed to|no such' }
            if ($actualErrors) {
                Write-ErrorAndExit "Failed to start Oracle node: $($actualErrors -join ' ')"
            }
        }
        Start-Sleep -Seconds 10
        $oracleStatus = docker ps --filter "name=noderr-node" --format "{{.Status}}"
        if (-not $oracleStatus) {
            Write-ErrorAndExit "Oracle container failed to start. Check logs: docker logs noderr-node"
        }
        Write-Log -Message "Oracle node started. ML service is loading models (~60-90s)..." -Level Success
        Write-Log -Message "Check ML service: docker logs noderr-ml-service -f" -Level Info
    } else {
        # Single container for Validator and Guardian
        docker stop noderr-node 2>$null
        docker rm   noderr-node 2>$null

        $dockerImage = switch ($Tier) {
            "GUARDIAN"  { "noderr-guardian:latest" }
            "VALIDATOR" { "noderr-validator:latest" }
            default     { Write-ErrorAndExit "Unknown tier: $Tier" }
        }

        docker run -d `
            --name noderr-node `
            --network noderr-network `
            --env-file "$Script:CONFIG_DIR\node.env" `
            --publish 4001:4001/tcp `
            --publish 4002:4002/tcp `
            --volume "$Script:CONFIG_DIR\credentials.json:/app/config/credentials.json:rw" `
            --volume //var/run/docker.sock:/var/run/docker.sock:ro `
            --log-driver json-file `
            --log-opt max-size=50m `
            --log-opt max-file=5 `
            --restart unless-stopped `
            $dockerImage

        Start-Sleep -Seconds 5
        $status = docker ps --filter "name=noderr-node" --format "{{.Status}}"
        if (-not $status) {
            Write-ErrorAndExit "Node failed to start. Check logs: docker logs noderr-node"
        }
        Write-Log -Message "Node started successfully" -Level Success
    }
}

# ============================================================================
# Post-Installation Summary
# ============================================================================

function Show-Summary {
    param([string]$Tier)
    $credentials = Get-Content -Path "$Script:CONFIG_DIR\credentials.json" -Raw | ConvertFrom-Json
    $nodeId      = $credentials.nodeId

    Write-Host ""
    Write-Host "╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║                                                                ║" -ForegroundColor Green
    Write-Host "║          Noderr Node OS Installation Complete!              ║" -ForegroundColor Green
    Write-Host "║                                                                ║" -ForegroundColor Green
    Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Node ID: $nodeId" -ForegroundColor Cyan
    Write-Host "  Tier:    $Tier"   -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Status:  Running" -ForegroundColor Green

    if ($Tier -eq "ORACLE") {
        Write-Host ""
        Write-Host "  Oracle Node Commands:" -ForegroundColor White
        Write-Host "    Logs (oracle):      docker logs noderr-node -f"         -ForegroundColor White
        Write-Host "    Logs (ml-service):  docker logs noderr-ml-service -f"   -ForegroundColor White
        Write-Host "    Stop:               docker compose -f `"$Script:CONFIG_DIR\docker-compose.yml`" down" -ForegroundColor White
        Write-Host "    Start:              docker compose -f `"$Script:CONFIG_DIR\docker-compose.yml`" up -d" -ForegroundColor White
        Write-Host "    Restart:            docker compose -f `"$Script:CONFIG_DIR\docker-compose.yml`" restart" -ForegroundColor White
        Write-Host ""
        Write-Host "  Note: The ML service takes 60-90s to load models on first start." -ForegroundColor Yellow
    } else {
        Write-Host "  Logs:    docker logs noderr-node -f"    -ForegroundColor White
        Write-Host "  Stop:    docker stop noderr-node"       -ForegroundColor White
        Write-Host "  Start:   docker start noderr-node"      -ForegroundColor White
        Write-Host "  Restart: docker restart noderr-node"    -ForegroundColor White
    }

    Write-Host ""
    Write-Host "  Configuration: $Script:CONFIG_DIR"                                     -ForegroundColor White
    Write-Host "  Credentials:   $Script:CONFIG_DIR\credentials.json (keep secure!)"     -ForegroundColor Yellow
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
    Write-Host "║              Noderr Node OS Installer v$($Script:VERSION)             ║" -ForegroundColor Cyan
    Write-Host "║                                                                ║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""

    if (-not (Test-Path -Path $Script:CONFIG_DIR)) {
        New-Item -ItemType Directory -Path $Script:CONFIG_DIR -Force | Out-Null
    }

    # Pre-flight checks
    Test-WindowsVersion
    Test-InternetConnectivity
    Test-HardwareBaseline
    $hasTpm = Test-TPM

    # Ensure Docker is installed and running
    Install-Docker

    # Key generation and attestation
    if ($hasTpm) {
        # TPM path - reuse existing TPM functions (New-TPMKey / New-Attestation) if available
        # For now, fall through to software path as TPM functions are not yet ported
        Write-Log -Message "TPM detected - using software attestation (TPM signing coming soon)" -Level Warning
    }
    New-SoftwareKey
    New-SoftwareAttestation

    # Fetch install config (determines tier, hardware requirements, etc.)
    $installConfig = Get-InstallConfig -Token $InstallToken

    # Tier-specific hardware validation
    Test-HardwareForTier -InstallConfig $installConfig

    # Register node
    $credentials = Register-Node -Token $InstallToken -InstallConfig $installConfig -WalletAddress $WalletAddress

    # Generate unique node wallet (hot wallet) for this node
    $wallet = New-NodeWallet

    # Download images and configure containers
    Install-DockerContainer -InstallConfig $installConfig -Credentials $credentials -Wallet $wallet

    # Start the node
    Start-NodeService -Tier $installConfig.tier

    # Summary
    Show-Summary -Tier $installConfig.tier

    Write-Log -Message "Installation completed successfully!" -Level Success
}

# Run
try {
    Main
} catch {
    Write-ErrorAndExit "Installation failed: $_"
}
