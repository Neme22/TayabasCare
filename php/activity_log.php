<?php
// ============================================================
// TayabasCare Activity Log (Audit Trail)
//
// Two usage modes:
//   1. require_once from other PHP files → only provides logActivity()
//   2. accessed directly as endpoint → serves GET requests
// ============================================================

// ---- Helper: Log an activity ----
function logActivity($db, $action, $module, $recordId = null, $recordLabel = '', $details = '') {
    try {
        $userId   = $_SESSION['user_id'] ?? null;
        $username = $_SESSION['username'] ?? 'system';
        $ip       = $_SERVER['REMOTE_ADDR'] ?? '';

        $stmt = $db->prepare("
            INSERT INTO activity_log (user_id, username, action, module, record_id, record_label, details, ip_address)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ");
        $stmt->execute([
            $userId,
            substr($username, 0, 100),
            $action,
            substr($module, 0, 50),
            $recordId,
            substr($recordLabel, 0, 255),
            $details,
            substr($ip, 0, 45)
        ]);
    } catch (PDOException $e) {
        // Silently fail — logging should never break the main operation
    }
}

// ---- Endpoint handler (only runs when accessed directly) ----
// Detect direct access: no calling script means this file is the entry point
$isDirectAccess = !isset($_SERVER['PATH_INFO']) && (
    basename($_SERVER['SCRIPT_FILENAME'] ?? '') === 'activity_log.php'
);

if ($isDirectAccess) {
    require_once __DIR__ . '/auth_check.php';
    requireRole('admin');

    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit(); }
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        errorResponse('Method not allowed. Use GET.', 405);
    }

    try {
        $action = $_GET['action'] ?? 'list';

        if ($action === 'list') {
            $where  = [];
            $params = [];

            if (!empty($_GET['module'])) {
                $where[]  = "module = ?";
                $params[] = $_GET['module'];
            }
            if (!empty($_GET['action_type'])) {
                $where[]  = "action = ?";
                $params[] = $_GET['action_type'];
            }
            if (!empty($_GET['user'])) {
                $where[]  = "username LIKE ?";
                $params[] = '%' . $_GET['user'] . '%';
            }
            if (!empty($_GET['from'])) {
                $where[]  = "created_at >= ?";
                $params[] = $_GET['from'];
            }
            if (!empty($_GET['to'])) {
                $where[]  = "created_at <= ?";
                $params[] = $_GET['to'] . ' 23:59:59';
            }

            $sql = "SELECT * FROM activity_log";
            if ($where) $sql .= " WHERE " . implode(" AND ", $where);
            $sql .= " ORDER BY created_at DESC LIMIT 500";

            $stmt = $db->prepare($sql);
            $stmt->execute($params);
            $rows = $stmt->fetchAll();

            $formatted = array_map(function($r) {
                return [
                    'id'           => (int)$r['id'],
                    'userId'       => $r['user_id'] ? (int)$r['user_id'] : null,
                    'username'     => $r['username'],
                    'action'       => $r['action'],
                    'module'       => $r['module'],
                    'recordId'     => $r['record_id'] ? (int)$r['record_id'] : null,
                    'recordLabel'  => $r['record_label'],
                    'details'      => $r['details'],
                    'ipAddress'    => $r['ip_address'],
                    'createdAt'    => $r['created_at']
                ];
            }, $rows);

            jsonResponse(true, $formatted);
        }

        if ($action === 'summary') {
            $today = date('Y-m-d');

            $stmt = $db->prepare("SELECT COUNT(*) as total FROM activity_log WHERE DATE(created_at) = ?");
            $stmt->execute([$today]);
            $todayCount = $stmt->fetch()['total'];

            $stmt = $db->query("SELECT module, COUNT(*) as count FROM activity_log GROUP BY module ORDER BY count DESC");
            $byModule = $stmt->fetchAll();

            $stmt = $db->query("SELECT action, COUNT(*) as count FROM activity_log GROUP BY action ORDER BY count DESC");
            $byAction = $stmt->fetchAll();

            $stmt = $db->query("SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 10");
            $recent = $stmt->fetchAll();

            jsonResponse(true, [
                'todayCount' => (int)$todayCount,
                'byModule'   => $byModule,
                'byAction'   => $byAction,
                'recent'     => $recent
            ]);
        }

        errorResponse('Unknown action: ' . $action);

    } catch (PDOException $e) {
        error_log('activity_log.php error: ' . $e->getMessage());
        errorResponse('Database error. Please try again.', 500);
    }
}
