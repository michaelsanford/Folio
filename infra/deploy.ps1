[CmdletBinding()]
param (
    [string]$Region = "ca-central-1",
    [string]$StackName = "folio-prod",
    [string]$Environment = "prod"
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Folio - Automated AWS Cloud Deployment" -ForegroundColor Cyan
Write-Host "Region: $Region | Stack: $StackName" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Verify AWS CLI and Docker
Write-Host "`n[1/5] Verifying AWS CLI & Docker prerequisites..." -ForegroundColor Yellow
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw "AWS CLI is not installed or not in PATH."
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is not installed or not in PATH."
}

$AccountId = (aws sts get-caller-identity --query "Account" --output text).Trim()
if (-not $AccountId) {
    throw "Unable to authenticate with AWS. Please check your AWS credentials (aws configure)."
}
Write-Host "Authenticated as AWS Account: $AccountId in $Region" -ForegroundColor Green

$EcrUri = "$AccountId.dkr.ecr.$Region.amazonaws.com/folio"

# 2. Ensure ECR Repository Exists for initial image push
Write-Host "`n[2/5] Ensuring ECR Repository exists..." -ForegroundColor Yellow
$ecrCheck = aws ecr describe-repositories --repository-names folio --region $Region 2>$null
if (-not $ecrCheck) {
    Write-Host "Creating initial ECR repository 'folio'..." -ForegroundColor Gray
    aws ecr create-repository --repository-name folio --region $Region | Out-Null
}

# 3. Build & Push Multi-stage Container Image
Write-Host "`n[3/5] Building unified Folio container image..." -ForegroundColor Yellow
$RootPath = Resolve-Path (Join-Path $PSScriptRoot "..")
docker build -t folio:latest -f "$RootPath\Dockerfile" "$RootPath"

Write-Host "Authenticating Docker with Amazon ECR..." -ForegroundColor Gray
aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin "$AccountId.dkr.ecr.$Region.amazonaws.com"

Write-Host "Tagging and pushing image to $EcrUri:latest..." -ForegroundColor Gray
docker tag folio:latest "$EcrUri:latest"
docker push "$EcrUri:latest"
Write-Host "Image successfully pushed to ECR." -ForegroundColor Green

# 4. Deploy Infrastructure as Code via CloudFormation
Write-Host "`n[4/5] Deploying CloudFormation Stack ($StackName)..." -ForegroundColor Yellow
$TemplatePath = Join-Path $PSScriptRoot "cloudformation.yml"

aws cloudformation deploy `
    --template-file "$TemplatePath" `
    --stack-name "$StackName" `
    --region "$Region" `
    --capabilities CAPABILITY_NAMED_IAM `
    --parameter-overrides EnvironmentName="$Environment" `
    --no-fail-on-empty-changeset

# 5. Fetch Live URL and Status
Write-Host "`n[5/5] Retrieving Live Deployment Outputs..." -ForegroundColor Yellow
$ServiceUrl = aws cloudformation describe-stacks `
    --stack-name "$StackName" `
    --region "$Region" `
    --query "Stacks[0].Outputs[?OutputKey=='ServiceUrl'].OutputValue" `
    --output text

$VaultBucket = aws cloudformation describe-stacks `
    --stack-name "$StackName" `
    --region "$Region" `
    --query "Stacks[0].Outputs[?OutputKey=='S3VaultBucket'].OutputValue" `
    --output text

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host "Folio Deployment Complete!" -ForegroundColor Green
Write-Host "Live HTTPS Application URL: $ServiceUrl" -ForegroundColor Cyan
Write-Host "S3 Litestream Vault Bucket: $VaultBucket" -ForegroundColor Gray
Write-Host "========================================================" -ForegroundColor Green
