@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Re-render #1-10 (verbose, mp4 + webp)...
python generate_nft.py --recompose --animated --mp4 --from 1 --to 10
pause
