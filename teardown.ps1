<#
.SYNOPSIS
    Tear down a Folio AWS SAM CloudFormation stack and optionally delete preserved resources.

.DESCRIPTION
    Discovers the main CloudFormation stack and the resources it leaves behind: the retained
    Aurora DSQL database and its AWS Backup vault, retained S3 archive buckets, the retained
    Cognito User Pool, the stack's Secrets Manager secrets, SAM ECR
    CompanionStacks and container images, and CloudWatch Log Groups (the legacy
    /aws/lambda/<function> groups, and /folio/<env>/app if it outlived its stack). Resources the
    stack owns outright (CloudFront distribution, alarms, SNS topic, budget, the
    /folio/<env>/app log group) are deleted with the stack itself.

    By default, prompts individually before deleting preserved resources; use -DeleteAll for a
    single prompt or -Force to delete all stack-associated resources without prompting.

    Database safety rules:
    - Before the database is deleted, every table is exported with `python -m app.cli export`
      (uv, backend/) to .\folio-db-backup-<cluster>-<yyyyMMdd-HHmmss>.db.zst in the current
      directory: a compressed SQLite file that `python -m app.cli import` loads into a fresh
      install. If the export fails the database is preserved, even with -Force. The database
      has deletion protection on; it is turned off just before deleting it.
    - Deleting the database requires typing its cluster id, including with -DeleteAll. Only
      -Force skips the typed confirmation. A cluster matched only by its Name tag (no stack) is
      never selected by -DeleteAll or -Force.
    - The backup vault is deleted (with its recovery points) only together with the database.

    Archive bucket safety rules:
    - Before an archive bucket is emptied, the vault (database/folio.db.zst, or the plain
      database/folio.db of older releases) is downloaded to
      .\folio-vault-backup-<bucket>-<yyyyMMdd-HHmmss>.db.zst (or .db) in the current directory, and
      closed-year archives (archives/) to .\folio-vault-backup-<bucket>-<yyyyMMdd-HHmmss>-archives\. If that
      download fails the bucket is preserved, even with -Force. Use -SkipVaultBackup to skip
      the download deliberately. Releases that kept the database itself in S3 left
      database/folio.db.zst there; it is downloaded too when present.
    - Deleting an archive bucket requires typing its exact name, including with -DeleteAll. Only
      -Force skips the typed confirmation.
    - A bucket the stack reused through ExistingVaultBucketName is never selected by -DeleteAll
      or -Force; it can only be deleted interactively.

    The Cognito User Pool is retained by the stack with deletion protection on. When it is
    selected, deletion protection is turned off with update-user-pool (sending the pool's
    current settings back, because UpdateUserPool resets any setting it is not given) and the
    pool is deleted with all of its users. If that update fails, the pool is preserved.

    CloudFormation may leave the stack's secrets scheduled for deletion with a recovery window.
    When selected, they are force-deleted without recovery. The template does not name its
    secrets, so a redeploy never collides with them either way.

.PARAMETER Region
    AWS region of the stack.

.PARAMETER StackName
    Main CloudFormation stack name.

.PARAMETER Environment
    Environment name used for resource naming conventions. Defaults to the stack's
    EnvironmentName parameter.

.PARAMETER Profile
    Optional AWS CLI profile.

.PARAMETER DeleteAll
    Ask once to delete the stack and all stack-associated retained resources (vault buckets
    still require typing their name; a reused vault bucket is never included).

.PARAMETER Force
    Skip all confirmation prompts and delete the stack and all stack-associated retained
    resources (a reused vault bucket is still never included, and a failed vault backup still
    preserves the bucket).

.PARAMETER SkipVaultBackup
    Do not export the database or download the archive bucket before deleting them.

.EXAMPLE
    .\teardown.ps1 -Region ca-central-1 -StackName Folio-QA

.EXAMPLE
    .\teardown.ps1 -Region ca-central-1 -StackName Folio-QA -DeleteAll

.EXAMPLE
    .\teardown.ps1 -Region ca-central-1 -StackName Folio-QA -Force
#>
[CmdletBinding()]
param (
    [string]$Region = "ca-central-1",
    [string]$StackName = "folio-prod",
    [string]$Environment = "",
    [string]$Profile = "",
    # Ask once to delete the stack and all stack-associated retained resources.
    [switch]$DeleteAll,
    # Skip all confirmation prompts and delete the stack and all stack-associated retained resources.
    [switch]$Force,
    # Do not export the database or download archives before deleting them.
    [switch]$SkipVaultBackup
)

$ErrorActionPreference = "Stop"

function Invoke-Aws {
    param (
        [string[]]$Arguments,
        [switch]$AllowFailure,
        [switch]$IncludeRegion = $true
    )

    $fullArgs = @()
    if ($Profile.Trim()) {
        $fullArgs += @("--profile", $Profile.Trim())
    }
    if ($IncludeRegion) {
        $fullArgs += @("--region", $Region)
    }
    $fullArgs += $Arguments

    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & aws @fullArgs 2>&1
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prevEap
    }

    $text = ($output | ForEach-Object { $_.ToString() }) -join "`n"
    if ($code -ne 0 -and -not $AllowFailure) {
        throw "AWS CLI failed (exit $code): aws $($Arguments -join ' ')`n$text"
    }

    return [pscustomobject]@{
        ExitCode = $code
        Output   = $text
    }
}

function Confirm-Action {
    param (
        [string]$Prompt,
        [bool]$DefaultYes = $false
    )

    if ($Force) {
        return $true
    }

    $suffix = if ($DefaultYes) { "[Y/n]" } else { "[y/N]" }
    $reply = (Read-Host "$Prompt $suffix").Trim()
    if ([string]::IsNullOrWhiteSpace($reply)) {
        return $DefaultYes
    }
    return ($reply -match '^(y|yes)$')
}

function Confirm-TypedName {
    param (
        [string]$Prompt,
        [string]$Expected
    )

    if ($Force) {
        return $true
    }

    $reply = Read-Host $Prompt
    if ($null -eq $reply) { return $false }
    return ($reply.Trim() -ceq $Expected)
}

function Backup-VaultDatabase {
    # Downloads the vault: database/folio.db.zst (zstd-compressed SQLite), or the plain
    # database/folio.db an older release wrote. Returns Ok=$false (bucket must be preserved)
    # on any failure.
    param ([string]$BucketName)

    $key = $null
    $head = $null
    foreach ($candidate in @("database/folio.db.zst", "database/folio.db")) {
        $probe = Invoke-Aws -Arguments @("s3api", "head-object", "--bucket", $BucketName, "--key", $candidate, "--output", "json") -AllowFailure
        if ($probe.ExitCode -eq 0) { $key = $candidate; $head = $probe; break }
        if ($probe.Output -notmatch '\(404\)|Not Found|NoSuchKey') {
            return [pscustomobject]@{ Ok = $false; Path = $null; Note = "head-object failed: $($probe.Output)" }
        }
    }
    if (-not $key) {
        return [pscustomobject]@{ Ok = $true; Path = $null; Note = "no current vault object to back up" }
    }
    $expectedLength = [long](($head.Output | ConvertFrom-Json).ContentLength)

    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $extension = if ($key.EndsWith(".zst")) { ".db.zst" } else { ".db" }
    $path = Join-Path (Get-Location).Path "folio-vault-backup-$BucketName-$stamp$extension"
    $get = Invoke-Aws -Arguments @("s3api", "get-object", "--bucket", $BucketName, "--key", $key, $path, "--output", "json") -AllowFailure
    if ($get.ExitCode -ne 0 -or -not (Test-Path $path) -or (Get-Item $path).Length -ne $expectedLength) {
        Remove-Item $path -Force -ErrorAction SilentlyContinue
        return [pscustomobject]@{ Ok = $false; Path = $null; Note = "download failed or size mismatch: $($get.Output)" }
    }
    return [pscustomobject]@{ Ok = $true; Path = $path; Note = "$expectedLength bytes" }
}

function Backup-VaultArchives {
    # Downloads closed-year archives (archives/). Returns Ok=$false (bucket must be preserved)
    # on any failure.
    param ([string]$BucketName)

    $list = Invoke-Aws -Arguments @("s3api", "list-objects-v2", "--bucket", $BucketName, "--prefix", "archives/", "--query", "KeyCount", "--output", "text") -AllowFailure
    if ($list.ExitCode -ne 0) {
        return [pscustomobject]@{ Ok = $false; Path = $null; Note = "list-objects failed: $($list.Output)" }
    }
    $count = 0
    [void][int]::TryParse("$($list.Output)".Trim(), [ref]$count)
    if ($count -eq 0) {
        return [pscustomobject]@{ Ok = $true; Path = $null; Note = "no closed-year archives" }
    }

    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $folder = Join-Path (Get-Location).Path "folio-vault-backup-$BucketName-$stamp-archives"
    $sync = Invoke-Aws -Arguments @("s3", "sync", "s3://$BucketName/archives/", $folder, "--only-show-errors") -AllowFailure
    $saved = if (Test-Path $folder) { @(Get-ChildItem -Path $folder -Recurse -File).Count } else { 0 }
    if ($sync.ExitCode -ne 0 -or $saved -lt $count) {
        return [pscustomobject]@{ Ok = $false; Path = $null; Note = "archive download failed ($saved of $count): $($sync.Output)" }
    }
    return [pscustomobject]@{ Ok = $true; Path = $folder; Note = "$saved archive file(s)" }
}

function Backup-FolioDatabase {
    # Exports every table of the cluster to a compressed SQLite file with the app's own CLI,
    # signed in as the database admin. Returns Ok=$false (database must be preserved) on failure.
    param ([string]$ClusterId, [string]$Endpoint)

    if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
        return [pscustomobject]@{ Ok = $false; Path = $null; Note = "uv is not installed (winget install astral-sh.uv)" }
    }
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $path = Join-Path (Get-Location).Path "folio-db-backup-$ClusterId-$stamp.db.zst"
    $vars = @{ DSQL_ENDPOINT = $Endpoint; AWS_REGION = $Region; FOLIO_SKIP_STARTUP_TASKS = "1" }
    if ($Profile) { $vars["AWS_PROFILE"] = $Profile }
    $saved = @{}
    foreach ($name in $vars.Keys) {
        $saved[$name] = [Environment]::GetEnvironmentVariable($name)
        [Environment]::SetEnvironmentVariable($name, $vars[$name])
    }
    try {
        $out = & uv run --directory (Join-Path $PSScriptRoot "backend") --quiet python -m app.cli export "$path" 2>&1
        $code = $LASTEXITCODE
    } finally {
        foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name]) }
    }
    if ($code -ne 0 -or -not (Test-Path $path) -or (Get-Item $path).Length -eq 0) {
        Remove-Item $path -Force -ErrorAction SilentlyContinue
        return [pscustomobject]@{ Ok = $false; Path = $null; Note = "export failed: $($out | Select-Object -Last 3)" }
    }
    return [pscustomobject]@{ Ok = $true; Path = $path; Note = "$((Get-Item $path).Length) bytes" }
}

function Remove-DsqlCluster {
    # Turns off deletion protection, then deletes the cluster and waits until it is gone.
    param ([string]$ClusterId)

    $upd = Invoke-Aws -Arguments @("dsql", "update-cluster", "--identifier", $ClusterId, "--no-deletion-protection-enabled", "--output", "json") -AllowFailure
    if ($upd.ExitCode -ne 0) {
        throw "Could not turn off deletion protection on database '$ClusterId' (preserved):`n$($upd.Output)"
    }
    $del = Invoke-Aws -Arguments @("dsql", "delete-cluster", "--identifier", $ClusterId, "--output", "json") -AllowFailure
    if ($del.ExitCode -ne 0) {
        throw "Deletion protection on database '$ClusterId' was turned off but delete-cluster failed:`n$($del.Output)"
    }
    Invoke-Aws -Arguments @("dsql", "wait", "cluster-not-exists", "--identifier", $ClusterId) -AllowFailure | Out-Null
}

function Remove-BackupVault {
    # Deletes every recovery point in the vault, then the vault.
    param ([string]$VaultName)

    $list = Invoke-Aws -Arguments @("backup", "list-recovery-points-by-backup-vault", "--backup-vault-name", $VaultName, "--query", "RecoveryPoints[].RecoveryPointArn", "--output", "json") -AllowFailure
    if ($list.ExitCode -ne 0) { throw "Could not list recovery points in '$VaultName':`n$($list.Output)" }
    foreach ($arn in @($list.Output | ConvertFrom-Json)) {
        if (-not $arn) { continue }
        $rp = Invoke-Aws -Arguments @("backup", "delete-recovery-point", "--backup-vault-name", $VaultName, "--recovery-point-arn", $arn) -AllowFailure
        if ($rp.ExitCode -ne 0) { throw "Could not delete recovery point $arn :`n$($rp.Output)" }
    }
    # Deletions are asynchronous; the vault can only go once it is empty.
    for ($i = 0; $i -lt 30; $i++) {
        $del = Invoke-Aws -Arguments @("backup", "delete-backup-vault", "--backup-vault-name", $VaultName) -AllowFailure
        if ($del.ExitCode -eq 0) { return }
        Start-Sleep -Seconds 10
    }
    throw "Backup vault '$VaultName' still has recovery points being deleted; delete it later in the console."
}

function Remove-CognitoUserPool {
    # Turns off deletion protection, then deletes the pool. UpdateUserPool resets every setting
    # it is not given, so the pool's current settings are sent back with the change. If the
    # update fails nothing has changed and the pool is preserved.
    # Returns $false when the pool no longer exists (for example a stack whose template did not
    # retain the pool deleted it together with the stack), $true when this call deleted it.
    param ([string]$PoolId)

    $desc = Invoke-Aws -Arguments @("cognito-idp", "describe-user-pool", "--user-pool-id", $PoolId, "--output", "json") -AllowFailure
    if ($desc.ExitCode -ne 0) {
        if ("$($desc.Output)" -match "ResourceNotFoundException") { return $false }
        throw "Could not read Cognito user pool '$PoolId' (preserved):`n$($desc.Output)"
    }
    $pool = ($desc.Output | ConvertFrom-Json).UserPool

    if ($pool.DeletionProtection -eq "ACTIVE") {
        $request = [ordered]@{ UserPoolId = $PoolId; DeletionProtection = "INACTIVE" }
        $preserve = @(
            "Policies", "LambdaConfig", "AutoVerifiedAttributes", "VerificationMessageTemplate",
            "SmsAuthenticationMessage", "UserAttributeUpdateSettings", "MfaConfiguration",
            "DeviceConfiguration", "EmailConfiguration", "SmsConfiguration", "UserPoolTags",
            "AdminCreateUserConfig", "UserPoolAddOns", "AccountRecoverySetting", "PoolName", "UserPoolTier"
        )
        foreach ($field in $preserve) {
            if ($null -ne $pool.$field) { $request[$field] = $pool.$field }
        }
        # Deprecated field echoed by DescribeUserPool; UpdateUserPool rejects it alongside
        # Policies.PasswordPolicy.TemporaryPasswordValidityDays.
        if ($request.Contains("AdminCreateUserConfig") -and $request["AdminCreateUserConfig"].PSObject.Properties["UnusedAccountValidityDays"]) {
            $request["AdminCreateUserConfig"].PSObject.Properties.Remove("UnusedAccountValidityDays")
        }

        $tmp = [System.IO.Path]::GetTempFileName()
        try {
            [System.IO.File]::WriteAllText($tmp, ($request | ConvertTo-Json -Depth 20), (New-Object System.Text.UTF8Encoding($false)))
            $upd = Invoke-Aws -Arguments @("cognito-idp", "update-user-pool", "--cli-input-json", "file://$tmp") -AllowFailure
        } finally {
            Remove-Item $tmp -Force -ErrorAction SilentlyContinue
        }
        if ($upd.ExitCode -ne 0) {
            throw "Could not turn off deletion protection on '$PoolId' (pool unchanged and preserved):`n$($upd.Output)`nIn the console: Cognito > User pools > $PoolId > Settings > Deletion protection."
        }
    }

    $del = Invoke-Aws -Arguments @("cognito-idp", "delete-user-pool", "--user-pool-id", $PoolId) -AllowFailure
    if ($del.ExitCode -ne 0) {
        throw "Deletion protection on '$PoolId' was turned off but delete-user-pool failed. Review the pool's settings before reusing it:`n$($del.Output)"
    }
    return $true
}

function Get-BucketVersionCounts {
    param ([string]$BucketName)

    $versionsCount = 0
    $markersCount = 0
    $keyMarker = $null
    $verMarker = $null

    do {
        $cmd = @("s3api", "list-object-versions", "--bucket", $BucketName, "--max-keys", "1000", "--output", "json")
        if ($keyMarker) { $cmd += @("--key-marker", $keyMarker) }
        if ($verMarker) { $cmd += @("--version-id-marker", $verMarker) }

        $res = Invoke-Aws -Arguments $cmd -AllowFailure
        if ($res.ExitCode -ne 0 -or -not $res.Output.Trim()) {
            break
        }

        $page = $res.Output | ConvertFrom-Json
        if ($page.Versions) { $versionsCount += @($page.Versions).Count }
        if ($page.DeleteMarkers) { $markersCount += @($page.DeleteMarkers).Count }

        if ($page.IsTruncated -eq $true) {
            $keyMarker = $page.NextKeyMarker
            $verMarker = $page.NextVersionIdMarker
        } else {
            $keyMarker = $null
            $verMarker = $null
        }
    } while ($keyMarker)

    return [pscustomobject]@{
        Versions      = $versionsCount
        DeleteMarkers = $markersCount
    }
}

function Remove-VersionedS3Bucket {
    param ([string]$BucketName)

    $tmpFile = [System.IO.Path]::GetTempFileName()
    try {
        while ($true) {
            $res = Invoke-Aws -Arguments @(
                "s3api", "list-object-versions",
                "--bucket", $BucketName,
                "--max-keys", "1000",
                "--output", "json"
            )
            if (-not $res.Output.Trim()) { break }

            $page = $res.Output | ConvertFrom-Json
            $entries = @()
            if ($page.Versions) {
                foreach ($v in $page.Versions) {
                    $entries += @{ Key = $v.Key; VersionId = $v.VersionId }
                }
            }
            if ($page.DeleteMarkers) {
                foreach ($m in $page.DeleteMarkers) {
                    $entries += @{ Key = $m.Key; VersionId = $m.VersionId }
                }
            }

            if ($entries.Count -eq 0) {
                break
            }

            for ($offset = 0; $offset -lt $entries.Count; $offset += 1000) {
                $end = [Math]::Min($offset + 999, $entries.Count - 1)
                $batch = @()
                for ($i = $offset; $i -le $end; $i++) {
                    $batch += $entries[$i]
                }
                $json = (@{ Objects = @($batch); Quiet = $true } | ConvertTo-Json -Depth 5 -Compress)
                [System.IO.File]::WriteAllText($tmpFile, $json, (New-Object System.Text.UTF8Encoding($false)))
                $uri = "file://$tmpFile"
                $delRes = Invoke-Aws -Arguments @("s3api", "delete-objects", "--bucket", $BucketName, "--delete", $uri, "--output", "json")
                if ($delRes.Output.Trim()) {
                    $delParsed = $delRes.Output | ConvertFrom-Json
                    $delErrors = @()
                    if ($null -ne $delParsed.Errors) {
                        $delErrors = @($delParsed.Errors)
                    }
                    if ($delErrors.Count -gt 0) {
                        $errDetails = ($delErrors | ForEach-Object { "$($_.Key) ($($_.VersionId)): $($_.Code) - $($_.Message)" }) -join "; "
                        throw "S3 delete-objects reported $($delErrors.Count) error(s) for '$BucketName': $errDetails"
                    }
                }
            }
        }
    } finally {
        if (Test-Path $tmpFile) {
            Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
        }
    }

    Invoke-Aws -Arguments @("s3api", "delete-bucket", "--bucket", $BucketName) | Out-Null
}

function Get-EcrImageDigests {
    param (
        [string]$RepositoryName,
        [switch]$AllowFailure
    )

    $digests = New-Object System.Collections.Generic.HashSet[string]
    $nextToken = $null
    do {
        $cmd = @("ecr", "list-images", "--repository-name", $RepositoryName, "--max-results", "1000", "--output", "json")
        if ($nextToken) { $cmd += @("--next-token", $nextToken) }
        $res = Invoke-Aws -Arguments $cmd -AllowFailure:$AllowFailure
        if ($res.ExitCode -ne 0 -or -not $res.Output.Trim()) { break }

        $page = $res.Output | ConvertFrom-Json
        if ($page.imageIds) {
            foreach ($img in $page.imageIds) {
                if ($img.imageDigest) {
                    $null = $digests.Add($img.imageDigest)
                }
            }
        }
        $nextToken = $page.nextToken
    } while ($nextToken)

    return @($digests)
}

function Clear-EcrRepository {
    param ([string]$RepositoryName)

    $maxPasses = 3
    for ($pass = 1; $pass -le $maxPasses; $pass++) {
        [string[]]$digests = @(Get-EcrImageDigests -RepositoryName $RepositoryName)
        if ($digests.Count -eq 0) { return }

        $deletedInPass = 0
        $deferredFailures = @()

        for ($offset = 0; $offset -lt $digests.Count; $offset += 100) {
            $end = [Math]::Min($offset + 99, $digests.Count - 1)
            $batchArgs = @()
            for ($i = $offset; $i -le $end; $i++) {
                $batchArgs += "imageDigest=$($digests[$i])"
            }

            $cmd = @("ecr", "batch-delete-image", "--repository-name", $RepositoryName, "--image-ids") + $batchArgs + @("--output", "json")
            $res = Invoke-Aws -Arguments $cmd

            if ($res.Output.Trim()) {
                $parsed = $res.Output | ConvertFrom-Json
                $deletedBatch = @()
                if ($null -ne $parsed.imageIds) {
                    $deletedBatch = @($parsed.imageIds)
                }
                $deletedInPass += $deletedBatch.Count

                $failures = @()
                if ($null -ne $parsed.failures) {
                    $failures = @($parsed.failures)
                }
                foreach ($f in $failures) {
                    if ($f.failureCode -eq "ImageReferencedByManifestList") {
                        $deferredFailures += $f
                    } else {
                        throw "ECR batch-delete-image failed for '$RepositoryName' ($($f.failureCode)): $($f.failureReason)"
                    }
                }
            }
        }

        if ($deferredFailures.Count -eq 0) {
            break
        }
        if ($deletedInPass -eq 0) {
            $details = ($deferredFailures | ForEach-Object { "$($_.failureCode): $($_.failureReason)" }) -join "; "
            throw "ECR batch-delete-image could not make progress on '$RepositoryName': $details"
        }
    }

    [string[]]$remaining = @(Get-EcrImageDigests -RepositoryName $RepositoryName)
    if ($remaining.Count -gt 0) {
        throw "ECR repository '$RepositoryName' still contains $($remaining.Count) image(s) after purge."
    }
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Folio - AWS SAM Serverless Teardown" -ForegroundColor Cyan
Write-Host "Region: $Region | Stack: $StackName" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw "AWS CLI is not installed or not in PATH."
}

# 1. Verify AWS identity
Write-Host "`n[1/4] Verifying AWS Identity & Target Resources..." -ForegroundColor Yellow
$identityJson = (Invoke-Aws -Arguments @("sts", "get-caller-identity", "--output", "json") -IncludeRegion:$false).Output
$identity = $identityJson | ConvertFrom-Json
$AccountId = $identity.Account
$CallerArn = $identity.Arn
Write-Host "Account: $AccountId | Caller: $CallerArn" -ForegroundColor Green

# 2. Inspect main CloudFormation stack
$stackExists = $false
$stackStatus = $null
$stackEnvParam = $null
$stackVaultOutput = $null
$stackBucketPhysicalId = $null
$stackLambdaName = $null
$stackReusedBucket = $null
$stackUserPoolId = $null
$stackSecretArns = @()
$stackClusterId = $null
$stackBackupVault = $null

$stackProbe = Invoke-Aws -Arguments @("cloudformation", "describe-stacks", "--stack-name", $StackName, "--output", "json") -AllowFailure
if ($stackProbe.ExitCode -eq 0 -and $stackProbe.Output.Trim()) {
    $stackObj = ($stackProbe.Output | ConvertFrom-Json).Stacks[0]
    if ($stackObj -and $stackObj.StackStatus -ne "DELETE_COMPLETE") {
        $stackExists = $true
        $stackStatus = $stackObj.StackStatus
        if ($stackObj.Parameters) {
            $envParam = $stackObj.Parameters | Where-Object { $_.ParameterKey -eq "EnvironmentName" } | Select-Object -First 1
            if ($envParam) { $stackEnvParam = $envParam.ParameterValue }
            $reuseParam = $stackObj.Parameters | Where-Object { $_.ParameterKey -eq "ExistingVaultBucketName" } | Select-Object -First 1
            if ($reuseParam -and -not [string]::IsNullOrWhiteSpace($reuseParam.ParameterValue)) {
                $stackReusedBucket = $reuseParam.ParameterValue.Trim()
            }
        }
        if ($stackObj.Outputs) {
            $vaultOut = $stackObj.Outputs | Where-Object { $_.OutputKey -eq "S3VaultBucket" } | Select-Object -First 1
            if ($vaultOut) { $stackVaultOutput = $vaultOut.OutputValue }
        }

        $resProbe = Invoke-Aws -Arguments @("cloudformation", "describe-stack-resources", "--stack-name", $StackName, "--output", "json") -AllowFailure
        if ($resProbe.ExitCode -eq 0 -and $resProbe.Output.Trim()) {
            $resources = ($resProbe.Output | ConvertFrom-Json).StackResources
            $vaultRes = $resources | Where-Object { $_.LogicalResourceId -eq "FolioStorageVault" } | Select-Object -First 1
            if ($vaultRes -and $vaultRes.PhysicalResourceId) { $stackBucketPhysicalId = $vaultRes.PhysicalResourceId }
            $fnRes = $resources | Where-Object { $_.LogicalResourceId -eq "FolioServerlessFunction" } | Select-Object -First 1
            if ($fnRes -and $fnRes.PhysicalResourceId) { $stackLambdaName = $fnRes.PhysicalResourceId }
            $poolRes = $resources | Where-Object { $_.ResourceType -eq "AWS::Cognito::UserPool" } | Select-Object -First 1
            if ($poolRes -and $poolRes.PhysicalResourceId) { $stackUserPoolId = $poolRes.PhysicalResourceId }
            $stackSecretArns = @($resources | Where-Object { $_.ResourceType -eq "AWS::SecretsManager::Secret" -and $_.PhysicalResourceId } | ForEach-Object { $_.PhysicalResourceId })
            $dbRes = $resources | Where-Object { $_.ResourceType -eq "AWS::DSQL::Cluster" } | Select-Object -First 1
            if ($dbRes -and $dbRes.PhysicalResourceId) { $stackClusterId = $dbRes.PhysicalResourceId }
            $bvRes = $resources | Where-Object { $_.ResourceType -eq "AWS::Backup::BackupVault" } | Select-Object -First 1
            if ($bvRes -and $bvRes.PhysicalResourceId) { $stackBackupVault = $bvRes.PhysicalResourceId }
        }
    }
}

$effectiveEnv = if ($Environment.Trim()) {
    $Environment.Trim().ToLowerInvariant()
} elseif ($stackEnvParam) {
    $stackEnvParam.Trim().ToLowerInvariant()
} else {
    ""
}

# 3. Discover retained S3 vault buckets
$bucketCandidateMap = [ordered]@{}
foreach ($pair in @(
    @{ Name = $stackBucketPhysicalId; Source = "Stack resource (FolioStorageVault)"; IncludeInDeleteAll = $true },
    @{ Name = $stackVaultOutput; Source = "Stack output (S3VaultBucket)"; IncludeInDeleteAll = $true },
    @{ Name = $(if ($effectiveEnv) { "folio-vault-$effectiveEnv-$AccountId-$Region" } else { $null }); Source = "Environment convention ($effectiveEnv)"; IncludeInDeleteAll = $true },
    @{ Name = "folio-vault-$AccountId-$Region"; Source = "Legacy single-bucket convention"; IncludeInDeleteAll = ($effectiveEnv -eq "" -or $effectiveEnv -eq "prod") }
)) {
    $bName = $pair.Name
    if ([string]::IsNullOrWhiteSpace($bName)) { continue }
    if ($bucketCandidateMap.Contains($bName)) {
        if ($pair.IncludeInDeleteAll) { $bucketCandidateMap[$bName].IncludeInDeleteAll = $true }
    } else {
        $bucketCandidateMap[$bName] = @{
            Source             = $pair.Source
            IncludeInDeleteAll = $pair.IncludeInDeleteAll
        }
    }
}

# A bucket the stack merely reused (ExistingVaultBucketName) predates the stack: never bulk-delete it.
if ($stackReusedBucket -and $bucketCandidateMap.Contains($stackReusedBucket)) {
    $bucketCandidateMap[$stackReusedBucket].IncludeInDeleteAll = $false
    $bucketCandidateMap[$stackReusedBucket].Source = "Reused by stack (ExistingVaultBucketName)"
}

$discoveredBuckets = @()
foreach ($bName in $bucketCandidateMap.Keys) {
    $head = Invoke-Aws -Arguments @("s3api", "head-bucket", "--bucket", $bName) -AllowFailure
    if ($head.ExitCode -eq 0) {
        $counts = Get-BucketVersionCounts -BucketName $bName
        $discoveredBuckets += [pscustomobject]@{
            Name               = $bName
            Source             = $bucketCandidateMap[$bName].Source
            IncludeInDeleteAll = $bucketCandidateMap[$bName].IncludeInDeleteAll
            Reused             = ($bName -eq $stackReusedBucket)
            Versions           = $counts.Versions
            DeleteMarkers      = $counts.DeleteMarkers
        }
    }
}

# 3b. Discover the retained Cognito User Pool (stack resource, or name convention once the stack is gone)
$userPoolCandidates = [ordered]@{}
if ($stackUserPoolId) {
    $userPoolCandidates[$stackUserPoolId] = @{ Source = "Stack resource (FolioUserPool)"; IncludeInDeleteAll = $true }
}
if ($effectiveEnv) {
    $poolName = "folio-userpool-$effectiveEnv"
    $poolToken = $null
    do {
        $cmd = @("cognito-idp", "list-user-pools", "--max-results", "60", "--output", "json")
        if ($poolToken) { $cmd += @("--next-token", $poolToken) }
        $poolRes = Invoke-Aws -Arguments $cmd -AllowFailure
        if ($poolRes.ExitCode -ne 0 -or -not $poolRes.Output.Trim()) { break }
        $poolPage = $poolRes.Output | ConvertFrom-Json
        foreach ($p in @($poolPage.UserPools)) {
            if ($p.Name -eq $poolName -and -not $userPoolCandidates.Contains($p.Id)) {
                # Not provably this stack's pool: interactive deletion only.
                $userPoolCandidates[$p.Id] = @{ Source = "Name convention ($poolName)"; IncludeInDeleteAll = $false }
            }
        }
        $poolToken = $poolPage.NextToken
    } while ($poolToken)
}

$discoveredUserPools = @()
foreach ($poolId in $userPoolCandidates.Keys) {
    $poolDesc = Invoke-Aws -Arguments @("cognito-idp", "describe-user-pool", "--user-pool-id", $poolId, "--output", "json") -AllowFailure
    if ($poolDesc.ExitCode -eq 0 -and $poolDesc.Output.Trim()) {
        $up = ($poolDesc.Output | ConvertFrom-Json).UserPool
        $discoveredUserPools += [pscustomobject]@{
            Id                 = $poolId
            Name               = $up.Name
            Users              = $up.EstimatedNumberOfUsers
            DeletionProtection = $up.DeletionProtection
            Source             = $userPoolCandidates[$poolId].Source
            IncludeInDeleteAll = $userPoolCandidates[$poolId].IncludeInDeleteAll
        }
    }
}

# 3a. Discover the retained database (stack resource, or Name tag folio-<env> once the stack is gone)
$clusterCandidates = [ordered]@{}
if ($stackClusterId) {
    $clusterCandidates[$stackClusterId] = @{ Source = "Stack resource (FolioDatabase)"; IncludeInDeleteAll = $true }
}
if ($effectiveEnv) {
    $clList = Invoke-Aws -Arguments @("dsql", "list-clusters", "--output", "json") -AllowFailure
    if ($clList.ExitCode -eq 0 -and $clList.Output.Trim()) {
        foreach ($c in @(($clList.Output | ConvertFrom-Json).clusters)) {
            if (-not $c.identifier -or $clusterCandidates.Contains($c.identifier)) { continue }
            $tags = Invoke-Aws -Arguments @("dsql", "list-tags-for-resource", "--resource-arn", $c.arn, "--output", "json") -AllowFailure
            if ($tags.ExitCode -eq 0 -and $tags.Output.Trim()) {
                $tagMap = ($tags.Output | ConvertFrom-Json).tags
                if ($tagMap -and $tagMap.Name -eq "folio-$effectiveEnv") {
                    # Not provably this stack's database: interactive deletion only.
                    $clusterCandidates[$c.identifier] = @{ Source = "Name tag (folio-$effectiveEnv)"; IncludeInDeleteAll = $false }
                }
            }
        }
    }
}
$discoveredDatabases = @()
foreach ($cid in $clusterCandidates.Keys) {
    $cg = Invoke-Aws -Arguments @("dsql", "get-cluster", "--identifier", $cid, "--output", "json") -AllowFailure
    if ($cg.ExitCode -eq 0 -and $cg.Output.Trim()) {
        $cl = $cg.Output | ConvertFrom-Json
        $discoveredDatabases += [pscustomobject]@{
            Id                 = $cid
            Endpoint           = if ($cl.endpoint) { $cl.endpoint } else { "$cid.dsql.$Region.on.aws" }
            Status             = $cl.status
            Source             = $clusterCandidates[$cid].Source
            IncludeInDeleteAll = $clusterCandidates[$cid].IncludeInDeleteAll
        }
    }
}
$backupVaultName = if ($stackBackupVault) { $stackBackupVault } elseif ($effectiveEnv) { "folio-$effectiveEnv-$Region" } else { $null }
$discoveredBackupVault = $null
if ($backupVaultName) {
    $bv = Invoke-Aws -Arguments @("backup", "describe-backup-vault", "--backup-vault-name", $backupVaultName, "--output", "json") -AllowFailure
    if ($bv.ExitCode -eq 0) { $discoveredBackupVault = $backupVaultName }
}

# 3c. Stack secrets (deleted by CloudFormation, possibly with a recovery window)
$discoveredSecrets = @($stackSecretArns)

# 4. Discover SAM ECR CompanionStacks
$companionPattern = "^$([regex]::Escape($StackName))-[0-9a-f]{8}-CompanionStack$"
$activeFilters = @(
    "CREATE_IN_PROGRESS", "CREATE_FAILED", "CREATE_COMPLETE",
    "ROLLBACK_IN_PROGRESS", "ROLLBACK_FAILED", "ROLLBACK_COMPLETE",
    "UPDATE_IN_PROGRESS", "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS", "UPDATE_COMPLETE",
    "UPDATE_ROLLBACK_IN_PROGRESS", "UPDATE_ROLLBACK_FAILED", "UPDATE_ROLLBACK_COMPLETE",
    "REVIEW_IN_PROGRESS", "DELETE_IN_PROGRESS", "DELETE_FAILED"
)
$discoveredCompanions = @()
$nextToken = $null
do {
    $cmd = @("cloudformation", "list-stacks", "--stack-status-filter") + $activeFilters + @("--output", "json")
    if ($nextToken) { $cmd += @("--next-token", $nextToken) }
    $listRes = Invoke-Aws -Arguments $cmd -AllowFailure
    if ($listRes.ExitCode -ne 0 -or -not $listRes.Output.Trim()) { break }
    $page = $listRes.Output | ConvertFrom-Json
    if ($page.StackSummaries) {
        foreach ($s in $page.StackSummaries) {
            if ($s.StackName -match $companionPattern) {
                $repos = @()
                $compRes = Invoke-Aws -Arguments @("cloudformation", "describe-stack-resources", "--stack-name", $s.StackName, "--output", "json") -AllowFailure
                if ($compRes.ExitCode -eq 0 -and $compRes.Output.Trim()) {
                    $ecrItems = @(($compRes.Output | ConvertFrom-Json).StackResources | Where-Object { $_.ResourceType -eq "AWS::ECR::Repository" -and -not [string]::IsNullOrWhiteSpace($_.PhysicalResourceId) })
                    foreach ($r in $ecrItems) {
                        $imgCount = @(Get-EcrImageDigests -RepositoryName $r.PhysicalResourceId -AllowFailure).Count
                        $repos += [pscustomobject]@{
                            Name       = $r.PhysicalResourceId
                            ImageCount = $imgCount
                        }
                    }
                }
                $discoveredCompanions += [pscustomobject]@{
                    StackName    = $s.StackName
                    StackStatus  = $s.StackStatus
                    Repositories = $repos
                }
            }
        }
    }
    $nextToken = $page.NextToken
} while ($nextToken)

# 5. Discover CloudWatch Log Groups. Legacy: /aws/lambda/<function> (written before the app
# log group existed). /folio/<env>/app is stack-owned and deleted with the stack, so it is
# only listed here when no stack exists (an orphan from an earlier stack).
$logGroupSet = New-Object System.Collections.Generic.HashSet[string]
$logPrefixes = @("/aws/lambda/$StackName-FolioServerlessFunction-")
if ($stackLambdaName) {
    $logPrefixes += "/aws/lambda/$stackLambdaName"
}
if (-not $stackExists -and $effectiveEnv) {
    $logPrefixes += "/folio/$effectiveEnv/"
}
foreach ($prefix in $logPrefixes) {
    $logRes = Invoke-Aws -Arguments @("logs", "describe-log-groups", "--log-group-name-prefix", $prefix, "--output", "json") -AllowFailure
    if ($logRes.ExitCode -eq 0 -and $logRes.Output.Trim()) {
        $parsedLogs = $logRes.Output | ConvertFrom-Json
        if ($parsedLogs.logGroups) {
            foreach ($lg in $parsedLogs.logGroups) {
                if ($lg.logGroupName) {
                    $null = $logGroupSet.Add($lg.logGroupName)
                }
            }
        }
    }
}
$discoveredLogGroups = @($logGroupSet | Sort-Object)

# Display discovery summary
Write-Host "`nDiscovered resources:" -ForegroundColor Cyan
if ($stackExists) {
    Write-Host "  - Main Stack:       $StackName ($stackStatus)" -ForegroundColor White
} else {
    Write-Host "  - Main Stack:       (none found)" -ForegroundColor DarkGray
}
if ($discoveredDatabases.Count -gt 0) {
    foreach ($d in $discoveredDatabases) {
        Write-Host "  - Database:         $($d.Id) [$($d.Status)] $($d.Endpoint) - $($d.Source)" -ForegroundColor Yellow
    }
} else {
    Write-Host "  - Database:         (none found)" -ForegroundColor DarkGray
}
if ($discoveredBackupVault) {
    Write-Host "  - Backup Vault:     $discoveredBackupVault (deleted only with the database)" -ForegroundColor Yellow
}
if ($discoveredBuckets.Count -gt 0) {
    foreach ($b in $discoveredBuckets) {
        Write-Host "  - S3 Vault Bucket:  $($b.Name) [$($b.Versions) versions, $($b.DeleteMarkers) delete markers] - $($b.Source)" -ForegroundColor Yellow
    }
} else {
    Write-Host "  - S3 Vault Buckets: (none found)" -ForegroundColor DarkGray
}
if ($discoveredUserPools.Count -gt 0) {
    foreach ($p in $discoveredUserPools) {
        Write-Host "  - Cognito Pool:     $($p.Id) '$($p.Name)' [~$($p.Users) users, deletion protection $($p.DeletionProtection)] - $($p.Source)" -ForegroundColor Yellow
    }
} else {
    Write-Host "  - Cognito Pools:    (none found)" -ForegroundColor DarkGray
}
foreach ($s in $discoveredSecrets) {
    Write-Host "  - Stack Secret:     $s (deleted with the stack; recovery window optional)" -ForegroundColor Yellow
}
if ($discoveredCompanions.Count -gt 0) {
    foreach ($c in $discoveredCompanions) {
        $repoSummary = ($c.Repositories | ForEach-Object { "$($_.Name) ($($_.ImageCount) images)" }) -join ", "
        if (-not $repoSummary) { $repoSummary = "no ECR repos" }
        Write-Host "  - SAM Companion:    $($c.StackName) ($($c.StackStatus)) [$repoSummary]" -ForegroundColor Yellow
    }
} else {
    Write-Host "  - SAM Companions:   (none found)" -ForegroundColor DarkGray
}
if ($discoveredLogGroups.Count -gt 0) {
    foreach ($lg in $discoveredLogGroups) {
        Write-Host "  - CloudWatch Logs:  $lg" -ForegroundColor Yellow
    }
} else {
    Write-Host "  - CloudWatch Logs:  (none found)" -ForegroundColor DarkGray
}

if (-not $stackExists -and $discoveredDatabases.Count -eq 0 -and $discoveredBuckets.Count -eq 0 -and $discoveredUserPools.Count -eq 0 -and $discoveredCompanions.Count -eq 0 -and $discoveredLogGroups.Count -eq 0) {
    Write-Host "`nNothing to tear down for stack '$StackName' in $Region." -ForegroundColor Green
    exit 0
}

# 6. Collect confirmation choices
Write-Host "`n[2/4] Confirming Teardown Actions..." -ForegroundColor Yellow
$deleteMainStack = $false
$databasesToDelete = @()
$bucketsToDelete = @()
$userPoolsToDelete = @()
$secretsToPurge = @()
$companionsToDelete = @()
$logGroupsToDelete = @()

if ($Force -or $DeleteAll) {
    if ($Force) {
        Write-Host "  -Force specified: skipping confirmation prompts and selecting all stack-associated resources." -ForegroundColor DarkYellow
    } elseif (-not (Confirm-Action -Prompt "Delete main stack '$StackName' AND all stack-associated retained resources permanently?" -DefaultYes:$false)) {
        Write-Host "Teardown aborted. No changes were made." -ForegroundColor Yellow
        exit 0
    }
    $deleteMainStack = $stackExists
    foreach ($d in $discoveredDatabases) {
        if (-not $d.IncludeInDeleteAll) {
            Write-Host "  Skipping database '$($d.Id)' (matched by Name tag only; run interactively to delete it)." -ForegroundColor DarkYellow
        } elseif ($Force -or (Confirm-TypedName -Prompt "Type the database id '$($d.Id)' to permanently delete it (anything else keeps it)" -Expected $d.Id)) {
            $databasesToDelete += $d
        } else {
            Write-Host "  Id did not match: keeping database '$($d.Id)'." -ForegroundColor DarkYellow
        }
    }
    foreach ($b in $discoveredBuckets) {
        if ($b.Reused) {
            Write-Host "  Skipping reused vault bucket '$($b.Name)' (ExistingVaultBucketName; it predates this stack). Run interactively without -Force/-DeleteAll to delete it." -ForegroundColor DarkYellow
        } elseif (-not $b.IncludeInDeleteAll) {
            Write-Host "  Skipping legacy bucket '$($b.Name)' (not bound to '$StackName'; run interactively without -Force/-DeleteAll if you intend to delete it)." -ForegroundColor DarkYellow
        } elseif (Confirm-TypedName -Prompt "Type the bucket name '$($b.Name)' to permanently delete the vault (anything else keeps it)" -Expected $b.Name) {
            $bucketsToDelete += $b
        } else {
            Write-Host "  Name did not match: keeping vault bucket '$($b.Name)'." -ForegroundColor DarkYellow
        }
    }
    foreach ($p in $discoveredUserPools) {
        if ($p.IncludeInDeleteAll) {
            $userPoolsToDelete += $p
        } else {
            Write-Host "  Skipping Cognito pool '$($p.Id)' (matched by name only; run interactively to delete it)." -ForegroundColor DarkYellow
        }
    }
    $secretsToPurge = @($discoveredSecrets)
    $companionsToDelete = @($discoveredCompanions)
    $logGroupsToDelete = @($discoveredLogGroups)
} else {
    if ($stackExists) {
        $deleteMainStack = Confirm-Action -Prompt "Destroy CloudFormation stack '$StackName' ($stackStatus)?" -DefaultYes:$false
        if (-not $deleteMainStack) {
            Write-Host "Teardown aborted. No changes were made." -ForegroundColor Yellow
            exit 0
        }
    }

    foreach ($d in $discoveredDatabases) {
        $prompt = "[PRESERVED BY DEFAULT] Database '$($d.Id)' ($($d.Endpoint)). Type its id to export it and delete it permanently, or press Enter to keep it"
        if (Confirm-TypedName -Prompt $prompt -Expected $d.Id) {
            $databasesToDelete += $d
        }
    }

    foreach ($b in $discoveredBuckets) {
        $reusedNote = if ($b.Reused) { " It was reused via ExistingVaultBucketName." } else { "" }
        $prompt = "[PRESERVED BY DEFAULT] S3 vault '$($b.Name)' ($($b.Versions) versions, $($b.DeleteMarkers) delete markers).$reusedNote Type the bucket name to permanently empty and delete it, or press Enter to keep it"
        if (Confirm-TypedName -Prompt $prompt -Expected $b.Name) {
            $bucketsToDelete += $b
        }
    }

    foreach ($p in $discoveredUserPools) {
        if (Confirm-Action -Prompt "[PRESERVED BY DEFAULT] Delete Cognito user pool '$($p.Id)' ('$($p.Name)', ~$($p.Users) users)? Users must be re-invited and re-enrol MFA" -DefaultYes:$false) {
            $userPoolsToDelete += $p
        }
    }

    if ($discoveredSecrets.Count -gt 0 -and $deleteMainStack) {
        if (Confirm-Action -Prompt "[OPTIONAL] Force-delete the stack's $($discoveredSecrets.Count) secret(s) without a recovery window once the stack is gone?" -DefaultYes:$false) {
            $secretsToPurge = @($discoveredSecrets)
        }
    }

    foreach ($c in $discoveredCompanions) {
        $repoDesc = ($c.Repositories | ForEach-Object { "$($_.Name): $($_.ImageCount) images" }) -join "; "
        if (-not $repoDesc) { $repoDesc = "empty" }
        if (Confirm-Action -Prompt "[PRESERVED BY DEFAULT] Purge ECR images ($repoDesc) and delete SAM CompanionStack '$($c.StackName)'?" -DefaultYes:$false) {
            $companionsToDelete += $c
        }
    }

    foreach ($lg in $discoveredLogGroups) {
        if (Confirm-Action -Prompt "[PRESERVED BY DEFAULT] Delete CloudWatch Log Group '$lg'?" -DefaultYes:$false) {
            $logGroupsToDelete += $lg
        }
    }
}

if (-not $deleteMainStack -and $databasesToDelete.Count -eq 0 -and $bucketsToDelete.Count -eq 0 -and $userPoolsToDelete.Count -eq 0 -and $companionsToDelete.Count -eq 0 -and $logGroupsToDelete.Count -eq 0) {
    Write-Host "Nothing selected for deletion. Exiting cleanly." -ForegroundColor Yellow
    exit 0
}

# 7. Execute deletions in dependency order
Write-Host "`n[3/4] Executing Teardown..." -ForegroundColor Yellow
$deletedItems = @()
$failedItems = @()
$backupFiles = @()

$skippedDatabases = @()
foreach ($d in $databasesToDelete) {
    if (-not $SkipVaultBackup) {
        Write-Host "Exporting database '$($d.Id)'..." -ForegroundColor Gray
        $export = Backup-FolioDatabase -ClusterId $d.Id -Endpoint $d.Endpoint
        if (-not $export.Ok) {
            Write-Host "  Export FAILED ($($export.Note)). Preserving database '$($d.Id)'." -ForegroundColor Red
            $failedItems += "Database $($d.Id) preserved: export failed"
            $skippedDatabases += $d.Id
            continue
        }
        Write-Host "  Saved $($export.Path) ($($export.Note))." -ForegroundColor Green
        $backupFiles += $export.Path
    }
}
$databasesToDelete = @($databasesToDelete | Where-Object { $skippedDatabases -notcontains $_.Id })

if ($deleteMainStack) {
    Write-Host "Deleting CloudFormation stack '$StackName' (the CloudFront distribution can take several minutes)..." -ForegroundColor Gray
    Invoke-Aws -Arguments @("cloudformation", "delete-stack", "--stack-name", $StackName) | Out-Null
    Write-Host "Waiting for stack deletion to complete..." -ForegroundColor Gray
    Invoke-Aws -Arguments @("cloudformation", "wait", "stack-delete-complete", "--stack-name", $StackName) | Out-Null
    $deletedItems += "CloudFormation stack: $StackName"
}

foreach ($s in $secretsToPurge) {
    $sd = Invoke-Aws -Arguments @("secretsmanager", "describe-secret", "--secret-id", $s, "--output", "json") -AllowFailure
    if ($sd.ExitCode -ne 0) {
        # ResourceNotFound: CloudFormation already removed it outright.
        continue
    }
    Write-Host "Force-deleting secret '$s' without recovery..." -ForegroundColor Gray
    $sdel = Invoke-Aws -Arguments @("secretsmanager", "delete-secret", "--secret-id", $s, "--force-delete-without-recovery", "--output", "json") -AllowFailure
    if ($sdel.ExitCode -eq 0) {
        $deletedItems += "Secret (no recovery window): $s"
    } else {
        $failedItems += "Secret $s : $($sdel.Output)"
    }
}

foreach ($d in $databasesToDelete) {
    Write-Host "Disabling deletion protection and deleting database '$($d.Id)'..." -ForegroundColor Gray
    try {
        Remove-DsqlCluster -ClusterId $d.Id
        $deletedItems += "Database: $($d.Id)"
    } catch {
        Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
        $failedItems += "Database $($d.Id) preserved"
        $skippedDatabases += $d.Id
    }
}
$databasesToDelete = @($databasesToDelete | Where-Object { $skippedDatabases -notcontains $_.Id })
if ($discoveredBackupVault -and $databasesToDelete.Count -gt 0) {
    Write-Host "Deleting backup vault '$discoveredBackupVault' and its recovery points..." -ForegroundColor Gray
    try {
        Remove-BackupVault -VaultName $discoveredBackupVault
        $deletedItems += "Backup vault: $discoveredBackupVault"
    } catch {
        Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
        $failedItems += "Backup vault $discoveredBackupVault preserved"
    }
}

$skippedBuckets = @()
foreach ($b in $bucketsToDelete) {
    if (-not $SkipVaultBackup) {
        Write-Host "Backing up the vault from '$($b.Name)'..." -ForegroundColor Gray
        $backup = Backup-VaultDatabase -BucketName $b.Name
        if (-not $backup.Ok) {
            Write-Host "  Backup FAILED ($($backup.Note)). Preserving vault bucket '$($b.Name)'." -ForegroundColor Red
            $failedItems += "S3 vault bucket $($b.Name) preserved: backup failed"
            $skippedBuckets += $b.Name
            continue
        }
        if ($backup.Path) {
            Write-Host "  Saved $($backup.Path) ($($backup.Note))." -ForegroundColor Green
            $backupFiles += $backup.Path
        } else {
            Write-Host "  Nothing to back up: $($backup.Note)." -ForegroundColor DarkYellow
        }
        $archives = Backup-VaultArchives -BucketName $b.Name
        if (-not $archives.Ok) {
            Write-Host "  Archive backup FAILED ($($archives.Note)). Preserving vault bucket '$($b.Name)'." -ForegroundColor Red
            $failedItems += "S3 vault bucket $($b.Name) preserved: archive backup failed"
            $skippedBuckets += $b.Name
            continue
        }
        if ($archives.Path) {
            Write-Host "  Saved $($archives.Path) ($($archives.Note))." -ForegroundColor Green
            $backupFiles += $archives.Path
        }
    }
    Write-Host "Emptying all versions and deleting S3 vault '$($b.Name)'..." -ForegroundColor Gray
    Remove-VersionedS3Bucket -BucketName $b.Name
    $deletedItems += "S3 vault bucket: $($b.Name)"
}
$bucketsToDelete = @($bucketsToDelete | Where-Object { $skippedBuckets -notcontains $_.Name })

$skippedPools = @()
foreach ($p in $userPoolsToDelete) {
    Write-Host "Disabling deletion protection and deleting Cognito user pool '$($p.Id)'..." -ForegroundColor Gray
    try {
        if (Remove-CognitoUserPool -PoolId $p.Id) {
            $deletedItems += "Cognito user pool: $($p.Id) ($($p.Name))"
        } else {
            Write-Host "  Already gone: the stack deleted it (its template did not retain the pool)." -ForegroundColor DarkGray
            $deletedItems += "Cognito user pool: $($p.Id) ($($p.Name)), deleted with the stack"
        }
    } catch {
        Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
        $failedItems += "Cognito user pool $($p.Id) preserved"
        $skippedPools += $p.Id
    }
}
$userPoolsToDelete = @($userPoolsToDelete | Where-Object { $skippedPools -notcontains $_.Id })

foreach ($c in $companionsToDelete) {
    foreach ($r in $c.Repositories) {
        if ($r.ImageCount -gt 0) {
            Write-Host "Purging $($r.ImageCount) image(s) from ECR repository '$($r.Name)'..." -ForegroundColor Gray
            Clear-EcrRepository -RepositoryName $r.Name
        }
    }
    Write-Host "Deleting SAM CompanionStack '$($c.StackName)'..." -ForegroundColor Gray
    Invoke-Aws -Arguments @("cloudformation", "delete-stack", "--stack-name", $c.StackName) | Out-Null
    Invoke-Aws -Arguments @("cloudformation", "wait", "stack-delete-complete", "--stack-name", $c.StackName) | Out-Null
    $deletedItems += "SAM CompanionStack + ECR: $($c.StackName)"
}

foreach ($lg in $logGroupsToDelete) {
    Write-Host "Deleting CloudWatch Log Group '$lg'..." -ForegroundColor Gray
    Invoke-Aws -Arguments @("logs", "delete-log-group", "--log-group-name", $lg) | Out-Null
    $deletedItems += "CloudWatch Log Group: $lg"
}

# 8. Final report
Write-Host "`n[4/4] Teardown Summary" -ForegroundColor Yellow
Write-Host "Deleted:" -ForegroundColor Green
foreach ($d in $deletedItems) {
    Write-Host "  - $d" -ForegroundColor White
}
if ($backupFiles.Count -gt 0) {
    Write-Host "Backups saved:" -ForegroundColor Green
    foreach ($f in $backupFiles) {
        Write-Host "  - $f" -ForegroundColor White
    }
}
if ($failedItems.Count -gt 0) {
    Write-Host "Not deleted (see messages above):" -ForegroundColor Red
    foreach ($f in $failedItems) {
        Write-Host "  - $f" -ForegroundColor White
    }
}

$deletedDatabaseIds = @($databasesToDelete | ForEach-Object { $_.Id })
$preservedDatabases = @($discoveredDatabases | Where-Object { $deletedDatabaseIds -notcontains $_.Id })
$deletedBucketNames = @($bucketsToDelete | ForEach-Object { $_.Name })
$deletedPoolIds = @($userPoolsToDelete | ForEach-Object { $_.Id })
$deletedCompanionNames = @($companionsToDelete | ForEach-Object { $_.StackName })
$preservedBuckets = @($discoveredBuckets | Where-Object { $deletedBucketNames -notcontains $_.Name })
$preservedPools = @($discoveredUserPools | Where-Object { $deletedPoolIds -notcontains $_.Id })
$preservedCompanions = @($discoveredCompanions | Where-Object { $deletedCompanionNames -notcontains $_.StackName })
$preservedLogs = @($discoveredLogGroups | Where-Object { $logGroupsToDelete -notcontains $_ })

Write-Host "Preserved:" -ForegroundColor Cyan
if ($stackExists -and -not $deleteMainStack) {
    Write-Host "  - CloudFormation stack: $StackName" -ForegroundColor White
}
foreach ($d in $preservedDatabases) {
    Write-Host "  - Database: $($d.Id) ($($d.Endpoint))" -ForegroundColor White
    Write-Host "    A new deploy creates a new, empty database; export this one with python -m app.cli export and import it there." -ForegroundColor DarkGray
}
foreach ($b in $preservedBuckets) {
    $envFlag = if ($effectiveEnv) { "-Environment $effectiveEnv " } else { "" }
    Write-Host "  - S3 vault bucket: $($b.Name)" -ForegroundColor White
    Write-Host "    Reattach on next deploy: .\deploy.ps1 -Region $Region -StackName $StackName $envFlag-ExistingVaultBucket $($b.Name)" -ForegroundColor DarkGray
}
foreach ($p in $preservedPools) {
    Write-Host "  - Cognito user pool: $($p.Id) ($($p.Name), deletion protection $($p.DeletionProtection))" -ForegroundColor White
    Write-Host "    A new deploy creates a new, empty pool; users in this one are not migrated." -ForegroundColor DarkGray
}
foreach ($c in $preservedCompanions) {
    Write-Host "  - SAM CompanionStack: $($c.StackName)" -ForegroundColor White
}
foreach ($lg in $preservedLogs) {
    Write-Host "  - CloudWatch Log Group: $lg" -ForegroundColor White
}
Write-Host "  - Shared SAM CLI deployment bucket (aws-sam-cli-managed-default-samclisourcebucket-*) intentionally untouched." -ForegroundColor DarkGray
Write-Host "`nTeardown complete." -ForegroundColor Green
