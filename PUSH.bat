@echo off
cd /d C:\RUBIK_PROYECTO
del /f /q .git\index.lock 2>nul
del /f /q .git\HEAD.lock 2>nul
git pull origin main --no-rebase --no-edit
git add -A
git commit -m "sync desde Cowork"
git push origin master:main
echo.
echo ✅ Listo! GitHub Actions despliega automaticamente.
pause
