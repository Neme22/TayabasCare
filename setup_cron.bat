@echo off
REM ============================================================
REM TayabasCare - Windows Task Scheduler Setup
REM Creates scheduled tasks for automated email notifications
REM Run this file as Administrator
REM ============================================================

echo.
echo ========================================
echo  TayabasCare Notification Scheduler Setup
echo ========================================
echo.

REM Check for admin privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: This script must be run as Administrator.
    echo Right-click and select "Run as administrator"
    pause
    exit /b 1
)

REM Create daily inspection reminder task (7:00 AM)
echo Creating daily inspection reminder task...
schtasks /create /tn "TayabasCare_DailyReminders" /tr "php C:\xampp\htdocs\TayabasCare\php\notification_runner.php?action=send" /sc daily /st 07:00 /f
if %errorLevel% equ 0 (
    echo   [OK] Daily reminders scheduled for 7:00 AM
) else (
    echo   [WARN] Failed to create daily reminder task
)

REM Create compliance alert task (8:00 AM daily)
echo Creating compliance alert task...
schtasks /create /tn "TayabasCare_ComplianceAlerts" /tr "php C:\xampp\htdocs\TayabasCare\php\notification_runner.php?action=send_compliance_alerts" /sc daily /st 08:00 /f
if %errorLevel% equ 0 (
    echo   [OK] Compliance alerts scheduled for 8:00 AM
) else (
    echo   [WARN] Failed to create compliance alert task
)

REM Create follow-up reminder task (9:00 AM daily)
echo Creating follow-up reminder task...
schtasks /create /tn "TayabasCare_FollowupReminders" /tr "php C:\xampp\htdocs\TayabasCare\php\notification_runner.php?action=send_followup_reminders" /sc daily /st 09:00 /f
if %errorLevel% equ 0 (
    echo   [OK] Follow-up reminders scheduled for 9:00 AM
) else (
    echo   [WARN] Failed to create follow-up reminder task
)

REM Create alert generation task (every 2 hours)
echo Creating alert generation task...
schtasks /create /tn "TayabasCare_AlertGeneration" /tr "php C:\xampp\htdocs\TayabasCare\php\alerts.php?action=generate" /sc hourly /mo 2 /f
if %errorLevel% equ 0 (
    echo   [OK] Alert generation scheduled every 2 hours
) else (
    echo   [WARN] Failed to create alert generation task
)

echo.
echo ========================================
echo  Setup Complete!
echo ========================================
echo.
echo  Scheduled Tasks Created:
echo    1. TayabasCare_DailyReminders     - 7:00 AM daily
echo    2. TayabasCare_ComplianceAlerts   - 8:00 AM daily
echo    3. TayabasCare_FollowupReminders  - 9:00 AM daily
echo    4. TayabasCare_AlertGeneration    - Every 2 hours
echo.
echo  NOTE: Ensure PHP is in your system PATH, or update the
echo  task commands with the full path to php.exe
echo  Example: C:\xampp\php\php.exe
echo.
echo  To verify tasks: schtasks /query /tn TayabasCare*
echo  To remove tasks:  schtasks /delete /tn "TaskName" /f
echo.
pause
