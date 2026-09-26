<?php
require_once 'config.php';
// session_start() is now called in config.php before headers
if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    die(json_encode(['success' => false, 'message' => 'Unauthorized. Please log in.']));
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
