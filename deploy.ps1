[CmdletBinding()]
param (
    [string]$Region = "ca-central-1",
    [string]$StackName = "folio-prod",
    [string]$Environment = "prod",
    [securestring]$MasterPassword,
    # Exact origin allowed to call the API cross-origin. Leave empty when the PWA
    # is served by the function itself, which needs no CORS at all.
    [string]$AllowedOrigin = "",
    # 0 = unreserved (required on sandbox/new AWS accounts with concurrency quota 10);
    # set to 1 on accounts with quota > 10 to enforce single-writer SQLite safety.
    [int]$ReservedConcurrency = 0,
    # Optional name of a retained S3 vault bucket to reuse instead of creating a new one.
    [string]$ExistingVaultBucket = "",
    # Optional email address to invite/bootstrap in the Cognito User Pool (idempotent).
    [string]$OwnerEmail = "",
    # Disable AWS Cognito provisioning and deploy in single Master Passphrase mode instead.
    [switch]$DisableCognito,
    # Optional HMAC signing secret for local cookies in -DisableCognito mode (auto-generated if omitted).
    [securestring]$SessionSecretKey
)

$ErrorActionPreference = "Stop"

$Environment = $Environment.Trim().ToLowerInvariant()
if ($Environment -notmatch '^[a-z0-9][a-z0-9-]{0,20}$') {
    throw "Environment must be lowercase alphanumeric/hyphens (1-21 chars) for valid S3 bucket naming."
}

$NormalizedOwnerEmail = $OwnerEmail.Trim().ToLowerInvariant()
if ($DisableCognito -and $NormalizedOwnerEmail) {
    throw "-OwnerEmail cannot be used with -DisableCognito (Cognito User Pool is disabled)."
}
if ($DisableCognito -and -not $MasterPassword) {
    throw "-DisableCognito requires -MasterPassword so production authentication never falls back to an unconfigured state."
}
if ($NormalizedOwnerEmail -and $NormalizedOwnerEmail -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
    throw "OwnerEmail '$OwnerEmail' does not look like a valid email address."
}

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
if ($LASTEXITCODE -ne 0 -or -not $AccountId) {
    throw "AWS authentication failed. Check AWS_PROFILE / credentials."
}
Write-Host "Authenticated as AWS Account: $AccountId in $Region" -ForegroundColor Green

$PrevAttestations = $env:BUILDX_NO_DEFAULT_ATTESTATIONS
Push-Location $PSScriptRoot

try {
    # 2. SAM Build
    Write-Host "`n[2/4] Building Serverless Application (SAM)..." -ForegroundColor Yellow
    # Disable OCI provenance attestations so BuildKit emits single-platform manifests Lambda accepts.
    $env:BUILDX_NO_DEFAULT_ATTESTATIONS = "1"
    sam build -t template.yaml --use-buildkit
    if ($LASTEXITCODE -ne 0) {
        throw "SAM build failed with exit code $LASTEXITCODE."
    }

    # 3. SAM Deploy
    Write-Host "`n[3/4] Deploying SAM Stack ($StackName)..." -ForegroundColor Yellow
    $ParamOverrides = @("EnvironmentName=$Environment")

    if ($DisableCognito) {
        $ParamOverrides += "EnableCognito=false"
        if ($SessionSecretKey) {
            $SessionSecret = ([System.Net.NetworkCredential]::new("", $SessionSecretKey).Password).Trim()
        } else {
            $secretBytes = New-Object byte[] 32
            $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
            try {
                $rng.GetBytes($secretBytes)
            } finally {
                $rng.Dispose()
            }
            $SessionSecret = [System.BitConverter]::ToString($secretBytes).Replace("-", "").ToLowerInvariant()
        }
        $ParamOverrides += "SessionSecretKey=$SessionSecret"
        $SessionSecret = $null
    } else {
        $ParamOverrides += "EnableCognito=true"
    }

    if ($MasterPassword) {
        # Hash locally so the passphrase itself never reaches CloudFormation or the
        # Lambda environment, both of which are readable with modest IAM access.
        # Piped over stdin so it never appears in the process list either.
        Write-Host "Hashing master passphrase locally (bcrypt)..." -ForegroundColor Yellow
        $BackendPath = Join-Path $PSScriptRoot "backend"
        $HashScript = Join-Path $BackendPath "scripts\hash_password.py"

        $Plain = [System.Net.NetworkCredential]::new("", $MasterPassword).Password
        if (Get-Command uv -ErrorAction SilentlyContinue) {
            $Hash = ($Plain | & uv run --directory $BackendPath --quiet python $HashScript)
        } else {
            $PythonExe = Join-Path $BackendPath ".venv\Scripts\python.exe"
            if (-not (Test-Path $PythonExe)) { $PythonExe = "python" }
            $Hash = ($Plain | & $PythonExe $HashScript)
        }
        $Plain = $null
        if ($LASTEXITCODE -ne 0 -or -not $Hash) { throw "Failed to hash the master passphrase." }
        $ParamOverrides += "MasterPasswordHash=$($Hash.Trim())"
    }

    if ($AllowedOrigin) {
        $ParamOverrides += "AllowedOrigin=$AllowedOrigin"
    }

    if ($ReservedConcurrency -gt 0) {
        $ParamOverrides += "ReservedConcurrency=$ReservedConcurrency"
    }

    if ($ExistingVaultBucket.Trim()) {
        $ParamOverrides += "ExistingVaultBucketName=$($ExistingVaultBucket.Trim())"
    }

    sam deploy `
        --stack-name "$StackName" `
        --region "$Region" `
        --resolve-s3 `
        --resolve-image-repos `
        --capabilities CAPABILITY_IAM `
        --parameter-overrides @ParamOverrides `
        --no-fail-on-empty-changeset
    if ($LASTEXITCODE -ne 0) {
        throw "SAM deploy failed with exit code $LASTEXITCODE."
    }

    # 4. Retrieve Outputs
    Write-Host "`n[4/4] Retrieving Live Serverless Endpoint..." -ForegroundColor Yellow
    $OutputsRaw = aws cloudformation describe-stacks `
        --stack-name "$StackName" `
        --region "$Region" `
        --query "Stacks[0].Outputs" `
        --output json
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to retrieve CloudFormation stack outputs for $StackName."
    }

    $OutputsMap = @{}
    if ($OutputsRaw) {
        $ParsedOutputs = $OutputsRaw | ConvertFrom-Json
        foreach ($Item in $ParsedOutputs) {
            if ($Item.OutputKey) {
                $OutputsMap[$Item.OutputKey] = $Item.OutputValue
            }
        }
    }
    $AppUrl = $OutputsMap["FolioAppUrl"]
    $VaultBucket = $OutputsMap["S3VaultBucket"]
    $UserPoolId = $OutputsMap["CognitoUserPoolId"]
    $ClientId = $OutputsMap["CognitoClientId"]

    Write-Host "`n========================================================" -ForegroundColor Green
    Write-Host "Folio Serverless SAM Deployment Complete!" -ForegroundColor Green
    Write-Host "Live HTTPS Application URL: $AppUrl" -ForegroundColor Cyan
    Write-Host "S3 Storage Vault Bucket:    $VaultBucket" -ForegroundColor Gray
    if ($UserPoolId -and $UserPoolId -ne "None") {
        Write-Host "Cognito User Pool ID:       $UserPoolId" -ForegroundColor Yellow
        Write-Host "Cognito App Client ID:      $ClientId" -ForegroundColor Yellow

        if ($NormalizedOwnerEmail) {
            Write-Host "`nInviting/verifying Cognito user '$NormalizedOwnerEmail'..." -ForegroundColor Yellow
            $prevEap = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            try {
                $probeRaw = & aws cognito-idp admin-get-user `
                    --user-pool-id "$UserPoolId" `
                    --username "$NormalizedOwnerEmail" `
                    --region "$Region" `
                    --output json 2>&1
                $probeCode = $LASTEXITCODE
            } finally {
                $ErrorActionPreference = $prevEap
            }
            $probeText = ($probeRaw | ForEach-Object { $_.ToString() }) -join "`n"

            if ($probeCode -eq 0) {
                $userObj = $probeText | ConvertFrom-Json
                $userStatus = $userObj.UserStatus
                Write-Host "Cognito user '$NormalizedOwnerEmail' already exists (status: $userStatus) -- skipping invite." -ForegroundColor Gray
                if ($userStatus -eq "FORCE_CHANGE_PASSWORD") {
                    Write-Host "To resend the temporary password email: aws cognito-idp admin-create-user --user-pool-id $UserPoolId --username $NormalizedOwnerEmail --message-action RESEND --desired-delivery-mediums EMAIL --region $Region" -ForegroundColor DarkGray
                }
            } elseif ($probeText -match "UserNotFoundException") {
                aws cognito-idp admin-create-user `
                    --user-pool-id "$UserPoolId" `
                    --region "$Region" `
                    --username "$NormalizedOwnerEmail" `
                    --user-attributes "Name=email,Value=$NormalizedOwnerEmail" "Name=email_verified,Value=true" `
                    --desired-delivery-mediums EMAIL `
                    --output json | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    throw "Failed to invite Cognito user '$NormalizedOwnerEmail' in pool '$UserPoolId'."
                }
                Write-Host "Invited '$NormalizedOwnerEmail' to Cognito User Pool '$UserPoolId'." -ForegroundColor Green
                Write-Host "Check email (including spam) for the temporary password from no-reply@verificationemail.com," -ForegroundColor Cyan
                Write-Host "then visit $AppUrl to choose your permanent passphrase (20+ chars) and scan the TOTP QR code." -ForegroundColor Cyan
            } else {
                throw "Failed to inspect Cognito user '$NormalizedOwnerEmail' in pool '$UserPoolId':`n$probeText"
            }
        } else {
            Write-Host "To invite a user (idempotent): .\deploy.ps1 -Region $Region -StackName $StackName -Environment $Environment -OwnerEmail you@example.com" -ForegroundColor DarkGray
        }
    } else {
        Write-Host "Authentication Mode:        Master Passphrase (Cognito disabled)" -ForegroundColor Yellow
    }
    Write-Host "========================================================" -ForegroundColor Green
} finally {
    if ($null -ne $PrevAttestations) {
        $env:BUILDX_NO_DEFAULT_ATTESTATIONS = $PrevAttestations
    } else {
        Remove-Item Env:\BUILDX_NO_DEFAULT_ATTESTATIONS -ErrorAction SilentlyContinue
    }
    Pop-Location
}
