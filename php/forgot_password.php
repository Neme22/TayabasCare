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

use PHPMailer\PHPMailer\PHPMailer;

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    errorResponse('Invalid request method', 405);
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

    try {
        $stmt = $db->prepare("SELECT id, username, email FROM users WHERE username = ?");
        $stmt->execute([$username]);
        $user = $stmt->fetch();

        if (!$user) {
            errorResponse('Username not found.', 404);
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
            errorResponse('The Username or Email does not match.', 400);
        }

        $otp     = str_pad(rand(0, 999999), 6, '0', STR_PAD_LEFT);
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
            $mail->SMTPOptions = [
                'ssl' => [
                    'verify_peer'       => false,
                    'verify_peer_name'  => false,
                    'allow_self_signed' => true
                ]
            ];

            $mail->setFrom(MAIL_FROM, MAIL_FROMNAME);
            $mail->addAddress($userEmail, $user['username']);
            $mail->Subject = 'TayabasCare - Password Reset OTP';
            $mail->Body    = "Hello {$user['username']},\n\n"
                           . "Your One-Time Password (OTP) for resetting your TayabasCare password is:\n\n"
                           . "  {$otp}\n\n"
                           . "This OTP is valid for 10 minutes.\n\n"
                           . "If you did not request this, please ignore this email.\n\n"
                           . "- TayabasCare System";
            $mail->send();
        } catch (Exception $e) {
            errorResponse('Failed to send email: ' . $mail->ErrorInfo, 500);
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
            errorResponse('No OTP request found for this username.', 404);
        }

        if ($record['used'] == 1) {
            errorResponse('This OTP has already been used.', 400);
        }

        if (strtotime($record['expires_at']) < time()) {
            errorResponse('OTP has expired. Please request a new one.', 400);
        }

        if (!hash_equals($record['otp'], $otp)) {
            errorResponse('Incorrect OTP. Please try again.', 400);
        }

        $stmt = $db->prepare("UPDATE password_resets SET used = 2 WHERE id = ?");
        $stmt->execute([$record['id']]);

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

    if (strlen($newPassword) < 6) {
        errorResponse('Password must be at least 6 characters long.', 400);
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