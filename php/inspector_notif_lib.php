<?php
// ============================================================
// Shared helpers for duty schedules & inspector notifications
// ============================================================

/**
 * Ensure `duty_type` column exists on `inspection_schedules`.
 */
function ensureScheduleDutyColumn(PDO $db): void {
    static $checked = false;
    if ($checked) return;
    $checked = true;
    try {
        $col = $db->query("SHOW COLUMNS FROM inspection_schedules LIKE 'duty_type'");
        if (!$col->fetch()) {
            $db->exec("ALTER TABLE inspection_schedules ADD COLUMN duty_type VARCHAR(50) NULL DEFAULT NULL AFTER establishment");
        }
    } catch (PDOException $e) {
        error_log('ensureScheduleDutyColumn: ' . $e->getMessage());
    }
}

/**
 * Ensure `inspector_notifications` table exists.
 */
function ensureInspectorNotificationsTable(PDO $db): void {
    static $created = false;
    if ($created) return;
    $created = true;
    try {
        $db->exec(
            "CREATE TABLE IF NOT EXISTS inspector_notifications (
                id INT AUTO_INCREMENT PRIMARY KEY,
                inspector_name VARCHAR(255) NOT NULL,
                username VARCHAR(100) NULL DEFAULT NULL,
                type VARCHAR(50) NOT NULL DEFAULT 'assigned',
                duty_type VARCHAR(50) NULL DEFAULT NULL,
                title VARCHAR(255) NOT NULL DEFAULT '',
                message TEXT NOT NULL,
                sched_date DATE NULL DEFAULT NULL,
                sched_dates_json TEXT NULL DEFAULT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_insp_name (inspector_name),
                INDEX idx_insp_user (username)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
        );
    } catch (PDOException $e) {
        error_log('ensureInspectorNotificationsTable: ' . $e->getMessage());
    }
}

/**
 * Resolve inspector full_name, username, and email from `inspector_accounts`.
 */
function resolveInspectorIdentity(PDO $db, string $nameOrUsername): array {
    $clean = trim($nameOrUsername);
    if ($clean === '') {
        return ['full_name' => '', 'username' => '', 'email' => ''];
    }
    try {
        $stmt = $db->prepare(
            "SELECT full_name, username, email
             FROM inspector_accounts
             WHERE LOWER(full_name) = LOWER(?) OR LOWER(username) = LOWER(?)
             LIMIT 1"
        );
        $stmt->execute([$clean, $clean]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            return [
                'full_name' => trim((string)($row['full_name'] ?? $clean)),
                'username'  => trim((string)($row['username'] ?? '')),
                'email'     => trim((string)($row['email'] ?? ''))
            ];
        }
    } catch (PDOException $e) {
        error_log('resolveInspectorIdentity: ' . $e->getMessage());
    }
    return ['full_name' => $clean, 'username' => '', 'email' => ''];
}

/**
 * Insert a persistent bell notification for an inspector.
 */
function createInspectorNotification(
    PDO $db,
    string $inspectorName,
    string $type,
    string $dutyType,
    string $title,
    string $message,
    ?string $schedDate = null,
    array $schedDates = []
): ?int {
    ensureInspectorNotificationsTable($db);
    $identity = resolveInspectorIdentity($db, $inspectorName);
    $storeName = $identity['full_name'] ?: trim($inspectorName);
    $storeUser = $identity['username'] ?: null;

    try {
        $stmt = $db->prepare(
            "INSERT INTO inspector_notifications
                (inspector_name, username, type, duty_type, title, message, sched_date, sched_dates_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        );
        $stmt->execute([
            $storeName,
            $storeUser,
            $type ?: 'assigned',
            $dutyType !== '' ? $dutyType : null,
            $title,
            $message,
            $schedDate ?: null,
            !empty($schedDates) ? json_encode(array_values($schedDates)) : null
        ]);
        return (int)$db->lastInsertId();
    } catch (PDOException $e) {
        error_log('createInspectorNotification: ' . $e->getMessage());
        return null;
    }
}
