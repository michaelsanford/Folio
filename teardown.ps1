<#
.SYNOPSIS
    Tear down a Folio AWS SAM CloudFormation stack and optionally delete preserved resources.

.DESCRIPTION
    Discovers the main CloudFormation stack, retained S3 vault buckets, SAM ECR CompanionStacks
    and container images, and Lambda CloudWatch Log Groups. By default, prompts individually before
    deleting preserved resources; use -DeleteAll for a single prompt or -Force to delete all
    stack-associated resources without prompting.

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
    [switch]$Force
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

$stackProbe = Invoke-Aws -Arguments @("cloudformation", "describe-stacks", "--stack-name", $StackName, "--output", "json") -AllowFailure
if ($stackProbe.ExitCode -eq 0 -and $stackProbe.Output.Trim()) {
    $stackObj = ($stackProbe.Output | ConvertFrom-Json).Stacks[0]
    if ($stackObj -and $stackObj.StackStatus -ne "DELETE_COMPLETE") {
        $stackExists = $true
        $stackStatus = $stackObj.StackStatus
        if ($stackObj.Parameters) {
            $envParam = $stackObj.Parameters | Where-Object { $_.ParameterKey -eq "EnvironmentName" } | Select-Object -First 1
            if ($envParam) { $stackEnvParam = $envParam.ParameterValue }
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

$discoveredBuckets = @()
foreach ($bName in $bucketCandidateMap.Keys) {
    $head = Invoke-Aws -Arguments @("s3api", "head-bucket", "--bucket", $bName) -AllowFailure
    if ($head.ExitCode -eq 0) {
        $counts = Get-BucketVersionCounts -BucketName $bName
        $discoveredBuckets += [pscustomobject]@{
            Name               = $bName
            Source             = $bucketCandidateMap[$bName].Source
            IncludeInDeleteAll = $bucketCandidateMap[$bName].IncludeInDeleteAll
            Versions           = $counts.Versions
            DeleteMarkers      = $counts.DeleteMarkers
        }
    }
}

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

# 5. Discover Lambda CloudWatch Log Groups
$logGroupSet = New-Object System.Collections.Generic.HashSet[string]
$logPrefixes = @("/aws/lambda/$StackName-FolioServerlessFunction-")
if ($stackLambdaName) {
    $logPrefixes += "/aws/lambda/$stackLambdaName"
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
if ($discoveredBuckets.Count -gt 0) {
    foreach ($b in $discoveredBuckets) {
        Write-Host "  - S3 Vault Bucket:  $($b.Name) [$($b.Versions) versions, $($b.DeleteMarkers) delete markers] - $($b.Source)" -ForegroundColor Yellow
    }
} else {
    Write-Host "  - S3 Vault Buckets: (none found)" -ForegroundColor DarkGray
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

if (-not $stackExists -and $discoveredBuckets.Count -eq 0 -and $discoveredCompanions.Count -eq 0 -and $discoveredLogGroups.Count -eq 0) {
    Write-Host "`nNothing to tear down for stack '$StackName' in $Region." -ForegroundColor Green
    exit 0
}

# 6. Collect confirmation choices
Write-Host "`n[2/4] Confirming Teardown Actions..." -ForegroundColor Yellow
$deleteMainStack = $false
$bucketsToDelete = @()
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
    foreach ($b in $discoveredBuckets) {
        if ($b.IncludeInDeleteAll) {
            $bucketsToDelete += $b
        } else {
            Write-Host "  Skipping legacy bucket '$($b.Name)' (not bound to '$StackName'; run interactively without -Force/-DeleteAll if you intend to delete it)." -ForegroundColor DarkYellow
        }
    }
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

    foreach ($b in $discoveredBuckets) {
        $warn = "[PRESERVED BY DEFAULT] Permanently empty & delete S3 vault '$($b.Name)' ($($b.Versions) versions, $($b.DeleteMarkers) delete markers)? This erases backups irreversibly"
        if (Confirm-Action -Prompt $warn -DefaultYes:$false) {
            $bucketsToDelete += $b
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

if (-not $deleteMainStack -and $bucketsToDelete.Count -eq 0 -and $companionsToDelete.Count -eq 0 -and $logGroupsToDelete.Count -eq 0) {
    Write-Host "Nothing selected for deletion. Exiting cleanly." -ForegroundColor Yellow
    exit 0
}

# 7. Execute deletions in dependency order
Write-Host "`n[3/4] Executing Teardown..." -ForegroundColor Yellow
$deletedItems = @()

if ($deleteMainStack) {
    Write-Host "Deleting CloudFormation stack '$StackName'..." -ForegroundColor Gray
    Invoke-Aws -Arguments @("cloudformation", "delete-stack", "--stack-name", $StackName) | Out-Null
    Write-Host "Waiting for stack deletion to complete..." -ForegroundColor Gray
    Invoke-Aws -Arguments @("cloudformation", "wait", "stack-delete-complete", "--stack-name", $StackName) | Out-Null
    $deletedItems += "CloudFormation stack: $StackName"
}

foreach ($b in $bucketsToDelete) {
    Write-Host "Emptying all versions and deleting S3 vault '$($b.Name)'..." -ForegroundColor Gray
    Remove-VersionedS3Bucket -BucketName $b.Name
    $deletedItems += "S3 vault bucket: $($b.Name)"
}

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

$deletedBucketNames = @($bucketsToDelete | ForEach-Object { $_.Name })
$deletedCompanionNames = @($companionsToDelete | ForEach-Object { $_.StackName })
$preservedBuckets = @($discoveredBuckets | Where-Object { $deletedBucketNames -notcontains $_.Name })
$preservedCompanions = @($discoveredCompanions | Where-Object { $deletedCompanionNames -notcontains $_.StackName })
$preservedLogs = @($discoveredLogGroups | Where-Object { $logGroupsToDelete -notcontains $_ })

Write-Host "Preserved:" -ForegroundColor Cyan
if ($stackExists -and -not $deleteMainStack) {
    Write-Host "  - CloudFormation stack: $StackName" -ForegroundColor White
}
foreach ($b in $preservedBuckets) {
    $envFlag = if ($effectiveEnv) { "-Environment $effectiveEnv " } else { "" }
    Write-Host "  - S3 vault bucket: $($b.Name)" -ForegroundColor White
    Write-Host "    Reattach on next deploy: .\deploy.ps1 -Region $Region -StackName $StackName $envFlag-ExistingVaultBucket $($b.Name)" -ForegroundColor DarkGray
}
foreach ($c in $preservedCompanions) {
    Write-Host "  - SAM CompanionStack: $($c.StackName)" -ForegroundColor White
}
foreach ($lg in $preservedLogs) {
    Write-Host "  - CloudWatch Log Group: $lg" -ForegroundColor White
}
Write-Host "  - Shared SAM CLI deployment bucket (aws-sam-cli-managed-default-samclisourcebucket-*) intentionally untouched." -ForegroundColor DarkGray
Write-Host "`nTeardown complete." -ForegroundColor Green
