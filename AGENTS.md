# TayabasCare — Agent Guide

## What this is

A PHP + vanilla JS web app for sanitary inspection and risk prediction in Tayabas City. Runs on XAMPP (Apache + MySQL). No build step, no package manager, no test suite, no CI.

## Project objectives

See `objectives.md`. In short: digitize inspection records, score establishments by violation risk (5-factor formula in `php/risk_utils.php`), and provide dashboards for the City Health Office.

## Running locally

1. Place the repo at `C:\xampp\htdocs\TayabasCare` (already done if you're here).
2. Start Apache + MySQL from XAMPP Control Panel.
3. One-time DB setup: visit `http://localhost/TayabasCare/php/setup_database.php` in a browser. This creates database `tayabascare_db` and all tables.
4. Landing page: `http://localhost/TayabasCare/` (index.html).

Default admin: `admin` / `admin123` (created by setup_database.php).

## Architecture

### Pages (static HTML, no framework)

| File | Role | Auth |
|---|---|---|
| `index.html` | Public landing page + login modal | None |
| `admin.html` | Admin dashboard (all modules) | Admin only |
| `inspector.html` | Inspector field dashboard | Inspector only |

### PHP API layer (`php/`)

Every PHP endpoint includes `config.php` which sets CORS headers, creates a PDO connection (`$db`), and provides `jsonResponse()` / `errorResponse()` helpers.

All state-changing endpoints (POST/PUT/DELETE) require a CSRF token via `X-CSRF-Token` header or `csrf_token` form field (see `php/csrf.php`). GET endpoints that write data also validate CSRF.

| File | Purpose |
|---|---|
| `config.php` | DB connection (PDO), CORS, session config, response helpers. **Must be `require_once`'d by every endpoint.** |
| `auth_check.php` | Session guard + `requireRole()` helper. CLI requests bypass session (for cron). |
| `csrf.php` | CSRF token generation + validation. |
| `csrf_token.php` | GET endpoint returning the session's CSRF token. |
| `auth.php` | Login (POST), session check (GET), logout (DELETE). Handles bcrypt, MD5, and plaintext password migration. |
| `sanitary.php` | CRUD for `sanitary_records` table. |
| `inspection.php` | CRUD for `inspection_reports`. On create/update, archives previous version to `inspection_history`. Inspector ownership enforced on updates. GET is cluster-scoped for inspectors (only their cluster's `location` values); `?establishments=1` returns a citywide names-only index for the Sanitary "New" chip. |
| `inspection_schedules.php` | Upsert schedule entries (inspector + date). GET allows both roles; POST lets inspectors schedule only for themselves and only for establishments in their cluster. |
| `clusters.php` | **Cluster ↔ inspector assignments** (5 clusters). The 66 barangays are split into fixed clusters in `cluster_lib.php` — the admin only picks which inspector owns each cluster. GET returns `{clusters, myCluster}` for any logged-in user (`?barangays=1` for a flat map); POST is admin+CSRF replace-all of inspector owners (all 5 clusters required). |
| `cluster_lib.php` | Shared cluster helpers: `fixedClusterBarangays()` (the fixed 66→5 partition, zone families never split), `clusterOwners()`, `clusterBarangaysForSession()`, `ensureClusterTables()`. Used by clusters/inspection/inspection_schedules. |
| `burial.php` | CRUD for `burial_records` (cadaver/skeletal/exhumation). |
| `archive.php` | Soft-delete store. No auto-expiry — archived items stay until an admin restores or permanently deletes them. |
| `risk_utils.php` | **Risk scoring engine.** 5-factor formula (0-100): violations, time since last inspection, establishment type, compliance rate, pending follow-ups. Shared by predict/alerts/pattern_analysis. |
| `predict.php` | GET endpoint returning risk scores for all establishments. Uses `risk_utils.php` for scoring. |
| `ai_analyze.php` | Calls OpenRouter API for AI risk narrative. Rate-limited (10/hr). |
| `forgot_password.php` | OTP-based password reset (send_otp / verify_otp / reset_password). |
| `change_password.php` | Self-service password change (supports legacy MD5/plaintext migration). |
| `alerts.php` | Alert generation and management. |
| `notification_runner.php` | Email notification dispatch (admin only). |
| `accomplishment.php` | Monthly accomplishment records per inspector. |
| `statistics.php` | Summary/year-over-year statistics. |
| `export_analytics.php` | Analytics data export. |
| `pattern_analysis.php` | Violation pattern analysis. |
| `risk_history.php` | Risk score trend history. |
| `activity_log.php` | Audit trail (also a library for `logActivity()`). |
| `inspector.php` | Inspector account management (admin only). |
| `import_sanitary.php` | Bulk CSV/Excel import into `sanitary_records`. |
| `import_inspections.php` | Bulk inspection report import. |
| `get_barangays.php` | Public barangay list (static data). |
| `download.php` | File download with path traversal protection. |
| `setup_database.php` | One-time DB + table creation. Run in browser. |
| `secrets.php` | Loads credentials from `.env`. Never commit real keys. |
| `email_template.php` | HTML email template renderer. |
| `PHPMailer/` | PHPMailer library + notification helpers. |

### JavaScript (`js/`)

| File | Used by |
|---|---|
| `login.js` | `index.html` — login form, forgot-password flow |
| `admin.js` | `admin.html` — all admin modules (~5700 lines, single file) |
| `inspector.js` | `inspector.html` — inspector modules (~5800 lines, single file) |

API base URL: `const API_BASE_URL = 'php';` (relative path). A fetch interceptor auto-attaches CSRF tokens to all mutating requests.

### CSS (`css/`)

| File | Used by |
|---|---|
| `style.css` | `index.html` (landing page) |
| `admin.css` | `admin.html` |
| `inspector.css` | `inspector.html` |
| `dashboard.css` | Shared dashboard components |

External CSS loaded via CDN: Tailwind CSS, DaisyUI 4.6.0, Font Awesome 6.x, Bootstrap Icons, Google Fonts (Inter).

## Database schema (15+ tables)

All tables use InnoDB + utf8mb4. Key tables:

- **`users`** — login credentials, role (`admin`/`inspector`)
- **`inspector_accounts`** — inspector profiles. Auth syncs between this and `users`.
- **`sanitary_records`** — establishment records (main data table for prediction)
- **`inspection_reports`** — current/latest inspection per establishment
- **`inspection_history`** — archived versions of inspection reports (auto-populated on update)
- **`inspection_schedules`** — inspector schedule entries (stores `establishment` for calendar chips)
- **`cluster_assignments`** — one row per cluster (1–5): which inspector owns it (the only admin-editable cluster data)
- **`cluster_barangays`** — legacy table from the earlier editable-partition design; membership now lives in `fixedClusterBarangays()` — nothing reads this table
- **`burial_records`** — burial/cadaver records
- **`archive_data`** — soft-deleted items (no auto-expiry; permanent delete only via the Archive module)
- **`password_resets`** — OTP-based password reset tokens
- **`alerts`** — system alerts with fingerprint dedup
- **`activity_log`** — audit trail
- **`notification_log`** — email notification history
- **`risk_scores`** — risk score history for trend analysis
- **`risk_schedule_config`** — risk-based inspection intervals
- **`scoring_weights`** — factor weights (25/20/20/20/15)
- **`violation_categories`** — violation code reference
- **`accomplishment_records`** — monthly accomplishment per inspector

## Risk prediction formula (`php/risk_utils.php`)

5 factors, 100-point scale:
1. **Previous violations** (0–25): keyword scan + `complied` flag, 8 pts each
2. **Time since last inspection** (0–20): 0–30 days=0, 31–60=5, 61–90=10, 91–180=15, 180+=20
3. **Establishment category** (0–20): keyword match on business name (food/health=20, retail/office=12, other=5)
4. **Compliance history** (0–20): inverse of compliance rate
5. **Pending follow-ups** (0–15): 5 pts each pending item

Risk levels: HIGH >= 60, MODERATE >= 30, LOW < 30.

Inspection revisions (from `inspection_history`) are deduplicated by `report_date` before scoring — editing a report N times does not inflate its risk score.

## Security notes

- **CSRF protection**: All mutating endpoints require `X-CSRF-Token` header. Tokens are fetched from `php/csrf_token.php` or returned in the login response.
- **Session security**: `HttpOnly`, `SameSite=Lax`, `session_regenerate_id()` on login, strict mode.
- **CORS**: Restricted to `http://localhost` (not wildcard).
- **Password hashing**: bcrypt (`PASSWORD_DEFAULT`). Legacy MD5/plaintext auto-migrate on login.
- **File uploads**: Extension + MIME validation via `finfo`, randomized filenames, size limits.
- **Path traversal**: `download.php` uses `realpath` + `str_starts_with` with directory separator.
- **Rate limiting**: Login (5/15min per IP), OTP verify (5/15min), OTP send (3/hr), AI analyze (10/hr).
- **Secrets**: Stored in `php/.env` (protected by `.htaccess`). Never commit real keys.

## Quirks and gotchas

- **Inspection upsert pattern**: `inspection.php` CREATE checks if an establishment already has a report. If yes, it archives the old one to `inspection_history` and updates the existing row (in a transaction). Uses `SELECT ... FOR UPDATE` to prevent race conditions.
- **Password migration**: `auth.php` tries bcrypt first, then MD5 (32-char hex), then plaintext comparison. On match with non-bcrypt, it auto-upgrades to bcrypt.
- **CLI bypass**: `auth_check.php` allows CLI (cron) requests to bypass session auth with admin role.
- **Setup guard**: `setup_database.php` blocks re-running if users exist (unless `?force=1`). Delete or lock it after install.
- **CDN dependencies**: Tailwind, DaisyUI, Chart.js, Tesseract.js, Font Awesome, Bootstrap Icons — all loaded from CDN. No local copies.
- **XSS protection**: `Utils.esc()` in admin.js and `esc()` in inspector.js escape HTML + quotes. Use these for ALL user data in `innerHTML` templates.
- **Inspector column headers**: `buildAdminInspectorColumnMap()` fills the accomplishment report headers. On failure it retries when the report opens (and reuses `DataStore.inspectors` if cached); unused columns show `—` and a toast warns the user.
- **Cluster scoping**: the 66 barangays are split into fixed Cluster 1–5 in code (`fixedClusterBarangays()` in `cluster_lib.php`, alphabetical blocks, zone families never split). In the Schedule module (`admin.html #clusterPanel` / `ClusterAssignments` in admin.js) the admin only assigns an inspector to each cluster — barangays are read-only chips, never editable. Inspectors fetch `php/clusters.php` once on load into `_myBarangays`; Inspection reports + History show only those barangays (server-enforced in `inspection.php` GET, client-filtered too), while Sanitary Records stay citywide. Reshuffle = admin re-saves the inspector dropdowns; views recompute on the inspector's next page load (nothing stored per inspector).
- **archive_type column**: `archive_data.archive_type` was originally `ENUM('inspectors','sanitary','burial','reports')` — new types (`report`, `schedule`, `calendar_event`) were silently coerced to `''` (non-strict SQL mode). It is now `VARCHAR(50)` (`sql/archive_type_to_varchar.sql`). Do not reintroduce an enum here; archive writers are sanitary/burial/inspection/inspector/inspection_schedules/calendar_events DELETE handlers, all admin+CSRF.

## Conventions

- PHP files use `require_once 'config.php'` (not relative paths — assumes same directory).
- All API responses follow `{ success: bool, data: any, message: string }` format via `jsonResponse()`.
- JS fetches use `API_BASE_URL + '/endpoint.php'` pattern.
- No TypeScript, no linting, no formatting config.
- Session-based auth (PHP `$_SESSION`), not token-based.
- Soft-delete via `archive_data` table — no auto-expiry; admin restores or permanently deletes from the Archive module.
