<?php
ob_start();
error_reporting(0);
ini_set('display_errors', 0);
require_once 'config.php';
ob_clean();
// session_start() is now called in config.php before headers

require_once __DIR__ . '/PHPMailer/Exception.php';
require_once __DIR__ . '/PHPMailer/PHPMailer.php';
require_once __DIR__ . '/PHPMailer/SMTP.php';
require_once __DIR__ . '/email_template.php';
require_once 'csrf.php';

use PHPMailer\PHPMailer\PHPMailer;

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    errorResponse('Invalid request method', 405);
}

if (csrfNeeded()) {
    requireCsrf();
}

$input = json_decode(file_get_contents('php://input'), true);
$action = $input['action'] ?? '';

switch ($action) {
    case 'send_otp':
        sendOTP($input);
        break;
    case 'verify_otp':
        verifyOTP($input);
        break;
    case 'reset_password':
        resetPassword($input);
        break;
    default:
        errorResponse('Invalid action', 400);
}

function sendOTP($input) {
    global $db;

    $username = trim($input['username'] ?? '');
    $email    = trim($input['email'] ?? '');

    if (empty($username) || empty($email)) {
        errorResponse('Username and email are required.', 400);
    }

    // Rate limit: max 3 OTP requests per username within 1 hour
    try {
        $rateStmt = $db->prepare("
            SELECT COUNT(*) as cnt FROM password_resets pr
            INNER JOIN users u ON u.id = pr.user_id
            WHERE u.username = ? AND pr.created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)
        ");
        $rateStmt->execute([$username]);
        $otpCount = $rateStmt->fetch()['cnt'] ?? 0;
        if ($otpCount >= 3) {
            errorResponse('Too many password reset requests. Please try again later.', 429);
        }
    } catch (PDOException $e) {
        // If rate check fails, allow attempt
    }

    try {
        $stmt = $db->prepare("SELECT id, username, email FROM users WHERE username = ?");
        $stmt->execute([$username]);
        $user = $stmt->fetch();

        // Generic message to prevent user enumeration
        if (!$user) {
            errorResponse('If the username and email match, an OTP has been sent.', 200);
        }

        // If the user's email in the users table is empty (e.g. inspector), check inspector_accounts
        $userEmail = $user['email'];
        if (empty($userEmail)) {
            $stmtIA = $db->prepare("SELECT email FROM inspector_accounts WHERE username = ?");
            $stmtIA->execute([$username]);
            $iaRow = $stmtIA->fetch();
            if ($iaRow) {
                $userEmail = $iaRow['email'];
            }
        }

        if (empty($userEmail) || strtolower($userEmail) !== strtolower($email)) {
            errorResponse('If the username and email match, an OTP has been sent.', 200);
        }

        $otp     = str_pad(random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $expires = date('Y-m-d H:i:s', strtotime('+10 minutes'));

        $stmt = $db->prepare("
            INSERT INTO password_resets (user_id, otp, expires_at)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE otp = VALUES(otp), expires_at = VALUES(expires_at), used = 0
        ");
        $stmt->execute([$user['id'], $otp, $expires]);

        $mail = new PHPMailer(true);
        try {
            $mail->isSMTP();
            $mail->Host       = MAIL_HOST;
            $mail->SMTPAuth   = true;
            $mail->Username   = MAIL_USERNAME;
            $mail->Password   = MAIL_PASSWORD;
            $mail->SMTPSecure = 'tls';
            $mail->Port       = MAIL_PORT;

            $mail->setFrom(MAIL_FROM, MAIL_FROMNAME);
            $mail->addAddress($userEmail, $user['username']);
            $mail->Subject = 'TayabasCare – Password Reset OTP';
            $mail->isHTML(true);

            $content = '<p style="margin:0 0 16px 0;">Hello <strong>' . htmlspecialchars($user['username']) . '</strong>,</p>'
                . '<p style="margin:0 0 24px 0;">We received a request to reset your TayabasCare password. Use the One-Time Password below to proceed:</p>'
                . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">'
                . '<tr><td align="center" style="padding:20px 0;">'
                . '<div style="display:inline-block;background-color:#f1f5f9;border:2px dashed #3b82f6;border-radius:10px;padding:16px 40px;">'
                . '<span style="font-size:32px;font-weight:700;color:#1e40af;letter-spacing:6px;font-family:Consolas,\'Courier New\',monospace;">' . $otp . '</span>'
                . '</div>'
                . '</td></tr></table>'
                . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;">'
                . '<tr><td style="background-color:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:0 6px 6px 0;font-size:14px;color:#92400e;">'
                . '&#9200; This OTP is valid for <strong>10 minutes</strong>. Do not share it with anyone.'
                . '</td></tr></table>'
                . '<p style="margin:0;font-size:13px;color:#94a3b8;">If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>';

            $mail->Body = renderEmailTemplate('Password Reset OTP', $content, '#3b82f6');
            $mail->AltBody = "Hello {$user['username']},\n\nYour One-Time Password (OTP) for resetting your TayabasCare password is:\n\n  {$otp}\n\nThis OTP is valid for 10 minutes.\nIf you did not request this, please ignore this email.\n\n- TayabasCare System";
            $mail->send();
        } catch (Exception $e) {
            error_log('Mail error: ' . $mail->ErrorInfo);
            errorResponse('Failed to send email. Please try again later.', 500);
        }

        jsonResponse(true, null, 'OTP sent to your registered email address.');

    } catch (PDOException $e) {
        error_log('Forgot password error: ' . $e->getMessage());
        errorResponse('Server error. Please try again later.', 500);
    }
}

function verifyOTP($input) {
    global $db;

    $username = trim($input['username'] ?? '');
    $otp      = trim($input['otp'] ?? '');

    if (empty($username) || empty($otp)) {
        errorResponse('Username and OTP are required.', 400);
    }

    // Rate limit: max 5 OTP verify attempts per username within 15 minutes
    try {
        $ip = $_SERVER['REMOTE_ADDR'] ?? '';
        $rateStmt = $db->prepare("
            SELECT COUNT(*) as cnt FROM activity_log
            WHERE action = 'OTP_VERIFY' AND details LIKE '%FAILED%' AND (username = ? OR ip_address = ?)
            AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)
        ");
        $rateStmt->execute([$username, $ip]);
        $failCount = $rateStmt->fetch()['cnt'] ?? 0;
        if ($failCount >= 5) {
            errorResponse('Too many failed OTP attempts. Please try again in 15 minutes.', 429);
        }
    } catch (PDOException $e) {
        // If rate check fails, allow attempt
    }

    try {
        $stmt = $db->prepare("
            SELECT pr.id, pr.otp, pr.expires_at, pr.used
            FROM password_resets pr
            INNER JOIN users u ON u.id = pr.user_id
            WHERE u.username = ?
            ORDER BY pr.created_at DESC
            LIMIT 1
        ");
        $stmt->execute([$username]);
        $record = $stmt->fetch();

        if (!$record) {
            errorResponse('Invalid or expired OTP.', 400);
        }

        // Reject if already used (state 1 = consumed by reset, state 2 = verified pending reset)
        if ($record['used'] != 0) {
            errorResponse('Invalid or expired OTP.', 400);
        }

        if (strtotime($record['expires_at']) < time()) {
            errorResponse('Invalid or expired OTP.', 400);
        }

        if (!hash_equals($record['otp'], $otp)) {
            // Log failed attempt for rate limiting
            try {
                require_once __DIR__ . '/activity_log.php';
                logActivity($db, 'OTP_VERIFY', 'auth', null, $username, 'FAILED: Invalid OTP');
            } catch (Exception $e) {}
            errorResponse('Invalid or expired OTP.', 400);
        }

        // Atomically consume: only mark used=2 if still used=0
        $stmt = $db->prepare("UPDATE password_resets SET used = 2 WHERE id = ? AND used = 0");
        $stmt->execute([$record['id']]);

        if ($stmt->rowCount() === 0) {
            errorResponse('Invalid or expired OTP.', 400);
        }

        $_SESSION['otp_verified_username'] = $username;
        $_SESSION['otp_verified_time']     = time();

        jsonResponse(true, null, 'OTP verified successfully.');

    } catch (PDOException $e) {
        error_log('Forgot password error: ' . $e->getMessage());
        errorResponse('Server error. Please try again later.', 500);
    }
}

function resetPassword($input) {
    global $db;

    $username    = trim($input['username'] ?? '');
    $newPassword = $input['new_password'] ?? '';
    $confirmPass = $input['confirm_password'] ?? '';

    if (empty($username) || empty($newPassword) || empty($confirmPass)) {
        errorResponse('All fields are required.', 400);
    }

    if (
        !isset($_SESSION['otp_verified_username']) ||
        $_SESSION['otp_verified_username'] !== $username ||
        (time() - $_SESSION['otp_verified_time']) > 600
    ) {
        errorResponse('Session expired or unauthorized. Please restart the process.', 403);
    }

    if ($newPassword !== $confirmPass) {
        errorResponse('Passwords do not match.', 400);
    }

    if (strlen($newPassword) < 8) {
        errorResponse('Password must be at least 8 characters long.', 400);
    }

    if (strlen($newPassword) > 72) {
        errorResponse('Password must be 72 characters or fewer.', 400);
    }

    try {
        $hashedPassword = password_hash($newPassword, PASSWORD_DEFAULT);

        $stmt = $db->prepare("UPDATE users SET password = ? WHERE username = ?");
        $stmt->execute([$hashedPassword, $username]);

        // Sync password to inspector_accounts for inspector users
        $db->prepare("UPDATE inspector_accounts SET password = ? WHERE username = ?")
           ->execute([$hashedPassword, $username]);

        $stmt = $db->prepare("
            UPDATE password_resets pr
            INNER JOIN users u ON u.id = pr.user_id
            SET pr.used = 1
            WHERE u.username = ? AND pr.used = 2
        ");
        $stmt->execute([$username]);

        unset($_SESSION['otp_verified_username'], $_SESSION['otp_verified_time']);

        jsonResponse(true, null, 'Password has been reset successfully. You may now log in.');

    } catch (PDOException $e) {
        error_log('Forgot password error: ' . $e->getMessage());
        errorResponse('Server error. Please try again later.', 500);
    }
}
?>