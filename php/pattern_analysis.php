<?php
require_once 'auth_check.php';
require_once 'risk_utils.php';

// ============================================================
// TayabasCare Pattern Analysis Engine (Objectives 2 & 5)
// Cross-establishment pattern identification, recurrence rates,
// violation patterns by category, and correlation analysis.
// ============================================================

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit(); }
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    errorResponse('Method not allowed. Use GET.', 405);
}

$action = $_GET['action'] ?? 'by_category';

try {
    // Common data loading
    $records = $db->query("SELECT * FROM sanitary_records ORDER BY created_at DESC")->fetchAll();
    $liveInspections = $db->query("SELECT * FROM inspection_reports ORDER BY report_date ASC")->fetchAll();
    $historyInspections = $db->query("SELECT * FROM inspection_history ORDER BY report_date ASC")->fetchAll();
    $allInspections = array_merge($liveInspections, $historyInspections);

    // Load violation categories
    $violationCategories = [];
    try {
        $catStmt = $db->query("SELECT code, label, risk_weight FROM violation_categories WHERE is_active = 1");
        $violationCategories = $catStmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (PDOException $e) {}

    $violationKeywords = [
        'PEST' => '/pest|infest|rodent|cockroach/i',
        'WASTE' => '/waste|garbage|disposal/i',
        'WATER' => '/water|sanitation|sanitary/i',
        'FOOD' => '/food handling|cross.contamination|hair restraint|gloves/i',
        'STRUCT' => '/crack|leak|repair|structural/i',
        'HYGIENE' => '/hygiene|uniform|apron|hair net/i',
        'DRAIN' => '/drainage|sewage|sewer/i',
        'CERT' => '/health certificate|medical certificate/i',
        'EXPIRED' => '/expired|stale/i',
        'CONTAM' => '/contaminat/i',
        'PERMIT' => '/no permit|permit.expired|unlicensed/i',
        'OTHER' => '/violation|failed|non.compliant|dirty|unsanitary|unsafe|improper|polluted/i'
    ];

    // matchEstablishment() is now defined in risk_utils.php

    // ---- action=by_category: Violation rates by FOOD vs NON-FOOD ----
    if ($action === 'by_category') {
        $categoryStats = [];
        $seen = [];

        foreach ($records as $record) {
            $name = $record['business_name'];
            if (isset($seen[$name])) continue;
            $seen[$name] = true;

            // Group as FOOD ESTABLISHMENT vs NON-FOOD ESTABLISHMENT
            $bizType = foodOrNonFoodLabel($record['business_type'] ?? '', $name);

            if (!isset($categoryStats[$bizType])) {
                $categoryStats[$bizType] = [
                    'category' => $bizType,
                    'totalEstablishments' => 0,
                    'totalInspections' => 0,
                    'totalViolations' => 0,
                    'totalComplied' => 0,
                    'avgRiskScore' => 0,
                    'riskScores' => []
                ];
            }
            $categoryStats[$bizType]['totalEstablishments']++;

            $myInspections = array_filter($allInspections, function($i) use ($name) {
                $estab = $i['establishment'] ?? $i['location'] ?? '';
                return matchEstablishment($estab, $name);
            });

            $inspCount = count($myInspections);
            $categoryStats[$bizType]['totalInspections'] += $inspCount;

            foreach ($myInspections as $insp) {
                $complied = isset($insp['complied']) ? (bool)$insp['complied'] : true;
                if ($complied) $categoryStats[$bizType]['totalComplied']++;

                $remarks = strtolower($insp['recommendation'] ?? '') . ' ' . strtolower($insp['remarks'] ?? '');
                foreach ($violationKeywords as $code => $pattern) {
                    if (preg_match($pattern, $remarks)) {
                        $categoryStats[$bizType]['totalViolations']++;
                        break;
                    }
                }
            }

            // Calculate risk score
            $sanitaryRecord = [
                'remarks' => $record['remarks'] ?? '',
                'result_xray' => $record['result_xray'] ?? null,
                'result_stool' => $record['result_stool'] ?? null,
                'business_type' => $record['business_type'] ?? 'Other',
            ];
            if ($inspCount > 0) {
                $scored = calculateRiskScore($name, array_values($myInspections), $sanitaryRecord);
                $categoryStats[$bizType]['riskScores'][] = $scored['totalScore'];
            }
        }

        // Compute averages
        $results = [];
        foreach ($categoryStats as $cat => $stats) {
            $avgRisk = !empty($stats['riskScores']) ? round(array_sum($stats['riskScores']) / count($stats['riskScores']), 1) : 0;
            $complianceRate = $stats['totalInspections'] > 0 ? round($stats['totalComplied'] / $stats['totalInspections'] * 100, 1) : 0;
            $violationRate = $stats['totalInspections'] > 0 ? round($stats['totalViolations'] / $stats['totalInspections'] * 100, 1) : 0;
            $results[] = [
                'category' => $stats['category'],
                'totalEstablishments' => $stats['totalEstablishments'],
                'totalInspections' => $stats['totalInspections'],
                'violationRate' => $violationRate,
                'complianceRate' => $complianceRate,
                'avgRiskScore' => $avgRisk,
                'totalViolations' => $stats['totalViolations']
            ];
        }
        usort($results, fn($a, $b) => $b['violationRate'] - $a['violationRate']);
        jsonResponse(true, $results);
    }

    // ---- action=by_barangay: Violation rates by barangay ----
    if ($action === 'by_barangay') {
        $barangayStats = [];
        $seen = [];

        foreach ($records as $record) {
            $name = $record['business_name'];
            if (isset($seen[$name])) continue;
            $seen[$name] = true;

            $brgy = $record['barangay'] ?? 'Unknown';
            if (empty($brgy)) $brgy = 'Unknown';

            if (!isset($barangayStats[$brgy])) {
                $barangayStats[$brgy] = [
                    'barangay' => $brgy,
                    'totalEstablishments' => 0,
                    'totalInspections' => 0,
                    'totalViolations' => 0,
                    'totalComplied' => 0,
                    'riskScores' => []
                ];
            }
            $barangayStats[$brgy]['totalEstablishments']++;

            $myInspections = array_filter($allInspections, function($i) use ($name) {
                $estab = $i['establishment'] ?? $i['location'] ?? '';
                return matchEstablishment($estab, $name);
            });

            $inspCount = count($myInspections);
            $barangayStats[$brgy]['totalInspections'] += $inspCount;

            foreach ($myInspections as $insp) {
                $complied = isset($insp['complied']) ? (bool)$insp['complied'] : true;
                if ($complied) $barangayStats[$brgy]['totalComplied']++;

                $remarks = strtolower($insp['recommendation'] ?? '') . ' ' . strtolower($insp['remarks'] ?? '');
                foreach ($violationKeywords as $code => $pattern) {
                    if (preg_match($pattern, $remarks)) {
                        $barangayStats[$brgy]['totalViolations']++;
                        break;
                    }
                }
            }

            $sanitaryRecord = [
                'remarks' => $record['remarks'] ?? '',
                'result_xray' => $record['result_xray'] ?? null,
                'result_stool' => $record['result_stool'] ?? null,
                'business_type' => $record['business_type'] ?? 'Other',
            ];
            if ($inspCount > 0) {
                $scored = calculateRiskScore($name, array_values($myInspections), $sanitaryRecord);
                $barangayStats[$brgy]['riskScores'][] = $scored['totalScore'];
            }
        }

        $results = [];
        foreach ($barangayStats as $brgy => $stats) {
            $avgRisk = !empty($stats['riskScores']) ? round(array_sum($stats['riskScores']) / count($stats['riskScores']), 1) : 0;
            $complianceRate = $stats['totalInspections'] > 0 ? round($stats['totalComplied'] / $stats['totalInspections'] * 100, 1) : 0;
            $results[] = [
                'barangay' => $stats['barangay'],
                'totalEstablishments' => $stats['totalEstablishments'],
                'totalInspections' => $stats['totalInspections'],
                'violationRate' => $stats['totalInspections'] > 0 ? round($stats['totalViolations'] / $stats['totalInspections'] * 100, 1) : 0,
                'complianceRate' => $complianceRate,
                'avgRiskScore' => $avgRisk,
                'totalViolations' => $stats['totalViolations']
            ];
        }
        usort($results, fn($a, $b) => $b['totalViolations'] - $a['totalViolations']);
        jsonResponse(true, $results);
    }

    // ---- action=recurrence: Violation recurrence rates per establishment ----
    if ($action === 'recurrence') {
        $seen = [];
        $results = [];

        foreach ($records as $record) {
            $name = $record['business_name'];
            if (isset($seen[$name])) continue;
            $seen[$name] = true;

            $myInspections = array_filter($allInspections, function($i) use ($name) {
                $estab = $i['establishment'] ?? $i['location'] ?? '';
                return matchEstablishment($estab, $name);
            });

            if (count($myInspections) < 2) continue;

            // Track violations by category across inspections in chronological order
            $sortedInspections = array_values($myInspections);
            usort($sortedInspections, function($a, $b) {
                $da = $a['report_date'] ?? $a['date'] ?? '';
                $dbVal = $b['report_date'] ?? $b['date'] ?? '';
                return strcmp($da, $dbVal);
            });

            $previousViolations = [];
            $recurrenceCount = 0;
            $totalViolations = 0;

            foreach ($sortedInspections as $insp) {
                $currentViolations = [];
                $remarks = strtolower($insp['recommendation'] ?? '') . ' ' . strtolower($insp['remarks'] ?? '');
                foreach ($violationKeywords as $code => $pattern) {
                    if (preg_match($pattern, $remarks)) {
                        $currentViolations[$code] = true;
                        $totalViolations++;
                    }
                }

                // Check if any current violation was in a previous inspection
                foreach ($currentViolations as $code => $_) {
                    if (isset($previousViolations[$code])) {
                        $recurrenceCount++;
                    }
                }

                $previousViolations = $currentViolations;
            }

            if ($totalViolations > 0) {
                $recurrenceRate = round($recurrenceCount / $totalViolations * 100, 1);
                $results[] = [
                    'establishment' => $name,
                    'barangay' => $record['barangay'] ?? '',
                    'totalInspections' => count($sortedInspections),
                    'totalViolations' => $totalViolations,
                    'recurrenceCount' => $recurrenceCount,
                    'recurrenceRate' => $recurrenceRate
                ];
            }
        }

        usort($results, fn($a, $b) => $b['recurrenceRate'] - $a['recurrenceRate']);
        jsonResponse(true, array_slice($results, 0, 50));
    }

    // ---- action=correlation: Category-violation correlation ----
    if ($action === 'correlation') {
        // Reuse by_category logic but return more detail
        $categoryStats = [];
        $seen = [];

        foreach ($records as $record) {
            $name = $record['business_name'];
            if (isset($seen[$name])) continue;
            $seen[$name] = true;

            $bizType = $record['business_type'] ?? 'Other';
            if (empty($bizType)) $bizType = 'Other';

            if (!isset($categoryStats[$bizType])) {
                $categoryStats[$bizType] = [
                    'category' => $bizType,
                    'count' => 0,
                    'totalViolations' => 0,
                    'totalComplied' => 0,
                    'totalInspections' => 0,
                    'violationTypes' => []
                ];
            }
            $categoryStats[$bizType]['count']++;

            $myInspections = array_filter($allInspections, function($i) use ($name) {
                $estab = $i['establishment'] ?? $i['location'] ?? '';
                return matchEstablishment($estab, $name);
            });

            foreach ($myInspections as $insp) {
                $categoryStats[$bizType]['totalInspections']++;
                $complied = isset($insp['complied']) ? (bool)$insp['complied'] : true;
                if ($complied) $categoryStats[$bizType]['totalComplied']++;

                $remarks = strtolower($insp['recommendation'] ?? '') . ' ' . strtolower($insp['remarks'] ?? '');
                foreach ($violationKeywords as $code => $pattern) {
                    if (preg_match($pattern, $remarks)) {
                        $categoryStats[$bizType]['totalViolations']++;
                        if (!isset($categoryStats[$bizType]['violationTypes'][$code])) {
                            $categoryStats[$bizType]['violationTypes'][$code] = 0;
                        }
                        $categoryStats[$bizType]['violationTypes'][$code]++;
                    }
                }
            }
        }

        $results = [];
        foreach ($categoryStats as $cat => $stats) {
            $avgViolations = $stats['count'] > 0 ? round($stats['totalViolations'] / $stats['count'], 2) : 0;
            $complianceRate = $stats['totalInspections'] > 0 ? round($stats['totalComplied'] / $stats['totalInspections'] * 100, 1) : 0;
            arsort($stats['violationTypes']);
            $results[] = [
                'category' => $stats['category'],
                'establishmentCount' => $stats['count'],
                'totalInspections' => $stats['totalInspections'],
                'avgViolationsPerEstablishment' => $avgViolations,
                'complianceRate' => $complianceRate,
                'topViolationTypes' => array_slice($stats['violationTypes'], 0, 5, true)
            ];
        }
        usort($results, fn($a, $b) => $b['avgViolationsPerEstablishment'] - $a['avgViolationsPerEstablishment']);
        jsonResponse(true, $results);
    }

    errorResponse('Unknown action. Valid: by_category, by_barangay, recurrence, correlation');

} catch (PDOException $e) {
    error_log('pattern_analysis.php error: ' . $e->getMessage());
    errorResponse('Database error. Please try again.', 500);
}
