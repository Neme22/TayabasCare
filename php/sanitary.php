<?php
require_once 'auth_check.php';
require_once 'activity_log.php';
require_once 'csrf.php';

$method = $_SERVER['REQUEST_METHOD'];

// Inspectors and admins can add records; only admins can edit or delete
if ($method === 'POST') {
    requireRole(['admin', 'inspector']);
} elseif (in_array($method, ['PUT', 'DELETE'])) {
    requireRole('admin');
}

if (csrfNeeded()) {
    requireCsrf();
}

switch($method) {
    case 'GET':
        getRecords();
        break;
    case 'POST':
        createRecord();
        break;
    case 'PUT':
        updateRecord();
        break;
    case 'DELETE':
        deleteRecord();
        break;
}

function getRecords() {
    global $db;
    try {
        $stmt = $db->query("SELECT * FROM sanitary_records ORDER BY created_at DESC");
        $records = $stmt->fetchAll();
        
        $formatted = array_map(function($r) {
            return [
                'id' => (int)$r['id'],
                'no' => $r['record_no'] ?? '',
                'date' => $r['date'],
                'permitNo' => $r['permit_no'],
                'personnelNo' => $r['personnel_no'] ?? '',
                'businessName' => $r['business_name'],
                'owner' => [
                    'first' => $r['owner_first_name'] ?? '',
                    'middle' => $r['owner_middle_name'] ?? '',
                    'last' => $r['owner_last_name'] ?? ''
                ],
                'personnel' => json_decode($r['personnel_list'] ?? '[]', true),
                'sex' => $r['sex'] ?? '',
                'result' => [
                    'xray' => (bool)($r['result_xray'] ?? 0),
                    'stool' => (bool)($r['result_stool'] ?? 0)
                ],
                'barangay' => $r['barangay'],
                'corporationName' => $r['corporation_name'] ?? '',
                'remarks' => $r['remarks'] ?? '',
                'businessType' => $r['business_type'] ?? 'Other'
            ];
        }, $records);
        
        jsonResponse(true, $formatted);
    } catch(PDOException $e) {
        error_log('sanitary.php error: ' . $e->getMessage());
        errorResponse('An error occurred. Please try again.', 500);
    }
}

function createRecord() {
    global $db;
    $input = json_decode(file_get_contents('php://input'), true);

    $errors = [];
    if (empty(trim($input['businessName'] ?? ''))) $errors[] = 'Business name is required.';
    if (empty(trim($input['barangay'] ?? ''))) $errors[] = 'Barangay is required.';
    $dateVal = $input['date'] ?? '';
    if ($dateVal && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateVal)) $errors[] = 'Date must be in YYYY-MM-DD format.';
    if (!empty($errors)) { errorResponse(implode(' ', $errors), 400); return; }

    try {
        $stmt = $db->prepare("
            INSERT INTO sanitary_records 
            (record_no, date, permit_no, personnel_no, business_name, 
             owner_first_name, owner_middle_name, owner_last_name, 
             personnel_list, sex, result_xray, result_stool, barangay, building_street, corporation_name, remarks, business_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");
        
        $stmt->execute([
            $input['no'] ?? '',
            $input['date'] ?? date('Y-m-d'),
            $input['permitNo'] ?? '',
            $input['personnelNo'] ?? '',
            $input['businessName'] ?? '',
            $input['owner']['first'] ?? '',
            $input['owner']['middle'] ?? '',
            $input['owner']['last'] ?? '',
            json_encode($input['personnel_list'] ?? $input['personnel'] ?? []),
            $input['sex'] ?? '',
            $input['result']['xray'] ?? 0,
            $input['result']['stool'] ?? 0,
            $input['barangay'] ?? '',
            $input['buildingStreet'] ?? 'N/A',
            $input['corporationName'] ?? '',
            $input['remarks'] ?? '',
            $input['businessType'] ?? 'Other'
        ]);

        $newId = $db->lastInsertId();
        logActivity($db, 'CREATE', 'sanitary', $newId, $input['businessName'] ?? '', 'New sanitary record');
        jsonResponse(true, ['id' => $newId], 'Record created');
    } catch(PDOException $e) {
        error_log('sanitary.php error: ' . $e->getMessage());
        errorResponse('An error occurred. Please try again.', 500);
    }
}

function updateRecord() {
    global $db;
    $input = json_decode(file_get_contents('php://input'), true);

    $errors = [];
    if (empty(trim($input['businessName'] ?? ''))) $errors[] = 'Business name is required.';
    if (empty(trim($input['barangay'] ?? ''))) $errors[] = 'Barangay is required.';
    $dateVal = $input['date'] ?? '';
    if ($dateVal && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateVal)) $errors[] = 'Date must be in YYYY-MM-DD format.';
    if (!empty($errors)) { errorResponse(implode(' ', $errors), 400); return; }

    try {
        $stmt = $db->prepare("
            UPDATE sanitary_records SET
            record_no=?, date=?, permit_no=?, personnel_no=?,
            business_name=?, owner_first_name=?, owner_middle_name=?,
            owner_last_name=?, personnel_list=?, sex=?,
            result_xray=?, result_stool=?, barangay=?, building_street=?, corporation_name=?, remarks=?, business_type=?
            WHERE id=?
        ");
        
        $stmt->execute([
            $input['no'] ?? '', 
            $input['date'] ?? '', 
            $input['permitNo'] ?? '', 
            $input['personnelNo'] ?? '',
            $input['businessName'] ?? '', 
            $input['owner']['first'] ?? '', 
            $input['owner']['middle'] ?? '',
            $input['owner']['last'] ?? '', 
            json_encode($input['personnel_list'] ?? $input['personnel'] ?? []), 
            $input['sex'] ?? '',
            $input['result']['xray'] ?? 0, 
            $input['result']['stool'] ?? 0, 
            $input['barangay'] ?? '',
            $input['buildingStreet'] ?? 'N/A',
            $input['corporationName'] ?? '',
            $input['remarks'] ?? '',
            $input['businessType'] ?? 'Other', 
            $input['id']
        ]);

        logActivity($db, 'UPDATE', 'sanitary', $input['id'], $input['businessName'] ?? '', 'Sanitary record updated');
        jsonResponse(true, null, 'Record updated');
    } catch(PDOException $e) {
        error_log('sanitary.php error: ' . $e->getMessage());
        errorResponse('An error occurred. Please try again.', 500);
    }
}

function deleteRecord() {
    global $db;
    $id = $_GET['id'] ?? null;
    $reason = $_GET['reason'] ?? '';

    if (!$id) {
        errorResponse('Record ID is required.', 400);
        return;
    }

    try {
        $stmt = $db->prepare("SELECT * FROM sanitary_records WHERE id = ?");
        $stmt->execute([$id]);
        $record = $stmt->fetch();

        if (!$record) {
            errorResponse('Record not found.', 404);
            return;
        }

        $archiveStmt = $db->prepare("
            INSERT INTO archive_data (archive_type, data_json, reason, expiry_date)
            VALUES ('sanitary', ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))
        ");
        $archiveStmt->execute([json_encode($record), $reason]);

        $deleteStmt = $db->prepare("DELETE FROM sanitary_records WHERE id = ?");
        $deleteStmt->execute([$id]);

        logActivity($db, 'DELETE', 'sanitary', $id, $record['business_name'] ?? '', "Archived: $reason");
        jsonResponse(true, null, 'Record archived');
    } catch(PDOException $e) {
        error_log('sanitary.php error: ' . $e->getMessage());
        errorResponse('An error occurred. Please try again.', 500);
    }
}
