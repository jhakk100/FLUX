param(
  [Parameter(Mandatory = $true)][string]$ExecutablePath,
  [Parameter(Mandatory = $true)][string]$IconPath
)

$ErrorActionPreference = "Stop"
$executable = [System.IO.Path]::GetFullPath($ExecutablePath)
$icon = [System.IO.Path]::GetFullPath($IconPath)
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "Executable not found: $executable" }
if (-not (Test-Path -LiteralPath $icon -PathType Leaf)) { throw "Icon not found: $icon" }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class FluxIconResources {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr BeginUpdateResource(string fileName, bool deleteExistingResources);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool UpdateResource(IntPtr updateHandle, IntPtr type, IntPtr name, ushort language, byte[] data, uint size);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool EndUpdateResource(IntPtr updateHandle, bool discard);
}
'@

function Read-UInt16([byte[]]$bytes, [int]$offset) { [BitConverter]::ToUInt16($bytes, $offset) }
function Read-UInt32([byte[]]$bytes, [int]$offset) { [BitConverter]::ToUInt32($bytes, $offset) }

$ico = [System.IO.File]::ReadAllBytes($icon)
if ($ico.Length -lt 22 -or (Read-UInt16 $ico 0) -ne 0 -or (Read-UInt16 $ico 2) -ne 1) { throw "Invalid ICO file: $icon" }
$count = Read-UInt16 $ico 4
if ($count -lt 1 -or $ico.Length -lt (6 + 16 * $count)) { throw "ICO directory is incomplete: $icon" }

$group = New-Object byte[] (6 + 14 * $count)
[Array]::Copy($ico, 0, $group, 0, 6)
$resourceEntries = @()
for ($index = 0; $index -lt $count; $index += 1) {
  $sourceOffset = 6 + 16 * $index
  $bytesInResource = Read-UInt32 $ico ($sourceOffset + 8)
  $imageOffset = Read-UInt32 $ico ($sourceOffset + 12)
  if ($bytesInResource -lt 1 -or $imageOffset -gt $ico.Length -or $bytesInResource -gt ($ico.Length - $imageOffset)) { throw "ICO image $index is outside the file." }
  $resourceId = [uint16]($index + 1)
  $image = New-Object byte[] $bytesInResource
  [Array]::Copy($ico, [int]$imageOffset, $image, 0, [int]$bytesInResource)
  $resourceEntries += [PSCustomObject]@{ Id = $resourceId; Data = $image }

  $groupOffset = 6 + 14 * $index
  [Array]::Copy($ico, $sourceOffset, $group, $groupOffset, 8)
  [Array]::Copy($ico, $sourceOffset + 8, $group, $groupOffset + 8, 4)
  [Array]::Copy([BitConverter]::GetBytes($resourceId), 0, $group, $groupOffset + 12, 2)
}

$handle = [FluxIconResources]::BeginUpdateResource($executable, $false)
if ($handle -eq [IntPtr]::Zero) { throw "BeginUpdateResource failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
$commit = $false
try {
  foreach ($entry in $resourceEntries) {
    if (-not [FluxIconResources]::UpdateResource($handle, [IntPtr]3, [IntPtr]$entry.Id, 0, $entry.Data, [uint32]$entry.Data.Length)) {
      throw "UpdateResource icon failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
  }
  if (-not [FluxIconResources]::UpdateResource($handle, [IntPtr]14, [IntPtr]1, 0, $group, [uint32]$group.Length)) {
    throw "UpdateResource group icon failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
  $commit = $true
} finally {
  if (-not [FluxIconResources]::EndUpdateResource($handle, -not $commit)) {
    throw "EndUpdateResource failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }
}

Write-Output "Applied $count icon image(s) directly to $executable"
