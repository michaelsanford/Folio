# Folio - 1-Command Local Development Launcher
[CmdletBinding()]
param(
    [switch]$Clean,
    # Set or replace the local master passphrase, even if one is already configured.
    [switch]$SetPassword,
    # Start without configuring authentication. The app will run, but every API
    # call returns 401 until a passphrase or Cognito is configured.
    [switch]$NoAuth
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Starting Folio Local Development Suite" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$RootPath = $PSScriptRoot
$BackendPath = Join-Path $RootPath "backend"
$FrontendPath = Join-Path $RootPath "frontend"
$PythonExe = Join-Path $BackendPath ".venv\Scripts\python.exe"
$DataPath = Join-Path $BackendPath "data"
$EnvFile = Join-Path $BackendPath ".env"


function Read-DotEnv {
    <#
        .SYNOPSIS
        Read backend/.env into a hashtable. Missing file yields an empty one.
    #>
    param([string]$Path)

    $values = @{}
    if (-not (Test-Path $Path)) { return $values }

    foreach ($line in Get-Content $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
        $split = $trimmed.IndexOf("=")
        if ($split -lt 1) { continue }
        $values[$trimmed.Substring(0, $split).Trim()] = $trimmed.Substring($split + 1).Trim()
    }
    return $values
}


function Set-DotEnvValue {
    <#
        .SYNOPSIS
        Upsert a single key in backend/.env, leaving every other line intact.
    #>
    param([string]$Path, [string]$Key, [string]$Value)

    $lines = if (Test-Path $Path) { @(Get-Content $Path) } else { @() }
    $replaced = $false
    $output = foreach ($line in $lines) {
        if ($line.Trim() -match "^$([regex]::Escape($Key))\s*=") {
            $replaced = $true
            "$Key=$Value"
        }
        else { $line }
    }
    if (-not $replaced) { $output = @($output) + "$Key=$Value" }

    # No BOM: pydantic-settings would read one as part of the first key name.
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($Path, [string[]]$output, $utf8NoBom)
}


function ConvertFrom-SecureStringPlain {
    param([System.Security.SecureString]$Secure)
    return [System.Net.NetworkCredential]::new("", $Secure).Password
}


# 0. Handle -Clean Flag (Reinitialize DB & Uploads)
if ($Clean) {
    Write-Host "`n[-Clean] Reinitializing SQLite Database & Clearing Uploads..." -ForegroundColor Magenta
    Remove-Item -Force -Recurse (Join-Path $DataPath "folio.db*") -ErrorAction SilentlyContinue
    Remove-Item -Force -Recurse (Join-Path $DataPath "uploads\*") -ErrorAction SilentlyContinue
    Write-Host "Database wiped. A clean database will be initialized on boot." -ForegroundColor Green
    Write-Host "Your master passphrase is configuration, not data, and is unaffected." -ForegroundColor Gray
}

# 1. Check Python Virtual Environment
if (-not (Test-Path $PythonExe)) {
    Write-Host "Creating Python virtual environment in backend\.venv..." -ForegroundColor Yellow
    python -m venv (Join-Path $BackendPath ".venv")
    & $PythonExe -m pip install -r (Join-Path $BackendPath "requirements-dev.txt")
}

# 2. Ensure authentication is configured.
#    Folio is fail-closed: with no passphrase and no Cognito, the app starts
#    normally and then rejects every API call, which reads as a broken build
#    rather than an unconfigured one. Prompt instead of letting that happen.
$DotEnv = Read-DotEnv -Path $EnvFile
$ConfiguredHash = if ($env:FOLIO_MASTER_PASSWORD_HASH) { $env:FOLIO_MASTER_PASSWORD_HASH } else { $DotEnv["FOLIO_MASTER_PASSWORD_HASH"] }
$CognitoPool = if ($env:COGNITO_USER_POOL_ID) { $env:COGNITO_USER_POOL_ID } else { $DotEnv["COGNITO_USER_POOL_ID"] }
$CognitoClient = if ($env:COGNITO_CLIENT_ID) { $env:COGNITO_CLIENT_ID } else { $DotEnv["COGNITO_CLIENT_ID"] }
$IsConfigured = [bool]$ConfiguredHash -or ([bool]$CognitoPool -and [bool]$CognitoClient)

if ($NoAuth) {
    Write-Host "`n[-NoAuth] Skipping authentication setup." -ForegroundColor Yellow
    Write-Host "The API will reject every request with 401 until auth is configured." -ForegroundColor Yellow
}
elseif ($SetPassword -or -not $IsConfigured) {
    Write-Host ""
    if ($SetPassword -and $IsConfigured) {
        Write-Host "Replacing the existing local master passphrase." -ForegroundColor Yellow
    }
    else {
        Write-Host "No authentication is configured yet." -ForegroundColor Yellow
        Write-Host "Folio is fail-closed, so it would start and then reject every request." -ForegroundColor Gray
    }
    Write-Host "Set a master passphrase (minimum 8 characters). It is bcrypt-hashed" -ForegroundColor Gray
    Write-Host "locally and only the hash is stored, in backend\.env (gitignored)." -ForegroundColor Gray
    Write-Host ""

    $Hash = $null
    for ($attempt = 1; $attempt -le 3 -and -not $Hash; $attempt++) {
        $first = Read-Host -AsSecureString -Prompt "  Master passphrase"
        $second = Read-Host -AsSecureString -Prompt "  Confirm passphrase"

        $plainFirst = ConvertFrom-SecureStringPlain $first
        $plainSecond = ConvertFrom-SecureStringPlain $second

        if ($plainFirst -cne $plainSecond) {
            Write-Host "  Passphrases did not match. Try again.`n" -ForegroundColor Red
            $plainFirst = $null; $plainSecond = $null
            continue
        }

        # Piped over stdin so the passphrase never reaches the command line or
        # PowerShell history. A non-zero exit means it was rejected (too short).
        $candidate = $plainFirst | & $PythonExe (Join-Path $BackendPath "scripts\hash_password.py")
        $plainFirst = $null; $plainSecond = $null

        if ($LASTEXITCODE -ne 0 -or -not $candidate) {
            Write-Host "" -NoNewline
            continue
        }
        $Hash = $candidate.Trim()
    }

    if (-not $Hash) {
        throw "Could not set a master passphrase. Re-run, or pass -NoAuth to start without authentication."
    }

    Set-DotEnvValue -Path $EnvFile -Key "FOLIO_MASTER_PASSWORD_HASH" -Value $Hash
    Write-Host "  Passphrase configured and saved to backend\.env" -ForegroundColor Green
}
else {
    $mode = if ($ConfiguredHash) { "master passphrase" } else { "Cognito" }
    Write-Host "`nAuthentication configured ($mode). Use -SetPassword to change it." -ForegroundColor Gray
}

# 3. Check Node modules
if (-not (Test-Path (Join-Path $FrontendPath "node_modules"))) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
    Push-Location $FrontendPath
    npm install
    Pop-Location
}

# 4. Start Backend in Background
Write-Host "`n[1/2] Launching FastAPI Backend on http://localhost:8000..." -ForegroundColor Green
$BackendJob = Start-Job -ScriptBlock {
    param($Dir, $Py)
    Set-Location $Dir
    & $Py -m uvicorn app.main:app --reload --port 8000
} -ArgumentList $BackendPath, $PythonExe

# Wait a brief moment for backend to initialize
Start-Sleep -Seconds 2

# 5. Start Vite Frontend in Foreground
Write-Host "[2/2] Launching Vite Frontend on http://localhost:5173..." -ForegroundColor Green
Write-Host "Press Ctrl+C to stop both backend and frontend." -ForegroundColor Gray

# Open browser
Start-Process "http://localhost:5173"

try {
    Push-Location $FrontendPath
    npm run dev
} finally {
    Pop-Location
    Write-Host "`nStopping FastAPI backend server..." -ForegroundColor Yellow
    Stop-Job $BackendJob -ErrorAction SilentlyContinue
    Remove-Job $BackendJob -ErrorAction SilentlyContinue
    Write-Host "All development services stopped." -ForegroundColor Green
}
