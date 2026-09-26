@echo off
cd /d "%~dp0"
REM В Stage 3 V2 — только PNG текущего batch.
python deploy_burn_assets.py --stage 3 --production --char-root "../Stage 3 V2" --merge-s3-map --s3-manifest-name manifest-stage3-v2-batch11.json --seed 14141 %*
pause
