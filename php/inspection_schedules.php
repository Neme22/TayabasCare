<?php
require_once 'auth_check.php';
requireRole('admin');
require_once 'activity_log.php';
require_once 'csrf.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'OPTIONS') { http_response_code(200); exit(); }

if (csrfNeeded()) {
    requireCsrf();
}

// ---- POST: Create/update schedule ----
if ($method === 'POST') {
    try {
        $input = json_decode(file_get_contents('php://input'), true);

        $inspector    = trim($input['inspector'] ?? '');
        $schedDate    = trim($input['schedDate'] ?? '');
        $notes        = trim($input['notes'] ?? '');
        $establishment = trim($input['establishment'] ?? '');
        $riskLevel    = trim($input['riskLevel'] ?? '');

        if (!$inspector || !$schedDate) {
            errorResponse('Missing data', 400);
        }

        // Try with new columns first, fall back to old schema
        try {
            $stmt = $db->prepare("
                INSERT INTO inspection_schedules (inspector_name, establishment, risk_level, schedDate, notes)
                VALUES (?, ?, ?, ?, ?)
            ");
            $stmt->execute([$inspector, $establishment ?: null, $riskLevel ?: null, $schedDate, $notes]);
        } catch (PDOException $e) {
            // Fallback: old schema without establishment/risk_level columns
            $stmt = $db->prepare("
                INSERT INTO inspection_schedules (inspector_name, schedDate, notes)
                VALUES (?, ?, ?)
            ");
            $stmt->execute([$inspector, $schedDate, $notes]);
        }

        logActivity($db, 'CREATE', 'schedule', null, $inspector, "Scheduled: $schedDate for " . ($establishment ?: 'general'));
        jsonResponse(true, null, 'Schedule saved.');
    } catch (PDOException $e) {
        error_log('inspection_schedules.php error: ' . $e->getMessage());
        errorResponse('Database error. Please try again.', 500);
    }
}

// ---- GET: List schedules ----
if ($method === 'GET') {
    try {
        $where = [];
        $params = [];

        if (!empty($_GET['inspector'])) {
            $where[] = "inspector_name = ?";
            $params[] = $_GET['inspector'];
        }
        if (!empty($_GET['from'])) {
            $where[] = "schedDate >= ?";
            $params[] = $_GET['from'];
        }
        if (!empty($_GET['to'])) {
            $where[] = "schedDate <= ?";
            $params[] = $_GET['to'];
        }

        $sql = "SELECT * FROM inspection_schedules";
        if ($where) $sql .= " WHERE " . implode(" AND ", $where);
        $sql .= " ORDER BY schedDate ASC";

        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        jsonResponse(true, $stmt->fetchAll());
    } catch (PDOException $e) {
        error_log('inspection_schedules.php error: ' . $e->getMessage());
        errorResponse('Database error. Please try again.', 500);
    }
}

// ---- PUT: Mark schedule as done ----
if ($method === 'PUT') {
    try {
        $input = json_decode(file_get_contents('php://input'), true);
        $id = intval($input['id'] ?? 0);
        if (!$id) errorResponse('Schedule ID required');

        $db->prepare("UPDATE inspection_schedules SET done = 1 WHERE id = ?")->execute([$id]);
        logActivity($db, 'UPDATE', 'schedule', $id, '', 'Schedule marked complete');
        jsonResponse(true, null, 'Schedule marked complete.');
    } catch (PDOException $e) {
        error_log('inspection_schedules.php error: ' . $e->getMessage());
        errorResponse('Database error. Please try again.', 500);
    }
}

// ---- DELETE: Cancel/remove schedule ----
if ($method === 'DELETE') {
    try {
        $id = intval($_GET['id'] ?? 0);
        if (!$id) errorResponse('Schedule ID required');

        $labelStmt = $db->prepare("SELECT inspector_name, schedDate FROM inspection_schedules WHERE id = ?");
        $labelStmt->execute([$id]);
        $label = $labelStmt->fetch();

        $db->prepare("DELETE FROM inspection_schedules WHERE id = ?")->execute([$id]);
        logActivity($db, 'DELETE', 'schedule', $id, $label['inspector_name'] ?? '', "Deleted schedule for " . ($label['schedDate'] ?? ''));
        jsonResponse(true, null, 'Schedule cancelled.');
    } catch (PDOException $e) {
        error_log('inspection_schedules.php error: ' . $e->getMessage());
        errorResponse('Database error. Please try again.', 500);
    }
}

errorResponse('Method not allowed', 405);
?>