# Folio - Automated Test Suite Runner (Backend + Frontend)
$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Running Folio Full Test Suite" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$RootPath = $PSScriptRoot
$BackendPath = Join-Path $RootPath "backend"
$FrontendPath = Join-Path $RootPath "frontend"
$PytestExe = Join-Path $BackendPath ".venv\Scripts\pytest.exe"

# 1. Backend Pytest Suite
Write-Host "`n[1/2] Running Backend Pytest Suite (Coverage & Unit Tests)..." -ForegroundColor Yellow
if (-not (Test-Path $PytestExe)) {
    throw "Pytest not found in backend\.venv. Run dev.ps1 first to setup environment."
}

Push-Location $BackendPath
try {
    & $PytestExe tests --cov=app --cov-report=term-missing
} finally {
    Pop-Location
}

# 2. Frontend TypeScript & Build Verification
Write-Host "`n[2/2] Running Frontend Typecheck & Build..." -ForegroundColor Yellow
Push-Location $FrontendPath
try {
    npm run build
} finally {
    Pop-Location
}

Write-Host "`n==========================================" -ForegroundColor Green
Write-Host "All Folio Tests & Builds Passed!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
