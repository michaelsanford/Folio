# Folio - Automated Test Suite Runner (Backend + Frontend)
$ErrorActionPreference = "Continue"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Running Folio Full Test Suite" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$RootPath = $PSScriptRoot
$BackendPath = Join-Path $RootPath "backend"
$FrontendPath = Join-Path $RootPath "frontend"
# 1. Backend Pytest Suite
Write-Host "`n[1/3] Running Backend Pytest Suite..." -ForegroundColor Yellow
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw "uv is not installed. Install via: winget install astral-sh.uv"
}

Push-Location $BackendPath
try {
    & uv run pytest
    if ($LASTEXITCODE -ne 0) { throw "Backend Pytest tests failed." }
} finally {
    Pop-Location
}

# 2. Frontend Vitest Suite
Write-Host "`n[2/3] Running Frontend Vitest Suite..." -ForegroundColor Yellow
Push-Location $FrontendPath
try {
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw "Frontend Vitest tests failed." }
} finally {
    Pop-Location
}

# 3. Frontend TypeScript & Production Build Verification
Write-Host "`n[3/3] Running Frontend Typecheck & Production Build..." -ForegroundColor Yellow
Push-Location $FrontendPath
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed." }
} finally {
    Pop-Location
}

Write-Host "`n==========================================" -ForegroundColor Green
Write-Host "All Folio Tests & Builds Passed!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
