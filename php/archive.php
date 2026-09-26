<?php
require_once 'auth_check.php';
requireRole('admin');
require_once 'activity_log.php';

$method = $_SERVER['REQUEST_METHOD'];

switch($method) {
    case 'GET': getArchive(); break;
    case 'POST': restoreItem(); break;
    case 'DELETE': permanentDelete(); break;
}

function getArchive() {
    global $db;
    try {
        $db->query("DELETE FROM archive_data WHERE expiry_date < NOW()");
        
        $stmt = $db->query("SELECT * FROM archive_data ORDER BY archived_at DESC");
        $items = $stmt->fetchAll();
        
        $formatted = array_map(function($i) {
            return [
                'id' => (int)$i['id'],
                'type' => $i['archive_type'],
                'subType' => $i['sub_type'],
                'data' => json_decode($i['data_json'], true),
                'reason' => $i['reason'],
                'archivedDate' => $i['archived_at'],
                'expiryDate' => $i['expiry_date']
            ];
        }, $items);
        
        jsonResponse(true, $formatted);
    } catch(PDOException $e) {
        error_log('archive.php error: ' . $e->getMessage());
        errorResponse('An error occurred. Please try again.', 500);
    }
}

function restoreItem() {
    global $db;
    $input = json_decode(file_get_contents('php://input'), true);
    $id = $input['id'] ?? null;
    
    try {
        $stmt = $db->prepare("SELECT * FROM archive_data WHERE id = ?");
        $stmt->execute([$id]);
        $item = $stmt->fetch();
        
        $data = json_decode($item['data_json'], true);
        $type = $item['archive_type'];
        $subType = $item['sub_type'] ?? '';
        
        if ($type === 'sanitary') {
            $stmt = $db->prepare("INSERT INTO sanitary_records
                (record_no, date, permit_no, personnel_no, business_name,
                 owner_first_name, owner_middle_name, owner_last_name,
                 personnel_list, sex, result_xray, result_stool, barangay,
                 building_street, corporation_name, remarks, business_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            $stmt->execute([
                $data['record_no'] ?? '', $data['date'] ?? null, $data['permit_no'] ?? '',
                $data['personnel_no'] ?? '', $data['business_name'] ?? '',
                $data['owner_first_name'] ?? '', $data['owner_middle_name'] ?? '',
                $data['owner_last_name'] ?? '',
                is_string($data['personnel_list'] ?? null) ? $data['personnel_list'] : json_encode($data['personnel_list'] ?? []),
                $data['sex'] ?? '', $data['result_xray'] ?? 0, $data['result_stool'] ?? 0,
                $data['barangay'] ?? '', $data['building_street'] ?? '',
                $data['corporation_name'] ?? '', $data['remarks'] ?? '',
                $data['business_type'] ?? 'Other'
            ]);
        } elseif ($type === 'burial') {
            $stmt = $db->prepare("INSERT INTO burial_records
                (type, datetime, deceased, death_date, death_place, informant, inspector, origin, transfer, funeral, cemetery_origin, cemetery_transfer, or_number, file_name, file_path)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            $stmt->execute([
                $subType ?: $data['type'] ?? 'cadaver',
                $data['datetime'] ?? '', $data['deceased'] ?? '', $data['death_date'] ?? null,
                $data['death_place'] ?? '', $data['informant'] ?? '', $data['inspector'] ?? '',
                $data['origin'] ?? '', $data['transfer'] ?? '', $data['funeral'] ?? '',
                $data['cemetery_origin'] ?? '', $data['cemetery_transfer'] ?? '', $data['or_number'] ?? '',
                $data['file_name'] ?? null, $data['file_path'] ?? null
            ]);
        } elseif ($type === 'report') {
            $stmt = $db->prepare("INSERT INTO inspection_reports
                (file_name, recommendation, remarks, complied, inspector_name, establishment, location, status, report_date, file_path, compliance_deadline, violation_codes, establishment_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            $stmt->execute([
                $data['file_name'] ?? '', $data['recommendation'] ?? '', $data['remarks'] ?? '',
                $data['complied'] ?? 0, $data['inspector_name'] ?? '',
                $data['establishment'] ?? '', $data['location'] ?? '',
                $data['status'] ?? 'Submitted', $data['report_date'] ?? null,
                $data['file_path'] ?? null, $data['compliance_deadline'] ?? null,
                $data['violation_codes'] ?? null, $data['establishment_id'] ?? null
            ]);
        } elseif ($type === 'inspector' || $type === 'inspectors') {
            // Ensure password is properly hashed before restoring
            $password = $data['password'] ?? '';
            if ($password && !password_verify($password, $password) && strlen($password) !== 60) {
                // Not a bcrypt hash — hash it before storing
                $password = password_hash($password, PASSWORD_DEFAULT);
            }

            $stmt = $db->prepare("INSERT INTO inspector_accounts
                (full_name, email, username, password, role_title)
                VALUES (?, ?, ?, ?, ?)");
            $stmt->execute([
                $data['full_name'] ?? '', $data['email'] ?? '', $data['username'] ?? '',
                $password, $data['role_title'] ?? 'Field Inspector'
            ]);
            // Also restore to users table
            $stmt2 = $db->prepare("INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, 'inspector')");
            $stmt2->execute([
                $data['username'] ?? '', $password, $data['email'] ?? ''
            ]);
        }
        
        $deleteStmt = $db->prepare("DELETE FROM archive_data WHERE id = ?");
        $deleteStmt->execute([$id]);

        logActivity($db, 'RESTORE', 'archive', $id, $data['business_name'] ?? $data['deceased'] ?? $data['establishment'] ?? $data['full_name'] ?? '', "Restored $type record");
        jsonResponse(true, null, 'Item restored');
    } catch(PDOException $e) {
        error_log('archive.php error: ' . $e->getMessage());
        errorResponse('An error occurred. Please try again.', 500);
    }
}

function permanentDelete() {
    global $db;
    $id = $_GET['id'] ?? null;

    try {
        // Get label before deleting
        $labelStmt = $db->prepare("SELECT archive_type FROM archive_data WHERE id = ?");
        $labelStmt->execute([$id]);
        $labelRow = $labelStmt->fetch();

        $stmt = $db->prepare("DELETE FROM archive_data WHERE id = ?");
        $stmt->execute([$id]);

        logActivity($db, 'DELETE', 'archive', $id, $labelRow['archive_type'] ?? '', 'Permanent delete from archive');
        jsonResponse(true, null, 'Item deleted permanently');
    } catch(PDOException $e) {
        error_log('archive.php error: ' . $e->getMessage());
        errorResponse('An error occurred. Please try again.', 500);
    }
}
?>