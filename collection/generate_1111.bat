@echo off
chcp 65001 >nul
cd /d "%~dp0"
python generate_nft.py --metadata --all --seed 1111
pause
