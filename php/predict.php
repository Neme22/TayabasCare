<?php
require_once 'auth_check.php';
require_once 'risk_utils.php';
require_once 'csrf.php';
// matchEstablishment() is now defined in risk_utils.php

// ============================================================
// TAYABASCARE PRESCRIPTION ENGINE
// Based on PD 856 - Code on Sanitation of the Philippines
// Merit scoring: 100 start, -5 per open violation, LOW=100 / MOD=65-99 / HIGH<=64
// ============================================================

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit(); }

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method not allowed. Use GET.']);
    exit();
}

// Return risk scores for all establishments from MySQL sanitary_records
try {
    // Lazy migration: admin-only free-text remark on the Prescribe detail view
    try {
        $col = $db->query("SHOW COLUMNS FROM sanitary_records LIKE 'admin_risk_remarks'");
        if (!$col->fetch()) {
            $db->exec("ALTER TABLE sanitary_records ADD COLUMN admin_risk_remarks TEXT NULL AFTER remarks");
        }
    } catch (PDOException $e) {
        error_log('ensure admin_risk_remarks: ' . $e->getMessage());
    }

    $stmt = $db->query("SELECT * FROM sanitary_records ORDER BY created_at DESC");
    $records = $stmt->fetchAll();

    // Index all establishments currently in archive_data so they never appear in Prescription
    $archivedIndex = getArchivedEstablishmentIndex($db);

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
        $record = decryptRow('sanitary_records', $record);
        $name = trim($record['business_name'] ?? '');
        $permit = trim($record['permit_no'] ?? '');
        $recId = (int)($record['id'] ?? 0);

        // Omit any establishment or permit currently archived
        if (isEstablishmentArchived($name, $permit, $archivedIndex, $recId)) {
            continue;
        }

        if (isset($seen[$name])) continue;
        $seen[$name] = true;

        // Filter inspections for this establishment by location match
        $myInspections = array_filter($allInspections, function($i) use ($name) {
            $estab = $i['establishment'] ?? $i['location'] ?? '';
            return matchEstablishment($estab, $name);
        });

        // Establishments with no inspection reports: LOW (no open violations), schedule initial visit
        if (count($myInspections) === 0) {
            $sanitaryRecord = [
                'remarks'       => $record['remarks']        ?? '',
                'result_xray'   => $record['result_xray']    ?? null,
                'result_stool'  => $record['result_stool']   ?? null,
                'barangay'      => $record['barangay']       ?? '',
                'created_at'    => $record['created_at']     ?? '',
                'business_type' => $record['business_type']  ?? 'Other',
            ];
            // Score with empty history: violations=0, time=0 (never), category=computed, compliance=0 (unknown), followup=0
            $scored = calculateRiskScore($name, [], $sanitaryRecord);
            // Override to mark as never-inspected with recommendation
            $scored['recommendations'] = ['Never inspected — schedule initial inspection immediately.'];
            $scored['totalInspections'] = 0;
            $scored['lastInspected']    = 'Never';
            $scored['businessName']    = $name;
            $scored['barangay']        = $record['barangay'] ?? '';
            $scored['permitNo']        = $record['permit_no'] ?? '';
            $scored['inspectorRemarks'] = [];
            $scored['adminRiskRemarks'] = $record['admin_risk_remarks'] ?? null;
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
        $scored['adminRiskRemarks'] = $record['admin_risk_remarks'] ?? null;
        // Include actual inspector remarks/recommendations from submitted reports
        $inspectorRemarks = array_values(array_filter(array_map(function($i) {
            $rec     = trim($i['recommendation'] ?? '');
            $remarks = trim($i['remarks'] ?? '');
            return $rec ?: $remarks;
        }, array_values($myInspections))));
        $scored['inspectorRemarks'] = $inspectorRemarks;
        $results[] = $scored;
    }

    // Sort worst-first: HIGH → MODERATE → LOW, then lowest merits
    usort($results, fn($a, $b) =>
        (VIOLATION_SEVERITY_RANK[$b['riskLevel']] <=> VIOLATION_SEVERITY_RANK[$a['riskLevel']])
        ?: (($a['merits'] ?? $a['totalScore'] ?? 0) <=> ($b['merits'] ?? $b['totalScore'] ?? 0)));

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
                $logStmt->execute([
                    $r['businessName'] ?? '',
                    $r['barangay'] ?? '',
                    $r['merits'] ?? $r['totalScore'] ?? 0,
                    $r['riskLevel'] ?? 'LOW',
                    $r['demerits'] ?? 0,
                    0, 0, 0, 0
                ]);
            }
        }
    } catch (PDOException $e) {
        // Logging is best-effort — don't fail the prediction
    }
    }

    // Admin-only remark must not ship to inspector sessions
    $isAdmin = (($_SESSION['role'] ?? '') === 'admin');
    if (!$isAdmin) {
        foreach ($results as &$r) {
            unset($r['adminRiskRemarks']);
        }
        unset($r);
    }

    echo json_encode(['success' => true, 'data' => $results, 'message' => ''], JSON_INVALID_UTF8_SUBSTITUTE | JSON_UNESCAPED_UNICODE);
} catch (PDOException $e) {
    error_log('predict.php error: ' . $e->getMessage());
    echo json_encode(['success' => false, 'data' => null, 'message' => 'Prescription engine error. Please try again.']);
}
exit();
