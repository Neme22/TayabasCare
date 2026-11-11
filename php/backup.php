<?php
// ============================================================
// TayabasCare — Database Backup & Restore (admin only + CLI cron)
//
// GET    backup.php                  → list dumps & schedule summary
// POST   action=create [&type=...]   → mysqldump → backups/ (manual|weekly|monthly)
// GET    action=download&file=       → download one dump
// POST   action=restore&file=        → load dump into DB (CSRF + admin)
// CLI    cron_cli.php backup run_weekly|run_monthly
//
// Backups live in ../backups/ (project root). Filenames must match
// tayabascare_db_[weekly_|monthly_]YYYYMMDD_HHMMSS.sql — no path traversal.
// ============================================================
require_once 'config.php';
require_once 'auth_check.php';
require_once 'csrf.php';
require_once 'activity_log.php';

requireRole('admin');

const BACKUP_PREFIX = 'tayabascare_db_';
const BACKUP_EXT = '.sql';
const BACKUP_KEEP_WEEKLY = 8;
const BACKUP_KEEP_MONTHLY = 12;

function backupDir(): string {
    $dir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'backups';
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    return $dir;
}

function appendBackupLog(string $line): void {
    $logFile = backupDir() . DIRECTORY_SEPARATOR . 'backup.log';
    $stamp = date('Y-m-d H:i:s T');
    @file_put_contents($logFile, "[$stamp] $line" . PHP_EOL, FILE_APPEND | LOCK_EX);
}

function dumpTypeFromFilename(string $file): string {
    if (str_starts_with($file, BACKUP_PREFIX . 'weekly_')) return 'weekly';
    if (str_starts_with($file, BACKUP_PREFIX . 'monthly_')) return 'monthly';
    return 'manual';
}

function mysqldumpPath(): string {
    $candidates = [
        dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'mysql' . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'mysqldump.exe',
        'C:\\xampp\\mysql\\bin\\mysqldump.exe',
        '/usr/bin/mysqldump',
        '/usr/bin/mariadb-dump',
    ];
    foreach ($candidates as $p) {
        if (is_executable($p)) return $p;
    }
    return '';
}

function mysqlClientPath(): string {
    $candidates = [
        dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'mysql' . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'mysql.exe',
        'C:\\xampp\\mysql\\bin\\mysql.exe',
        '/usr/bin/mysql',
        '/usr/bin/mariadb',
    ];
    foreach ($candidates as $p) {
        if (is_executable($p)) return $p;
    }
    return '';
}

/** Resolve a dump filename safely inside backups/. Returns full path or null. */
function resolveDump(string $file): ?string {
    $file = basename($file); // strip any path
    if ($file === '' || !str_starts_with($file, BACKUP_PREFIX) || !str_ends_with($file, BACKUP_EXT)) {
        return null;
    }
    if (!preg_match('/^' . preg_quote(BACKUP_PREFIX, '/') . '(?:(weekly|monthly)_)?\d{8}_\d{6}' . preg_quote(BACKUP_EXT, '/') . '$/', $file)) {
        return null;
    }
    $full = backupDir() . DIRECTORY_SEPARATOR . $file;
    if (!is_file($full)) return null;
    return $full;
}

function listDumps(): array {
    $dir = backupDir();
    $out = [];
    foreach (glob($dir . DIRECTORY_SEPARATOR . BACKUP_PREFIX . '*' . BACKUP_EXT) ?: [] as $path) {
        $name = basename($path);
        if (!resolveDump($name)) continue;
        $out[] = [
            'file'  => $name,
            'type'  => dumpTypeFromFilename($name),
            'size'  => (int) filesize($path),
            'mtime' => (int) filemtime($path),
        ];
    }
    usort($out, fn($a, $b) => $b['mtime'] <=> $a['mtime']);
    return $out;
}

function buildScheduleSummary(array $dumps): array {
    $weekly = array_values(array_filter($dumps, fn($d) => $d['type'] === 'weekly'));
    $monthly = array_values(array_filter($dumps, fn($d) => $d['type'] === 'monthly'));
    return [
        'weekly' => [
            'label'       => 'Every Sunday at 2:00 AM',
            'keep'        => BACKUP_KEEP_WEEKLY,
            'count'       => count($weekly),
            'latestFile'  => $weekly[0]['file'] ?? null,
            'latestMtime' => $weekly[0]['mtime'] ?? null,
        ],
        'monthly' => [
            'label'       => '1st of every month at 3:00 AM',
            'keep'        => BACKUP_KEEP_MONTHLY,
            'count'       => count($monthly),
            'latestFile'  => $monthly[0]['file'] ?? null,
            'latestMtime' => $monthly[0]['mtime'] ?? null,
        ],
    ];
}

function pruneScheduledBackups(string $type, int $keep): int {
    if (!in_array($type, ['weekly', 'monthly'], true) || $keep < 1) return 0;
    $pattern = backupDir() . DIRECTORY_SEPARATOR . BACKUP_PREFIX . $type . '_*' . BACKUP_EXT;
    $files = glob($pattern) ?: [];
    if (count($files) <= $keep) return 0;

    usort($files, function ($a, $b) {
        $cmp = filemtime($b) <=> filemtime($a);
        return $cmp !== 0 ? $cmp : strcmp(basename($b), basename($a));
    });

    $removed = 0;
    foreach (array_slice($files, $keep) as $old) {
        if (@unlink($old)) $removed++;
    }
    return $removed;
}

function shellQuoteArg(string $v): string {
    // Windows cmd-safe double-quote wrapping
    return '"' . str_replace('"', '""', $v) . '"';
}

function runCommand(string $cmd, ?string $stdinFile = null, ?string $stdoutFile = null): array {
    $descriptors = [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
    if ($stdinFile !== null) {
        $descriptors[0] = ['file', $stdinFile, 'r'];
    }
    if ($stdoutFile !== null) {
        $descriptors[1] = ['file', $stdoutFile, 'w'];
    }
    $proc = proc_open($cmd, $descriptors, $pipes);
    if (!is_resource($proc)) {
        return [1, '', 'Failed to start process'];
    }
    if ($stdinFile === null) {
        fclose($pipes[0]);
    }
    $stdout = ($stdoutFile === null && isset($pipes[1])) ? stream_get_contents($pipes[1]) : '';
    $stderr = isset($pipes[2]) ? stream_get_contents($pipes[2]) : '';
    if ($stdoutFile === null && isset($pipes[1])) fclose($pipes[1]);
    if (isset($pipes[2])) fclose($pipes[2]);
    $code = proc_close($proc);
    return [$code, (string)$stdout, (string)$stderr];
}

function createDatabaseDump(PDO $db, string $type = 'manual'): array {
    if (!in_array($type, ['manual', 'weekly', 'monthly'], true)) {
        $type = 'manual';
    }
    $dump = mysqldumpPath();
    if (!$dump) {
        appendBackupLog("FAIL [$type] mysqldump not found");
        return [false, 'mysqldump not found on this server.', null, 0, 0];
    }

    $stamp = date('Ymd_His');
    $mid = ($type === 'manual') ? '' : ($type . '_');
    $file = BACKUP_PREFIX . $mid . $stamp . BACKUP_EXT;
    $full = backupDir() . DIRECTORY_SEPARATOR . $file;

    // --no-tablespaces avoids MySQL 8 PROCESS privilege failure on DB-scoped accounts
    $opts = '--single-transaction --no-tablespaces --routines --triggers --events --add-drop-table --result-file='
        . (PHP_OS_FAMILY === 'Windows' ? shellQuoteArg($full) : escapeshellarg($full));

    if (PHP_OS_FAMILY === 'Windows') {
        $cmd = shellQuoteArg($dump)
            . ' -u ' . shellQuoteArg(DB_USER)
            . (DB_PASS !== '' ? ' -p' . shellQuoteArg(DB_PASS) : '')
            . (DB_HOST !== 'localhost' && DB_HOST !== '' ? ' -h ' . shellQuoteArg(DB_HOST) : '')
            . ' ' . $opts . ' ' . shellQuoteArg(DB_NAME);
    } else {
        $cmd = escapeshellarg($dump)
            . ' -u ' . escapeshellarg(DB_USER)
            . (DB_PASS !== '' ? ' -p' . escapeshellarg(DB_PASS) : '')
            . (DB_HOST !== 'localhost' && DB_HOST !== '' ? ' -h ' . escapeshellarg(DB_HOST) : '')
            . ' ' . $opts . ' ' . escapeshellarg(DB_NAME);
    }

    [$code, $out, $err] = runCommand($cmd);
    if ($code !== 0 || !is_file($full) || filesize($full) === 0) {
        @unlink($full);
        $errMsg = trim($err !== '' ? $err : $out);
        appendBackupLog("FAIL [$type] $file: $errMsg");
        return [false, 'Backup failed: ' . $errMsg, null, 0, 0];
    }

    @chmod($full, 0640);
    $size = (int) filesize($full);

    $pruned = 0;
    if ($type === 'weekly') {
        $pruned = pruneScheduledBackups('weekly', BACKUP_KEEP_WEEKLY);
    } elseif ($type === 'monthly') {
        $pruned = pruneScheduledBackups('monthly', BACKUP_KEEP_MONTHLY);
    }

    appendBackupLog("OK [$type] $file ($size bytes)" . ($pruned > 0 ? " (pruned $pruned old)" : ''));
    logActivity($db, 'CREATE', 'backup', null, $file, "Database backup created ($type)");

    return [true, 'Backup created successfully', $file, $size, $pruned];
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = $_GET['action'] ?? ($_POST['action'] ?? 'list');

// ---------- CLI CRON (weekly / monthly) ----------
if ($method === 'GET' && in_array($action, ['run_weekly', 'run_monthly', 'run_manual'], true)) {
    if (php_sapi_name() !== 'cli') {
        errorResponse('CLI cron only.', 403);
    }
    $type = substr($action, 4);
    [$ok, $msg, $file, $size, $pruned] = createDatabaseDump($db, $type);
    if (!$ok) {
        fwrite(STDERR, "[FAIL] [$type] $msg" . PHP_EOL);
        exit(1);
    }
    echo "[OK] [$type] $file ($size bytes)" . ($pruned > 0 ? " pruned=$pruned" : '') . PHP_EOL;
    exit(0);
}

// ---------- LIST ----------
if ($method === 'GET' && ($action === 'list' || $action === '')) {
    $dumps = listDumps();
    jsonResponse(true, [
        'dumps'      => $dumps,
        'dir'        => backupDir(),
        'canBackup'  => mysqldumpPath() !== '',
        'canRestore' => mysqlClientPath() !== '',
        'schedule'   => buildScheduleSummary($dumps),
    ], 'ok');
}

// ---------- DOWNLOAD ----------
if ($method === 'GET' && $action === 'download') {
    $path = resolveDump($_GET['file'] ?? '');
    if (!$path) errorResponse('Invalid backup file.', 400);
    $name = basename($path);
    header('Content-Type: application/sql');
    header('Content-Disposition: attachment; filename="' . $name . '"');
    header('Content-Length: ' . filesize($path));
    header('X-Content-Type-Options: nosniff');
    readfile($path);
    exit;
}

// ---------- CREATE ----------
if ($method === 'POST' && $action === 'create') {
    requireCsrf();
    $type = $_POST['type'] ?? 'manual';
    if (!in_array($type, ['manual', 'weekly', 'monthly'], true)) {
        $type = 'manual';
    }
    [$ok, $msg, $file, $size] = createDatabaseDump($db, $type);
    if (!$ok) {
        errorResponse($msg, 500);
    }
    $dumps = listDumps();
    jsonResponse(true, [
        'file'     => $file,
        'type'     => $type,
        'size'     => $size,
        'dumps'    => $dumps,
        'schedule' => buildScheduleSummary($dumps),
    ], ucfirst($type) . ' backup created successfully');
}

// ---------- RESTORE ----------
if ($method === 'POST' && $action === 'restore') {
    requireCsrf();
    $client = mysqlClientPath();
    if (!$client) errorResponse('mysql client not found on this server.', 500);

    $path = resolveDump($_POST['file'] ?? '');
    if (!$path) errorResponse('Invalid backup file.', 400);

    // Ensure DB exists
    $create = (PHP_OS_FAMILY === 'Windows')
        ? shellQuoteArg($client) . ' -u ' . shellQuoteArg(DB_USER)
            . (DB_PASS !== '' ? ' -p' . shellQuoteArg(DB_PASS) : '')
            . ' -e ' . shellQuoteArg('CREATE DATABASE IF NOT EXISTS `' . DB_NAME . '` CHARACTER SET utf8mb4;')
        : escapeshellarg($client) . ' -u ' . escapeshellarg(DB_USER)
            . (DB_PASS !== '' ? ' -p' . escapeshellarg(DB_PASS) : '')
            . ' -e ' . escapeshellarg('CREATE DATABASE IF NOT EXISTS `' . DB_NAME . '` CHARACTER SET utf8mb4;');

    [$c1, , $e1] = runCommand($create);
    if ($c1 !== 0) errorResponse('Could not prepare database: ' . trim($e1), 500);

    // Feed dump via stdin
    if (PHP_OS_FAMILY === 'Windows') {
        $cmd = shellQuoteArg($client) . ' -u ' . shellQuoteArg(DB_USER)
            . (DB_PASS !== '' ? ' -p' . shellQuoteArg(DB_PASS) : '')
            . (DB_HOST !== 'localhost' && DB_HOST !== '' ? ' -h ' . shellQuoteArg(DB_HOST) : '')
            . ' ' . shellQuoteArg(DB_NAME);
    } else {
        $cmd = escapeshellarg($client) . ' -u ' . escapeshellarg(DB_USER)
            . (DB_PASS !== '' ? ' -p' . escapeshellarg(DB_PASS) : '')
            . (DB_HOST !== 'localhost' && DB_HOST !== '' ? ' -h ' . escapeshellarg(DB_HOST) : '')
            . ' ' . escapeshellarg(DB_NAME);
    }

    [$code, $out, $err] = runCommand($cmd, $path, null);
    if ($code !== 0) {
        errorResponse('Restore failed: ' . trim($err !== '' ? $err : $out), 500);
    }

    appendBackupLog('RESTORE ' . basename($path));
    logActivity($db, 'RESTORE', 'backup', null, basename($path), 'Database restored from backup');
    jsonResponse(true, ['file' => basename($path)], 'Database restored successfully from ' . basename($path));
}

errorResponse('Unknown action.', 400);
