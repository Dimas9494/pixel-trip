@echo off
chcp 65001 >nul
cd /d "%~dp0"
python assign_rarity.py
if errorlevel 1 exit /b 1
python generate_collection.py %*
if "%1"=="" pause
