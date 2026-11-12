@echo off
setlocal EnableExtensions
set "ROOT=%~dp0.."

REM Remove legacy fixed-time tasks if present
schtasks /Delete /TN "TayabasCare_DB_Backup" /F >nul 2>&1
schtasks /Delete /TN "TayabasCare_DB_Backup_Weekly" /F >nul 2>&1
schtasks /Delete /TN "TayabasCare_DB_Backup_Monthly" /F >nul 2>&1

schtasks /Create /TN "TayabasCare_DB_Backup_Schedule" /TR "\"%ROOT%\scripts\backup_db.bat\" check" /SC MINUTE /MO 1 /F
if errorlevel 1 (
  echo [FAIL] Run as Administrator to install the automated backup watcher.
  exit /b 1
)

echo [OK] Automated backup watcher scheduled (every 1 minute checks your Weekly & Monthly settings in Admin -> Database Backup).
exit /b 0
