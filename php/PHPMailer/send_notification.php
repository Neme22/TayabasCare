<?php
require_once __DIR__ . '/../auth_check.php';
require_once __DIR__ . '/Exception.php';
require_once __DIR__ . '/PHPMailer.php';
require_once __DIR__ . '/SMTP.php';

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

function sendInspectionEmail($toEmail, $toName, $schedDate, $notes = '') {
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
        $mail->addAddress($toEmail, $toName);

        $formattedDate = date('F j, Y', strtotime($schedDate));

        $mail->Subject = 'TayabasCare – Inspection Reminder for ' . $formattedDate;
        $mail->Body    =
            "Dear $toName,\n\n" .
            "This is a reminder that you have an inspection scheduled TOMORROW:\n\n" .
            "   Date: $formattedDate\n" .
            ($notes ? "   Note: $notes\n" : '') .
            "\nPlease prepare accordingly.\n\n" .
            "– TayabasCare System";

        $mail->send();
        return true;
    } catch (Exception $e) {
        return false;
    }
}

// Called from admin.js when a schedule is saved
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);

    $inspectorName = trim($input['inspector'] ?? '');
    $schedDate     = trim($input['schedDate'] ?? '');
    $notes         = trim($input['notes'] ?? '');
    $emailType     = trim($input['type'] ?? 'assigned'); // 'assigned' or 'reschedule'

    if (!$inspectorName || !$schedDate) {
        errorResponse('Missing inspector or date', 400);
    }

    // Look up the inspector's email
    $stmt = $db->prepare("SELECT email FROM inspector_accounts WHERE full_name = ? LIMIT 1");
    $stmt->execute([$inspectorName]);
    $inspector = $stmt->fetch();

    if (!$inspector) {
        errorResponse('Inspector not found: ' . $inspectorName, 404);
    }

    $formattedDate = date('F j, Y', strtotime($schedDate));
    $subject = $emailType === 'reschedule'
        ? 'TayabasCare – Your Inspection Schedule Has Been Changed'
        : 'TayabasCare – New Inspection Schedule Assigned';

    $body = $emailType === 'reschedule'
        ? "Dear $inspectorName,\n\nYour inspection schedule has been updated.\n\n   New Date: $formattedDate\n" . ($notes ? "   Note: $notes\n" : '') . "\n– TayabasCare System"
        : "Dear $inspectorName,\n\nYou have been assigned a new inspection schedule.\n\n   Date: $formattedDate\n" . ($notes ? "   Note: $notes\n" : '') . "\n– TayabasCare System";

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
        $mail->addAddress($inspector['email'], $inspectorName);
        $mail->Subject = $subject;
        $mail->Body    = $body;
        $mail->send();
        jsonResponse(true, null, 'Email sent to inspector.');
    } catch (Exception $e) {
        errorResponse('Email failed: ' . $mail->ErrorInfo, 500);
    }
}
?>