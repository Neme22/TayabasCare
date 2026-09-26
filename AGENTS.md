# TayabasCare — Agent Guide

## What this is

A PHP + vanilla JS web app for sanitary inspection and risk prediction in Tayabas City. Runs on XAMPP (Apache + MySQL). No build step, no package manager, no test suite, no CI.

## Project objectives

See `objectives.md`. In short: digitize inspection records, score establishments by violation risk (5-factor formula in `predict.php`), and provide dashboards for the City Health Office.

## Running locally

1. Place the repo at `C:\xampp\htdocs\TayabasCare` (already done if you're here).
2. Start Apache + MySQL from XAMPP Control Panel.
3. One-time DB setup: visit `http://localhost/TayabasCare/php/setup_database.php` in a browser. This creates database `tayabascare_db` and all tables.
4. Landing page: `http://localhost/TayabasCare/` (index.html).

Default admin: `admin` / `admin123` (created by setup_database.php). There is also a legacy script `create_default_users.php` with different passwords (`admin`/`1234`).

## Architecture

### Pages (static HTML, no framework)

| File | Role | Auth |
|---|---|---|
| `index.html` | Public landing page + login modal | None |
| `admin.html` | Admin dashboard (all modules) | Admin only |
| `inspector.html` | Inspector field dashboard | Inspector only |

### PHP API layer (`php/`)

Every PHP endpoint includes `config.php` which sets CORS headers, creates a PDO connection (`$db`), and provides `jsonResponse()` / `errorResponse()` helpers.

| File | Purpose |
|---|---|
| `config.php` | DB connection (PDO), CORS, response helpers. **Must be `require_once`'d by every endpoint.** |
| `db.php` | Legacy mysqli connection. Used by some older code paths — prefer PDO via `config.php` for new code. |
| `auth.php` | Login (POST), session check (GET), logout (DELETE). Handles bcrypt, MD5, and plaintext password migration. |
| `sanitary.php` | CRUD for `sanitary_records` table. |
| `inspection.php` | CRUD for `inspection_reports`. On create/update, archives previous version to `inspection_history`. |
| `inspection_schedules.php` | Upsert schedule entries (inspector + date). |
| `burial.php` | CRUD for `burial_records` (cadaver/skeletal/exhumation). |
| `archive.php` | Soft-delete store. Auto-purges expired items (30-day expiry). |
| `predict.php` | **Risk prediction engine.** 5-factor scoring (0–100): violations, time since last inspection, establishment type, compliance rate, pending follow-ups. |
| `ai_analyze.php` | Calls OpenRouter API (model prompt in-code) for AI risk narrative. API key in `secrets.php`. |
| `import_sanitary.php` | Bulk CSV/Excel import into `sanitary_records`. |
| `setup_database.php` | One-time DB + table creation. Run in browser. |
| `secrets.php` | OpenRouter API key. Do not commit real keys. |

### JavaScript (`js/`)

| File | Used by |
|---|---|
| `login.js` | `index.html` — login form, forgot-password flow |
| `admin.js` | `admin.html` — all admin modules (~4000 lines, single file) |
| `inspector.js` | `inspector.html` — inspector modules (~5000 lines, single file) |

API base URL is hardcoded: `const API_BASE_URL = 'http://localhost/TayabasCare/php';`

### CSS (`css/`)

| File | Used by |
|---|---|
| `style.css` | `index.html` (landing page) |
| `admin.css` | `admin.html` |
| `inspector.css` | `inspector.html` |
| `dashboard.css` | Shared dashboard components |

External CSS loaded via CDN: Tailwind CSS, DaisyUI 4.6.0, Font Awesome 6.x, Bootstrap Icons, Google Fonts (Inter).

## Database schema (11 tables)

All tables use InnoDB + utf8mb4. Key tables:

- **`users`** — login credentials, role (`admin`/`inspector`)
- **`inspector_accounts`** — inspector profiles. Auth syncs between this and `users`.
- **`sanitary_records`** — establishment records (the main data table for prediction)
- **`inspection_reports`** — current/latest inspection per establishment
- **`inspection_history`** — archived versions of inspection reports (auto-populated on update)
- **`inspection_schedules`** — inspector schedule entries
- **`burial_records`** — burial/cadaver records (separate module)
- **`archive_data`** — soft-deleted items with 30-day expiry
- **`password_resets`** — OTP-based password reset tokens
- **`sanitary_permits`** — legacy permit data (imported historical records)

## Risk prediction formula (`predict.php`)

5 factors, 100-point scale:
1. **Previous violations** (0–25): keyword scan + `complied` flag, 8 pts each
2. **Time since last inspection** (0–20): 0–30 days=0, 31–60=5, 61–90=10, 91–180=15, 180+=20
3. **Establishment category** (0–20): keyword match on business name (food/health=20, retail/office=12, other=5)
4. **Compliance history** (0–20): inverse of compliance rate
5. **Pending follow-ups** (0–15): 5 pts each pending item

Risk levels: HIGH >= 60, MODERATE >= 30, LOW < 30.

## Quirks and gotchas

- **Two DB drivers coexist**: `config.php` uses PDO, `db.php` uses mysqli. New code should use PDO via `config.php`.
- **Inspection upsert pattern**: `inspection.php` CREATE checks if an establishment already has a report. If yes, it archives the old one to `inspection_history` and updates the existing row instead of inserting.
- **Password migration**: `auth.php` tries bcrypt first, then MD5 (32-char hex), then plaintext comparison. On match with non-bcrypt, it auto-upgrades to bcrypt.
- **No CORS restriction**: `Access-Control-Allow-Origin: *` is set in `config.php`. Fine for local dev, not for production.
- **`setup_database.php` is a string literal bug**: the file starts with a `"` character (line 1) before the HTML doctype. It still works because PHP processes the `<?php` block inside, but the output starts with a stray quote.
- **Prediction uses both DB and localStorage**: `predict.php` GET pulls from MySQL. The POST endpoint accepts inspection data from localStorage (frontend passes it). The GET handler merges `inspection_reports` + `inspection_history` for accurate violation counts.
- **CDN dependencies**: Tailwind, DaisyUI, Chart.js, Tesseract.js, Font Awesome, Bootstrap Icons — all loaded from CDN. No local copies. If CDN is unreachable, UI breaks.
- **Hardcoded inspector names** in `admin.html` accomplishment report table headers (MEL, MICHAEL, OLIVE, WENDY, ZALDY). Changing inspectors requires editing the HTML.

## Conventions

- PHP files use `require_once 'config.php'` (not relative paths — assumes same directory).
- All API responses follow `{ success: bool, data: any, message: string }` format via `jsonResponse()`.
- JS fetches use `API_BASE_URL + '/endpoint.php'` pattern.
- No TypeScript, no linting, no formatting config.
- Session-based auth (PHP `$_SESSION`), not token-based.
- Soft-delete via `archive_data` table with 30-day auto-expiry.
