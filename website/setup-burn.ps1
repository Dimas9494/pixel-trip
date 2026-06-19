Set-Location $PSScriptRoot
New-Item -ItemType Directory -Force -Path "public\images\burn" | Out-Null

Write-Host "Drop 3 evolution PNGs into: public\images\burn\"
Write-Host "  level-1.png  (Genesis)"
Write-Host "  level-2.png  (Awakened)"
Write-Host "  level-3.png  (Ascended)"
Write-Host ""
Write-Host "Or pass file paths:"
Write-Host '  node scripts/setup-burn.mjs "C:\path\1.png" "C:\path\2.png" "C:\path\3.png"'
Write-Host ""

node scripts/setup-burn.mjs
