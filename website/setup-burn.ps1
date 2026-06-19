Set-Location $PSScriptRoot
New-Item -ItemType Directory -Force -Path "public\images\burn" | Out-Null

Write-Host "Expected PNG files in public\images\burn\:"
Write-Host "  1.png  (Level 1 — Genesis)"
Write-Host "  2.png  (Level 2 — Awakened)"
Write-Host "  3.png  (Level 3 — Ascended)"
Write-Host ""

node scripts/setup-burn.mjs
