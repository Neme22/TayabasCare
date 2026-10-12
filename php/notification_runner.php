<?php
require_once 'auth_check.php';
requireRole('admin');
require_once 'risk_utils.php';
require_once 'csrf.php';
require_once __DIR__ . '/PHPMailer/Exception.php';
require_once __DIR__ . '/PHPMailer/PHPMailer.php';
require_once __DIR__ . '/PHPMailer/SMTP.php';
require_once __DIR__ . '/email_template.php';

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

// ============================================================
// TayabasCare Notification Runner
// Checks for tomorrow's scheduled inspections and sends email
// reminders. Tracks sends in notification_log to avoid duplicates.
// ============================================================

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit(); }
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    errorResponse('Method not allowed. Use GET.', 405);
}

if (csrfNeeded()) {
    requireCsrf();
}

try {
    $action = $_GET['action'] ?? 'status';

    // ---- GET ?action=status: Show notification status ----
    if ($action === 'status') {
        $today = date('Y-m-d');

        // Count emails sent today
        $stmt = $db->prepare("SELECT COUNT(*) as sent FROM notification_log WHERE DATE(sent_at) = ? AND status = 'sent'");
        $stmt->execute([$today]);
        $sentToday = $stmt->fetch()['sent'];

        // Count failed today
        $stmt = $db->prepare("SELECT COUNT(*) as failed FROM notification_log WHERE DATE(sent_at) = ? AND status = 'failed'");
        $stmt->execute([$today]);
        $failedToday = $stmt->fetch()['failed'];

        // Last sent timestamp
        $stmt = $db->query("SELECT sent_at FROM notification_log WHERE status = 'sent' ORDER BY sent_at DESC LIMIT 1");
        $lastSent = $stmt->fetch();
        $lastSentAt = $lastSent ? $lastSent['sent_at'] : null;

        // Tomorrow's schedules count
        $tomorrow = date('Y-m-d', strtotime('+1 day'));
        $stmt = $db->prepare("
            SELECT COUNT(*) as pending
            FROM inspection_schedules s
            WHERE s.schedDate = ? AND s.done = 0
        ");
        $stmt->execute([$tomorrow]);
        $pendingTomorrow = $stmt->fetch()['pending'];

        // Check if already sent for tomorrow
        $stmt = $db->prepare("
            SELECT COUNT(*) as already_sent
            FROM notification_log
            WHERE DATE(sent_at) = ? AND status = 'sent'
        ");
        $stmt->execute([$today]);
        $alreadySentToday = $stmt->fetch()['already_sent'] > 0;

        jsonResponse(true, [
            'sentToday'       => (int)$sentToday,
            'failedToday'     => (int)$failedToday,
            'lastSentAt'      => $lastSentAt,
            'pendingTomorrow' => (int)$pendingTomorrow,
            'alreadySentToday' => (bool)$alreadySentToday
        ]);
    }

    // ---- GET ?action=send: Trigger sending reminders ----
    if ($action === 'send') {
        // GET-triggered write — require CSRF token
        requireCsrf();
        $tomorrow = date('Y-m-d', strtotime('+1 day'));
        $today = date('Y-m-d');

        // Check if already sent today (prevent duplicate sends within same day)
        $skipDuplicate = isset($_GET['force']) && $_GET['force'] === '1';
        if (!$skipDuplicate) {
            $stmt = $db->prepare("SELECT COUNT(*) as cnt FROM notification_log WHERE DATE(sent_at) = ? AND status = 'sent'");
            $stmt->execute([$today]);
            if ($stmt->fetch()['cnt'] > 0) {
                jsonResponse(true, [
                    'sent' => 0,
                    'failed' => 0,
                    'skipped' => true,
                    'message' => 'Reminders already sent today. Use ?action=send&force=1 to resend.'
                ]);
            }
        }

        // Find tomorrow's schedules with inspector emails
        $stmt = $db->prepare("
            SELECT s.id as schedule_id, s.schedDate, s.notes, s.inspector_name, s.establishment,
                   i.email
            FROM inspection_schedules s
            JOIN inspector_accounts i ON i.full_name = s.inspector_name
            WHERE s.schedDate = ? AND s.done = 0
        ");
        $stmt->execute([$tomorrow]);
        $schedules = $stmt->fetchAll();

        if (empty($schedules)) {
            jsonResponse(true, [
                'sent' => 0,
                'failed' => 0,
                'skipped' => false,
                'message' => 'No scheduled inspections for tomorrow.'
            ]);
        }

        $sent = 0;
        $failed = 0;
        $errors = [];

        foreach ($schedules as $s) {
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
                $mail->addAddress($s['email'], $s['inspector_name']);

                $formattedDate = date('F j, Y', strtotime($s['schedDate']));

                $content = '<p style="margin:0 0 16px 0;">Dear <strong>' . htmlspecialchars($s['inspector_name']) . '</strong>,</p>'
                    . '<p style="margin:0 0 20px 0;">This is a reminder that you have an inspection scheduled <strong>tomorrow</strong>:</p>'
                    . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eff6ff;border-radius:8px;border-left:4px solid #3b82f6;">'
                    . '<tr><td style="padding:16px 20px;">'
                    . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
                    . emailInfoRow('Date', $formattedDate)
                    . ($s['establishment'] ? emailInfoRow('Establishment', $s['establishment']) : '')
                    . ($s['notes'] ? emailInfoRow('Note', $s['notes']) : '')
                    . '</table>'
                    . '</td></tr></table>'
                    . '<p style="margin:20px 0 0 0;">Please prepare accordingly and review the establishment details before your visit.</p>';

                $altBody = "Dear {$s['inspector_name']},\n\nThis is a reminder that you have an inspection scheduled TOMORROW:\n\n   Date: $formattedDate"
                    . ($s['establishment'] ? "\n   Establishment: {$s['establishment']}" : '')
                    . ($s['notes'] ? "\n   Note: {$s['notes']}" : '')
                    . "\n\nPlease prepare accordingly.\n\n– TayabasCare System";

                $mail->Subject = 'TayabasCare – Inspection Reminder for ' . $formattedDate;
                $mail->isHTML(true);
                $mail->Body = renderEmailTemplate('Inspection Reminder', $content, '#3b82f6');
                $mail->AltBody = $altBody;

                $mail->send();
                $sent++;

                // Log success
                $logStmt = $db->prepare("INSERT INTO notification_log (schedule_id, inspector_name, email, status) VALUES (?, ?, ?, 'sent')");
                $logStmt->execute([$s['schedule_id'], $s['inspector_name'], $s['email']]);

                // Mark schedule as notified
                $db->prepare("UPDATE inspection_schedules SET notified = 1 WHERE id = ?")->execute([$s['schedule_id']]);

            } catch (Exception $e) {
                $failed++;
                $errMsg = $e->getMessage();
                $errors[] = "{$s['inspector_name']}: $errMsg";

                // Log failure
                $logStmt = $db->prepare("INSERT INTO notification_log (schedule_id, inspector_name, email, status, error_message) VALUES (?, ?, ?, 'failed', ?)");
                $logStmt->execute([$s['schedule_id'], $s['inspector_name'], $s['email'], $errMsg]);
            }
        }

        jsonResponse(true, [
            'sent'    => $sent,
            'failed'  => $failed,
            'skipped' => false,
            'errors'  => $errors,
            'message' => "Sent $sent reminder(s)" . ($failed > 0 ? ", $failed failed" : '') . "."
        ]);
    }

    // ---- GET ?action=send_compliance_alerts: Email admin about HIGH-risk & violations ----
    if ($action === 'send_compliance_alerts') {
        // GET-triggered write — require CSRF token
        requireCsrf();
        require_once __DIR__ . '/risk_utils.php';

        // Check if already sent today
        $today = date('Y-m-d');
        $stmt = $db->prepare("SELECT COUNT(*) as cnt FROM notification_log WHERE DATE(sent_at) = ? AND status = 'sent' AND notification_type = 'compliance_alert'");
        $stmt->execute([$today]);
        if ($stmt->fetch()['cnt'] > 0 && !isset($_GET['force'])) {
            jsonResponse(true, ['sent' => 0, 'skipped' => true, 'message' => 'Compliance alerts already sent today.']);
        }

        // Get admin email
        $adminStmt = $db->query("SELECT email FROM users WHERE role = 'admin' AND email IS NOT NULL AND email != '' LIMIT 1");
        $admin = $adminStmt->fetch();
        if (!$admin) {
            errorResponse('No admin email configured.', 400);
        }

        // Find HIGH-risk establishments
        $records = $db->query("SELECT * FROM sanitary_records ORDER BY created_at DESC")->fetchAll();
        $liveInspections = $db->query("SELECT * FROM inspection_reports ORDER BY report_date ASC")->fetchAll();
        $historyInspections = $db->query("SELECT * FROM inspection_history ORDER BY report_date ASC")->fetchAll();
        $allInspections = array_merge($liveInspections, $historyInspections);

        $highRiskItems = [];
        $violationThresholdItems = [];
        $seen = [];

        foreach ($records as $record) {
            $name = $record['business_name'];
            if (isset($seen[$name])) continue;
            $seen[$name] = true;

            $myInspections = array_filter($allInspections, function($i) use ($name) {
                $estab = $i['establishment'] ?? $i['location'] ?? '';
                return matchEstablishment($estab, $name);
            });

            if (count($myInspections) === 0) continue;

            $sanitaryRecord = [
                'remarks' => $record['remarks'] ?? '',
                'result_xray' => $record['result_xray'] ?? null,
                'result_stool' => $record['result_stool'] ?? null,
                'business_type' => $record['business_type'] ?? 'Other',
            ];
            $scored = calculateRiskScore($name, array_values($myInspections), $sanitaryRecord);

            if ($scored['totalScore'] >= 60) {
                $highRiskItems[] = "{$name} (Score: {$scored['totalScore']}, Barangay: " . ($record['barangay'] ?? 'N/A') . ")";
            }

            $violationCount = $scored['factors']['violations']['count'] ?? 0;
            if ($violationCount >= 3) {
                $violationThresholdItems[] = "{$name} — {$violationCount} violations on record";
            }
        }

        if (empty($highRiskItems) && empty($violationThresholdItems)) {
            jsonResponse(true, ['sent' => 0, 'message' => 'No compliance issues to report.']);
        }

        // Build and send email
        $mail = new PHPMailer(true);
        try {
            $mail->isSMTP();
            $mail->Host = MAIL_HOST;
            $mail->SMTPAuth = true;
            $mail->Username = MAIL_USERNAME;
            $mail->Password = MAIL_PASSWORD;
            $mail->SMTPSecure = 'tls';
            $mail->Port = MAIL_PORT;
            $mail->setFrom(MAIL_FROM, MAIL_FROMNAME);
            $mail->addAddress($admin['email']);
            $mail->Subject = 'TayabasCare – Daily Compliance Alert (' . date('M j, Y') . ')';

            $content = '<p style="margin:0 0 16px 0;">Dear <strong>City Health Officer</strong>,</p>'
                . '<p style="margin:0 0 20px 0;">This is your daily compliance alert from TayabasCare.</p>';

            if (!empty($highRiskItems)) {
                $content .= '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">'
                    . '<tr><td style="background-color:#fef2f2;border-left:4px solid #dc2626;padding:12px 16px;border-radius:0 6px 6px 0;">'
                    . '<span style="font-size:15px;font-weight:700;color:#991b1b;">&#9888; High-Risk Establishments (' . count($highRiskItems) . ')</span>'
                    . '</td></tr></table>'
                    . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">';
                foreach ($highRiskItems as $item) {
                    $content .= emailListItem($item);
                }
                $content .= '</table>'
                    . '<p style="margin:0 0 20px 0;font-size:14px;color:#dc2626;font-weight:600;">These establishments require priority inspection.</p>';
            }

            if (!empty($violationThresholdItems)) {
                $content .= '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">'
                    . '<tr><td style="background-color:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:0 6px 6px 0;">'
                    . '<span style="font-size:15px;font-weight:700;color:#92400e;">&#9888; Violation Threshold Alerts (' . count($violationThresholdItems) . ')</span>'
                    . '</td></tr></table>'
                    . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">';
                foreach ($violationThresholdItems as $item) {
                    $content .= emailListItem($item);
                }
                $content .= '</table>'
                    . '<p style="margin:0 0 20px 0;font-size:14px;color:#92400e;font-weight:600;">These establishments have 3+ violations and need corrective action.</p>';
            }

            $content .= '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;">'
                . '<tr><td style="background-color:#eff6ff;border-radius:8px;padding:14px 18px;font-size:14px;color:#1e40af;">'
                . '&#128200; Please review these in the <strong>TayabasCare Dashboard</strong> for full details and action items.'
                . '</td></tr></table>';

            $altBody = "Dear City Health Officer,\n\nThis is the daily compliance alert from TayabasCare.\n\n";
            if (!empty($highRiskItems)) {
                $altBody .= "=== HIGH-RISK ESTABLISHMENTS (" . count($highRiskItems) . ") ===\n";
                foreach ($highRiskItems as $item) $altBody .= "  - {$item}\n";
                $altBody .= "\nThese establishments require priority inspection.\n\n";
            }
            if (!empty($violationThresholdItems)) {
                $altBody .= "=== VIOLATION THRESHOLD ALERTS (" . count($violationThresholdItems) . ") ===\n";
                foreach ($violationThresholdItems as $item) $altBody .= "  - {$item}\n";
                $altBody .= "\nThese establishments have 3+ violations and need corrective action.\n\n";
            }
            $altBody .= "Please review these in the TayabasCare dashboard.\n\n– TayabasCare System";

            $mail->isHTML(true);
            $mail->Body = renderEmailTemplate('Daily Compliance Alert', $content, '#dc2626');
            $mail->AltBody = $altBody;
            $mail->send();

            $logStmt = $db->prepare("INSERT INTO notification_log (inspector_name, email, status, notification_type) VALUES ('Admin', ?, 'sent', 'compliance_alert')");
            $logStmt->execute([$admin['email']]);

            jsonResponse(true, ['sent' => 1, 'highRisk' => count($highRiskItems), 'violationAlerts' => count($violationThresholdItems)], 'Compliance alert sent to admin.');
        } catch (Exception $e) {
            $logStmt = $db->prepare("INSERT INTO notification_log (inspector_name, email, status, error_message, notification_type) VALUES ('Admin', ?, 'failed', ?, 'compliance_alert')");
            $logStmt->execute([$admin['email'], $e->getMessage()]);
            errorResponse('Failed to send notification. Please try again.', 500);
        }
    }

    // ---- GET ?action=send_followup_reminders: Email inspectors about overdue deadlines ----
    if ($action === 'send_followup_reminders') {
        // GET-triggered write — require CSRF token
        requireCsrf();
        $today = date('Y-m-d');

        // Find reports with overdue compliance deadlines
        $stmt = $db->prepare("
            SELECT ir.id, ir.establishment, ir.inspector_name, ir.compliance_deadline, ir.report_date, i.email
            FROM inspection_reports ir
            LEFT JOIN inspector_accounts i ON i.full_name = ir.inspector_name
            WHERE ir.compliance_deadline IS NOT NULL
            AND ir.compliance_deadline < ?
            AND ir.complied = 0
            AND ir.status != 'complied'
        ");
        $stmt->execute([$today]);
        $overdue = $stmt->fetchAll();

        $sent = 0;
        $failed = 0;
        $errors = [];

        foreach ($overdue as $item) {
            if (empty($item['email'])) continue;

            // Deduplicate: check if already sent for this report today
            $dedupStmt = $db->prepare("SELECT COUNT(*) as cnt FROM notification_log WHERE schedule_id = ? AND notification_type = 'followup_reminder' AND DATE(sent_at) = ?");
            $dedupStmt->execute([$item['id'], $today]);
            if ($dedupStmt->fetch()['cnt'] > 0) continue;

            $daysOverdue = (int)(new DateTime($today))->diff(new DateTime($item['compliance_deadline']))->days;

            $mail = new PHPMailer(true);
            try {
                $mail->isSMTP();
                $mail->Host = MAIL_HOST;
                $mail->SMTPAuth = true;
                $mail->Username = MAIL_USERNAME;
                $mail->Password = MAIL_PASSWORD;
                $mail->SMTPSecure = 'tls';
                $mail->Port = MAIL_PORT;
                $mail->setFrom(MAIL_FROM, MAIL_FROMNAME);
                $mail->addAddress($item['email'], $item['inspector_name']);
                $mail->Subject = 'TayabasCare – Overdue Compliance Follow-up';

                $content = '<p style="margin:0 0 16px 0;">Dear <strong>' . htmlspecialchars($item['inspector_name']) . '</strong>,</p>'
                    . '<p style="margin:0 0 20px 0;">The compliance deadline for the following establishment has passed:</p>'
                    . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef2f2;border-radius:8px;border-left:4px solid #dc2626;">'
                    . '<tr><td style="padding:16px 20px;">'
                    . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
                    . emailInfoRow('Establishment', $item['establishment'])
                    . emailInfoRow('Deadline', date('F j, Y', strtotime($item['compliance_deadline'])))
                    . emailInfoRow('Days Overdue', $daysOverdue . ($daysOverdue === 1 ? ' day' : ' days'))
                    . '</table>'
                    . '</td></tr></table>'
                    . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 0 0;">'
                    . '<tr><td style="background-color:#fef3c7;border-radius:8px;padding:14px 18px;font-size:14px;color:#92400e;">'
                    . '&#9888; Please follow up with the establishment and update the compliance status in TayabasCare as soon as possible.'
                    . '</td></tr></table>';

                $altBody = "Dear {$item['inspector_name']},\n\nThe compliance deadline for the following establishment has passed:\n\n"
                    . "   Establishment: {$item['establishment']}\n"
                    . "   Deadline: " . date('F j, Y', strtotime($item['compliance_deadline'])) . "\n"
                    . "   Days Overdue: {$daysOverdue}\n\n"
                    . "Please follow up with the establishment and update the compliance status in TayabasCare.\n\n– TayabasCare System";

                $mail->isHTML(true);
                $mail->Body = renderEmailTemplate('Overdue Compliance Follow-up', $content, '#dc2626');
                $mail->AltBody = $altBody;
                $mail->send();
                $sent++;

                $logStmt = $db->prepare("INSERT INTO notification_log (schedule_id, inspector_name, email, status, notification_type) VALUES (?, ?, ?, 'sent', 'followup_reminder')");
                $logStmt->execute([$item['id'], $item['inspector_name'], $item['email']]);
            } catch (Exception $e) {
                $failed++;
                $errors[] = "{$item['inspector_name']}: " . $e->getMessage();
                $logStmt = $db->prepare("INSERT INTO notification_log (schedule_id, inspector_name, email, status, error_message, notification_type) VALUES (?, ?, ?, 'failed', ?, 'followup_reminder')");
                $logStmt->execute([$item['id'], $item['inspector_name'], $item['email'], $e->getMessage()]);
            }
        }

        jsonResponse(true, ['sent' => $sent, 'failed' => $failed, 'overdueCount' => count($overdue), 'errors' => $errors],
            $sent > 0 ? "Sent $sent follow-up reminder(s)." : (count($overdue) > 0 ? "Overdue items found but all already notified or no email." : "No overdue compliance deadlines."));
    }

    errorResponse('Unknown action. Use ?action=status, ?action=send, ?action=send_compliance_alerts, ?action=send_followup_reminders');

} catch (PDOException $e) {
    error_log('notification_runner.php error: ' . $e->getMessage());
    errorResponse('Database error. Please try again.', 500);
}
?>
