$ErrorActionPreference = "Stop"

$websiteRoot = $PSScriptRoot
$src = Join-Path $websiteRoot "..\collection\build\images" | Resolve-Path
$dst = Join-Path $websiteRoot "public\images"
$files = @("1.gif", "25.gif", "42.gif", "56.gif", "100.gif", "133.gif")

New-Item -ItemType Directory -Force -Path $dst | Out-Null

Write-Host "Source: $src"
Write-Host "Target: $dst"
Write-Host ""

foreach ($file in $files) {
  $from = Join-Path $src $file
  if (-not (Test-Path -LiteralPath $from)) {
    Write-Error "Missing: $from"
    exit 1
  }
  Copy-Item -LiteralPath $from -Destination $dst -Force
  Write-Host "OK $file"
}

Write-Host ""
Get-ChildItem -LiteralPath $dst | Sort-Object Name | Format-Table Name, Length -AutoSize
Write-Host "Done. All 6 preview GIFs copied."
