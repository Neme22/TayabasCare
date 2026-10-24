<?php
require_once 'auth_check.php';
require_once 'csrf.php';

// ============================================================
// Per-user notification read/dismiss state (inspector bell).
// Survives logout / re-login / different browsers.
// ============================================================

$method = $_SERVER['REQUEST_METHOD'];
if (csrfNeeded()) {
    requireCsrf();
}

// Lazy table create (setup_database.php is not present in this tree)
try {
    $db->exec(
        "CREATE TABLE IF NOT EXISTS user_notification_state (
            user_id    INT NOT NULL,
            notif_id   VARCHAR(255) NOT NULL,
            is_read    TINYINT(1) NOT NULL DEFAULT 0,
            dismissed  TINYINT(1) NOT NULL DEFAULT 0,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, notif_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    );
} catch (PDOException $e) {
    error_log('notif_state create: ' . $e->getMessage());
}

$userId = (int)($_SESSION['user_id'] ?? 0);

// ---- GET: current user's read/dismissed id lists ----
if ($method === 'GET') {
    try {
        $stmt = $db->prepare("SELECT notif_id, is_read, dismissed FROM user_notification_state WHERE user_id = ?");
        $stmt->execute([$userId]);
        $read = [];
        $dismissed = [];
        foreach ($stmt->fetchAll() as $row) {
            if ((int)$row['is_read'] === 1)   $read[] = $row['notif_id'];
            if ((int)$row['dismissed'] === 1) $dismissed[] = $row['notif_id'];
        }
        jsonResponse(true, ['read_ids' => $read, 'dismissed_ids' => $dismissed]);
    } catch (PDOException $e) {
        error_log('notif_state GET: ' . $e->getMessage());
        jsonResponse(true, ['read_ids' => [], 'dismissed_ids' => []]);
    }
}

// ---- POST: upsert read/dismiss flags ----
// body: { action: 'read'|'dismiss', notif_ids: [string, ...] }
if ($method === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $action = $input['action'] ?? '';
    $ids = $input['notif_ids'] ?? [];

    if (!in_array($action, ['read', 'dismiss'], true)) {
        errorResponse('Unknown action', 400);
    }
    if (!is_array($ids) || count($ids) === 0) {
        errorResponse('notif_ids required', 400);
    }
    if (count($ids) > 200) {
        errorResponse('Too many ids', 400);
    }

    $isRead    = ($action === 'read') ? 1 : 0;
    $dismissed = ($action === 'dismiss') ? 1 : 0;

    try {
        $stmt = $db->prepare(
            "INSERT INTO user_notification_state (user_id, notif_id, is_read, dismissed)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               is_read   = GREATEST(is_read,   VALUES(is_read)),
               dismissed = GREATEST(dismissed, VALUES(dismissed))"
        );
        $db->beginTransaction();
        foreach ($ids as $nid) {
            $nid = substr(preg_replace('/[^\w\-:]/', '', (string)$nid), 0, 255);
            if ($nid === '') continue;
            // dismiss also marks read
            $stmt->execute([$userId, $nid, $action === 'dismiss' ? 1 : $isRead, $dismissed]);
        }
        $db->commit();
        jsonResponse(true, null, 'Notification state saved.');
    } catch (PDOException $e) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('notif_state POST: ' . $e->getMessage());
        errorResponse('Database error. Please try again.', 500);
    }
}

errorResponse('Method not allowed', 405);
