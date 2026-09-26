<?php
require_once 'auth_check.php';
require_once 'risk_utils.php';
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
            $scored = [
                'totalScore'       => 85,
                'riskLevel'        => 'HIGH',
                'businessType'     => $sanitaryRecord['business_type'],
                'factors'          => [
                    'violations'    => ['score' => 0,  'max' => 25, 'label' => 'Previous Violations',        'count' => 0],
                    'timeSinceLast' => ['score' => 20, 'max' => 20, 'label' => 'Time Since Last Inspection', 'days'  => null],
                    'estabType'     => ['score' => 5,  'max' => 20, 'label' => 'Establishment Category'],
                    'compliance'    => ['score' => 10, 'max' => 20, 'label' => 'Compliance History',         'rate'  => null],
                    'followUp'      => ['score' => 0,  'max' => 15, 'label' => 'Pending Follow-up Actions',  'count' => 0],
                ],
                'recommendations'  => ['Never inspected — schedule initial inspection immediately.'],
                'totalInspections' => 0,
                'lastInspected'    => 'Never',
            ];
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
    try {
        $db->exec("CREATE TABLE IF NOT EXISTS risk_scores (
            id INT AUTO_INCREMENT PRIMARY KEY,
            establishment VARCHAR(255) NOT NULL,
            barangay VARCHAR(100),
            total_score INT NOT NULL,
            risk_level VARCHAR(20) NOT NULL,
            factor_violations INT DEFAULT 0,
            factor_time INT DEFAULT 0,
            factor_category INT DEFAULT 0,
            factor_compliance INT DEFAULT 0,
            factor_followup INT DEFAULT 0,
            recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_establishment (establishment),
            INDEX idx_recorded (recorded_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

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

    echo json_encode(['success' => true, 'data' => $results]);
} catch (PDOException $e) {
    error_log('predict.php error: ' . $e->getMessage());
    echo json_encode(['success' => false, 'message' => 'Prediction engine error. Please try again.']);
}
exit();
?>
