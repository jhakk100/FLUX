[CmdletBinding()]
param(
  [switch]$InstallNode
)

$ErrorActionPreference = "Stop"
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot "manifest.json") -Raw | ConvertFrom-Json
$nodeInstaller = Join-Path $PSScriptRoot (Join-Path "installers" "node-v$($manifest.node.version)-x64.msi")

if ($InstallNode) {
  if (-not (Test-Path -LiteralPath $nodeInstaller)) { throw "Run .\setup\Download-Installers.ps1 first: $nodeInstaller was not found." }
  Write-Host "Starting the official Node.js installer. Complete it, then open a new PowerShell window and run this script again without -InstallNode."
  Start-Process -FilePath $nodeInstaller -Wait
  exit 0
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js $($manifest.node.minimumVersion)+ is required. Run this script with -InstallNode after downloading the installer." }
$nodeVersion = (node --version).Trim().TrimStart("v")
if ([version]$nodeVersion -lt [version]$manifest.node.minimumVersion) { throw "Node.js $($manifest.node.minimumVersion)+ is required; found $nodeVersion." }
if (-not (Get-Command corepack -ErrorAction SilentlyContinue)) { throw "Corepack was not found. Install the Node.js 24 MSI with the Corepack feature enabled." }

corepack enable
corepack pnpm --version
corepack pnpm install --frozen-lockfile
Write-Host "Development dependencies are installed. Build Windows executable with: corepack pnpm run build:win"
