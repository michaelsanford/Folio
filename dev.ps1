# Folio - 1-Command Local Development Launcher
[CmdletBinding()]
param(
    [switch]$Clean,
    # Set or replace the local master passphrase, even if one is already configured.
    [switch]$SetPassword
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


function Get-PortOwner {
    <#
        .SYNOPSIS
        The process listening on a TCP port, or $null if the port is free.
    #>
    param([int]$Port)

    $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
            Select-Object -First 1
    if (-not $conn) { return $null }
    return Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
}


function Stop-ProcessTree {
    <#
        .SYNOPSIS
        Kill a process and its descendants, children first.

        .DESCRIPTION
        uvicorn --reload runs the app in a child process. Stopping only the parent
        leaves that child alive, still holding port 8000 and an open handle on
        folio.db -- which then makes the next -Clean fail.
    #>
    param([int]$ProcessId)

    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue)
    foreach ($child in $children) { Stop-ProcessTree -ProcessId $child.ProcessId }
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}


# 0. Refuse to start on top of a running instance.
#    Without this the backend loses the race for port 8000 and exits, while the
#    stale server keeps answering /api/health -- so the app looks up, against
#    whatever code and data that older process was started with.
foreach ($check in @(@{ Port = 8000; Name = "backend" }, @{ Port = 5173; Name = "frontend" })) {
    $owner = Get-PortOwner -Port $check.Port
    if ($owner) {
        throw @"
Port $($check.Port) is already in use by $($owner.ProcessName) (PID $($owner.Id)), started $($owner.StartTime).

Folio's $($check.Name) cannot start while that process holds the port, and a stale
instance also keeps a lock on the database that blocks -Clean. Stop it first:

  Stop-Process -Id $($owner.Id) -Force

An earlier run that was interrupted rather than closed with Ctrl+C is the usual cause.
"@
    }
}

# 1. Handle -Clean Flag (Reinitialize DB & Uploads)
if ($Clean) {
    Write-Host "`n[-Clean] Reinitializing SQLite Database & Clearing Uploads..." -ForegroundColor Magenta

    Remove-Item -Force -Recurse (Join-Path $DataPath "folio.db*") -ErrorAction SilentlyContinue
    Remove-Item -Force -Recurse (Join-Path $DataPath "uploads\*") -ErrorAction SilentlyContinue

    # Verify rather than announce. Remove-Item fails silently on a file another
    # process holds open, and reporting a wipe that did not happen sends you on to
    # test against the data you meant to discard.
    $survivors = @(Get-ChildItem (Join-Path $DataPath "folio.db*") -ErrorAction SilentlyContinue)
    if ($survivors.Count -gt 0) {
        throw @"
-Clean could not delete the database: $($survivors.Name -join ', ')

Something still holds the file open. The ports were free, so it is not a running
Folio server -- check for a DB browser, an IDE data source, or an orphaned python
process:

  Get-Process python | Select-Object Id, StartTime

Nothing was wiped.
"@
    }

    Write-Host "Database wiped. A clean database will be initialized on boot." -ForegroundColor Green
    Write-Host "Your master passphrase is configuration, not data, and is unaffected." -ForegroundColor Gray
}

# 2. Check Python Virtual Environment
if (-not (Test-Path $PythonExe)) {
    Write-Host "Creating Python virtual environment in backend\.venv..." -ForegroundColor Yellow
    python -m venv (Join-Path $BackendPath ".venv")
    & $PythonExe -m pip install -r (Join-Path $BackendPath "requirements-dev.txt")
}

# 3. Ensure authentication is configured.
#    Folio is fail-closed: with no passphrase and no Cognito, the app starts
#    normally and then rejects every API call, which reads as a broken build
#    rather than an unconfigured one. Prompt instead of letting that happen.
$DotEnv = Read-DotEnv -Path $EnvFile
function Get-Setting {
    param([string]$Name)
    $fromProcess = [Environment]::GetEnvironmentVariable($Name)
    if ($fromProcess) { return $fromProcess }
    return $DotEnv[$Name]
}

$ConfiguredHash = Get-Setting "FOLIO_MASTER_PASSWORD_HASH"
# The backend also accepts a plaintext passphrase in development, so treat that
# as configured too rather than prompting over the top of it.
$ConfiguredPlain = Get-Setting "FOLIO_MASTER_PASSWORD"
$CognitoPool = Get-Setting "COGNITO_USER_POOL_ID"
$CognitoClient = Get-Setting "COGNITO_CLIENT_ID"
$IsConfigured = [bool]$ConfiguredHash -or [bool]$ConfiguredPlain -or
                ([bool]$CognitoPool -and [bool]$CognitoClient)

if ($SetPassword -or -not $IsConfigured) {
    # Read-Host blocks forever when stdin is redirected, so say what to do
    # instead of hanging.
    if ([Console]::IsInputRedirected) {
        throw @"
Cannot prompt for a master passphrase: this shell has no interactive input.

Folio is fail-closed, so starting without one would reject every API request.
Configure it non-interactively instead, then re-run:

  # generate a hash (reads the passphrase from stdin)
  "your passphrase" | python backend\scripts\hash_password.py

  # then add it to backend\.env
  FOLIO_MASTER_PASSWORD_HASH=<hash>

Or set COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID to use Cognito instead.
"@
    }

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
        throw "Could not set a master passphrase after 3 attempts. Re-run when ready."
    }

    Set-DotEnvValue -Path $EnvFile -Key "FOLIO_MASTER_PASSWORD_HASH" -Value $Hash
    Write-Host "  Passphrase configured and saved to backend\.env" -ForegroundColor Green
}
else {
    $mode = if ($ConfiguredHash) { "master passphrase" }
            elseif ($ConfiguredPlain) { "master passphrase, plaintext" }
            else { "Cognito" }
    Write-Host "`nAuthentication configured ($mode). Use -SetPassword to change it." -ForegroundColor Gray
}

# 4. Check Node modules
if (-not (Test-Path (Join-Path $FrontendPath "node_modules"))) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
    Push-Location $FrontendPath
    npm install
    Pop-Location
}

# 5. Start Backend in Background
#    Start-Process rather than Start-Job: it yields a real PID, so the shutdown
#    below can kill uvicorn's reload child too instead of orphaning it.
Write-Host "`n[1/2] Launching FastAPI Backend on http://localhost:8000..." -ForegroundColor Green

$BackendOutLog = Join-Path $DataPath "dev-backend.out.log"
$BackendErrLog = Join-Path $DataPath "dev-backend.err.log"
New-Item -ItemType Directory -Force -Path $DataPath | Out-Null

$BackendProc = Start-Process -FilePath $PythonExe `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--reload", "--port", "8000" `
    -WorkingDirectory $BackendPath -PassThru -NoNewWindow `
    -RedirectStandardOutput $BackendOutLog -RedirectStandardError $BackendErrLog

function Show-BackendLog {
    <#
        .SYNOPSIS
        Print the backend's own output. It is redirected to a file, so a startup
        failure would otherwise be invisible.
    #>
    foreach ($log in @($BackendErrLog, $BackendOutLog)) {
        if (-not (Test-Path $log)) { continue }
        $tail = Get-Content $log -Tail 25 -ErrorAction SilentlyContinue
        if ($tail) {
            Write-Host "`n--- $(Split-Path $log -Leaf) ---" -ForegroundColor DarkGray
            $tail | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
        }
    }
}

# Wait for the backend to answer rather than guessing at a sleep, and fail loudly
# if it never does. A dead backend used to leave the frontend up and apparently
# working, right until every request 500'd.
$Ready = $false
$Deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $Deadline) {
    if ($BackendProc.HasExited) {
        Show-BackendLog
        throw "The FastAPI backend exited with code $($BackendProc.ExitCode) during startup. Its output is above, and in backend\data\dev-backend.*.log."
    }
    try {
        # 127.0.0.1, not localhost: uvicorn binds IPv4 only, and localhost
        # resolves to ::1 first here -- every probe would fail against a
        # perfectly healthy server.
        $probe = Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/health" -UseBasicParsing -TimeoutSec 2
        if ($probe.StatusCode -eq 200) { $Ready = $true; break }
    }
    catch {
        # Not up yet; fall through to the sleep below.
    }
    Start-Sleep -Milliseconds 400
}

if (-not $Ready) {
    Show-BackendLog
    Stop-ProcessTree -ProcessId $BackendProc.Id
    throw "The FastAPI backend did not become healthy within 60 seconds. Its output is above, and in backend\data\dev-backend.*.log."
}

Write-Host "Backend healthy (PID $($BackendProc.Id)). Log: backend\data\dev-backend.err.log" -ForegroundColor Gray

# 6. Start Vite Frontend in Foreground
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
    Stop-ProcessTree -ProcessId $BackendProc.Id

    # Confirm it actually died. A surviving child keeps port 8000 and the database
    # locked, which breaks the next run's -Clean in a way that is hard to spot.
    $stillListening = Get-PortOwner -Port 8000
    if ($stillListening) {
        Write-Host "Warning: PID $($stillListening.Id) ($($stillListening.ProcessName)) still holds port 8000." -ForegroundColor Yellow
        Write-Host "         Stop it before the next run: Stop-Process -Id $($stillListening.Id) -Force" -ForegroundColor Yellow
    }
    else {
        Write-Host "All development services stopped." -ForegroundColor Green
    }
}
