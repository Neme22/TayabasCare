<?php
require_once 'auth_check.php';
require_once 'risk_utils.php';
require_once 'csrf.php';
// matchEstablishment() is now defined in risk_utils.php

// ============================================================
// TAYABASCARE VIOLATION PREDICTION ENGINE
// Based on PD 856 - Code on Sanitation of the Philippines
// 5-Factor Risk Scoring Formula (per thesis objectives)
// ============================================================

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit(); }

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method not allowed. Use GET.']);
    exit();
}

// Return risk scores for all establishments from MySQL sanitary_records
try {
    $stmt = $db->query("SELECT * FROM sanitary_records ORDER BY created_at DESC");
    $records = $stmt->fetchAll();

    // Get all inspection reports from DB
    $inspStmt = $db->query("SELECT * FROM inspection_reports ORDER BY report_date ASC");
    $liveInspections = $inspStmt->fetchAll();

    // Also get archived inspection history — without this, only the single
    // "current" row per establishment gets counted, undercounting real violations
    $histStmt = $db->query("SELECT * FROM inspection_history ORDER BY report_date ASC");
    $historyInspections = $histStmt->fetchAll();

    $allInspections = array_merge($liveInspections, $historyInspections);

    $results = [];
    $seen = [];

    foreach ($records as $record) {
        $name = $record['business_name'];
        if (isset($seen[$name])) continue;
        $seen[$name] = true;

        // Filter inspections for this establishment by location match
        $myInspections = array_filter($allInspections, function($i) use ($name) {
            $estab = $i['establishment'] ?? $i['location'] ?? '';
            return matchEstablishment($estab, $name);
        });

        // Establishments with no inspection reports get maximum risk (never inspected)
        if (count($myInspections) === 0) {
            $sanitaryRecord = [
                'remarks'       => $record['remarks']        ?? '',
                'result_xray'   => $record['result_xray']    ?? null,
                'result_stool'  => $record['result_stool']   ?? null,
                'barangay'      => $record['barangay']       ?? '',
                'created_at'    => $record['created_at']     ?? '',
                'business_type' => $record['business_type']  ?? 'Other',
            ];
            // Score honestly: violations=0, time=20 (never), category=computed, compliance=10 (unknown), followup=0
            $scored = calculateRiskScore($name, [], $sanitaryRecord);
            // Override to mark as never-inspected with recommendation
            $scored['recommendations'] = ['Never inspected — schedule initial inspection immediately.'];
            $scored['totalInspections'] = 0;
            $scored['lastInspected']    = 'Never';
            $scored['businessName']    = $name;
            $scored['barangay']        = $record['barangay'] ?? '';
            $scored['permitNo']        = $record['permit_no'] ?? '';
            $scored['inspectorRemarks'] = [];
            $results[] = $scored;
            continue;
        }

        $sanitaryRecord = [
            'remarks'       => $record['remarks']        ?? '',
            'result_xray'   => $record['result_xray']    ?? null,
            'result_stool'  => $record['result_stool']   ?? null,
            'barangay'      => $record['barangay']       ?? '',
            'created_at'    => $record['created_at']     ?? '',
            'business_type' => $record['business_type']  ?? 'Other',
        ];

        $scored = calculateRiskScore($name, array_values($myInspections), $sanitaryRecord);
        $scored['businessName'] = $name;
        $scored['barangay']     = $record['barangay'] ?? '';
        $scored['permitNo']     = $record['permit_no'] ?? '';
        // Include actual inspector remarks/recommendations from submitted reports
        $inspectorRemarks = array_values(array_filter(array_map(function($i) {
            $rec     = trim($i['recommendation'] ?? '');
            $remarks = trim($i['remarks'] ?? '');
            return $rec ?: $remarks;
        }, array_values($myInspections))));
        $scored['inspectorRemarks'] = $inspectorRemarks;
        $results[] = $scored;
    }

    // Sort by score descending (highest risk first)
    usort($results, fn($a, $b) => $b['totalScore'] - $a['totalScore']);

    // Log risk scores to history table (create table if needed)
    // CSRF required for this GET-side write — skip logging if token is absent
    if (validateCsrf()) {
    try {
        // Only log if last log was > 5 minutes ago (better trend granularity)
        $lastLog = $db->query("SELECT MAX(recorded_at) as last FROM risk_scores")->fetch();
        $shouldLog = !$lastLog['last'] || (time() - strtotime($lastLog['last'])) > 300;

        if ($shouldLog) {
            $logStmt = $db->prepare("
                INSERT INTO risk_scores (establishment, barangay, total_score, risk_level,
                    factor_violations, factor_time, factor_category, factor_compliance, factor_followup)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ");
            foreach ($results as $r) {
                $factors = $r['factors'] ?? [];
                $logStmt->execute([
                    $r['businessName'] ?? '',
                    $r['barangay'] ?? '',
                    $r['totalScore'] ?? 0,
                    $r['riskLevel'] ?? 'LOW',
                    $factors['violations']['score'] ?? 0,
                    $factors['timeSinceLast']['score'] ?? 0,
                    $factors['estabType']['score'] ?? 0,
                    $factors['compliance']['score'] ?? 0,
                    $factors['followUp']['score'] ?? 0
                ]);
            }
        }
    } catch (PDOException $e) {
        // Logging is best-effort — don't fail the prediction
    }
    }

    echo json_encode(['success' => true, 'data' => $results, 'message' => ''], JSON_INVALID_UTF8_SUBSTITUTE | JSON_UNESCAPED_UNICODE);
} catch (PDOException $e) {
    error_log('predict.php error: ' . $e->getMessage());
    echo json_encode(['success' => false, 'data' => null, 'message' => 'Prediction engine error. Please try again.']);
}
exit();
?>
