[CmdletBinding()]
param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$setupRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot "manifest.json") -Raw | ConvertFrom-Json
$installerDirectory = Join-Path $PSScriptRoot "installers"
New-Item -ItemType Directory -Path $installerDirectory -Force | Out-Null

$checksumUrl = "$($manifest.node.source)SHASUMS256.txt"
$checksumPath = Join-Path $installerDirectory "SHASUMS256.txt"
Invoke-WebRequest -Uri $checksumUrl -OutFile $checksumPath
$checksums = @{}
foreach ($line in Get-Content -LiteralPath $checksumPath) {
  if ($line -match "^(?<hash>[a-fA-F0-9]{64})\s+(?<file>.+)$") { $checksums[$matches.file] = $matches.hash.ToLowerInvariant() }
}

foreach ($fileName in $manifest.node.files) {
  if (-not $checksums.ContainsKey($fileName)) { throw "Official checksum list does not contain $fileName." }
  $target = Join-Path $installerDirectory $fileName
  $expectedHash = $checksums[$fileName]
  $needsDownload = $Force -or -not (Test-Path -LiteralPath $target)
  if (-not $needsDownload) { $needsDownload = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash }
  if ($needsDownload) {
    Write-Host "Downloading $fileName"
    Invoke-WebRequest -Uri "$($manifest.node.source)$fileName" -OutFile $target
  }
  $actualHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $expectedHash) { Remove-Item -LiteralPath $target -Force; throw "SHA-256 verification failed for $fileName." }
  Write-Host "Verified $fileName ($actualHash)"
}

Write-Host "Installer files are ready in: $installerDirectory"
