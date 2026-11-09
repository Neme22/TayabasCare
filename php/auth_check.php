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
        die(json_encode(['success' => false, 'code' => 'UNAUTHORIZED', 'message' => 'Unauthorized. Please log in.']));
    }

    // Verify single active session (prevent concurrent logins)
    $userId = $_SESSION['user_id'] ?? null;
    $sessToken = $_SESSION['session_token'] ?? null;

    if ($userId && $userId > 0) {
        try {
            $stmt = $db->prepare("SELECT current_session_token FROM users WHERE id = ?");
            $stmt->execute([$userId]);
            $dbToken = $stmt->fetchColumn();

            // If token in DB does not match this session's token, account logged in on another device
            if (empty($sessToken) || $dbToken !== $sessToken) {
                session_unset();
                session_destroy();
                http_response_code(401);
                die(json_encode([
                    'success' => false,
                    'code'    => 'CONCURRENT_LOGIN',
                    'message' => 'Your account has been logged in on another device. You have been logged out.'
                ]));
            }
        } catch (PDOException $e) {
            // Ignore if column doesn't exist yet
            error_log('auth_check session verification error: ' . $e->getMessage());
        }
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
