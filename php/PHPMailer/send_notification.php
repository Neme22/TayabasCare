<?php
require_once __DIR__ . '/../auth_check.php';
require_once __DIR__ . '/Exception.php';
require_once __DIR__ . '/PHPMailer.php';
require_once __DIR__ . '/SMTP.php';
require_once __DIR__ . '/../email_template.php';

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

        $mail->setFrom(MAIL_FROM, MAIL_FROMNAME);
        $mail->addAddress($toEmail, $toName);
        $mail->isHTML(true);

        $formattedDate = date('F j, Y', strtotime($schedDate));

        $mail->Subject = 'TayabasCare – Inspection Reminder for ' . $formattedDate;

        $content = '<p style="margin:0 0 16px 0;">Dear <strong>' . htmlspecialchars($toName) . '</strong>,</p>'
            . '<p style="margin:0 0 20px 0;">This is a reminder that you have an inspection scheduled:</p>'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;border-radius:8px;padding:4px;">'
            . '<tr><td style="padding:16px 20px;">'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
            . emailInfoRow('Date', $formattedDate)
            . ($notes ? emailInfoRow('Note', $notes) : '')
            . '</table>'
            . '</td></tr></table>'
            . '<p style="margin:20px 0 0 0;">Please prepare accordingly.</p>';

        $mail->Body = renderEmailTemplate('Inspection Reminder', $content, '#1e40af');
        $mail->AltBody = "Dear $toName,\n\nThis is a reminder that you have an inspection scheduled:\n\n   Date: $formattedDate\n" . ($notes ? "   Note: $notes\n" : '') . "\nPlease prepare accordingly.\n\n– TayabasCare System";

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

    if ($emailType === 'reschedule') {
        $accentColor = '#f59e0b';
        $title = 'Schedule Updated';
        $intro = 'Your inspection schedule has been updated.';
    } else {
        $accentColor = '#1e40af';
        $title = 'New Inspection Schedule';
        $intro = 'You have been assigned a new inspection schedule.';
    }

    $content = '<p style="margin:0 0 16px 0;">Dear <strong>' . htmlspecialchars($inspectorName) . '</strong>,</p>'
        . '<p style="margin:0 0 20px 0;">' . $intro . '</p>'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;border-radius:8px;">'
        . '<tr><td style="padding:16px 20px;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        . ($emailType === 'reschedule' ? emailInfoRow('New Date', $formattedDate) : emailInfoRow('Date', $formattedDate))
        . ($notes ? emailInfoRow('Note', $notes) : '')
        . '</table>'
        . '</td></tr></table>'
        . '<p style="margin:20px 0 0 0;font-size:14px;color:#64748b;">Please log in to TayabasCare for full details.</p>';

    $altBody = "Dear $inspectorName,\n\n" . strip_tags($intro) . "\n\n"
        . ($emailType === 'reschedule' ? "New Date" : "Date") . ": $formattedDate\n"
        . ($notes ? "Note: $notes\n" : '')
        . "\n– TayabasCare System";

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
        $mail->addAddress($inspector['email'], $inspectorName);
        $mail->Subject = $subject;
        $mail->isHTML(true);
        $mail->Body = renderEmailTemplate($title, $content, $accentColor);
        $mail->AltBody = $altBody;
        $mail->send();
        jsonResponse(true, null, 'Email sent to inspector.');
    } catch (Exception $e) {
        errorResponse('Email failed: ' . $mail->ErrorInfo, 500);
    }
}
?>