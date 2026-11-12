@echo off
setlocal EnableExtensions
set "ROOT=%~dp0.."
set "MODE=%~1"
if "%MODE%"=="" set "MODE=manual"

set "PHP_BIN=%ROOT%\..\..\php\php.exe"
if not exist "%PHP_BIN%" set "PHP_BIN=C:\xampp\php\php.exe"
if exist "%PHP_BIN%" (
    if /I "%MODE%"=="check" (
        "%PHP_BIN%" "%ROOT%\php\cron_cli.php" backup check_due
        exit /b %errorlevel%
    )
    if /I "%MODE%"=="weekly" (
        "%PHP_BIN%" "%ROOT%\php\cron_cli.php" backup run_weekly
        exit /b %errorlevel%
    )
    if /I "%MODE%"=="monthly" (
        "%PHP_BIN%" "%ROOT%\php\cron_cli.php" backup run_monthly
        exit /b %errorlevel%
    )
    "%PHP_BIN%" "%ROOT%\php\cron_cli.php" backup run_manual
    exit /b %errorlevel%
)

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
if /I "%MODE%"=="weekly" (
    set "OUT=%BACKUP_DIR%\%DB%_weekly_%STAMP%.sql"
) else if /I "%MODE%"=="monthly" (
    set "OUT=%BACKUP_DIR%\%DB%_monthly_%STAMP%.sql"
) else (
    set "OUT=%BACKUP_DIR%\%DB%_%STAMP%.sql"
)
set "DUMP_OPTS=--single-transaction --no-tablespaces --routines --triggers --events --add-drop-table"
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
echo [%DATE% %TIME%] OK [%MODE%] %OUT% (%SIZE% bytes) >> "%BACKUP_DIR%\backup.log"
echo [OK] Backup written: %OUT% (%SIZE% bytes)
exit /b 0
