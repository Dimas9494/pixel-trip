Set-Location $PSScriptRoot
New-Item -ItemType Directory -Force -Path "public\images\burn" | Out-Null

Write-Host "Drop 3 evolution GIFs into: public\images\burn\"
Write-Host "  level-1.gif  (Genesis)"
Write-Host "  level-2.gif  (Awakened)"
Write-Host "  level-3.gif  (Ascended)"
Write-Host ""
Write-Host "Or pass file paths:"
Write-Host '  node scripts/setup-burn.mjs "C:\path\1.gif" "C:\path\2.gif" "C:\path\3.gif"'
Write-Host ""

node scripts/setup-burn.mjs
