<?php
/**
 * Admin Recovery Codes — manage (admin session required)
 * Actions: status (GET), generate (POST), update_email (POST)
 */
require_once 'config.php';
require_once 'auth_check.php';
require_once 'csrf.php';
require_once 'activity_log.php';

if (csrfNeeded()) {
    requireCsrf();
}
requireRole('admin');

// Action may come from query string, form field, or JSON body
$input = json_decode(file_get_contents('php://input'), true) ?: [];
$action = $_GET['action'] ?? $input['action'] ?? $_POST['action'] ?? '';

switch ($action) {
    case 'status':
        handleStatus();
        break;
    case 'generate':
        handleGenerate($input);
        break;
    case 'update_email':
        handleUpdateEmail($input);
        break;
    default:
        errorResponse('Unknown action', 400);
}

function getAdminUser() {
    global $db;
    $userId = $_SESSION['user_id'] ?? null;
    if (!$userId) {
        errorResponse('Unauthorized', 401);
    }
    $stmt = $db->prepare("SELECT id, username, email, role FROM users WHERE id = ? AND role = 'admin'");
    $stmt->execute([$userId]);
    $user = $stmt->fetch();
    if (!$user) {
        errorResponse('Admin account not found', 403);
    }
    return $user;
}

function handleStatus() {
    global $db;
    $user = getAdminUser();

    $stmt = $db->prepare("
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN used_at IS NULL AND expires_at > NOW() THEN 1 ELSE 0 END) AS remaining,
            MIN(created_at) AS generated_at,
            MAX(expires_at) AS expires_at
        FROM admin_recovery_codes
        WHERE user_id = ?
    ");
    $stmt->execute([$user['id']]);
    $row = $stmt->fetch();

    $total = (int)($row['total'] ?? 0);
    $remaining = (int)($row['remaining'] ?? 0);

    jsonResponse(true, [
        'generated'    => $total > 0,
        'remaining'    => $remaining,
        'total'        => $total,
        'generated_at' => $row['generated_at'] ?? null,
        'expires_at'   => $row['expires_at'] ?? null,
    ], 'OK');
}

function normalizeRecoveryCode($code) {
    return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)$code));
}

function handleGenerate($input = []) {
    global $db;
    $user = getAdminUser();

    $confirm = $input['confirm'] ?? false;
    if (!$confirm) {
        errorResponse('Confirmation required to generate recovery codes.', 400);
    }

    $plaintextCodes = [];
    $hashed = [];
    $expiresAt = date('Y-m-d H:i:s', strtotime('+12 months'));

    try {
        $db->beginTransaction();

        $db->prepare("DELETE FROM admin_recovery_codes WHERE user_id = ?")->execute([$user['id']]);

        $insert = $db->prepare("INSERT INTO admin_recovery_codes (user_id, code_hash, expires_at) VALUES (?, ?, ?)");
        for ($i = 0; $i < 10; $i++) {
            $raw = bin2hex(random_bytes(8)); // 16 hex chars
            $formatted = strtoupper(substr($raw, 0, 4) . '-' . substr($raw, 4, 4) . '-' . substr($raw, 8, 4) . '-' . substr($raw, 12, 4));
            $plaintextCodes[] = $formatted;
            $hash = hash('sha256', normalizeRecoveryCode($formatted));
            $hashed[] = $hash;
            $insert->execute([$user['id'], $hash, $expiresAt]);
        }

        $db->commit();
    } catch (PDOException $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        error_log('admin_recovery generate error: ' . $e->getMessage());
        errorResponse('Failed to generate recovery codes. Please try again.', 500);
    }

    // Never log plaintext codes
    logActivity($db, 'ADMIN_RECOVERY_GENERATE', 'auth', $user['id'], $user['username'], 'Generated 10 recovery codes');

    jsonResponse(true, [
        'codes'      => $plaintextCodes,
        'expires_at' => $expiresAt,
    ], 'Recovery codes generated. Store them securely — they will not be shown again.');
}

function handleUpdateEmail($input = []) {
    global $db;
    $user = getAdminUser();

    $email = trim($input['email'] ?? '');

    if ($email === '' || strlen($email) > 255 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        errorResponse('Please enter a valid email address.', 400);
    }

    try {
        $stmt = $db->prepare("UPDATE users SET email = ? WHERE id = ? AND role = 'admin'");
        $stmt->execute([$email, $user['id']]);
        if ($stmt->rowCount() === 0 && $user['email'] !== $email) {
            errorResponse('Failed to update email.', 500);
        }
    } catch (PDOException $e) {
        error_log('admin_recovery update_email error: ' . $e->getMessage());
        errorResponse('Failed to update email. Please try again.', 500);
    }

    $_SESSION['email'] = $email;
    logActivity($db, 'ADMIN_RECOVERY_EMAIL', 'auth', $user['id'], $user['username'], 'Admin email updated');

    jsonResponse(true, ['email' => $email], 'Email updated successfully.');
}
