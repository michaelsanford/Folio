[CmdletBinding()]
param (
    [string]$Region = "ca-central-1",
    [string]$StackName = "folio-prod",
    [string]$Environment = "prod",
    [string]$MasterPassword = ""
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Folio - AWS SAM Serverless Deployment" -ForegroundColor Cyan
Write-Host "Region: $Region | Stack: $StackName" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Verify Prerequisites
Write-Host "`n[1/4] Verifying AWS SAM CLI & Docker..." -ForegroundColor Yellow
if (-not (Get-Command sam -ErrorAction SilentlyContinue)) {
    throw "AWS SAM CLI is not installed. Install via: winget install Amazon.SAM-CLI"
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is not installed or not running."
}

$AccountId = (aws sts get-caller-identity --query "Account" --output text).Trim()
Write-Host "Authenticated as AWS Account: $AccountId in $Region" -ForegroundColor Green

$RootPath = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $RootPath

try {
    # 2. SAM Build
    Write-Host "`n[2/4] Building Serverless Application (SAM)..." -ForegroundColor Yellow
    sam build -t template.yaml

    # 3. SAM Deploy
    Write-Host "`n[3/4] Deploying SAM Stack ($StackName)..." -ForegroundColor Yellow
    $ParamOverrides = "EnvironmentName=$Environment"
    if ($MasterPassword) {
        $ParamOverrides += " MasterPassword=$MasterPassword"
    }

    sam deploy `
        --stack-name "$StackName" `
        --region "$Region" `
        --resolve-s3 `
        --resolve-image-repos `
        --capabilities CAPABILITY_IAM `
        --parameter-overrides $ParamOverrides `
        --no-fail-on-empty-changeset

    # 4. Retrieve Outputs
    Write-Host "`n[4/4] Retrieving Live Serverless Endpoint..." -ForegroundColor Yellow
    $AppUrl = aws cloudformation describe-stacks `
        --stack-name "$StackName" `
        --region "$Region" `
        --query "Stacks[0].Outputs[?OutputKey=='FolioAppUrl'].OutputValue" `
        --output text

    $VaultBucket = aws cloudformation describe-stacks `
        --stack-name "$StackName" `
        --region "$Region" `
        --query "Stacks[0].Outputs[?OutputKey=='S3VaultBucket'].OutputValue" `
        --output text

    Write-Host "`n========================================================" -ForegroundColor Green
    Write-Host "Folio Serverless SAM Deployment Complete!" -ForegroundColor Green
    Write-Host "Live HTTPS Application URL: $AppUrl" -ForegroundColor Cyan
    Write-Host "S3 Storage Vault Bucket:    $VaultBucket" -ForegroundColor Gray
    Write-Host "========================================================" -ForegroundColor Green
} finally {
    Pop-Location
}
