-- Fix archive_data.archive_type: the original ENUM silently coerced new
-- archive types ('report', 'schedule', 'calendar_event') to '' under
-- non-strict SQL mode. Run once against tayabascare_db.
-- See AGENTS.md > Quirks and gotchas > archive_type column.

ALTER TABLE archive_data MODIFY archive_type VARCHAR(50) NOT NULL;
