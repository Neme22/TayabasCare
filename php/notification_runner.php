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
                $mail->CharSet = 'UTF-8';
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
                    . "\n\nPlease prepare accordingly.\n\n- TayabasCare System";

                $mail->Subject = 'TayabasCare - Inspection Reminder for ' . $formattedDate;
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

    // ---- GET ?action=send_compliance_alerts: Email & notify inspectors about compliance alerts ----
    if ($action === 'send_compliance_alerts') {
        // GET-triggered write — require CSRF token
        requireCsrf();
        require_once __DIR__ . '/risk_utils.php';
        require_once __DIR__ . '/cluster_lib.php';
        require_once __DIR__ . '/inspector_notif_lib.php';

        $today = date('Y-m-d');
        $force = isset($_GET['force']) && $_GET['force'] === '1';

        if (!$force) {
            $stmt = $db->prepare("SELECT COUNT(*) as cnt FROM notification_log WHERE DATE(sent_at) = ? AND status = 'sent' AND notification_type = 'compliance_alert'");
            $stmt->execute([$today]);
            if ($stmt->fetch()['cnt'] > 0) {
                jsonResponse(true, ['sent' => 0, 'skipped' => true], 'Compliance alerts already sent today.');
            }
        }

        ensureClusterTables($db);
        $ownersMap = clusterOwners($db);
        $archivedIndex = getArchivedEstablishmentIndex($db);

        // Build lookup of real inspectors from inspector_accounts
        $inspRows = $db->query("SELECT full_name, username, email FROM inspector_accounts ORDER BY id ASC")->fetchAll(PDO::FETCH_ASSOC);
        $inspectorsByKey = [];
        foreach ($inspRows as $ir) {
            $full = trim((string)($ir['full_name'] ?? ''));
            $user = trim((string)($ir['username'] ?? ''));
            if ($full === '') continue;
            $entry = ['full_name' => $full, 'username' => $user, 'email' => trim((string)($ir['email'] ?? ''))];
            $inspectorsByKey[strtolower($full)] = $entry;
            if ($user !== '') $inspectorsByKey[strtolower($user)] = $entry;
            $first = strtolower(explode(' ', $full)[0] ?? '');
            if ($first !== '' && !isset($inspectorsByKey[$first])) $inspectorsByKey[$first] = $entry;
        }
        if (isset($inspectorsByKey['rizaldy a. ramos'])) {
            $inspectorsByKey['rizaldy'] = $inspectorsByKey['rizaldy a. ramos'];
            $inspectorsByKey['zaldy'] = $inspectorsByKey['rizaldy a. ramos'];
        }

        $records = $db->query("SELECT * FROM sanitary_records ORDER BY created_at DESC")->fetchAll(PDO::FETCH_ASSOC);
        $liveRaw = $db->query("SELECT * FROM inspection_reports ORDER BY report_date ASC")->fetchAll(PDO::FETCH_ASSOC);
        $histRaw = $db->query("SELECT * FROM inspection_history ORDER BY report_date ASC")->fetchAll(PDO::FETCH_ASSOC);

        $liveInspections = array_map(fn($r) => decryptRow('inspection_reports', $r), $liveRaw);
        $historyInspections = array_map(fn($r) => decryptRow('inspection_history', $r), $histRaw);
        $allInspections = array_merge($liveInspections, $historyInspections);

        $inspectorBuckets = [];
        $seen = [];

        foreach ($records as $record) {
            $record = decryptRow('sanitary_records', $record);
            $name = trim((string)($record['business_name'] ?? ''));
            $permit = trim((string)($record['permit_no'] ?? ''));
            $recId = (int)($record['id'] ?? 0);
            if ($name === '' || isEstablishmentArchived($name, $permit, $archivedIndex, $recId)) continue;
            if (isset($seen[strtolower($name)])) continue;
            $seen[strtolower($name)] = true;

            $myInspections = array_values(array_filter($allInspections, function ($i) use ($name) {
                $estab = $i['establishment'] ?? $i['location'] ?? '';
                return matchEstablishment($estab, $name);
            }));
            if (empty($myInspections)) continue;

            // Find latest live inspection report for deadline/complied check
            $liveMatches = array_values(array_filter($liveInspections, function ($i) use ($name) {
                return matchEstablishment($i['establishment'] ?? $i['location'] ?? '', $name);
            }));
            $latestLive = !empty($liveMatches) ? end($liveMatches) : null;

            $sanitaryRecord = [
                'remarks'       => $record['remarks'] ?? '',
                'result_xray'   => $record['result_xray'] ?? null,
                'result_stool'  => $record['result_stool'] ?? null,
                'business_type' => $record['business_type'] ?? 'Other',
            ];
            $scored = calculateRiskScore($name, $myInspections, $sanitaryRecord);

            $riskLevel = $scored['riskLevel'] ?? 'LOW';
            $merits = (int)($scored['merits'] ?? $scored['totalScore'] ?? 100);
            $openViolations = $scored['matchedViolations'] ?? [];
            $violationCount = (int)($scored['openViolationCount'] ?? count($openViolations));
            $latestNonComplied = $latestLive && empty($latestLive['complied']);

            if ($riskLevel !== 'HIGH' && $violationCount === 0 && !$latestNonComplied) {
                continue;
            }

            // Determine responsible inspector via barangay cluster first, else latest inspection inspector
            $barangay = trim((string)($record['barangay'] ?? ($latestLive['location'] ?? '')));
            $assignedEntry = null;
            if ($barangay !== '') {
                $clusterN = fixedClusterForBarangay($barangay, $db);
                if ($clusterN && !empty($ownersMap[$clusterN])) {
                    $assignedEntry = $inspectorsByKey[strtolower(trim($ownersMap[$clusterN]))] ?? null;
                }
            }
            if (!$assignedEntry && $latestLive && !empty($latestLive['inspector_name'])) {
                $cand = strtolower(trim((string)$latestLive['inspector_name']));
                if (!in_array($cand, ['admin', 'system', ''], true) && isset($inspectorsByKey[$cand])) {
                    $assignedEntry = $inspectorsByKey[$cand];
                }
            }
            if (!$assignedEntry) continue;

            $deadline = trim((string)($latestLive['compliance_deadline'] ?? ''));
            $overdueDays = 0;
            if ($deadline !== '' && $deadline < $today) {
                $overdueDays = (int)(new DateTime($today))->diff(new DateTime($deadline))->days;
            }

            $key = strtolower($assignedEntry['full_name']);
            if (!isset($inspectorBuckets[$key])) {
                $inspectorBuckets[$key] = ['inspector' => $assignedEntry, 'items' => []];
            }
            $inspectorBuckets[$key]['items'][] = [
                'name'          => $name,
                'barangay'      => $barangay !== '' ? $barangay : 'N/A',
                'riskLevel'     => $riskLevel,
                'merits'        => $merits,
                'openCount'     => $violationCount,
                'openLabels'    => array_column($openViolations, 'label'),
                'deadline'      => $deadline,
                'overdueDays'   => $overdueDays,
            ];
        }

        if (empty($inspectorBuckets)) {
            jsonResponse(true, ['sent' => 0, 'notifications' => 0], 'No open compliance alerts for inspectors right now.');
        }

        $emailsSent = 0;
        $emailsFailed = 0;
        $notifsCreated = 0;
        $errors = [];

        foreach ($inspectorBuckets as $bucket) {
            $insp = $bucket['inspector'];
            $items = $bucket['items'];
            $cnt = count($items);
            $highCnt = count(array_filter($items, fn($x) => $x['riskLevel'] === 'HIGH'));

            $namesPreview = implode(', ', array_slice(array_column($items, 'name'), 0, 3));
            if ($cnt > 3) $namesPreview .= ' +' . ($cnt - 3) . ' more';

            $notifTitle = $highCnt > 0
                ? "High-Risk & Compliance Alert ({$cnt})"
                : "Compliance Follow-Up Alert ({$cnt})";
            $notifMsg = "Establishments needing compliance action: {$namesPreview}. Please check email or Reports for details.";

            $nid = createInspectorNotification(
                $db,
                $insp['full_name'],
                'compliance_alert',
                '',
                $notifTitle,
                $notifMsg,
                $today
            );
            if ($nid) $notifsCreated++;

            if ($insp['email'] === '' || !filter_var($insp['email'], FILTER_VALIDATE_EMAIL)) {
                $emailsFailed++;
                $errors[] = "{$insp['full_name']}: No valid email configured";
                continue;
            }

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
                $mail->CharSet = 'UTF-8';
                $mail->addAddress($insp['email'], $insp['full_name']);
                $mail->Subject = 'TayabasCare - Compliance Alert (' . $cnt . ' Establishment' . ($cnt > 1 ? 's' : '') . ' · ' . date('M j, Y') . ')';

                $content = '<p style="margin:0 0 16px 0;">Dear <strong>' . htmlspecialchars($insp['full_name']) . '</strong>,</p>'
                    . '<p style="margin:0 0 20px 0;">The following establishment' . ($cnt > 1 ? 's in your assigned area require' : ' in your assigned area requires') . ' compliance attention or follow-up inspection:</p>'
                    . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">';

                $altLines = [];
                foreach ($items as $it) {
                    $statusParts = ["Risk: {$it['riskLevel']} ({$it['merits']}/100 merits)"];
                    if ($it['openCount'] > 0) {
                        $labels = !empty($it['openLabels']) ? ' — ' . implode(', ', array_slice($it['openLabels'], 0, 3)) : '';
                        $statusParts[] = "{$it['openCount']} open violation(s){$labels}";
                    }
                    if ($it['overdueDays'] > 0) {
                        $statusParts[] = "Overdue by {$it['overdueDays']} day(s) (Deadline: {$it['deadline']})";
                    } elseif ($it['deadline'] !== '') {
                        $statusParts[] = "Deadline: {$it['deadline']}";
                    }
                    $summaryText = "{$it['name']} (Brgy. {$it['barangay']}) — " . implode(' | ', $statusParts);
                    $content .= emailListItem($summaryText);
                    $altLines[] = "  - {$summaryText}";
                }
                $content .= '</table>'
                    . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;">'
                    . '<tr><td style="background-color:#fef2f2;border-left:4px solid #dc2626;border-radius:0 8px 8px 0;padding:12px 16px;font-size:14px;color:#991b1b;">'
                    . 'Please log in to <strong>TayabasCare</strong> to conduct follow-up or update compliance status.'
                    . '</td></tr></table>';

                $altBody = "Dear {$insp['full_name']},\n\n"
                    . "Establishments in your assigned area requiring compliance attention:\n\n"
                    . implode("\n", $altLines) . "\n\n"
                    . "Please log in to TayabasCare for full details.\n\n- TayabasCare System";

                $mail->isHTML(true);
                $mail->Body = renderEmailTemplate('Compliance Alert Notice', $content, '#dc2626');
                $mail->AltBody = $altBody;
                $mail->send();
                $emailsSent++;

                $logStmt = $db->prepare("INSERT INTO notification_log (inspector_name, email, status, notification_type) VALUES (?, ?, 'sent', 'compliance_alert')");
                $logStmt->execute([$insp['full_name'], $insp['email']]);
            } catch (Exception $e) {
                $emailsFailed++;
                $errMsg = $e->getMessage();
                $errors[] = "{$insp['full_name']}: {$errMsg}";
                $logStmt = $db->prepare("INSERT INTO notification_log (inspector_name, email, status, error_message, notification_type) VALUES (?, ?, 'failed', ?, 'compliance_alert')");
                $logStmt->execute([$insp['full_name'], $insp['email'], $errMsg]);
            }
        }

        $totalInsp = count($inspectorBuckets);
        $summaryMsg = "Sent compliance alerts to {$totalInsp} inspector(s) ({$emailsSent} email(s), {$notifsCreated} notification(s))" . ($emailsFailed > 0 ? ", {$emailsFailed} email failed" : '') . ".";
        jsonResponse(true, [
            'sent'               => $emailsSent,
            'failed'             => $emailsFailed,
            'notifications'      => $notifsCreated,
            'inspectorsNotified' => $totalInsp,
            'errors'             => $errors
        ], $summaryMsg);
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
                $mail->CharSet = 'UTF-8';
                $mail->addAddress($item['email'], $item['inspector_name']);
                $mail->Subject = 'TayabasCare - Overdue Compliance Follow-up';

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
                    . "Please follow up with the establishment and update the compliance status in TayabasCare.\n\n- TayabasCare System";

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
