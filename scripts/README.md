# TayabasCare — Database Backup & Restore

## What this is
Full MySQL backup/restore for `tayabascare_db` (XAMPP). Backup is read-only and safe while the app is live.

## Backup (safe anytime)
```
scripts\backup_db.bat
```
- Writes: `backups\tayabascare_db_YYYYMMDD_HHMMSS.sql`
- Logs: `backups\backup.log`
- Does NOT modify the live database

## Restore (disaster only — overwrites live data)
```
scripts\restore_db.bat
```
or with an explicit file:
```
scripts\restore_db.bat C:\path\to\dump.sql
```
- Defaults to the newest dump in `backups\`
- Requires typing `YES` before anything is overwritten
- After restore: hard-refresh the app and check Sanitary / Prescribe / Inspection

## Optional: daily backup task (Windows Task Scheduler)
```
scripts\setup_backup_task.bat
```
Registers a daily 18:00 task. Does not change existing cron/alert tasks.

## Safe drill (does not touch production)
```
mysql -u root -e "CREATE DATABASE tayabascare_drill"
mysql -u root tayabascare_drill < backups\tayabascare_db_<stamp>.sql
mysql -u root -e "DROP DATABASE tayabascare_drill"
```

## Off-machine copy
After each important backup, copy the `.sql` to USB/cloud. If the whole disk dies, that file is enough to rebuild.

## Files
| Path | Purpose |
|------|---------|
| scripts/backup_db.bat | Create dump |
| scripts/restore_db.bat | Restore from dump |
| scripts/setup_backup_task.bat | Optional daily schedule |
| backups/ | Dumps + log (SQL not committed to git) |