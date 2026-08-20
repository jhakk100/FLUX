$ErrorActionPreference = "Stop"

# Build processes should be gone after `node scripts/build-windows-exe.mjs` returns.
# Match only FLUX's exact build command lines; unrelated Node applications are ignored.
$patterns = @(
  'node\s+scripts[/\\]build-windows-exe\.mjs',
  'pnpm\.mjs"\s+run\s+build:win'
)

try {
  $leftovers = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object {
      $commandLine = $_.CommandLine
      $commandLine -and ($patterns | Where-Object { $commandLine -match $_ })
    } |
    Select-Object ProcessId, ParentProcessId, CreationDate, CommandLine
} catch {
  # Some restricted shells deny process command-line inspection. The build lock
  # still detects an active or interrupted FLUX build without touching other apps.
  $lockPath = Join-Path (Split-Path $PSScriptRoot -Parent) "dist/.flux-build.lock"
  if (Test-Path -LiteralPath $lockPath) {
    Write-Error "FLUX build lock is still present: $lockPath"
    exit 1
  }
  Write-Warning "Windows denied full process inspection. No active FLUX build lock remains. Run this command in a normal PowerShell session for a full process scan."
  exit 0
}

if ($leftovers) {
  Write-Error "FLUX build Node process leak detected."
  $leftovers | Format-List | Out-String | Write-Error
  exit 1
}

Write-Output "No FLUX build Node processes remain."
