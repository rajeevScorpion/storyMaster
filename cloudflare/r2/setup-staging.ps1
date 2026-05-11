param(
  [string]$PublicBucket = $(if ($env:R2_BUCKET_NAME) { $env:R2_BUCKET_NAME } else { "kissago-media-staging" }),
  [string]$PrivateBucket = $(if ($env:R2_PRIVATE_BUCKET_NAME) { $env:R2_PRIVATE_BUCKET_NAME } else { "kissago-media-private-staging" }),
  [string]$CorsFile = "cloudflare/r2/cors-staging.json"
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
    if ($AllowAlreadyExists -and $text -match "(?i)already exists|already own|already been taken|bucket.*exists") {
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

Write-Host "This script assumes Wrangler is installed or available through npx."
Write-Host "If you are not logged in, run: npx wrangler login"

Invoke-Wrangler -Arguments @("r2", "bucket", "create", $PublicBucket) -AllowAlreadyExists
Invoke-Wrangler -Arguments @("r2", "bucket", "create", $PrivateBucket) -AllowAlreadyExists
Invoke-Wrangler -Arguments @("r2", "bucket", "cors", "set", $PublicBucket, "--file", $CorsFile)
Invoke-Wrangler -Arguments @("r2", "bucket", "cors", "set", $PrivateBucket, "--file", $CorsFile)
Invoke-Wrangler -Arguments @("r2", "bucket", "list")

Write-Host "Next manual step: connect media-stage.kissago.cc to $PublicBucket only."
