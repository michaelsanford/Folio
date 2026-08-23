# Folio - 1-Command Local Development Launcher
$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Starting Folio Local Development Suite" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$RootPath = $PSScriptRoot
$BackendPath = Join-Path $RootPath "backend"
$FrontendPath = Join-Path $RootPath "frontend"
$PythonExe = Join-Path $BackendPath ".venv\Scripts\python.exe"

# 1. Check Python Virtual Environment
if (-not (Test-Path $PythonExe)) {
    Write-Host "Creating Python virtual environment in backend\.venv..." -ForegroundColor Yellow
    python -m venv (Join-Path $BackendPath ".venv")
    & $PythonExe -m pip install -r (Join-Path $BackendPath "requirements.txt")
}

# 2. Check Node modules
if (-not (Test-Path (Join-Path $FrontendPath "node_modules"))) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
    Push-Location $FrontendPath
    npm install
    Pop-Location
}

# 3. Start Backend in Background
Write-Host "`n[1/2] Launching FastAPI Backend on http://localhost:8000..." -ForegroundColor Green
$BackendJob = Start-Job -ScriptBlock {
    param($Dir, $Py)
    Set-Location $Dir
    & $Py -m uvicorn app.main:app --reload --port 8000
} -ArgumentList $BackendPath, $PythonExe

# Wait a brief moment for backend to initialize
Start-Sleep -Seconds 2

# 4. Start Vite Frontend in Foreground
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
