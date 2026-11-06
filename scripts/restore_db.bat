@echo off
setlocal EnableExtensions
set "ROOT=%~dp0.."
set "MYSQL=%ROOT%\..\..\mysql\bin\mysql.exe"
if not exist "%MYSQL%" set "MYSQL=C:\xampp\mysql\bin\mysql.exe"
set "DB=tayabascare_db"
set "BACKUP_DIR=%ROOT%\backups"
set "USER=root"
set "PASS="
if not exist "%MYSQL%" (
    echo [ERROR] mysql not found: %MYSQL%
    exit /b 1
)
set "FILE=%~1"
if "%FILE%"=="" (
    for /f "delims=" %%F in ('dir /b /o-d "%BACKUP_DIR%\%DB%_*.sql" 2^>nul') do (
        if not defined FILE set "FILE=%BACKUP_DIR%\%%F"
    )
)
if not defined FILE (
    echo [ERROR] No dump found in %BACKUP_DIR%
    exit /b 1
)
if not exist "%FILE%" (
    echo [ERROR] Dump not found: %FILE%
    exit /b 1
)
echo Restoring: %FILE%
echo Target:    %DB%
echo This OVERWRITES live tables in %DB%.
set "CONFIRM="
set /p CONFIRM=Type YES to continue:
if /i not "%CONFIRM%"=="YES" (
    echo Cancelled.
    exit /b 1
)
if defined PASS (
    "%MYSQL%" -u %USER% -p%PASS% -e "CREATE DATABASE IF NOT EXISTS `%DB%` CHARACTER SET utf8mb4;" || exit /b 1
    "%MYSQL%" -u %USER% -p%PASS% %DB% < "%FILE%"
) else (
    "%MYSQL%" -u %USER% -e "CREATE DATABASE IF NOT EXISTS `%DB%` CHARACTER SET utf8mb4;" || exit /b 1
    "%MYSQL%" -u %USER% %DB% < "%FILE%"
)
if errorlevel 1 (
    echo [FAIL] Restore failed.
    exit /b 1
)
echo [OK] Restore complete.
exit /b 0
