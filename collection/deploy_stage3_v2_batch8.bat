@echo off
cd /d "%~dp0"
REM В Stage 3 V2 должны быть только PNG текущего batch (иначе перерендерятся старые линии).
python deploy_burn_assets.py --stage 3 --production --char-root "../Stage 3 V2" --merge-s3-map --s3-manifest-name manifest-stage3-v2-batch8.json --seed 11111 %*
pause
