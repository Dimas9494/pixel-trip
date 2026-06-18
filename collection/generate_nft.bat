@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo  PIXEL ORIGINS - NFT Generator
echo ========================================
echo.
echo  [1] Metadata only (4444 JSON)
echo  [2] Metadata + static WebP images
echo  [3] Full: metadata + WebP + animated WebP + MP4
echo  [4] Preview 10 tokens (metadata)
echo.
set /p choice="Choose [1-4]: "

if "%choice%"=="1" goto meta
if "%choice%"=="2" goto static
if "%choice%"=="3" goto full
if "%choice%"=="4" goto preview
goto meta

:meta
python generate_nft.py --metadata --all
goto end

:static
python generate_nft.py --metadata --images --all
goto end

:full
python generate_nft.py --metadata --images --animated --mp4 --all
goto end

:preview
python generate_nft.py --metadata --size 10
goto end

:end
pause
