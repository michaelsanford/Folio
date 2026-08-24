# Folio - Automated Test Suite Runner (Backend + Frontend)
$ErrorActionPreference = "Continue"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Running Folio Full Test Suite" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$RootPath = $PSScriptRoot
$BackendPath = Join-Path $RootPath "backend"
$FrontendPath = Join-Path $RootPath "frontend"
$PytestExe = Join-Path $BackendPath ".venv\Scripts\pytest.exe"

# 1. Backend Pytest Suite
Write-Host "`n[1/3] Running Backend Pytest Suite (Coverage & Integration Tests)..." -ForegroundColor Yellow
if (-not (Test-Path $PytestExe)) {
    throw "Pytest not found in backend\.venv. Run dev.ps1 first to setup environment."
}

Push-Location $BackendPath
try {
    & $PytestExe tests -o addopts="" --cov=app --cov-report=term-missing
    if ($LASTEXITCODE -ne 0) { throw "Backend Pytest tests failed." }
} finally {
    Pop-Location
}

# 2. Frontend Vitest Suite
Write-Host "`n[2/3] Running Frontend Vitest Suite (Component & Auth Unit Tests)..." -ForegroundColor Yellow
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
