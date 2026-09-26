<?php
require_once 'auth_check.php';
require_once 'activity_log.php';

$method = $_SERVER['REQUEST_METHOD'];

// DELETE requires admin role
if ($method === 'DELETE') {
    requireRole('admin');
}

switch($method) {
    case 'GET':
        if (isset($_GET['history_id'])) {
            getHistory($_GET['history_id']);
        } else {
            getReports();
        }
        break;
    case 'POST':
        if (!empty($_POST['id'])) {
            // Multipart form-data update with file upload
            updateReportWithFile();
        } elseif (!empty($_FILES)) {
            // Has file upload but no id — treat as create
            createReport();
        } else {
            // Check JSON body for id (when Content-Type is application/json)
            $rawInput = file_get_contents('php://input');
            $jsonInput = json_decode($rawInput, true);
            if (!empty($jsonInput['id'])) {
                // JSON update without file — delegate to updateReport with buffered input
                updateReportFromJson($jsonInput);
            } else {
                // Re-encode for createReport which reads php://input
                // Store in a global so createReport can use it
                $GLOBALS['_json_input'] = $jsonInput;
                createReport();
            }
        }
        break;
    case 'PUT': updateReport(); break;
    case 'DELETE': deleteReport(); break;
}

function getReports() {
    global $db;
    try {
        $stmt = $db->query("SELECT * FROM inspection_reports ORDER BY created_at DESC");
        $reports = $stmt->fetchAll();
        
        $formatted = array_map(function($r) {
            $aiAnalysis = null;
            if (!empty($r['ai_analysis'])) {
                $decoded = json_decode($r['ai_analysis'], true);
                if ($decoded) $aiAnalysis = $decoded;
            }
            return [
                'id' => (int)$r['id'],
                'file' => $r['file_name'],
                'filePath' => $r['file_path'],
                'recommendation' => $r['recommendation'],
                'remarks' => $r['remarks'],
                'complied' => (bool)$r['complied'],
                'compliance_deadline' => $r['compliance_deadline'] ?? null,
                'inspector' => $r['inspector_name'],
                'establishment' => $r['establishment'],
                'location' => $r['location'],
                'status' => $r['status'],
                'date' => $r['report_date'],
                'aiAnalysis' => $aiAnalysis
            ];
        }, $reports);
        
        jsonResponse(true, $formatted);
    } catch(PDOException $e) {
        error_log('getReports error: ' . $e->getMessage());
        errorResponse('Failed to load reports. Please try again.', 500);
    }
}

function getHistory($inspection_id) {
    global $db;
    try {
        $stmt = $db->prepare("
            SELECT * FROM inspection_history
            WHERE inspection_id = ?
            ORDER BY archived_at DESC
        ");
        $stmt->execute([$inspection_id]);
        $rows = $stmt->fetchAll();

        $formatted = array_map(function($r) {
            return [
                'id'             => (int)$r['id'],
                'inspection_id'  => (int)$r['inspection_id'],
                'establishment'  => $r['establishment'],
                'location'       => $r['location'],
                'inspector'      => $r['inspector_name'],
                'file'           => $r['file_name'],
                'filePath'       => $r['file_path'],
                'remarks'        => $r['remarks'],
                'recommendation' => $r['recommendation'],
                'complied'       => (bool)$r['complied'],
                'status'         => $r['status'],
                'date'           => $r['report_date'],
                'archived_at'    => $r['archived_at']
            ];
        }, $rows);

        jsonResponse(true, $formatted);
    } catch(PDOException $e) {
        error_log('getHistory error: ' . $e->getMessage());
        errorResponse('Failed to load history. Please try again.', 500);
    }
}

function createReport() {
    global $db;

    if (!empty($_POST) || !empty($_FILES)) {
        $input = $_POST;
    } elseif (!empty($GLOBALS['_json_input'])) {
        $input = $GLOBALS['_json_input'];
    } else {
        $input = json_decode(file_get_contents('php://input'), true);
    }

    $fileName = '';
    $filePath = '';
    if (!empty($_FILES['attachment']['tmp_name'])) {
        // Validate file upload
        $allowedExts = ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx'];
        $maxSize = 10 * 1024 * 1024; // 10MB
        $ext = strtolower(pathinfo($_FILES['attachment']['name'], PATHINFO_EXTENSION));

        if (!in_array($ext, $allowedExts)) {
            errorResponse('File type not allowed. Allowed: ' . implode(', ', $allowedExts), 400);
            return;
        }
        if ($_FILES['attachment']['size'] > $maxSize) {
            errorResponse('File too large. Maximum size is 10MB.', 400);
            return;
        }
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $mime = finfo_file($finfo, $_FILES['attachment']['tmp_name']);
        finfo_close($finfo);
        $allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf',
            'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
        if (!in_array($mime, $allowedMimes)) {
            errorResponse('Invalid file type detected.', 400);
            return;
        }

        $uploadDir = __DIR__ . '/../uploads/inspections/';
        if (!is_dir($uploadDir)) mkdir($uploadDir, 0755, true);
        $safeName = uniqid('insp_', true) . '.' . $ext;
        if (move_uploaded_file($_FILES['attachment']['tmp_name'], $uploadDir . $safeName)) {
            $fileName = $_FILES['attachment']['name'];
            $filePath = 'uploads/inspections/' . $safeName;
        }
    }
    
    // Parse violation codes from form data
    $violationCodes = $input['violation_codes'] ?? null;
    if ($violationCodes && is_string($violationCodes)) {
        $decoded = json_decode($violationCodes, true);
        $violationCodes = is_array($decoded) ? json_encode($decoded) : null;
    } elseif (is_array($violationCodes)) {
        $violationCodes = json_encode($violationCodes);
    } else {
        $violationCodes = null;
    }

    // Look up establishment_id from sanitary_records
    $establishmentId = null;

    try {
        $establishment = $input['establishment'] ?? $input['location'] ?? '';

        // Look up establishment_id from sanitary_records
        if ($establishment) {
            $eidStmt = $db->prepare("SELECT id FROM sanitary_records WHERE LOWER(TRIM(business_name)) = LOWER(TRIM(?)) LIMIT 1");
            $eidStmt->execute([$establishment]);
            $eidRow = $eidStmt->fetch();
            if ($eidRow) $establishmentId = (int)$eidRow['id'];
        }

        // Check if a record already exists for this establishment
        $checkStmt = $db->prepare("SELECT * FROM inspection_reports WHERE establishment = ? LIMIT 1");
        $checkStmt->execute([$establishment]);
        $existing = $checkStmt->fetch();

        if ($existing) {
            // UPDATE the existing record instead of inserting a new one
            // Archive the current record into inspection_history before overwriting
            $hist = $db->prepare("
                INSERT INTO inspection_history
                (inspection_id, establishment, location, inspector_name, file_name, file_path, remarks, recommendation, complied, status, report_date, violation_codes, establishment_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ");
            $hist->execute([
                $existing['id'],
                $existing['establishment'],
                $existing['location'],
                $existing['inspector_name'],
                $existing['file_name'],
                $existing['file_path'],
                $existing['remarks'],
                $existing['recommendation'],
                $existing['complied'],
                $existing['status'],
                $existing['report_date'],
                $existing['violation_codes'] ?? null,
                $existing['establishment_id'] ?? null
            ]);

            $stmt = $db->prepare("
                UPDATE inspection_reports
                SET file_name = ?, file_path = ?, recommendation = ?, remarks = ?, complied = ?,
                    inspector_name = ?, location = ?, status = ?, report_date = ?, violation_codes = ?, establishment_id = ?
                WHERE establishment = ?
            ");
            $stmt->execute([
                $fileName ?: ($input['file'] ?? ''),
                $filePath ?: $existing['file_path'],
                $input['recommendation'] ?? '',
                $input['remarks'] ?? '',
                $input['complied'] ?? 0,
                $input['inspector'] ?? '',
                $input['location'] ?? '',
                $input['status'] ?? 'Submitted',
                date('Y-m-d H:i:s', strtotime($input['date'] ?? 'now')),
                $violationCodes,
                $establishmentId,
                $establishment
            ]);
            logActivity($db, 'UPDATE', 'inspection', $existing['id'], $establishment, 'Report updated (previous archived)');
            jsonResponse(true, ['id' => $existing['id']], 'Report updated');
        } else {
            // INSERT new record (first time this establishment is inspected)
            $stmt = $db->prepare("
                INSERT INTO inspection_reports
                (file_name, file_path, recommendation, remarks, complied, inspector_name, establishment, location, status, report_date, compliance_deadline, violation_codes, establishment_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ");
            $stmt->execute([
                $fileName ?: ($input['file'] ?? ''),
                $filePath,
                $input['recommendation'] ?? '',
                $input['remarks'] ?? '',
                $input['complied'] ?? 0,
                $input['inspector'] ?? '',
                $establishment,
                $input['location'] ?? '',
                $input['status'] ?? 'Submitted',
                date('Y-m-d H:i:s', strtotime($input['date'] ?? 'now')),
                !empty($input['compliance_deadline']) ? $input['compliance_deadline'] : null,
                $violationCodes,
                $establishmentId
            ]);
            $newId = $db->lastInsertId();
            logActivity($db, 'CREATE', 'inspection', $newId, $establishment, 'New inspection report');
            jsonResponse(true, ['id' => $newId], 'Report created');
        }
    } catch(PDOException $e) {
        error_log('inspection.php error: ' . $e->getMessage());
        errorResponse('An error occurred. Please try again.', 500);
    }
}

function updateReportFromJson($input) {
    global $db;
    $id = $input['id'] ?? null;

    if (!$id) {
        errorResponse('Missing report ID', 400);
        return;
    }

    try {
        // Step 1: Copy the current record into inspection_history before overwriting
        $old = $db->prepare("SELECT * FROM inspection_reports WHERE id = ?");
        $old->execute([$id]);
        $current = $old->fetch();

        if ($current) {
            $hist = $db->prepare("
                INSERT INTO inspection_history
                (inspection_id, establishment, location, inspector_name, file_name, file_path, remarks, recommendation, complied, status, report_date, violation_codes, establishment_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ");
            $hist->execute([
                $current['id'],
                $current['establishment'],
                $current['location'],
                $current['inspector_name'],
                $current['file_name'],
                $current['file_path'],
                $current['remarks'],
                $current['recommendation'],
                $current['complied'],
                $current['status'],
                $current['report_date'],
                $current['violation_codes'] ?? null,
                $current['establishment_id'] ?? null
            ]);
        }

        // Step 2: Update the active record
        $violationCodes = $input['violationCodes'] ?? $input['violation_codes'] ?? null;
        if ($violationCodes && is_string($violationCodes)) {
            $decoded = json_decode($violationCodes, true);
            $violationCodes = is_array($decoded) ? json_encode($decoded) : null;
        } elseif (is_array($violationCodes)) {
            $violationCodes = json_encode($violationCodes);
        }

        // Look up establishment_id
        $establishmentId = $input['establishment_id'] ?? null;
        $establishment = $input['establishment'] ?? '';
        if (!$establishmentId && $establishment) {
            $eidStmt = $db->prepare("SELECT id FROM sanitary_records WHERE LOWER(TRIM(business_name)) = LOWER(TRIM(?)) LIMIT 1");
            $eidStmt->execute([$establishment]);
            $eidRow = $eidStmt->fetch();
            if ($eidRow) $establishmentId = (int)$eidRow['id'];
        }

        $stmt = $db->prepare("
            UPDATE inspection_reports
            SET file_name = ?, recommendation = ?, remarks = ?, complied = ?,
                compliance_deadline = ?, inspector_name = ?, location = ?, status = ?, report_date = ?,
                violation_codes = ?, establishment_id = ?
            WHERE id = ?
        ");
        $stmt->execute([
            $input['file'] ?? '',
            $input['recommendation'] ?? '',
            $input['remarks'] ?? '',
            $input['complied'] ?? 0,
            !empty($input['compliance_deadline']) ? $input['compliance_deadline'] : null,
            $input['inspector'] ?? '',
            $input['location'] ?? '',
            $input['status'] ?? 'Submitted',
            date('Y-m-d H:i:s', strtotime($input['date'] ?? 'now')),
            $violationCodes,
            $establishmentId,
            $id
        ]);

        logActivity($db, 'UPDATE', 'inspection', $id, $input['establishment'] ?? $input['location'] ?? '', 'Report updated');
        jsonResponse(true, ['id' => $id], 'Report updated');
    } catch(PDOException $e) {
        error_log('inspection.php error: ' . $e->getMessage());
        errorResponse('An error occurred. Please try again.', 500);
    }
}

function updateReport() {
    global $db;
    $input = json_decode(file_get_contents('php://input'), true);
    $id = $input['id'] ?? null;

    if (!$id) {
        errorResponse('Missing report ID', 400);
        return;
    }

    try {
        // Step 1: Copy the current record into inspection_history before overwriting
        $old = $db->prepare("SELECT * FROM inspection_reports WHERE id = ?");
        $old->execute([$id]);
        $current = $old->fetch();

        if ($current) {
            $hist = $db->prepare("
                INSERT INTO inspection_history
                (inspection_id, establishment, location, inspector_name, file_name, file_path, remarks, recommendation, complied, status, report_date, violation_codes, establishment_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ");
            $hist->execute([
                $current['id'],
                $current['establishment'],
                $current['location'],
                $current['inspector_name'],
                $current['file_name'],
                $current['file_path'],
                $current['remarks'],
                $current['recommendation'],
                $current['complied'],
                $current['status'],
                $current['report_date'],
                $current['violation_codes'] ?? null,
                $current['establishment_id'] ?? null
            ]);
        }

        // Step 2: Update the active record with new inspection data
        $violationCodes = $input['violationCodes'] ?? $input['violation_codes'] ?? null;
        if ($violationCodes && is_string($violationCodes)) {
            $decoded = json_decode($violationCodes, true);
            $violationCodes = is_array($decoded) ? json_encode($decoded) : null;
        } elseif (is_array($violationCodes)) {
            $violationCodes = json_encode($violationCodes);
        }

        $stmt = $db->prepare("
            UPDATE inspection_reports
            SET file_name = ?, recommendation = ?, remarks = ?, complied = ?,
                compliance_deadline = ?, inspector_name = ?, location = ?, status = ?, report_date = ?,
                violation_codes = ?
            WHERE id = ?
        ");
        $stmt->execute([
            $input['file'] ?? '',
            $input['recommendation'] ?? '',
            $input['remarks'] ?? '',
            $input['complied'] ?? 0,
            !empty($input['compliance_deadline']) ? $input['compliance_deadline'] : null,
            $input['inspector'] ?? '',
            $input['location'] ?? '',
            $input['status'] ?? 'Submitted',
            date('Y-m-d H:i:s', strtotime($input['date'] ?? 'now')),
            $violationCodes,
            $id
        ]);

        logActivity($db, 'UPDATE', 'inspection', $id, $input['establishment'] ?? $input['location'] ?? '', 'Report updated');
        jsonResponse(true, ['id' => $id], 'Report updated');
    } catch(PDOException $e) {
        error_log('inspection.php error: ' . $e->getMessage());
        errorResponse('An error occurred. Please try again.', 500);
    }
}

function updateReportWithFile() {
    global $db;
    $input = $_POST;
    $id = $input['id'] ?? null;

    if (!$id) {
        errorResponse('Missing report ID', 400);
        return;
    }

    try {
        $old = $db->prepare("SELECT * FROM inspection_reports WHERE id = ?");
        $old->execute([$id]);
        $current = $old->fetch();

        if (!$current) {
            errorResponse('Report not found', 404);
            return;
        }

        // Keep the existing file unless a new one was uploaded
        $fileName = $current['file_name'];
        $filePath = $current['file_path'];
        if (!empty($_FILES['attachment']['tmp_name'])) {
            // Validate file upload
            $allowedExts = ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx'];
            $maxSize = 10 * 1024 * 1024;
            $ext = strtolower(pathinfo($_FILES['attachment']['name'], PATHINFO_EXTENSION));
            if (!in_array($ext, $allowedExts)) {
                errorResponse('File type not allowed.', 400);
                return;
            }
            if ($_FILES['attachment']['size'] > $maxSize) {
                errorResponse('File too large. Maximum size is 10MB.', 400);
                return;
            }
            $finfo = finfo_open(FILEINFO_MIME_TYPE);
            $mime = finfo_file($finfo, $_FILES['attachment']['tmp_name']);
            finfo_close($finfo);
            $allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf',
                'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
            if (!in_array($mime, $allowedMimes)) {
                errorResponse('Invalid file type detected.', 400);
                return;
            }

            $uploadDir = __DIR__ . '/../uploads/inspections/';
            if (!is_dir($uploadDir)) mkdir($uploadDir, 0755, true);
            $safeName = uniqid('insp_', true) . '.' . $ext;
            if (move_uploaded_file($_FILES['attachment']['tmp_name'], $uploadDir . $safeName)) {
                $fileName = $_FILES['attachment']['name'];
                $filePath = 'uploads/inspections/' . $safeName;
            }
        }

        $hist = $db->prepare("
            INSERT INTO inspection_history
            (inspection_id, establishment, location, inspector_name, file_name, file_path, remarks, recommendation, complied, status, report_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");
        $hist->execute([
            $current['id'],
            $current['establishment'],
            $current['location'],
            $current['inspector_name'],
            $current['file_name'],
            $current['file_path'],
            $current['remarks'],
            $current['recommendation'],
            $current['complied'],
            $current['status'],
            $current['report_date']
        ]);

        $stmt = $db->prepare("
            UPDATE inspection_reports
            SET file_name = ?, file_path = ?, recommendation = ?, remarks = ?, complied = ?,
                compliance_deadline = ?, inspector_name = ?, location = ?, status = ?, report_date = ?
            WHERE id = ?
        ");
        $stmt->execute([
            $fileName,
            $filePath,
            $input['recommendation'] ?? '',
            $input['remarks'] ?? '',
            $input['complied'] ?? 0,
            !empty($input['compliance_deadline']) ? $input['compliance_deadline'] : null,
            $input['inspector'] ?? '',
            $input['location'] ?? '',
            $input['status'] ?? 'Submitted',
            date('Y-m-d H:i:s', strtotime($input['date'] ?? 'now')),
            $id
        ]);

        logActivity($db, 'UPDATE', 'inspection', $id, $input['establishment'] ?? $input['location'] ?? '', 'Report updated (previous archived)');
        jsonResponse(true, ['id' => $id], 'Report updated');
    } catch(PDOException $e) {
        error_log('inspection.php error: ' . $e->getMessage());
        errorResponse('An error occurred. Please try again.', 500);
    }
}

function deleteReport() {
    global $db;
    $id = $_GET['id'] ?? null;
    $reason = $_GET['reason'] ?? '';

    if (!$id) {
        errorResponse('Report ID is required.', 400);
        return;
    }

    try {
        $stmt = $db->prepare("SELECT * FROM inspection_reports WHERE id = ?");
        $stmt->execute([$id]);
        $report = $stmt->fetch();

        if (!$report) {
            errorResponse('Report not found.', 404);
            return;
        }

        $archiveStmt = $db->prepare("
            INSERT INTO archive_data (archive_type, data_json, reason, expiry_date)
            VALUES ('report', ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))
        ");
        $archiveStmt->execute([json_encode($report), $reason]);

        $deleteStmt = $db->prepare("DELETE FROM inspection_reports WHERE id = ?");
        $deleteStmt->execute([$id]);

        logActivity($db, 'DELETE', 'inspection', $id, $report['establishment'] ?? '', "Archived: $reason");
        jsonResponse(true, null, 'Report archived');
    } catch(PDOException $e) {
        error_log('inspection.php error: ' . $e->getMessage());
        errorResponse('An error occurred. Please try again.', 500);
    }
}
?>