<?php
require_once __DIR__ . '/../auth_check.php';
require_once __DIR__ . '/../csrf.php';
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
        $mail->CharSet = 'UTF-8';
        $mail->addAddress($toEmail, $toName);
        $mail->isHTML(true);

        $formattedDate = date('F j, Y', strtotime($schedDate));

        $mail->Subject = 'TayabasCare - Inspection Reminder for ' . $formattedDate;

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
        $mail->AltBody = "Dear $toName,\n\nThis is a reminder that you have an inspection scheduled:\n\n   Date: $formattedDate\n" . ($notes ? "   Note: $notes\n" : '') . "\nPlease prepare accordingly.\n\n- TayabasCare System";

        $mail->send();
        return true;
    } catch (Exception $e) {
        return false;
    }
}

// Called from admin.js / inspector.js when a schedule is saved
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (csrfNeeded()) {
        requireCsrf();
    }

    $input = json_decode(file_get_contents('php://input'), true) ?: [];

    $inspectorName = trim($input['inspector'] ?? '');
    $schedDate     = trim($input['schedDate'] ?? '');
    $schedDatesRaw = $input['schedDates'] ?? null;
    $dutyType      = trim($input['dutyType'] ?? ($input['duty_type'] ?? ''));
    $establishment = trim($input['establishment'] ?? '');
    $notes         = trim($input['notes'] ?? '');
    $emailType     = trim($input['type'] ?? 'assigned'); // 'assigned' or 'reschedule'

    $dates = [];
    if (is_array($schedDatesRaw) && count($schedDatesRaw) > 0) {
        foreach ($schedDatesRaw as $d) {
            $d = trim((string)$d);
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) {
                $dates[] = $d;
            }
        }
    } elseif ($schedDate !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $schedDate)) {
        $dates[] = $schedDate;
    }
    $dates = array_values(array_unique($dates));
    sort($dates);

    if (!$inspectorName || empty($dates)) {
        errorResponse('Missing inspector or date(s)', 400);
    }

    // Look up the inspector's email & canonical name
    $stmt = $db->prepare(
        "SELECT full_name, email
         FROM inspector_accounts
         WHERE LOWER(full_name) = LOWER(?) OR LOWER(username) = LOWER(?)
         LIMIT 1"
    );
    $stmt->execute([$inspectorName, $inspectorName]);
    $inspector = $stmt->fetch();

    if (!$inspector) {
        errorResponse('Inspector not found: ' . $inspectorName, 404);
    }

    $recipientName  = $inspector['full_name'] ?: $inspectorName;
    $recipientEmail = trim($inspector['email'] ?? '');
    if ($recipientEmail === '' || !filter_var($recipientEmail, FILTER_VALIDATE_EMAIL)) {
        errorResponse('No valid email address configured for ' . $recipientName, 400);
    }

    $formattedDates = array_map(fn($d) => date('F j, Y (l)', strtotime($d)), $dates);
    $countDays = count($dates);

    $dutyColors = [
        'Inspections' => '#2563eb',
        'Sanitary'    => '#059669',
        'Burial'      => '#7c3aed'
    ];

    if ($emailType === 'reschedule') {
        $accentColor = '#f59e0b';
        $title = 'Schedule Updated';
        $subject = 'TayabasCare - Your Inspection Schedule Has Been Changed';
        $intro = 'Your inspection schedule has been updated.';
    } elseif ($dutyType !== '') {
        $accentColor = $dutyColors[$dutyType] ?? '#1e40af';
        $title = 'New ' . $dutyType . ' Duty Schedule';
        $subject = 'TayabasCare - New ' . $dutyType . ' Duty Schedule ('
            . ($countDays === 1 ? date('M j, Y', strtotime($dates[0])) : $countDays . ' days')
            . ')';
        $intro = 'You have been assigned to <strong>' . htmlspecialchars($dutyType) . ' Duty</strong>'
            . ($countDays > 1 ? ' for <strong>' . $countDays . ' days</strong>.' : '.');
    } else {
        $accentColor = '#1e40af';
        $title = $establishment !== '' ? 'Re-inspection / Inspection Schedule' : 'New Inspection Schedule';
        $subject = $establishment !== ''
            ? 'TayabasCare - Inspection Scheduled: ' . $establishment
            : 'TayabasCare - New Inspection Schedule Assigned';
        $intro = $establishment !== ''
            ? 'You have been scheduled to inspect <strong>' . htmlspecialchars($establishment) . '</strong>.'
            : 'You have been assigned a new inspection schedule.';
    }

    $infoRowsHtml = '';
    if ($establishment !== '') {
        $infoRowsHtml .= emailInfoRow('Establishment', $establishment);
    }
    if ($dutyType !== '') {
        $infoRowsHtml .= emailInfoRow('Duty Assignment', $dutyType . ' Duty');
    }
    if ($countDays > 1) {
        $infoRowsHtml .= emailInfoRow('Duration', $countDays . ' days');
        $dateListHtml = '<ul style="margin:0;padding-left:18px;color:#1e293b;font-weight:600;">'
            . implode('', array_map(fn($fd) => '<li style="margin-bottom:3px;">' . htmlspecialchars($fd) . '</li>', $formattedDates))
            . '</ul>';
        $infoRowsHtml .= '<tr>'
            . '<td style="padding:6px 0;font-size:14px;color:#64748b;white-space:nowrap;padding-right:16px;vertical-align:top;width:120px;">Scheduled Dates:</td>'
            . '<td style="padding:6px 0;font-size:14px;">' . $dateListHtml . '</td>'
            . '</tr>';
    } else {
        $label = $emailType === 'reschedule' ? 'New Date' : 'Scheduled Date';
        $infoRowsHtml .= emailInfoRow($label, $formattedDates[0]);
    }
    if ($notes !== '') {
        $infoRowsHtml .= emailInfoRow('Notes', $notes);
    }

    $content = '<p style="margin:0 0 16px 0;">Dear <strong>' . htmlspecialchars($recipientName) . '</strong>,</p>'
        . '<p style="margin:0 0 20px 0;">' . $intro . '</p>'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;border-radius:8px;border-left:4px solid ' . $accentColor . ';">'
        . '<tr><td style="padding:16px 20px;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        . $infoRowsHtml
        . '</table>'
        . '</td></tr></table>'
        . '<p style="margin:20px 0 0 0;font-size:14px;color:#64748b;">Please log in to TayabasCare to view your schedule on the calendar.</p>';

    $altDates = $countDays > 1
        ? "Scheduled Dates (" . $countDays . " days):\n   - " . implode("\n   - ", $formattedDates)
        : (($emailType === 'reschedule' ? "New Date" : "Scheduled Date") . ": " . $formattedDates[0]);

    $altBody = "Dear $recipientName,\n\n" . strip_tags($intro) . "\n\n"
        . ($establishment !== '' ? "Establishment: $establishment\n" : '')
        . ($dutyType !== '' ? "Duty Assignment: $dutyType Duty\n" : '')
        . $altDates . "\n"
        . ($notes !== '' ? "Notes: $notes\n" : '')
        . "\nPlease log in to TayabasCare for full details.\n\n- TayabasCare System";

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
        $mail->CharSet = 'UTF-8';
        $mail->addAddress($recipientEmail, $recipientName);
        $mail->Subject = $subject;
        $mail->isHTML(true);
        $mail->Body = renderEmailTemplate($title, $content, $accentColor);
        $mail->AltBody = $altBody;
        $mail->send();
        jsonResponse(true, ['email' => $recipientEmail], 'Email sent to inspector.');
    } catch (Exception $e) {
        error_log('send_notification.php SMTP error: ' . $mail->ErrorInfo);
        errorResponse('Email failed: ' . $mail->ErrorInfo, 500);
    }
}
