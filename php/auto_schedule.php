<?php
require_once 'auth_check.php';
requireRole('admin');
require_once 'risk_utils.php';
require_once 'csrf.php';
// matchEstablishment() is now defined in risk_utils.php

// ============================================================
// TayabasCare Risk-Based Auto-Scheduling Engine
// Automatically generates inspection schedules for establishments
// based on their risk level and time since last inspection.
// ============================================================

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'OPTIONS') { http_response_code(200); exit(); }

if (csrfNeeded()) {
    requireCsrf();
}

// ---- GET: Preview auto-scheduling recommendations ----
if ($method === 'GET') {
    try {
        $recommendations = getRiskBasedRecommendations($db);
        jsonResponse(true, $recommendations);
    } catch (Exception $e) {
        error_log('auto_schedule.php error: ' . $e->getMessage());
        errorResponse('Failed to generate recommendations. Please try again.', 500);
    }
}

// ---- POST: Execute auto-scheduling ----
if ($method === 'POST') {
    try {
        $input = json_decode(file_get_contents('php://input'), true);
        $assignTo = trim($input['inspector'] ?? '');
        $startDate = trim($input['startDate'] ?? date('Y-m-d'));
        $maxPerDay = intval($input['maxPerDay'] ?? 3);

        if (!$startDate) $startDate = date('Y-m-d');

        $recommendations = getRiskBasedRecommendations($db);

        if (empty($recommendations)) {
            jsonResponse(true, ['scheduled' => 0], 'No establishments currently overdue for inspection.');
        }

        // Get available inspectors
        if ($assignTo) {
            $inspectorStmt = $db->prepare("SELECT full_name FROM inspector_accounts WHERE full_name = ?");
            $inspectorStmt->execute([$assignTo]);
            $inspectors = $inspectorStmt->fetchAll();
        } else {
            $inspectors = $db->query("SELECT full_name FROM inspector_accounts ORDER BY full_name")->fetchAll();
        }

        if (empty($inspectors)) {
            errorResponse('No inspectors available. Add inspector accounts first.', 400);
        }

        $scheduled = 0;
        $currentDate = new DateTime($startDate);

        foreach ($recommendations as $rec) {
            $inspectorIdx = $scheduled % count($inspectors);
            if ($scheduled > 0 && $scheduled % ($maxPerDay * count($inspectors)) === 0) {
                $currentDate->modify('+1 day');
                while (in_array($currentDate->format('N'), [6, 7])) {
                    $currentDate->modify('+1 day');
                }
            }

            $inspectorName = $assignTo ?: $inspectors[$inspectorIdx]['full_name'];
            $schedDate = $currentDate->format('Y-m-d');
            $notes = "Auto-scheduled ({$rec['riskLevel']}, score: {$rec['riskScore']}) — {$rec['reason']}";

            // Check if already scheduled (avoid duplicates)
            try {
                $check = $db->prepare("SELECT id FROM inspection_schedules WHERE establishment = ? AND schedDate >= ? AND done = 0 LIMIT 1");
                $check->execute([$rec['establishment'], date('Y-m-d')]);
                if ($check->fetch()) continue;
            } catch (PDOException $e) {
                // Table might not have establishment column yet
            }

            try {
                $stmt = $db->prepare("INSERT INTO inspection_schedules (inspector_name, establishment, risk_level, schedDate, notes) VALUES (?, ?, ?, ?, ?)");
                $stmt->execute([$inspectorName, $rec['establishment'], $rec['riskLevel'], $schedDate, $notes]);
            } catch (PDOException $e) {
                // Fallback to old schema
                $stmt = $db->prepare("INSERT INTO inspection_schedules (inspector_name, schedDate, notes) VALUES (?, ?, ?)");
                $stmt->execute([$inspectorName, $schedDate, $notes]);
            }
            $scheduled++;
        }

        jsonResponse(true, ['scheduled' => $scheduled], "{$scheduled} inspections auto-scheduled based on risk levels.");
    } catch (Exception $e) {
        error_log('auto_schedule.php error: ' . $e->getMessage());
        errorResponse('Auto-scheduling failed. Please try again.', 500);
    }
}

errorResponse('Method not allowed', 405);

// ============================================================
// RISK-BASED RECOMMENDATION ENGINE
// ============================================================
function getRiskBasedRecommendations($db) {
    $config = [];
    try {
        $cfgStmt = $db->query("SELECT * FROM risk_schedule_config");
        foreach ($cfgStmt->fetchAll() as $row) {
            $config[$row['risk_level']] = $row['inspection_interval_days'];
        }
    } catch (PDOException $e) {
        // Table doesn't exist yet — use defaults
    }
    $highInterval = $config['HIGH'] ?? 30;
    $modInterval = $config['MODERATE'] ?? 90;
    $lowInterval = $config['LOW'] ?? 180;

    $records = $db->query("SELECT * FROM sanitary_records ORDER BY created_at DESC")->fetchAll();
    $liveInspections = $db->query("SELECT * FROM inspection_reports ORDER BY report_date ASC")->fetchAll();
    $historyInspections = $db->query("SELECT * FROM inspection_history ORDER BY report_date ASC")->fetchAll();
    $allInspections = array_merge($liveInspections, $historyInspections);

    $today = new DateTime();
    $recommendations = [];
    $seen = [];

    foreach ($records as $record) {
        $name = $record['business_name'];
        if (isset($seen[$name])) continue;
        $seen[$name] = true;

        $myInspections = array_values(array_filter($allInspections, function($i) use ($name) {
            $estab = $i['establishment'] ?? $i['location'] ?? '';
            return matchEstablishment($estab, $name);
        }));

        $sanitaryRecord = [
            'remarks'       => $record['remarks'] ?? '',
            'result_xray'   => $record['result_xray'] ?? null,
            'result_stool'  => $record['result_stool'] ?? null,
            'business_type' => $record['business_type'] ?? 'Other',
        ];

        $scored = calculateRiskScore($name, $myInspections, $sanitaryRecord);
        $riskLevel = $scored['riskLevel'];
        $totalScore = $scored['totalScore'];
        $violationCount = $scored['factors']['violations']['count'] ?? 0;

        $interval = $riskLevel === 'HIGH' ? $highInterval : ($riskLevel === 'MODERATE' ? $modInterval : $lowInterval);

        $lastInspDate = null;
        foreach ($myInspections as $insp) {
            $d = $insp['date'] ?? $insp['report_date'] ?? null;
            if ($d) { try { $dt = new DateTime($d); if (!$lastInspDate || $dt > $lastInspDate) $lastInspDate = $dt; } catch(Exception $e) {} }
        }

        $daysSinceLastInspection = $lastInspDate ? (int)$today->diff($lastInspDate)->days : 9999;
        $isOverdue = $daysSinceLastInspection >= $interval;

        if ($isOverdue) {
            $reason = $lastInspDate
                ? "Last inspected {$daysSinceLastInspection} days ago (interval: {$interval}d for {$riskLevel})"
                : "Never inspected — requires initial inspection";

            $recommendations[] = [
                'establishment' => $name,
                'barangay' => $record['barangay'] ?? '',
                'riskLevel' => $riskLevel,
                'riskScore' => $totalScore,
                'lastInspected' => $lastInspDate ? $lastInspDate->format('M j, Y') : 'Never',
                'daysSinceLastInspection' => $daysSinceLastInspection,
                'requiredInterval' => $interval,
                'reason' => $reason,
                'violations' => $violationCount
            ];
        }
    }

    usort($recommendations, function($a, $b) {
        $levelOrder = ['HIGH' => 0, 'MODERATE' => 1, 'LOW' => 2];
        $la = $levelOrder[$a['riskLevel']] ?? 3;
        $lb = $levelOrder[$b['riskLevel']] ?? 3;
        if ($la !== $lb) return $la - $lb;
        return $b['riskScore'] - $a['riskScore'];
    });

    return $recommendations;
}
?>
