<?php
require_once 'auth_check.php';

// ============================================================
// TayabasCare Statistics & Year-over-Year Analysis (Objective 2)
// Aggregate statistics, percentiles, YoY comparison, violation trends
// ============================================================

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit(); }
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    errorResponse('Method not allowed. Use GET.', 405);
}

$action = $_GET['action'] ?? 'summary';

try {
    // ---- action=summary: Overall statistics ----
    if ($action === 'summary') {
        // Risk score statistics from risk_scores table
        $riskStats = ['mean' => 0, 'median' => 0, 'stddev' => 0, 'min' => 0, 'max' => 0, 'count' => 0];
        try {
            $stmt = $db->query("
                SELECT
                    AVG(total_score) as mean_score,
                    MIN(total_score) as min_score,
                    MAX(total_score) as max_score,
                    COUNT(*) as total,
                    STDDEV(total_score) as stddev_score
                FROM risk_scores
                WHERE recorded_at = (SELECT MAX(recorded_at) FROM risk_scores)
            ");
            $row = $stmt->fetch();
            if ($row && $row['total'] > 0) {
                $riskStats['mean'] = round((float)$row['mean_score'], 1);
                $riskStats['min'] = (int)$row['min_score'];
                $riskStats['max'] = (int)$row['max_score'];
                $riskStats['count'] = (int)$row['total'];
                $riskStats['stddev'] = round((float)$row['stddev_score'], 1);

                // Median
                $offsetMid = (int)floor($row['total'] / 2);
                $midStmt = $db->prepare("SELECT total_score FROM risk_scores WHERE recorded_at = (SELECT MAX(recorded_at) FROM risk_scores) ORDER BY total_score LIMIT 1 OFFSET ?");
                $midStmt->execute([$offsetMid]);
                $mid = $midStmt->fetch();
                $riskStats['median'] = $mid ? (int)$mid['total_score'] : 0;

                // Percentiles
                $offsetP25 = (int)floor($row['total'] * 0.25);
                $p25Stmt = $db->prepare("SELECT total_score FROM risk_scores WHERE recorded_at = (SELECT MAX(recorded_at) FROM risk_scores) ORDER BY total_score LIMIT 1 OFFSET ?");
                $p25Stmt->execute([$offsetP25]);
                $p25 = $p25Stmt->fetch();

                $offsetP75 = (int)floor($row['total'] * 0.75);
                $p75Stmt = $db->prepare("SELECT total_score FROM risk_scores WHERE recorded_at = (SELECT MAX(recorded_at) FROM risk_scores) ORDER BY total_score LIMIT 1 OFFSET ?");
                $p75Stmt->execute([$offsetP75]);
                $p75 = $p75Stmt->fetch();
                $riskStats['p25'] = $p25 ? (int)$p25['total_score'] : 0;
                $riskStats['p75'] = $p75 ? (int)$p75['total_score'] : 0;
            }
        } catch (PDOException $e) {}

        // Risk distribution
        $distribution = ['HIGH' => 0, 'MODERATE' => 0, 'LOW' => 0];
        try {
            $distStmt = $db->query("
                SELECT risk_level, COUNT(*) as cnt FROM risk_scores
                WHERE recorded_at = (SELECT MAX(recorded_at) FROM risk_scores)
                GROUP BY risk_level
            ");
            foreach ($distStmt->fetchAll() as $row) {
                $distribution[$row['risk_level']] = (int)$row['cnt'];
            }
        } catch (PDOException $e) {}

        // Total inspections (current + history)
        $totalInsp = 0;
        try {
            $r1 = $db->query("SELECT COUNT(*) as c FROM inspection_reports")->fetch();
            $r2 = $db->query("SELECT COUNT(*) as c FROM inspection_history")->fetch();
            $totalInsp = (int)$r1['c'] + (int)$r2['c'];
        } catch (PDOException $e) {}

        // Total establishments
        $totalEstab = 0;
        try {
            $r = $db->query("SELECT COUNT(*) as c FROM sanitary_records")->fetch();
            $totalEstab = (int)$r['c'];
        } catch (PDOException $e) {}

        // Compliance rate
        $complianceRate = 0;
        try {
            $r = $db->query("SELECT COUNT(*) as total, SUM(CASE WHEN complied = 1 THEN 1 ELSE 0 END) as comp FROM inspection_reports")->fetch();
            $complianceRate = $r['total'] > 0 ? round($r['comp'] / $r['total'] * 100, 1) : 0;
        } catch (PDOException $e) {}

        jsonResponse(true, [
            'riskScoreStats' => $riskStats,
            'riskDistribution' => $distribution,
            'totalEstablishments' => $totalEstab,
            'totalInspections' => $totalInsp,
            'complianceRate' => $complianceRate
        ]);
    }

    // ---- action=year_over_year: Compare metrics across years ----
    if ($action === 'year_over_year') {
        $year1 = intval($_GET['year1'] ?? (date('Y') - 1));
        $year2 = intval($_GET['year2'] ?? date('Y'));

        $results = [];
        foreach ([$year1, $year2] as $year) {
            $from = "$year-01-01";
            $to = "$year-12-31 23:59:59";

            // Inspections count (current + history)
            $stmt = $db->prepare("SELECT COUNT(*) as c FROM inspection_reports WHERE report_date BETWEEN ? AND ?");
            $stmt->execute([$from, $to]);
            $inspCount = (int)$stmt->fetch()['c'];
            $stmt = $db->prepare("SELECT COUNT(*) as c FROM inspection_history WHERE report_date BETWEEN ? AND ?");
            $stmt->execute([$from, $to]);
            $inspCount += (int)$stmt->fetch()['c'];

            // Compliance rate
            $stmt = $db->prepare("SELECT COUNT(*) as total, SUM(CASE WHEN complied = 1 THEN 1 ELSE 0 END) as comp FROM inspection_reports WHERE report_date BETWEEN ? AND ?");
            $stmt->execute([$from, $to]);
            $compData = $stmt->fetch();
            $compRate = $compData['total'] > 0 ? round($compData['comp'] / $compData['total'] * 100, 1) : 0;

            // Violation count (keyword-based)
            $violationKeywords = ['violation', 'failed', 'non-compliant', 'dirty', 'unsanitary',
                                  'pest', 'contaminated', 'sewage', 'unsafe', 'expired', 'no permit',
                                  'improper', 'garbage', 'waste', 'polluted', 'infest'];
            $pattern = '/\b(' . implode('|', array_map('preg_quote', $violationKeywords)) . ')\b/i';

            $stmt = $db->prepare("SELECT recommendation, remarks, complied FROM inspection_reports WHERE report_date BETWEEN ? AND ?");
            $stmt->execute([$from, $to]);
            $allRemarks = $stmt->fetchAll();
            $stmt = $db->prepare("SELECT recommendation, remarks, complied FROM inspection_history WHERE report_date BETWEEN ? AND ?");
            $stmt->execute([$from, $to]);
            $allRemarks = array_merge($allRemarks, $stmt->fetchAll());

            $violationCount = 0;
            foreach ($allRemarks as $r) {
                $text = strtolower(($r['recommendation'] ?? '') . ' ' . ($r['remarks'] ?? ''));
                $complied = isset($r['complied']) ? (bool)$r['complied'] : true;
                if (!$complied || preg_match($pattern, $text)) $violationCount++;
            }

            // Monthly breakdown
            $stmt = $db->prepare("SELECT DATE_FORMAT(report_date, '%m') as month, COUNT(*) as cnt
                FROM inspection_reports WHERE report_date BETWEEN ? AND ?
                GROUP BY DATE_FORMAT(report_date, '%m') ORDER BY month");
            $stmt->execute([$from, $to]);
            $monthly = [];
            foreach ($stmt->fetchAll() as $row) {
                $monthly[$row['month']] = (int)$row['cnt'];
            }

            $results[$year] = [
                'year' => $year,
                'totalInspections' => $inspCount,
                'complianceRate' => $compRate,
                'totalViolations' => $violationCount,
                'monthlyBreakdown' => $monthly
            ];
        }

        // Compute changes
        $changes = [];
        foreach (['totalInspections', 'complianceRate', 'totalViolations'] as $metric) {
            $v1 = $results[$year1][$metric] ?? 0;
            $v2 = $results[$year2][$metric] ?? 0;
            $change = $v1 > 0 ? round(($v2 - $v1) / $v1 * 100, 1) : ($v2 > 0 ? 100 : 0);
            $changes[$metric] = [
                $year1 => $v1,
                $year2 => $v2,
                'changePercent' => $change
            ];
        }

        jsonResponse(true, ['years' => $results, 'changes' => $changes]);
    }

    // ---- action=violation_trends: Monthly violation category trends (12 months) ----
    if ($action === 'violation_trends') {
        $months = intval($_GET['months'] ?? 12);
        $from = date('Y-m-d', strtotime("-{$months} months"));

        $violationKeywords = [
            'PEST' => '/pest|infest|rodent|cockroach/i',
            'WASTE' => '/waste|garbage|disposal/i',
            'WATER' => '/water|sanitation|sanitary/i',
            'FOOD' => '/food handling|cross.contamination/i',
            'STRUCT' => '/crack|leak|repair|structural/i',
            'HYGIENE' => '/hygiene|uniform|apron/i',
            'DRAIN' => '/drainage|sewage|sewer/i',
            'CERT' => '/health certificate|medical certificate/i',
            'EXPIRED' => '/expired|stale/i',
            'PERMIT' => '/no permit|permit.expired|unlicensed/i'
        ];

        $stmt = $db->prepare("SELECT DATE_FORMAT(report_date, '%Y-%m') as month, recommendation, remarks
            FROM inspection_reports WHERE report_date >= ? ORDER BY report_date");
        $stmt->execute([$from]);
        $allRows = $stmt->fetchAll();

        $stmt2 = $db->prepare("SELECT DATE_FORMAT(report_date, '%Y-%m') as month, recommendation, remarks
            FROM inspection_history WHERE report_date >= ? ORDER BY report_date");
        $stmt2->execute([$from]);
        $allRows = array_merge($allRows, $stmt2->fetchAll());

        $trends = []; // month -> [category -> count]
        foreach ($allRows as $row) {
            $month = $row['month'];
            if (!isset($trends[$month])) $trends[$month] = [];
            $text = strtolower(($row['recommendation'] ?? '') . ' ' . ($row['remarks'] ?? ''));
            foreach ($violationKeywords as $code => $pattern) {
                if (preg_match($pattern, $text)) {
                    if (!isset($trends[$month][$code])) $trends[$month][$code] = 0;
                    $trends[$month][$code]++;
                }
            }
        }
        ksort($trends);
        jsonResponse(true, $trends);
    }

    errorResponse('Unknown action. Valid: summary, year_over_year, violation_trends');

} catch (PDOException $e) {
    error_log('statistics.php error: ' . $e->getMessage());
    errorResponse('Database error. Please try again.', 500);
}
?>
