@echo off
setlocal EnableExtensions
set "ROOT=%~dp0.."

REM Remove legacy daily task name if present
schtasks /Delete /TN "TayabasCare_DB_Backup" /F >nul 2>&1

schtasks /Create /TN "TayabasCare_DB_Backup_Weekly" /TR "\"%ROOT%\scripts\backup_db.bat\" weekly" /SC WEEKLY /D SUN /ST 02:00 /F
if errorlevel 1 (
  echo [FAIL] Run as Administrator to schedule weekly backups.
  exit /b 1
)

schtasks /Create /TN "TayabasCare_DB_Backup_Monthly" /TR "\"%ROOT%\scripts\backup_db.bat\" monthly" /SC MONTHLY /D 1 /ST 03:00 /F
if errorlevel 1 (
  echo [FAIL] Run as Administrator to schedule monthly backups.
  exit /b 1
)

echo [OK] Weekly backup scheduled: Sundays at 02:00 AM
echo [OK] Monthly backup scheduled: 1st of every month at 03:00 AM
exit /b 0
