param(
  [string]$PublicBucket = $(if ($env:R2_BUCKET_NAME) { $env:R2_BUCKET_NAME } else { "kissago-media-production" }),
  [string]$PrivateBucket = $(if ($env:R2_PRIVATE_BUCKET_NAME) { $env:R2_PRIVATE_BUCKET_NAME } else { "kissago-media-private-production" }),
  [string]$PublicDomain = $(if ($env:R2_PUBLIC_DOMAIN) { $env:R2_PUBLIC_DOMAIN } else { "media.kissago.cc" }),
  [string]$ZoneId = $(if ($env:CLOUDFLARE_ZONE_ID) { $env:CLOUDFLARE_ZONE_ID } else { "c7e22e411b36b4f531af9682acf8909a" }),
  [string]$CorsFile = "cloudflare/r2/cors-production.json"
)

$ErrorActionPreference = "Stop"

function Invoke-Wrangler {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [switch]$AllowAlreadyExists
  )

  Write-Host "npx wrangler $($Arguments -join ' ')"
  $npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
  if (-not $npx) {
    $npx = Get-Command npx -ErrorAction Stop
  }

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $npx.Source wrangler @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $text = ($output | Out-String).Trim()

  if ($exitCode -ne 0) {
    if ($AllowAlreadyExists -and $text -match "(?i)already exists|already own|already been taken|bucket.*exists|domain.*already|custom domain.*exists|already connected") {
      Write-Warning $text
      return
    }

    if ($text) {
      Write-Host $text
    }
    throw "Wrangler command failed with exit code $exitCode."
  }

  if ($text) {
    Write-Host $text
  }
}

if (-not (Test-Path -LiteralPath $CorsFile)) {
  throw "CORS file not found: $CorsFile"
}

if (-not $ZoneId -or $ZoneId -eq "<ZONE_ID>") {
  throw "Missing Cloudflare zone ID for kissago.cc. Pass -ZoneId <ZONE_ID> or set CLOUDFLARE_ZONE_ID."
}

Write-Host "This script assumes Wrangler is installed or available through npx."
Write-Host "If you are not logged in, run: npx wrangler login"
Write-Host "Public production bucket: $PublicBucket"
Write-Host "Private production bucket: $PrivateBucket"
Write-Host "Public R2 domain: $PublicDomain"
Write-Host "Zone ID: $ZoneId"

Invoke-Wrangler -Arguments @("r2", "bucket", "create", $PublicBucket) -AllowAlreadyExists
Invoke-Wrangler -Arguments @("r2", "bucket", "create", $PrivateBucket) -AllowAlreadyExists

Invoke-Wrangler -Arguments @("r2", "bucket", "cors", "set", $PublicBucket, "--file", $CorsFile)
Invoke-Wrangler -Arguments @("r2", "bucket", "cors", "set", $PrivateBucket, "--file", $CorsFile)

Invoke-Wrangler -Arguments @("r2", "bucket", "domain", "add", $PublicBucket, "--domain", $PublicDomain, "--zone-id", $ZoneId, "--min-tls", "1.2", "--force") -AllowAlreadyExists

Write-Host ""
Write-Host "Verification:"
Invoke-Wrangler -Arguments @("r2", "bucket", "list")
Invoke-Wrangler -Arguments @("r2", "bucket", "cors", "list", $PublicBucket)
Invoke-Wrangler -Arguments @("r2", "bucket", "cors", "list", $PrivateBucket)
Invoke-Wrangler -Arguments @("r2", "bucket", "domain", "list", $PublicBucket)
Invoke-Wrangler -Arguments @("r2", "bucket", "domain", "list", $PrivateBucket)
Invoke-Wrangler -Arguments @("r2", "bucket", "dev-url", "get", $PrivateBucket)

Write-Host ""
Write-Host "Done. Confirm $PublicDomain is active on $PublicBucket only."
Write-Host "Do not connect a custom domain or public r2.dev URL to $PrivateBucket."
