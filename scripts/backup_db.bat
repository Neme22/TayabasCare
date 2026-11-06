@echo off
setlocal EnableExtensions
set "ROOT=%~dp0.."
set "MYSQL=%ROOT%\..\..\mysql\bin\mysqldump.exe"
if not exist "%MYSQL%" set "MYSQL=C:\xampp\mysql\bin\mysqldump.exe"
set "DB=tayabascare_db"
set "BACKUP_DIR=%ROOT%\backups"
set "USER=root"
set "PASS="
if not exist "%MYSQL%" (
    echo [ERROR] mysqldump not found: %MYSQL%
    exit /b 1
)
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "STAMP=%%i"
set "OUT=%BACKUP_DIR%\%DB%_%STAMP%.sql"
set "DUMP_OPTS=--single-transaction --routines --triggers --events --add-drop-table"
if defined PASS (
    "%MYSQL%" -u %USER% -p%PASS% %DUMP_OPTS% --result-file="%OUT%" %DB%
) else (
    "%MYSQL%" -u %USER% %DUMP_OPTS% --result-file="%OUT%" %DB%
)
if errorlevel 1 (
    echo [%DATE% %TIME%] FAIL %OUT% >> "%BACKUP_DIR%\backup.log"
    echo [FAIL] See backups\backup.log
    exit /b 1
)
for %%F in ("%OUT%") do set "SIZE=%%~zF"
echo [%DATE% %TIME%] OK %OUT% (%SIZE% bytes) >> "%BACKUP_DIR%\backup.log"
echo [OK] Backup written: %OUT% (%SIZE% bytes)
exit /b 0
