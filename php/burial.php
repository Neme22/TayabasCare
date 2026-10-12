<?php
require_once 'auth_check.php';
require_once 'activity_log.php';
require_once 'csrf.php';

$method = $_SERVER['REQUEST_METHOD'];

// Write operations require admin role
if (in_array($method, ['POST', 'PUT', 'DELETE'])) {
    requireRole('admin');
}

if (csrfNeeded()) {
    requireCsrf();
}

switch($method) {
    case 'GET': getRecords(); break;
    case 'POST':
        if (!empty($_POST['id'])) {
            updateRecord();
        } else {
            createRecord();
        }
        break;
    case 'PUT': updateRecord(); break;
    case 'DELETE': deleteRecord(); break;
}

function validateFileUpload() {
    if (empty($_FILES['attachment']['tmp_name'])) return [null, null];

    $allowedExts = ['jpg', 'jpeg', 'png', 'gif', 'pdf'];
    $maxSize = 10 * 1024 * 1024; // 10MB
    $ext = strtolower(pathinfo($_FILES['attachment']['name'], PATHINFO_EXTENSION));

    if (!in_array($ext, $allowedExts)) {
        errorResponse('File type not allowed. Allowed: ' . implode(', ', $allowedExts), 400);
    }
    if ($_FILES['attachment']['size'] > $maxSize) {
        errorResponse('File too large. Maximum size is 10MB.', 400);
    }

    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime = finfo_file($finfo, $_FILES['attachment']['tmp_name']);
    finfo_close($finfo);
    $allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
    if (!in_array($mime, $allowedMimes)) {
        errorResponse('Invalid file type detected.', 400);
    }

    $uploadDir = __DIR__ . '/../uploads/burial/';
    if (!is_dir($uploadDir)) mkdir($uploadDir, 0755, true);
    $safeName = uniqid('burial_', true) . '.' . $ext;
    if (move_uploaded_file($_FILES['attachment']['tmp_name'], $uploadDir . $safeName)) {
        // Sanitize original filename before storing
        $originalName = preg_replace('/[\x00-\x1f\x7f<>"\'`]/', '', $_FILES['attachment']['name']);
        return [$originalName, 'uploads/burial/' . $safeName];
    }
    return [null, null];
}

function getRecords() {
    global $db;
    try {
        $stmt = $db->query("SELECT * FROM burial_records ORDER BY created_at DESC");
        $records = $stmt->fetchAll();

        $grouped = ['cadaver' => [], 'skeletal' => [], 'exhumation' => []];

        foreach ($records as $r) {
            $formatted = [
                'id' => (int)$r['id'],
                'datetime' => $r['datetime'],
                'deceased' => $r['deceased'],
                'deathDate' => $r['death_date'],
                'deathPlace' => $r['death_place'],
                'informant' => $r['informant'],
                'inspector' => $r['inspector'],
                'origin' => $r['origin'],
                'transfer' => $r['transfer'],
                'funeral' => $r['funeral'],
                'cemeteryOrigin' => $r['cemetery_origin'],
                'cemeteryTransfer' => $r['cemetery_transfer'],
                'orNumber' => $r['or_number'],
                'fileName' => $r['file_name'],
                'filePath' => $r['file_path']
            ];
            $grouped[$r['type']][] = $formatted;
        }

        jsonResponse(true, $grouped);
    } catch(PDOException $e) {
        error_log('burial.php error: ' . $e->getMessage());
        errorResponse('An error occurred. Please try again.', 500);
    }
}

function createRecord() {
    global $db;

    if (!empty($_POST)) {
        $input = $_POST;
    } else {
        $input = json_decode(file_get_contents('php://input'), true);
    }

    $result = validateFileUpload();
    if ($result === false) return;
    [$fileName, $filePath] = $result;

    try {
        $stmt = $db->prepare("
            INSERT INTO burial_records
            (type, datetime, deceased, death_date, death_place,
             informant, inspector, origin, transfer,
             funeral, cemetery_origin, cemetery_transfer, or_number,
             file_name, file_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");

        $stmt->execute([
            $input['type'] ?? 'cadaver',
            $input['datetime'] ?? date('Y-m-d H:i:s'),
            $input['deceased'] ?? '',
            $input['deathDate'] ?? null,
            $input['deathPlace'] ?? '',
            $input['informant'] ?? '',
            $input['inspector'] ?? '',
            $input['origin'] ?? '',
            $input['transfer'] ?? '',
            $input['funeral'] ?? '',
            $input['cemeteryOrigin'] ?? '',
            $input['cemeteryTransfer'] ?? '',
            $input['orNumber'] ?? '',
            $fileName,
            $filePath
        ]);

        $newId = $db->lastInsertId();
        logActivity($db, 'CREATE', 'burial', $newId, $input['deceased'] ?? '', "Type: {$input['type']}");
        jsonResponse(true, ['id' => $newId], 'Record created');
    } catch(PDOException $e) {
        error_log('burial.php error: ' . $e->getMessage());
        errorResponse('An error occurred. Please try again.', 500);
    }
}

function updateRecord() {
    global $db;

    if (!empty($_POST)) {
        $input = $_POST;
    } else {
        $input = json_decode(file_get_contents('php://input'), true);
    }

    $id = $input['id'] ?? null;
    if (!$id) {
        errorResponse('Missing record ID', 400);
        return;
    }

    // Get existing record to preserve file if no new one uploaded
    $old = $db->prepare("SELECT * FROM burial_records WHERE id = ?");
    $old->execute([$id]);
    $current = $old->fetch();
    if (!$current) {
        errorResponse('Record not found', 404);
        return;
    }

    $fileName = $current['file_name'];
    $filePath = $current['file_path'];

    $result = validateFileUpload();
    if ($result === false) return;
    [$newFileName, $newFilePath] = $result;
    if ($newFileName !== null) {
        $fileName = $newFileName;
        $filePath = $newFilePath;
    }

    try {
        $stmt = $db->prepare("
            UPDATE burial_records SET
            type=?, datetime=?, deceased=?, death_date=?,
            death_place=?, informant=?, inspector=?,
            origin=?, transfer=?, funeral=?,
            cemetery_origin=?, cemetery_transfer=?, or_number=?,
            file_name=?, file_path=?
            WHERE id=?
        ");

        $stmt->execute([
            $input['type'] ?? 'cadaver', $input['datetime'] ?? '', $input['deceased'] ?? '', $input['deathDate'] ?? null,
            $input['deathPlace'] ?? '', $input['informant'] ?? '', $input['inspector'] ?? '',
            $input['origin'] ?? '', $input['transfer'] ?? '', $input['funeral'] ?? '',
            $input['cemeteryOrigin'] ?? '', $input['cemeteryTransfer'] ?? '', $input['orNumber'] ?? '',
            $fileName, $filePath,
            $id
        ]);

        logActivity($db, 'UPDATE', 'burial', $input['id'], $input['deceased'] ?? '', 'Burial record updated');
        jsonResponse(true, null, 'Record updated');
    } catch(PDOException $e) {
        error_log('burial.php error: ' . $e->getMessage());
        errorResponse('An error occurred. Please try again.', 500);
    }
}

function deleteRecord() {
    global $db;
    $id = $_GET['id'] ?? null;
    $reason = $_GET['reason'] ?? '';

    try {
        $stmt = $db->prepare("SELECT * FROM burial_records WHERE id = ?");
        $stmt->execute([$id]);
        $record = $stmt->fetch();

        if (!$record) {
            errorResponse('Record not found.', 404);
            return;
        }

        $archiveStmt = $db->prepare("
            INSERT INTO archive_data (archive_type, sub_type, data_json, reason, expiry_date)
            VALUES ('burial', ?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))
        ");
        $archiveStmt->execute([$record['type'], json_encode($record), $reason]);

        $deleteStmt = $db->prepare("DELETE FROM burial_records WHERE id = ?");
        $deleteStmt->execute([$id]);

        logActivity($db, 'DELETE', 'burial', $id, $record['deceased'] ?? '', "Archived: $reason");
        jsonResponse(true, null, 'Record archived');
    } catch(PDOException $e) {
        error_log('burial.php error: ' . $e->getMessage());
        errorResponse('An error occurred. Please try again.', 500);
    }
}
