<?php
require_once 'auth_check.php';
requireRole('admin');

// ============================================================
// BULK HISTORICAL RECORD IMPORT (Objective 1)
// Accepts an array of sanitary record rows (parsed from a CSV/
// Excel file on the frontend) and inserts them into
// sanitary_records in one batch — for digitizing old paper
// records instead of typing them one at a time.
// ============================================================

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    errorResponse('Only POST is allowed for bulk import', 405);
}

$input = json_decode(file_get_contents('php://input'), true);
$rows  = $input['rows'] ?? [];

if (!is_array($rows) || count($rows) === 0) {
    errorResponse('No rows to import', 400);
}

// Fetch existing business names + barangay for duplicate detection
$existingKeys = [];
try {
    $existingStmt = $db->query("SELECT LOWER(TRIM(business_name)) as name, LOWER(TRIM(barangay)) as brgy FROM sanitary_records");
    foreach ($existingStmt->fetchAll() as $row) {
        $existingKeys[$row['name'] . '|' . ($row['brgy'] ?? '')] = true;
    }
} catch (PDOException $e) {
    // If query fails, proceed without duplicate detection
}

$stmt = $db->prepare("
    INSERT INTO sanitary_records
    (record_no, date, permit_no, personnel_no, business_name,
     owner_first_name, owner_middle_name, owner_last_name,
     personnel_list, sex, result_xray, result_stool, barangay,
     building_street, corporation_name, remarks, business_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
");

$imported  = 0;
$skipped   = 0;
$failed    = [];

$db->beginTransaction();

foreach ($rows as $i => $row) {
    $businessName = trim($row['businessName'] ?? '');
    if ($businessName === '') {
        $failed[] = ['row' => $i + 1, 'error' => 'Missing business name'];
        continue;
    }

    // Duplicate detection (name + barangay)
    $normalizedName = strtolower(trim($businessName));
    $normalizedBrgy = strtolower(trim($row['barangay'] ?? ''));
    $dedupeKey = $normalizedName . '|' . $normalizedBrgy;
    if (isset($existingKeys[$dedupeKey])) {
        $skipped++;
        continue;
    }

    // Date format validation
    $dateVal = $row['date'] ?? date('Y-m-d');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateVal)) {
        $dateVal = date('Y-m-d');
    }

    // Map medical results and personnel from imported data
    $resultXray = isset($row['resultXray']) ? (int)(bool)$row['resultXray'] : (isset($row['Result Xray']) ? (int)(bool)$row['Result Xray'] : 0);
    $resultStool = isset($row['resultStool']) ? (int)(bool)$row['resultStool'] : (isset($row['Result Stool']) ? (int)(bool)$row['Result Stool'] : 0);
    $personnelRaw = $row['personnelList'] ?? $row['Personnel List'] ?? null;
    if ($personnelRaw === null || $personnelRaw === '') {
        $personnelList = json_encode([]);
    } elseif (is_string($personnelRaw)) {
        $personnelList = json_encode(array_filter(array_map('trim', explode(',', $personnelRaw))));
    } else {
        $personnelList = json_encode($personnelRaw);
    }

    try {
        $stmt->execute([
            $row['no']             ?? '',
            $dateVal,
            $row['permitNo']       ?? '',
            $row['personnelNo']    ?? '',
            $businessName,
            $row['ownerFirst']     ?? '',
            $row['ownerMiddle']    ?? '',
            $row['ownerLast']      ?? '',
            $personnelList,
            $row['sex']            ?? '',
            $resultXray,
            $resultStool,
            $row['barangay']       ?? '',
            $row['buildingStreet'] ?? '',
            $row['corporationName']?? '',
            $row['remarks']        ?? '',
            $row['businessType']   ?? 'Other'
        ]);
        $imported++;
        $existingKeys[$dedupeKey] = true;
    } catch (PDOException $e) {
        $failed[] = ['row' => $i + 1, 'business' => $businessName, 'error' => $e->getMessage()];
    }
}

if (empty($failed)) {
    $db->commit();
} else {
    // Commit what succeeded, report failures
    $db->commit();
}

$msg = "$imported record(s) imported.";
if ($skipped > 0) $msg .= " $skipped duplicate(s) skipped.";
jsonResponse(true, ['imported' => $imported, 'skipped' => $skipped, 'failed' => $failed], $msg);
?>
