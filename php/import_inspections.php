<?php
require_once 'auth_check.php';
requireRole('admin');
require_once 'csrf.php';

// ============================================================
// BULK INSPECTION REPORT IMPORT (Objective 1)
// Accepts an array of inspection records (parsed from CSV/Excel
// on the frontend) and inserts them into inspection_reports.
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

// Build lookup map: business_name -> sanitary_records.id
$estabMap = [];
try {
    $estabStmt = $db->query("SELECT id, LOWER(TRIM(business_name)) as name FROM sanitary_records");
    foreach ($estabStmt->fetchAll() as $row) {
        $estabMap[$row['name']] = (int)$row['id'];
    }
} catch (PDOException $e) {}

// Load violation categories for code mapping
$categoryMap = [];
try {
    $catStmt = $db->query("SELECT code, LOWER(label) as label FROM violation_categories WHERE is_active = 1");
    foreach ($catStmt->fetchAll() as $row) {
        $categoryMap[$row['label']] = $row['code'];
    }
} catch (PDOException $e) {}

$stmt = $db->prepare("
    INSERT INTO inspection_reports
    (establishment, establishment_id, inspector_name, report_date, recommendation, remarks, complied, status, file_path, compliance_deadline, violation_codes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
");

$imported = 0;
$failed = [];

$db->beginTransaction();

foreach ($rows as $i => $row) {
    $establishment = trim($row['establishment'] ?? '');
    if ($establishment === '') {
        $failed[] = ['row' => $i + 1, 'error' => 'Missing establishment name'];
        continue;
    }

    // Validate date
    $reportDate = $row['reportDate'] ?? $row['date'] ?? date('Y-m-d');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}/', $reportDate)) {
        $reportDate = date('Y-m-d');
    }

    // Map establishment to ID
    $estabId = $estabMap[strtolower(trim($establishment))] ?? null;

    // Parse complied status
    $complied = 0;
    $compliedRaw = strtolower(trim($row['complied'] ?? ''));
    if (in_array($compliedRaw, ['1', 'true', 'yes', 'complied'])) $complied = 1;

    // Parse violation codes from remarks/recommendation
    $remarks = trim($row['remarks'] ?? '');
    $recommendation = trim($row['recommendation'] ?? '');
    $violationCodes = [];
    $combinedText = strtolower($remarks . ' ' . $recommendation);
    foreach ($categoryMap as $label => $code) {
        if (strpos($combinedText, $label) !== false) {
            $violationCodes[] = $code;
        }
    }

    // Also check for explicit violation codes from checklist
    if (!empty($row['violationCodes'])) {
        if (is_string($row['violationCodes'])) {
            $extra = json_decode($row['violationCodes'], true);
            if (is_array($extra)) $violationCodes = array_unique(array_merge($violationCodes, $extra));
        } elseif (is_array($row['violationCodes'])) {
            $violationCodes = array_unique(array_merge($violationCodes, $row['violationCodes']));
        }
    }

    $complianceDeadline = $row['complianceDeadline'] ?? null;
    if ($complianceDeadline && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $complianceDeadline)) {
        $complianceDeadline = null;
    }

    try {
        $stmt->execute([
            $establishment,
            $estabId,
            trim($row['inspectorName'] ?? ''),
            $reportDate,
            $recommendation,
            $remarks,
            $complied,
            trim($row['status'] ?? 'Submitted'),
            $complianceDeadline,
            !empty($violationCodes) ? json_encode($violationCodes) : null
        ]);
        $imported++;
    } catch (PDOException $e) {
        $failed[] = ['row' => $i + 1, 'business' => $establishment, 'error' => $e->getMessage()];
    }
}

if (empty($failed)) {
    $db->commit();
} else {
    $db->commit();
}

try {
    require_once 'activity_log.php';
    logActivity($db, 'IMPORT', 'inspection', null, '', "Bulk imported $imported inspection report(s)");
} catch (Exception $e) {}

$msg = "$imported inspection report(s) imported.";
jsonResponse(true, ['imported' => $imported, 'failed' => $failed], $msg);
?>
