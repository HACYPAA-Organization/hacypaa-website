[CmdletBinding()]
param([switch]$ValidateOnly, [switch]$ProtectWebhookSecret)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$releaseRoot = Split-Path -Parent $PSScriptRoot
$apiRoot = Join-Path $releaseRoot 'conference-api'
$wranglerCli = Join-Path $apiRoot 'node_modules/wrangler/bin/wrangler.js'
$checkoutFile = Join-Path $releaseRoot 'assets/js/checkout.js'
$readyFile = Join-Path (Split-Path -Parent $releaseRoot) 'release-20261103-ready.json'
$protectedWebhookFile = Join-Path (Split-Path -Parent $releaseRoot) 'release-20261103-webhook.clixml'
$expectedStripeAccount = 'acct_1U82LpM0AC70O1UB'
$nodeProgram = (Get-Command node -ErrorAction Stop).Source
$pythonProgram = (Get-Command python -ErrorAction Stop).Source
$gitProgram = (Get-Command git -ErrorAction Stop).Source
$releaseBranch = 'release/merch-nov3-2026'
$reviewedMainSha = 'f0ba3f48b5b9ed6ad363448df2664eff79f9cbda'
$releasePaths = @(
    'admin/index.html',
    'assets/css/merch.css',
    'assets/js/checkout.js',
    'assets/js/merch-products.js',
    'assets/js/merch.js',
    'assets/js/preregistration-payment.js',
    'conference-api/src/index.js',
    'conference-api/test/index.spec.js',
    'conference-api/wrangler.jsonc',
    'conference-api/migrations/0010_payment_link_expiry.sql',
    'merch/index.html',
    'payment/index.html',
    'scripts/Publish-Merch.ps1'
)

function Invoke-ReleaseCommand {
    param([string]$Program, [string[]]$Arguments, [string]$Directory)
    Push-Location -LiteralPath $Directory
    try {
        & $Program @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "A release command failed (exit $LASTEXITCODE). Publication has stopped."
        }
    } finally {
        Pop-Location
    }
}

function Read-PrivateReleaseValue {
    param([string]$Label)
    $secureValue = Read-Host $Label -AsSecureString
    $valuePointer = [IntPtr]::Zero
    try {
        $valuePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($valuePointer).Trim()
    } finally {
        if ($valuePointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($valuePointer)
        }
        $secureValue.Dispose()
    }
}

function Test-ReleaseSyntax {
    foreach ($relativePath in @(
        'assets/js/checkout.js',
        'assets/js/merch.js',
        'assets/js/merch-products.js',
        'assets/js/preregistration-payment.js',
        'conference-api/src/index.js'
    )) {
        Get-Content -LiteralPath (Join-Path $releaseRoot $relativePath) -Raw |
            & $nodeProgram --check --input-type=module
        if ($LASTEXITCODE -ne 0) {
            throw "JavaScript validation failed: $relativePath"
        }
    }
    Invoke-ReleaseCommand -Program $pythonProgram `
        -Arguments @('scripts/check_site.py') -Directory $releaseRoot
}

if ($ProtectWebhookSecret) {
    $protectedValue = Read-Host 'Webhook signing secret' -AsSecureString
    try {
        $protectedValue | Export-Clixml -LiteralPath $protectedWebhookFile
    } finally {
        $protectedValue.Dispose()
    }
    Write-Host 'Webhook secret saved with Windows user encryption.'
    return
}

if (-not (Test-Path -LiteralPath $wranglerCli)) {
    throw 'The release dependencies are missing. Run npm ci inside conference-api first.'
}

Test-ReleaseSyntax
if ($ValidateOnly) {
    Write-Host 'Release validation passed. No production settings were changed.'
    return
}

Write-Host ''
Write-Host 'HACYPAA merchandise: final live configuration'
Write-Host 'Use the LIVE keys from TWO GUYS PRESUMABLY LLC.'
Write-Host 'Secret values are entered privately and sent directly to Cloudflare.'
Write-Host ''

$publishableKey = (Read-Host 'Live publishable key (pk_live_)').Trim()
if ($publishableKey -notmatch '^pk_live_[A-Za-z0-9]+$') {
    throw 'A live publishable key beginning pk_live_ is required.'
}

$stripeServerKey = Read-PrivateReleaseValue `
    'Live server API key (rk_live_ preferred; an existing sk_live_ is also supported)'
$stripeWebhookSecret = $null
if (Test-Path -LiteralPath $protectedWebhookFile) {
    $savedPointer = [IntPtr]::Zero
    $savedWebhook = $null
    try {
        $savedWebhook = Import-Clixml -LiteralPath $protectedWebhookFile
        $savedPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($savedWebhook)
        $stripeWebhookSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($savedPointer)
    } catch {
        Write-Host 'Windows could not unlock the saved webhook secret; paste it from the HACYPAA webhook settings.'
    } finally {
        if ($savedPointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($savedPointer)
        }
        if ($savedWebhook) { $savedWebhook.Dispose() }
    }
}
if (-not $stripeWebhookSecret) {
    $stripeWebhookSecret = Read-PrivateReleaseValue `
        'Signing secret for the HACYPAA live webhook (whsec_)'
}

$releasePreviousCi = [Environment]::GetEnvironmentVariable('CI', 'Process')
$releasePreviousMetrics = [Environment]::GetEnvironmentVariable('WRANGLER_SEND_METRICS', 'Process')
$releasePreviousLog = [Environment]::GetEnvironmentVariable('WRANGLER_LOG_PATH', 'Process')

try {
    if ($stripeServerKey -notmatch '^(rk|sk)_live_[A-Za-z0-9]+$') {
        throw 'A LIVE server key beginning rk_live_ or sk_live_ is required.'
    }
    if ($stripeWebhookSecret -notmatch '^whsec_[A-Za-z0-9_-]+$') {
        throw 'A webhook signing secret beginning whsec_ is required.'
    }

    # Verify Checkout API access without creating a customer, payment, or order.
    $stripeHeaders = @{ Authorization = 'Bearer ' + $stripeServerKey }
    try {
        $checkoutAccess = Invoke-RestMethod `
            -Uri 'https://api.stripe.com/v1/checkout/sessions?limit=1' `
            -Headers $stripeHeaders -Method Get
        if ($checkoutAccess.object -ne 'list') {
            throw 'Unexpected Stripe response.'
        }
    } catch {
        throw 'The live server key could not read Checkout Sessions. Check its value and Checkout permissions.'
    }

    # Restricted runtime keys need not have permission to read account settings.
    $stripeAccount = $null
    try {
        $stripeAccount = Invoke-RestMethod -Uri 'https://api.stripe.com/v1/account' `
            -Headers $stripeHeaders -Method Get
    } catch {
        $statusCode = 0
        if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
        if ($statusCode -ne 403) {
            throw 'The live Stripe account could not be verified.'
        }
    }
    if ($stripeAccount) {
        if ($stripeAccount.id -ne $expectedStripeAccount) {
            throw 'This server key belongs to a different Stripe account. No production settings were changed.'
        }
        if (-not $stripeAccount.charges_enabled) {
            throw 'Stripe has not enabled live charges on this account yet.'
        }
    }

    # Update the public client key before preparing the exact website commit.
    $checkoutSource = [IO.File]::ReadAllText($checkoutFile)
    $keyMatcher = [regex]'(?s)(const\s+stripePublishableKey\s*=\s*)["''][^"'']+["'']'
    if ($keyMatcher.Matches($checkoutSource).Count -ne 1) {
        throw 'Could not locate the frontend publishable-key setting.'
    }
    $checkoutSource = $keyMatcher.Replace($checkoutSource, {
        param($match)
        $match.Groups[1].Value + '"' + $publishableKey + '"'
    }, 1)
    [IO.File]::WriteAllText($checkoutFile, $checkoutSource, [Text.UTF8Encoding]::new($false))

    # Prepare the isolated Git checkout before making production changes.
    Push-Location -LiteralPath $releaseRoot
    try {
        $originUrl = & $gitProgram remote get-url origin
        if ($LASTEXITCODE -ne 0 -or $originUrl.TrimEnd('/') -ne 'https://github.com/HACYPAA-Organization/hacypaa-website.git') {
            throw 'The release checkout is not connected to the expected HACYPAA repository.'
        }
        $currentBranch = & $gitProgram branch --show-current
        if ($currentBranch -ne $releaseBranch) {
            & $gitProgram show-ref --verify --quiet ('refs/heads/' + $releaseBranch)
            if ($LASTEXITCODE -eq 0) {
                Invoke-ReleaseCommand -Program $gitProgram -Arguments @('switch', $releaseBranch) -Directory $releaseRoot
            } else {
                Invoke-ReleaseCommand -Program $gitProgram -Arguments @('switch', '-c', $releaseBranch) -Directory $releaseRoot
            }
        }
        Invoke-ReleaseCommand -Program $gitProgram `
            -Arguments (@('add', '--') + $releasePaths) -Directory $releaseRoot
        & $gitProgram diff --cached --quiet
        if ($LASTEXITCODE -eq 1) {
            Invoke-ReleaseCommand -Program $gitProgram `
                -Arguments @('commit', '-m', 'Launch HACYPAA XI merchandise and registration safeguards') `
                -Directory $releaseRoot
        } elseif ($LASTEXITCODE -ne 0) {
            throw 'Could not inspect the staged release changes.'
        }
        Invoke-ReleaseCommand -Program $gitProgram `
            -Arguments @('fetch', 'origin', 'main') -Directory $releaseRoot
        Invoke-ReleaseCommand -Program $gitProgram `
            -Arguments @('merge', '--no-edit', 'origin/main') -Directory $releaseRoot
        $latestMain = & $gitProgram rev-parse origin/main
        if ($latestMain -ne $reviewedMainSha) {
            Invoke-ReleaseCommand -Program $nodeProgram `
                -Arguments @('node_modules/vitest/vitest.mjs', 'run') -Directory $apiRoot
        }
    } finally {
        Pop-Location
    }
    Test-ReleaseSyntax

    $env:CI = 'true'
    $env:WRANGLER_SEND_METRICS = 'false'
    $env:WRANGLER_LOG_PATH = Join-Path $apiRoot 'release-deploy.log'

    # Refuse to apply older, unreviewed database migrations implicitly.
    Push-Location -LiteralPath $apiRoot
    try {
        $migrationOutput = & $nodeProgram $wranglerCli d1 migrations list hacypaa-orders --remote 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw 'Could not inspect production migrations. Check your Cloudflare login.'
        }
        $migrationText = ($migrationOutput | Out-String)
        $pendingMigrations = @(
            [regex]::Matches($migrationText, '\b\d{4}_[A-Za-z0-9_-]+\.sql\b') |
                ForEach-Object { $_.Value } | Sort-Object -Unique
        )
        $unexpectedMigrations = @(
            $pendingMigrations | Where-Object { $_ -ne '0010_payment_link_expiry.sql' }
        )
        if ($unexpectedMigrations.Count -gt 0) {
            throw ('Additional production migrations need review: ' + ($unexpectedMigrations -join ', '))
        }
    } finally {
        Pop-Location
    }

    if ($pendingMigrations.Count -gt 0) {
        Invoke-ReleaseCommand -Program $nodeProgram `
            -Arguments @($wranglerCli, 'd1', 'migrations', 'apply', 'hacypaa-orders', '--remote') `
            -Directory $apiRoot
    }

    # This changes only these two secrets; existing Printify, email, and admin
    # credentials remain in Cloudflare's encrypted Worker secrets.
    $secretsJson = @{
        STRIPE_SECRET_KEY = $stripeServerKey
        STRIPE_WEBHOOK_SECRET = $stripeWebhookSecret
    } | ConvertTo-Json -Compress
    Push-Location -LiteralPath $apiRoot
    try {
        $secretsJson | & $nodeProgram $wranglerCli secret bulk
        if ($LASTEXITCODE -ne 0) { throw 'Cloudflare could not save the live Stripe secrets.' }
    } finally {
        Pop-Location
    }

    Invoke-ReleaseCommand -Program $nodeProgram `
        -Arguments @($wranglerCli, 'deploy') -Directory $apiRoot

    # Cover registrations created between the migration and the Worker rollout.
    # Existing non-null expirations, including already-expired ones, stay intact.
    $backfillSql = 'UPDATE registrations SET payment_access_token_expires_at = unixepoch() + 2592000 WHERE payment_access_token_hash IS NOT NULL AND payment_access_token_expires_at IS NULL;'
    Invoke-ReleaseCommand -Program $nodeProgram `
        -Arguments @($wranglerCli, 'd1', 'execute', 'hacypaa-orders', '--remote', '--command', $backfillSql, '--yes') `
        -Directory $apiRoot

    $health = Invoke-RestMethod -Uri 'https://checkout-api.tgp-services.workers.dev/health' -Method Get
    if (-not $health.ok) { throw 'The deployed Worker health check failed.' }

    # Publish only after the backend is deployed and healthy. A normal push
    # refuses to overwrite an independently advanced main branch.
    Invoke-ReleaseCommand -Program $gitProgram `
        -Arguments @('push', 'origin', 'HEAD:refs/heads/main') -Directory $releaseRoot

    @{
        backendDeployed = $true
        websitePushed = $true
        timestampUtc = [DateTime]::UtcNow.ToString('o')
        workerSha256 = (Get-FileHash -LiteralPath (Join-Path $apiRoot 'src/index.js') -Algorithm SHA256).Hash
        checkoutSha256 = (Get-FileHash -LiteralPath $checkoutFile -Algorithm SHA256).Hash
    } | ConvertTo-Json | Set-Content -LiteralPath $readyFile -Encoding UTF8

    if (Test-Path -LiteralPath $protectedWebhookFile) {
        Remove-Item -LiteralPath $protectedWebhookFile
    }

    Write-Host ''
    Write-Host 'Production backend deployed and website pushed to main.'
    Write-Host 'Return to the chat with: deployment finished'
    Write-Host 'GitHub Pages may take a few minutes to update. A real purchase still needs to verify Printify fulfillment.'
} finally {
    $stripeServerKey = $null
    $stripeWebhookSecret = $null
    $secretsJson = $null
    $stripeHeaders = $null
    [Environment]::SetEnvironmentVariable('CI', $releasePreviousCi, 'Process')
    [Environment]::SetEnvironmentVariable('WRANGLER_SEND_METRICS', $releasePreviousMetrics, 'Process')
    [Environment]::SetEnvironmentVariable('WRANGLER_LOG_PATH', $releasePreviousLog, 'Process')
}
