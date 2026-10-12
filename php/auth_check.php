<?php
require_once 'config.php';

// Allow CLI (cron) requests to bypass session auth
if (php_sapi_name() === 'cli') {
    // CLI is trusted — set a default admin session context for cron scripts
    $_SESSION['user_id'] = $_SESSION['user_id'] ?? -1;
    $_SESSION['username'] = $_SESSION['username'] ?? 'cron';
    $_SESSION['role'] = $_SESSION['role'] ?? 'admin';
} else {
    // Web requests must have a valid session
    if (!isset($_SESSION['user_id'])) {
        http_response_code(401);
        die(json_encode(['success' => false, 'message' => 'Unauthorized. Please log in.']));
    }
}

/**
 * Restrict access to one or more roles.
 * Usage: requireRole('admin') or requireRole(['admin','inspector'])
 */
function requireRole($roles) {
    if (!is_array($roles)) $roles = [$roles];
    $userRole = $_SESSION['role'] ?? '';
    if (!in_array($userRole, $roles, true)) {
        http_response_code(403);
        die(json_encode(['success' => false, 'message' => 'Forbidden. Insufficient permissions.']));
    }
}
