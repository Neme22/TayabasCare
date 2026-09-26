<?php
require_once 'auth_check.php';
require_once 'activity_log.php';

// ============================================================
// Accomplishment Records CRUD Endpoint
// Stores monthly accomplishment data per inspector in the DB
// (replaces localStorage-based storage)
// ============================================================

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'OPTIONS') { http_response_code(200); exit(); }

switch ($method) {
    case 'GET':    getRecords();   break;
    case 'POST':   createRecord(); break;
    case 'PUT':    updateRecord(); break;
    case 'DELETE': deleteRecord(); break;
    default: errorResponse('Method not allowed', 405);
}

function getRecords() {
    global $db;

    $inspector = $_GET['inspector'] ?? '';
    $month     = $_GET['month'] ?? '';
    $year      = $_GET['year'] ?? '';

    try {
        $where  = [];
        $params = [];

        if ($inspector) {
            $where[]  = "inspector_name = ?";
            $params[] = $inspector;
        }
        if ($month) {
            $where[]  = "month = ?";
            $params[] = intval($month);
        }
        if ($year) {
            $where[]  = "year = ?";
            $params[] = intval($year);
        }

        $sql = "SELECT * FROM accomplishment_records";
        if ($where) $sql .= " WHERE " . implode(" AND ", $where);
        $sql .= " ORDER BY year DESC, month DESC, inspector_name ASC";

        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();

        $formatted = array_map(function($r) {
            $fields = json_decode($r['fields'], true);
            if (!is_array($fields)) $fields = [];
            return [
                'id'           => (int)$r['id'],
                'inspector'    => $r['inspector_name'],
                'month'        => (int)$r['month'],
                'year'         => (int)$r['year'],
                'fields'       => $fields,
                'createdAt'    => $r['created_at'],
                'updatedAt'    => $r['updated_at']
            ];
        }, $rows);

        jsonResponse(true, $formatted);
    } catch (PDOException $e) {
        error_log('accomplishment.php GET error: ' . $e->getMessage());
        errorResponse('Failed to load accomplishment records.', 500);
    }
}

function createRecord() {
    global $db;

    $input = json_decode(file_get_contents('php://input'), true);

    $inspector = trim($input['inspector'] ?? '');
    $month     = intval($input['month'] ?? 0);
    $year      = intval($input['year'] ?? 0);
    $fields    = $input['fields'] ?? [];

    if (!$inspector || !$month || !$year) {
        errorResponse('Inspector name, month, and year are required.', 400);
    }
    if ($month < 1 || $month > 12) {
        errorResponse('Month must be between 1 and 12.', 400);
    }
    if (!is_array($fields)) {
        errorResponse('Fields must be an array.', 400);
    }

    try {
        $stmt = $db->prepare("
            INSERT INTO accomplishment_records (inspector_name, month, year, fields)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE fields = VALUES(fields), updated_at = CURRENT_TIMESTAMP
        ");
        $stmt->execute([$inspector, $month, $year, json_encode($fields)]);

        $newId = $db->lastInsertId();
        if ($newId == 0) {
            // ON DUPLICATE KEY UPDATE — fetch the existing ID
            $fetchStmt = $db->prepare("SELECT id FROM accomplishment_records WHERE inspector_name = ? AND month = ? AND year = ?");
            $fetchStmt->execute([$inspector, $month, $year]);
            $newId = $fetchStmt->fetch()['id'] ?? 0;
        }

        logActivity($db, 'CREATE', 'accomplishment', $newId, $inspector, "Month: $month/$year");
        jsonResponse(true, ['id' => (int)$newId], 'Accomplishment record saved.');
    } catch (PDOException $e) {
        error_log('accomplishment.php POST error: ' . $e->getMessage());
        errorResponse('Failed to save accomplishment record.', 500);
    }
}

function updateRecord() {
    global $db;

    $input = json_decode(file_get_contents('php://input'), true);

    $id     = intval($input['id'] ?? 0);
    $fields = $input['fields'] ?? null;

    if (!$id) {
        errorResponse('Record ID is required.', 400);
    }

    try {
        if ($fields !== null) {
            if (!is_array($fields)) errorResponse('Fields must be an array.', 400);
            $stmt = $db->prepare("UPDATE accomplishment_records SET fields = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
            $stmt->execute([json_encode($fields), $id]);
        }

        // Also allow updating inspector/month/year
        if (isset($input['inspector']) || isset($input['month']) || isset($input['year'])) {
            $parts   = [];
            $params  = [];
            if (isset($input['inspector'])) { $parts[] = "inspector_name = ?"; $params[] = trim($input['inspector']); }
            if (isset($input['month']))     { $parts[] = "month = ?";         $params[] = intval($input['month']); }
            if (isset($input['year']))      { $parts[] = "year = ?";          $params[] = intval($input['year']); }
            $params[] = $id;
            $db->prepare("UPDATE accomplishment_records SET " . implode(', ', $parts) . ", updated_at = CURRENT_TIMESTAMP WHERE id = ?")
               ->execute($params);
        }

        logActivity($db, 'UPDATE', 'accomplishment', $id, '', 'Accomplishment record updated');
        jsonResponse(true, null, 'Record updated.');
    } catch (PDOException $e) {
        error_log('accomplishment.php PUT error: ' . $e->getMessage());
        errorResponse('Failed to update record.', 500);
    }
}

function deleteRecord() {
    global $db;

    $id = intval($_GET['id'] ?? 0);
    if (!$id) errorResponse('Record ID is required.', 400);

    try {
        $labelStmt = $db->prepare("SELECT inspector_name, month, year FROM accomplishment_records WHERE id = ?");
        $labelStmt->execute([$id]);
        $label = $labelStmt->fetch();

        $db->prepare("DELETE FROM accomplishment_records WHERE id = ?")->execute([$id]);

        logActivity($db, 'DELETE', 'accomplishment', $id, $label['inspector_name'] ?? '', "Month: {$label['month']}/{$label['year']}");
        jsonResponse(true, null, 'Record deleted.');
    } catch (PDOException $e) {
        error_log('accomplishment.php DELETE error: ' . $e->getMessage());
        errorResponse('Failed to delete record.', 500);
    }
}
?>