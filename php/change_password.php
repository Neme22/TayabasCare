<?php
require_once 'auth_check.php';
require_once 'csrf.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    errorResponse('Invalid request method', 405);
}

if (csrfNeeded()) {
    requireCsrf();
}

$input = json_decode(file_get_contents('php://input'), true);

$currentPassword = $input['currentPassword'] ?? '';
$newPassword = $input['newPassword'] ?? '';

// Validate inputs
if (empty($currentPassword) || empty($newPassword)) {
    errorResponse('Current password and new password are required', 400);
}

if (strlen($newPassword) < 8) {
    errorResponse('Password must be at least 8 characters long', 400);
}

if (strlen($newPassword) > 72) {
    errorResponse('Password must be 72 characters or fewer', 400);
}

try {
    // Get user from session
    if (!isset($_SESSION['user_id'])) {
        errorResponse('User not logged in', 401);
    }

    $userId = $_SESSION['user_id'];
    
    // Both admin and inspector credentials are in the users table
    $table = 'users';
    
    // Get current password hash from database
    $stmt = $db->prepare("SELECT password FROM $table WHERE id = ?");
    $stmt->execute([$userId]);
    $user = $stmt->fetch();
    
    if (!$user) {
        errorResponse('User not found', 404);
    }
    
    // Verify current password (support legacy MD5 and plaintext for migration)
    $isPasswordCorrect = password_verify($currentPassword, $user['password']);
    if (!$isPasswordCorrect && strlen($user['password']) === 32 && ctype_xdigit($user['password'])) {
        // Legacy MD5 hash
        $isPasswordCorrect = (md5($currentPassword) === $user['password']);
    } elseif (!$isPasswordCorrect && !password_get_info($user['password'])['algo']) {
        // Legacy plaintext (no hash algo detected)
        $isPasswordCorrect = hash_equals($user['password'], $currentPassword);
    }

    if (!$isPasswordCorrect) {
        errorResponse('Current password is incorrect', 401);
    }
    
    // Hash new password
    $newPasswordHash = password_hash($newPassword, PASSWORD_DEFAULT);
    
    // Update password
    $updateStmt = $db->prepare("UPDATE $table SET password = ? WHERE id = ?");
    $updateStmt->execute([$newPasswordHash, $userId]);

    // Sync password to inspector_accounts for inspector users
    if (isset($_SESSION['role']) && $_SESSION['role'] === 'inspector' && isset($_SESSION['username'])) {
        $db->prepare("UPDATE inspector_accounts SET password = ? WHERE username = ?")
           ->execute([$newPasswordHash, $_SESSION['username']]);
    }

    jsonResponse(true, null, 'Password changed successfully');
    
} catch(PDOException $e) {
    error_log('change_password.php error: ' . $e->getMessage());
    errorResponse('Failed to change password. Please try again.', 500);
}
?>