<?php
require_once 'auth_check.php';
requireRole(['admin', 'inspector']);
require_once 'csrf.php';
require_once 'accomplishment_auto.php';
require_once 'activity_log.php';

// ============================================================
// BULK HISTORICAL ACCOMPLISHMENT IMPORT
// Accepts rows parsed from CSV/Excel/DOCX on the frontend and
// upserts them into accomplishment_records (one row per
// inspector + month + year).
// ============================================================

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    errorResponse('Only POST is allowed for bulk import', 405);
}

if (csrfNeeded()) {
    requireCsrf();
}

$input = json_decode(file_get_contents('php://input'), true);
$rows  = $input['rows'] ?? [];

if (!is_array($rows) || count($rows) === 0) {
    errorResponse('No rows to import', 400);
}

$stmt = $db->prepare("
    INSERT INTO accomplishment_records (inspector_name, month, year, fields)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE fields = VALUES(fields), updated_at = CURRENT_TIMESTAMP
");

$imported = 0;
$updated  = 0;
$failed   = [];

$db->beginTransaction();

foreach ($rows as $i => $row) {
    $inspector = trim($row['inspector'] ?? '');
    $month     = intval($row['month'] ?? 0);
    $year      = intval($row['year'] ?? 0);
    $fields    = $row['fields'] ?? [];

    if ($inspector === '') {
        $failed[] = ['row' => $i + 1, 'error' => 'Missing inspector name'];
        continue;
    }
    if ($month < 1 || $month > 12) {
        $failed[] = ['row' => $i + 1, 'error' => 'Invalid month'];
        continue;
    }
    if ($year < 2000 || $year > 2099) {
        $failed[] = ['row' => $i + 1, 'error' => 'Invalid year'];
        continue;
    }
    if (!is_array($fields)) $fields = [];

    // Normalize to exactly 24 numeric slots
    $norm = [];
    for ($f = 0; $f < 24; $f++) {
        $v = $fields[$f] ?? 0;
        $norm[] = max(0, intval($v));
    }

    try {
        // Detect insert vs update for the imported counter
        $check = $db->prepare("SELECT id FROM accomplishment_records WHERE inspector_name = ? AND month = ? AND year = ?");
        $check->execute([$inspector, $month, $year]);
        $existed = (bool)$check->fetch();

        $stmt->execute([$inspector, $month, $year, json_encode($norm)]);
        if ($existed) $updated++; else $imported++;
    } catch (PDOException $e) {
        error_log('import_accomplishment.php row error: ' . $e->getMessage());
        $failed[] = ['row' => $i + 1, 'error' => 'Database error'];
    }
}

if ($imported + $updated > 0) {
    $db->commit();
    logActivity($db, 'IMPORT', 'accomplishment', 0, '', "Imported $imported, updated $updated");
    $msg = "Imported $imported record(s)";
    if ($updated) $msg .= ", updated $updated";
    if ($failed) $msg .= ", " . count($failed) . " failed";
    jsonResponse(true, ['imported' => $imported, 'updated' => $updated, 'failed' => $failed], $msg . '.');
} else {
    $db->rollBack();
    errorResponse('No rows imported' . ($failed ? ': ' . $failed[0]['error'] : ''), 400);
}
