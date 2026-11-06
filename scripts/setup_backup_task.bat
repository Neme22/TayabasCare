@echo off
setlocal EnableExtensions
set "ROOT=%~dp0.."
schtasks /Create /TN "TayabasCare_DB_Backup" /TR "%ROOT%\scripts\backup_db.bat" /SC DAILY /ST 18:00 /F
if errorlevel 1 (
  echo [FAIL] Run as Administrator to schedule daily backups.
  exit /b 1
)
echo [OK] Daily backup scheduled at 18:00
exit /b 0
