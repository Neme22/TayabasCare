<?php
require_once 'auth_check.php';
requireRole(['admin', 'inspector']);
require_once 'csrf.php';
require_once 'activity_log.php';
require_once 'accomplishment_auto.php';

// ============================================================
// BULK BURIAL RECORD IMPORT
// Accepts { type, rows } — rows parsed from a DOCX (Certificates
// of Transfer) or CSV/Excel file on the frontend — and inserts
// them into burial_records in one batch.
// ============================================================

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    errorResponse('Only POST is allowed for bulk import', 405);
}

if (csrfNeeded()) {
    requireCsrf();
}

// Lazy migrations (mirrors burial.php)
function ensureImportBurialColumns() {
    global $db;
    static $checked = false;
    if ($checked) return;
    $checked = true;
    try {
        $stmt = $db->query("SHOW COLUMNS FROM burial_records LIKE 'sex'");
        if (!$stmt->fetch()) {
            $db->exec("ALTER TABLE burial_records ADD COLUMN sex VARCHAR(10) NOT NULL DEFAULT '' AFTER inspector");
        }
        $stmt = $db->query("SHOW COLUMNS FROM burial_records LIKE 'cause_of_death'");
        if (!$stmt->fetch()) {
            $db->exec("ALTER TABLE burial_records ADD COLUMN cause_of_death VARCHAR(255) NOT NULL DEFAULT '' AFTER death_place");
        }
        $stmt = $db->query("SHOW COLUMNS FROM burial_records LIKE 'age'");
        if (!$stmt->fetch()) {
            $db->exec("ALTER TABLE burial_records ADD COLUMN age VARCHAR(20) NOT NULL DEFAULT '' AFTER sex");
        }
    } catch (PDOException $e) {
        error_log('ensureImportBurialColumns: ' . $e->getMessage());
    }
}
ensureImportBurialColumns();

$input = json_decode(file_get_contents('php://input'), true);
$rows  = $input['rows'] ?? [];
$type  = $input['type'] ?? 'cadaver';

if (!in_array($type, ['cadaver', 'skeletal', 'exhumation'], true)) {
    errorResponse('Invalid burial type', 400);
}
if (!is_array($rows) || count($rows) === 0) {
    errorResponse('No rows to import', 400);
}

// Dedup keys: deceased | death_date | type (deceased is encrypted — decrypt in PHP)
$existingKeys = [];
try {
    $stmt = $db->query("SELECT deceased, IFNULL(death_date, '') as ddate, type FROM burial_records");
    foreach ($stmt->fetchAll() as $r) {
        $name = decryptField($r['deceased'] ?? '', 'burial_records.deceased') ?? '';
        $existingKeys[strtolower(trim($name)) . '|' . strtolower(trim($r['ddate'])) . '|' . $r['type']] = true;
    }
} catch (PDOException $e) {
    // proceed without duplicate detection
}

$stmt = $db->prepare("
    INSERT INTO burial_records
    (type, datetime, deceased, death_date, death_place, cause_of_death,
     informant, inspector, sex, age, origin, transfer,
     funeral, cemetery_origin, cemetery_transfer, or_number,
     file_name, file_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
");

$imported = 0;
$skipped  = 0;
$failed   = [];

$db->beginTransaction();

foreach ($rows as $i => $row) {
    $deceased = trim($row['deceased'] ?? '');
    if ($deceased === '') {
        $failed[] = ['row' => $i + 1, 'error' => 'Missing deceased name'];
        continue;
    }

    $deathDate = $row['deathDate'] ?? $row['death_date'] ?? '';
    $deathDate = is_string($deathDate) ? trim($deathDate) : '';
    if ($deathDate !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $deathDate)) {
        $parsed = strtotime($deathDate);
        $deathDate = $parsed ? date('Y-m-d', $parsed) : '';
    }

    $dedupeKey = strtolower($deceased) . '|' . strtolower($deathDate) . '|' . $type;
    if (isset($existingKeys[$dedupeKey])) {
        $skipped++;
        continue;
    }

    $datetime = trim($row['datetime'] ?? '');
    if ($datetime === '') {
        $datetime = date('Y-m-d H:i:s');
    } else {
        $parsed = strtotime($datetime);
        if ($parsed) $datetime = date('Y-m-d H:i:s', $parsed);
        else $datetime = date('Y-m-d H:i:s');
    }

    $inspectorName = trim($row['inspector'] ?? '');
    if ($inspectorName === '') {
        $inspectorName = accomplishmentSessionFullName($db);
        if ($inspectorName === '') $inspectorName = trim($_SESSION['username'] ?? '');
    }

    try {
        $stmt->execute([
            $type,
            $datetime,
            encryptField($deceased, 'burial_records.deceased'),
            $deathDate !== '' ? $deathDate : null,
            encryptField(trim($row['deathPlace'] ?? ''), 'burial_records.death_place'),
            encryptField(trim($row['causeOfDeath'] ?? ''), 'burial_records.cause_of_death'),
            encryptField(trim($row['informant'] ?? ''), 'burial_records.informant'),
            $inspectorName,
            encryptField(trim($row['sex'] ?? ''), 'burial_records.sex'),
            encryptField(trim($row['age'] ?? ''), 'burial_records.age'),
            trim($row['origin'] ?? ''),
            trim($row['transfer'] ?? ''),
            trim($row['funeral'] ?? ''),
            trim($row['cemeteryOrigin'] ?? ''),
            trim($row['cemeteryTransfer'] ?? ''),
            trim($row['orNumber'] ?? '')
        ]);
        $imported++;
        $existingKeys[$dedupeKey] = true;
    } catch (PDOException $e) {
        $failed[] = ['row' => $i + 1, 'deceased' => $deceased, 'error' => $e->getMessage()];
    }
}

// Commit all successfully imported rows; failures are reported in the response
$db->commit();

try {
    logActivity($db, 'IMPORT', 'burial', null, '', "Bulk imported $imported burial record(s) (type=$type)");
} catch (Exception $e) {}

$msg = "$imported record(s) imported.";
if ($skipped > 0) $msg .= " $skipped duplicate(s) skipped.";
if (count($failed) > 0) $msg .= " " . count($failed) . " row(s) failed.";
jsonResponse(true, ['imported' => $imported, 'skipped' => $skipped, 'failed' => $failed], $msg);
