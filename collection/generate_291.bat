@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Rescan rarity + generate 291 metadata...
python assign_rarity.py
if errorlevel 1 exit /b 1
python generate_nft.py --metadata --all --seed 291
pause
