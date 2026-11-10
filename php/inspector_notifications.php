<?php
require_once 'auth_check.php';
require_once 'cluster_lib.php';
require_once 'inspector_notif_lib.php';

$method = $_SERVER['REQUEST_METHOD'];
if ($method === 'OPTIONS') { http_response_code(200); exit(); }
if ($method !== 'GET') {
    errorResponse('Method not allowed. Use GET.', 405);
}

requireRole(['inspector', 'admin']);
ensureInspectorNotificationsTable($db);

try {
    $role     = $_SESSION['role'] ?? '';
    $username = trim($_SESSION['username'] ?? '');
    $fullName = $role === 'inspector' ? sessionInspectorFullName($db) : trim($_GET['inspector'] ?? '');

    if ($role === 'admin' && $fullName === '') {
        // Optional admin query without filter: return latest 50
        $rows = $db->query(
            "SELECT id, inspector_name, username, type, duty_type, title, message, sched_date, sched_dates_json, created_at
             FROM inspector_notifications
             ORDER BY created_at DESC, id DESC
             LIMIT 50"
        )->fetchAll();
    } else {
        $variants = array_values(array_unique(array_filter([
            strtolower($fullName),
            strtolower($username)
        ], fn($v) => $v !== '')));

        if (empty($variants)) {
            jsonResponse(true, []);
        }

        $ph = implode(',', array_fill(0, count($variants), '?'));
        $stmt = $db->prepare(
            "SELECT id, inspector_name, username, type, duty_type, title, message, sched_date, sched_dates_json, created_at
             FROM inspector_notifications
             WHERE LOWER(inspector_name) IN ($ph)
                OR (username IS NOT NULL AND username <> '' AND LOWER(username) IN ($ph))
             ORDER BY created_at DESC, id DESC
             LIMIT 50"
        );
        $stmt->execute(array_merge($variants, $variants));
        $rows = $stmt->fetchAll();
    }

    $result = array_map(function($r) {
        $dates = [];
        if (!empty($r['sched_dates_json'])) {
            $decoded = json_decode($r['sched_dates_json'], true);
            if (is_array($decoded)) $dates = $decoded;
        }
        return [
            'id'         => 'srv-notif-' . $r['id'],
            'dbId'       => (int)$r['id'],
            'inspector'  => $r['inspector_name'],
            'type'       => $r['type'] ?: 'assigned',
            'dutyType'   => $r['duty_type'] ?: '',
            'title'      => $r['title'] ?: '',
            'message'    => $r['message'],
            'schedDate'  => $r['sched_date'] ?: ($dates[0] ?? null),
            'schedDates' => $dates,
            'date'       => date('c', strtotime($r['created_at']))
        ];
    }, $rows);

    jsonResponse(true, $result);
} catch (PDOException $e) {
    error_log('inspector_notifications.php error: ' . $e->getMessage());
    errorResponse('Database error. Please try again.', 500);
}
