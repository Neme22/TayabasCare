<?php
/**
 * Admin Recovery Code redeem — public break-glass endpoint.
 * Resets the existing admin password using a one-time recovery code.
 * No session required. CSRF still required.
 */
require_once 'config.php';
require_once 'csrf.php';
require_once 'activity_log.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    errorResponse('Invalid request method', 405);
}
if (csrfNeeded()) {
    requireCsrf();
}

$input = json_decode(file_get_contents('php://input'), true) ?: [];
$action = $input['action'] ?? 'redeem';

if ($action !== 'redeem') {
    errorResponse('Unknown action', 400);
}

$username        = trim($input['username'] ?? '');
$code            = $input['code'] ?? '';
$newPassword     = $input['new_password'] ?? '';
$confirmPassword = $input['confirm_password'] ?? '';
$ip              = $_SERVER['REMOTE_ADDR'] ?? '';

// Rate limit: 5 failed attempts per username/IP in 15 minutes
// Anonymous callers log as username 'system', so also match record_label (the target admin username)
try {
    $rateStmt = $db->prepare("
        SELECT COUNT(*) as cnt FROM activity_log
        WHERE action = 'ADMIN_RECOVERY' AND details LIKE '%FAILED%'
          AND (username = ? OR record_label = ? OR ip_address = ?)
          AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)
    ");
    $rateStmt->execute([$username, $username, $ip]);
    $failCount = $rateStmt->fetch()['cnt'] ?? 0;
    if ($failCount >= 5) {
        errorResponse('Too many failed recovery attempts. Please try again in 15 minutes.', 429);
    }
} catch (PDOException $e) {
    // If rate check fails, allow attempt
}

if ($username === '' || $code === '') {
    errorResponse('Username and recovery code are required.', 400);
}

if ($newPassword !== $confirmPassword) {
    errorResponse('Passwords do not match.', 400);
}
if (strlen($newPassword) < 8) {
    errorResponse('Password must be at least 8 characters long.', 400);
}
if (strlen($newPassword) > 72) {
    errorResponse('Password must be 72 characters or fewer.', 400);
}

// Normalize code: uppercase, strip non-alphanumerics (dashes optional)
$normalized = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)$code));
$codeHash = hash('sha256', $normalized);

try {
    // Single lookup — no enumeration of why a code failed
    $stmt = $db->prepare("
        SELECT c.id AS code_id, c.used_at, c.expires_at, u.id AS uid, u.username
        FROM admin_recovery_codes c
        JOIN users u ON u.id = c.user_id
        WHERE c.code_hash = ? AND u.username = ? AND u.role = 'admin'
    ");
    $stmt->execute([$codeHash, $username]);
    $row = $stmt->fetch();

    $valid = false;
    if ($row && $row['used_at'] === null && strtotime($row['expires_at']) > time()) {
        $valid = true;
    }

    if (!$valid) {
        logActivity($db, 'ADMIN_RECOVERY', 'auth', null, $username, 'FAILED: Invalid recovery code');
        errorResponse('Invalid recovery code.', 400);
    }

    $db->beginTransaction();

    // Atomic consume
    $consume = $db->prepare("UPDATE admin_recovery_codes SET used_at = NOW() WHERE id = ? AND used_at IS NULL");
    $consume->execute([$row['code_id']]);
    if ($consume->rowCount() === 0) {
        $db->rollBack();
        logActivity($db, 'ADMIN_RECOVERY', 'auth', null, $username, 'FAILED: Code already used');
        errorResponse('Invalid recovery code.', 400);
    }

    // Reset admin password
    $hash = password_hash($newPassword, PASSWORD_DEFAULT);
    $upd = $db->prepare("UPDATE users SET password = ? WHERE id = ? AND role = 'admin'");
    $upd->execute([$hash, $row['uid']]);
    if ($upd->rowCount() === 0) {
        $db->rollBack();
        logActivity($db, 'ADMIN_RECOVERY', 'auth', null, $username, 'FAILED: Admin user not found on update');
        errorResponse('Invalid recovery code.', 400);
    }

    // Burn remaining unused codes in this batch
    $db->prepare("UPDATE admin_recovery_codes SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL")
       ->execute([$row['uid']]);

    $db->commit();

    logActivity($db, 'ADMIN_RECOVERY', 'auth', $row['uid'], $username, 'SUCCESS: Password reset via recovery code');
    jsonResponse(true, null, 'Password reset. Log in as administrator.');
} catch (PDOException $e) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    error_log('admin_recovery_redeem error: ' . $e->getMessage());
    errorResponse('Server error. Please try again later.', 500);
}
