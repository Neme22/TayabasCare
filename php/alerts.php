<?php
require_once 'auth_check.php';
require_once 'risk_utils.php';
require_once 'csrf.php';
// matchEstablishment() is now defined in risk_utils.php

// ============================================================
// TayabasCare Alerts & Notification System
// Generates alerts for: violation thresholds, overdue follow-ups,
// high-risk establishments, and schedule reminders.
// ============================================================

$method = $_SERVER['REQUEST_METHOD'];

if (csrfNeeded()) {
    requireCsrf();
}

// ---- GET: Fetch alerts ----
if ($method === 'GET') {
    $action = $_GET['action'] ?? 'list';

    if ($action === 'list') {
        try {
            $unreadOnly = isset($_GET['unread']) && $_GET['unread'] === '1';
            $sql = "SELECT * FROM alerts WHERE dismissed = 0";
            if ($unreadOnly) $sql .= " AND is_read = 0";
            $sql .= " ORDER BY severity DESC, created_at DESC LIMIT 100";
            $stmt = $db->query($sql);
            jsonResponse(true, $stmt->fetchAll());
        } catch (PDOException $e) {
            // alerts table may not exist yet — return empty
            jsonResponse(true, []);
        }
    }

    if ($action === 'count') {
        try {
            $stmt = $db->query("SELECT COUNT(*) as unread FROM alerts WHERE dismissed = 0 AND is_read = 0");
            jsonResponse(true, ['unread' => $stmt->fetch()['unread']]);
        } catch (PDOException $e) {
            jsonResponse(true, ['unread' => 0]);
        }
    }

    if ($action === 'generate') {
        // GET-triggered write — require CSRF token
        requireCsrf();
        try {
            generateAlerts($db);
            jsonResponse(true, null, 'Alerts generated successfully.');
        } catch (PDOException $e) {
            error_log('alerts.php error: ' . $e->getMessage());
            errorResponse('Failed to generate alerts. Please try again.', 500);
        }
    }

    errorResponse('Unknown action: ' . $action);
}

// ---- PUT: Mark as read or dismissed ----
if ($method === 'PUT') {
    try {
        $input = json_decode(file_get_contents('php://input'), true);
        $id = intval($input['id'] ?? 0);
        $action = $input['action'] ?? '';

        if (!$id) errorResponse('Alert ID required');

        if ($action === 'read') {
            $db->prepare("UPDATE alerts SET is_read = 1 WHERE id = ?")->execute([$id]);
            jsonResponse(true, null, 'Marked as read.');
        }

        if ($action === 'dismiss') {
            $db->prepare("UPDATE alerts SET dismissed = 1 WHERE id = ?")->execute([$id]);
            jsonResponse(true, null, 'Alert dismissed.');
        }

        if ($action === 'read_all') {
            $db->exec("UPDATE alerts SET is_read = 1 WHERE dismissed = 0");
            jsonResponse(true, null, 'All alerts marked as read.');
        }

        errorResponse('Unknown action: ' . $action);
    } catch (PDOException $e) {
        error_log('alerts.php error: ' . $e->getMessage());
        errorResponse('Database error. Please try again.', 500);
    }
}

// ---- DELETE: Clear dismissed alerts ----
if ($method === 'DELETE') {
    try {
        $db->exec("DELETE FROM alerts WHERE dismissed = 1");
        jsonResponse(true, null, 'Dismissed alerts cleared.');
    } catch (PDOException $e) {
        error_log('alerts.php error: ' . $e->getMessage());
        errorResponse('Database error. Please try again.', 500);
    }
}

errorResponse('Method not allowed', 405);

// ============================================================
// ALERT GENERATION ENGINE
// ============================================================
function generateAlerts($db) {
    // Only regenerate if last generation was > 2 minutes ago
    $stmt = $db->query("SELECT MAX(created_at) as last_gen FROM alerts");
    $lastGen = $stmt->fetch()['last_gen'];
    if ($lastGen) {
        $minutesSince = (time() - strtotime($lastGen)) / 60;
        if ($minutesSince < 2) return;
    }

    // Ensure fingerprint column exists (migration for existing DBs)
    try {
        $db->exec("ALTER TABLE alerts ADD COLUMN fingerprint VARCHAR(255) DEFAULT NULL");
    } catch (PDOException $e) {
        // Column already exists — continue
    }
    // MySQL doesn't support CREATE INDEX IF NOT EXISTS — check information_schema first
    $idxCheck = $db->query("SELECT COUNT(*) as cnt FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alerts' AND INDEX_NAME = 'idx_fingerprint'");
    if ((int)$idxCheck->fetch()['cnt'] === 0) {
        // Clean up duplicate fingerprints before creating unique index
        $db->exec("DELETE a1 FROM alerts a1 INNER JOIN alerts a2 WHERE a1.id > a2.id AND a1.fingerprint = a2.fingerprint AND a1.fingerprint IS NOT NULL");
        try { $db->exec("CREATE UNIQUE INDEX idx_fingerprint ON alerts (fingerprint)"); } catch (PDOException $e) {}
    }

    // Get fingerprints of dismissed alerts so we don't recreate them
    $dismissedStmt = $db->query("SELECT fingerprint FROM alerts WHERE dismissed = 1 AND fingerprint IS NOT NULL");
    $dismissedFingerprints = [];
    foreach ($dismissedStmt->fetchAll() as $row) {
        $dismissedFingerprints[$row['fingerprint']] = true;
    }

    // Clean up old dismissed alerts (older than 7 days)
    $db->exec("DELETE FROM alerts WHERE dismissed = 1 AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)");

    // Generate new alerts into a buffer
    $tempAlerts = [];

    generateViolationThresholdAlerts($db, $tempAlerts);
    generateOverdueFollowupAlerts($db, $tempAlerts);
    generateHighRiskAlerts($db, $tempAlerts);
    generateScheduleReminderAlerts($db, $tempAlerts);

    // Build a fingerprint for each new alert
    foreach ($tempAlerts as &$alert) {
        $alert['fingerprint'] = $alert['alert_type'] . ':' . ($alert['establishment'] ?? '');
    }
    unset($alert);

    // Remove alerts that were previously dismissed
    $tempAlerts = array_filter($tempAlerts, function($a) use ($dismissedFingerprints) {
        return !isset($dismissedFingerprints[$a['fingerprint']]);
    });

    // Get fingerprints of currently active (non-dismissed) alerts
    $activeStmt = $db->query("SELECT fingerprint FROM alerts WHERE dismissed = 0 AND fingerprint IS NOT NULL");
    $activeFingerprints = [];
    foreach ($activeStmt->fetchAll() as $row) {
        $activeFingerprints[$row['fingerprint']] = true;
    }

    // Insert only NEW alerts (not already active, not dismissed)
    $stmt = $db->prepare("INSERT IGNORE INTO alerts (alert_type, establishment, barangay, message, severity, risk_score, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?)");
    foreach ($tempAlerts as $alert) {
        if (isset($activeFingerprints[$alert['fingerprint']])) continue;
        $stmt->execute([
            $alert['alert_type'],
            $alert['establishment'] ?? '',
            $alert['barangay'] ?? '',
            $alert['message'],
            $alert['severity'] ?? 'warning',
            $alert['risk_score'] ?? 0,
            $alert['fingerprint']
        ]);
    }

    // Remove active alerts that are no longer relevant (e.g., establishment was fixed)
    $currentFingerprints = array_column($tempAlerts, 'fingerprint');
    if (!empty($currentFingerprints)) {
        $placeholders = implode(',', array_fill(0, count($currentFingerprints), '?'));
        $db->prepare("DELETE FROM alerts WHERE dismissed = 0 AND fingerprint IS NOT NULL AND fingerprint NOT IN ($placeholders)")
           ->execute($currentFingerprints);
    }
}

// ---- Violation Threshold Alerts ----
function generateViolationThresholdAlerts($db, &$alerts) {
    $VIOLATION_THRESHOLD = 3;

    $records = $db->query("SELECT * FROM sanitary_records ORDER BY created_at DESC")->fetchAll();
    $liveInspections = $db->query("SELECT * FROM inspection_reports ORDER BY report_date ASC")->fetchAll();
    $historyInspections = $db->query("SELECT * FROM inspection_history ORDER BY report_date ASC")->fetchAll();
    $allInspections = array_merge($liveInspections, $historyInspections);

    $violationKeywords = ['violation', 'failed', 'non-compliant', 'dirty', 'unsanitary',
                          'pest', 'contaminated', 'sewage', 'unsafe', 'expired', 'no permit',
                          'improper', 'garbage', 'waste', 'polluted', 'infest'];
    $pattern = '/\b(' . implode('|', array_map('preg_quote', $violationKeywords)) . ')\b/i';

    $seen = [];
    foreach ($records as $record) {
        $name = $record['business_name'];
        if (isset($seen[$name])) continue;
        $seen[$name] = true;

        $myInspections = array_filter($allInspections, function($i) use ($name) {
            $estab = $i['establishment'] ?? $i['location'] ?? '';
            return matchEstablishment($estab, $name);
        });

        $violationCount = 0;
        foreach ($myInspections as $insp) {
            $complied = isset($insp['complied']) ? (bool)$insp['complied'] : true;
            $remarks = strtolower($insp['recommendation'] ?? '') . ' ' . strtolower($insp['status'] ?? '');
            if (!$complied || preg_match($pattern, $remarks)) $violationCount++;
        }

        $sanRemarks = strtolower($record['remarks'] ?? '');
        if ($sanRemarks && preg_match($pattern, $sanRemarks)) $violationCount++;

        if ($violationCount >= $VIOLATION_THRESHOLD) {
            $severity = $violationCount >= 5 ? 'critical' : 'warning';
            $alerts[] = [
                'alert_type' => 'violation_threshold',
                'establishment' => $name,
                'barangay' => $record['barangay'] ?? '',
                'message' => "{$name} has {$violationCount} unresolved sanitary violations requiring immediate corrective action and re-inspection.",
                'severity' => $severity,
                'risk_score' => 0
            ];
        }
    }
}

// ---- Overdue Follow-up Alerts ----
function generateOverdueFollowupAlerts($db, &$alerts) {
    $OVERDUE_DAYS = 14;
    $cutoff = date('Y-m-d', strtotime("-{$OVERDUE_DAYS} days"));

    $stmt = $db->prepare("
        SELECT * FROM inspection_reports
        WHERE LOWER(status) IN ('pending', 'for follow-up')
        AND report_date < ?
    ");
    $stmt->execute([$cutoff]);
    $overdue = $stmt->fetchAll();

    foreach ($overdue as $item) {
        $daysOverdue = (int)(new DateTime())->diff(new DateTime($item['report_date']))->days;
        $alerts[] = [
            'alert_type' => 'overdue_followup',
            'establishment' => $item['establishment'] ?? 'Unknown',
            'barangay' => '',
            'message' => "Follow-up inspection for \"{$item['establishment']}\" is {$daysOverdue} day(s) past due. Assigned inspector: {$item['inspector_name']}. Please verify compliance status.",
            'severity' => 'warning',
            'risk_score' => 0
        ];
    }

    $stmt = $db->prepare("
        SELECT * FROM inspection_history
        WHERE LOWER(status) IN ('pending', 'for follow-up')
        AND report_date < ?
    ");
    $stmt->execute([$cutoff]);
    $overdueHistory = $stmt->fetchAll();

    foreach ($overdueHistory as $item) {
        $daysOverdue = (int)(new DateTime())->diff(new DateTime($item['report_date']))->days;
        $alerts[] = [
            'alert_type' => 'overdue_followup',
            'establishment' => $item['establishment'] ?? 'Unknown',
            'barangay' => '',
            'message' => "Archived follow-up for \"{$item['establishment']}\" remains unresolved after {$daysOverdue} day(s). Recommend scheduling a re-inspection.",
            'severity' => 'info',
            'risk_score' => 0
        ];
    }
}

// ---- High-Risk Establishment Alerts ----
function generateHighRiskAlerts($db, &$alerts) {
    $records = $db->query("SELECT * FROM sanitary_records ORDER BY created_at DESC")->fetchAll();
    $liveInspections = $db->query("SELECT * FROM inspection_reports ORDER BY report_date ASC")->fetchAll();
    $historyInspections = $db->query("SELECT * FROM inspection_history ORDER BY report_date ASC")->fetchAll();
    $allInspections = array_merge($liveInspections, $historyInspections);

    $seen = [];
    foreach ($records as $record) {
        $name = $record['business_name'];
        if (isset($seen[$name])) continue;
        $seen[$name] = true;

        $myInspections = array_values(array_filter($allInspections, function($i) use ($name) {
            $estab = $i['establishment'] ?? $i['location'] ?? '';
            return matchEstablishment($estab, $name);
        }));

        if (count($myInspections) === 0) continue;

        $sanitaryRecord = [
            'remarks'       => $record['remarks'] ?? '',
            'result_xray'   => $record['result_xray'] ?? null,
            'result_stool'  => $record['result_stool'] ?? null,
            'business_type' => $record['business_type'] ?? 'Other',
        ];

        $scored = calculateRiskScore($name, $myInspections, $sanitaryRecord);

        if ($scored['totalScore'] >= 60) {
            $complianceRate = $scored['factors']['compliance']['rate'] ?? 'N/A';
            $violationCount = $scored['factors']['violations']['count'] ?? 0;
            $alerts[] = [
                'alert_type' => 'high_risk',
                'establishment' => $name,
                'barangay' => $record['barangay'] ?? '',
                'message' => "{$name} has been classified as HIGH RISK (Score: {$scored['totalScore']}/100). {$violationCount} violation(s) on record with {$complianceRate}% compliance rate. Priority inspection is strongly recommended.",
                'severity' => 'critical',
                'risk_score' => $scored['totalScore']
            ];
        }
    }
}

// ---- Schedule Reminder Alerts ----
function generateScheduleReminderAlerts($db, &$alerts) {
    try {
        $today = date('Y-m-d');
        $threeDays = date('Y-m-d', strtotime('+3 days'));

        $stmt = $db->prepare("
            SELECT * FROM inspection_schedules
            WHERE schedDate BETWEEN ? AND ? AND done = 0
            ORDER BY schedDate ASC
        ");
        $stmt->execute([$today, $threeDays]);
        $upcoming = $stmt->fetchAll();

        foreach ($upcoming as $sched) {
            $daysUntil = (int)(new DateTime($sched['schedDate']))->diff(new DateTime())->days;
            $label = $daysUntil === 0 ? 'TODAY' : ($daysUntil === 1 ? 'tomorrow' : "in {$daysUntil} days");
            $severity = $daysUntil === 0 ? 'critical' : ($daysUntil === 1 ? 'warning' : 'info');
            $alerts[] = [
                'alert_type' => 'schedule_reminder',
                'establishment' => $sched['inspector_name'],
                'barangay' => '',
                'message' => "Inspection duty scheduled {$label} — Inspector: {$sched['inspector_name']}" . ($sched['establishment'] ? " for {$sched['establishment']}" : '') . ($sched['notes'] ? ". Notes: {$sched['notes']}" : ''),
                'severity' => $severity,
                'risk_score' => 0
            ];
        }
    } catch (PDOException $e) {
        // Table may not exist or have different schema
    }
}
?>
