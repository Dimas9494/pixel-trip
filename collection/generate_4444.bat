@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo PIXEL TRIP — metadata + GIF for OpenSea (4444)
python assign_rarity.py
if errorlevel 1 exit /b 1
python generate_nft.py --metadata --all --seed 4444
pause
