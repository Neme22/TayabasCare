<?php
require_once 'auth_check.php';
requireRole('admin');

// ============================================================
// TayabasCare Analytics Export Endpoint
// Returns aggregated analytics data for PDF/Excel report export
// ============================================================

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit(); }
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    errorResponse('Method not allowed. Use GET.', 405);
}

try {
    $period = $_GET['period'] ?? 'monthly';
    $year   = intval($_GET['year'] ?? date('Y'));
    $month  = max(1, min(12, intval($_GET['month'] ?? date('n'))));
    $quarter = max(1, min(4, intval($_GET['quarter'] ?? ceil(date('n') / 3))));

    // Date range based on period
    if ($period === 'monthly') {
        $from = "$year-" . str_pad($month, 2, '0', STR_PAD_LEFT) . "-01";
        $to   = date('Y-m-t', strtotime($from));
        $periodLabel = date('F Y', strtotime($from));
    } elseif ($period === 'quarterly') {
        $qStartMonth = ($quarter - 1) * 3 + 1;
        $from = "$year-" . str_pad($qStartMonth, 2, '0', STR_PAD_LEFT) . "-01";
        $qEndMonth = $qStartMonth + 2;
        $to = date('Y-m-t', strtotime("$year-" . str_pad($qEndMonth, 2, '0', STR_PAD_LEFT) . "-01"));
        $periodLabel = "Q$quarter $year";
    } else { // annual
        $from = "$year-01-01";
        $to   = "$year-12-31";
        $periodLabel = "Year $year";
    }

    // ---- 1. Total inspections in period ----
    $stmt = $db->prepare("SELECT COUNT(*) as total FROM inspection_reports WHERE report_date BETWEEN ? AND ?");
    $stmt->execute([$from, $to . ' 23:59:59']);
    $totalInspections = (int)$stmt->fetch()['total'];

    // Also count from history
    $stmt = $db->prepare("SELECT COUNT(*) as total FROM inspection_history WHERE report_date BETWEEN ? AND ?");
    $stmt->execute([$from, $to . ' 23:59:59']);
    $totalInspections += (int)$stmt->fetch()['total'];

    // ---- 2. Compliance rate (includes history for accurate trends) ----
    $stmt = $db->prepare("SELECT
        COUNT(*) as total,
        SUM(CASE WHEN complied = 1 THEN 1 ELSE 0 END) as complied
        FROM inspection_reports WHERE report_date BETWEEN ? AND ?");
    $stmt->execute([$from, $to . ' 23:59:59']);
    $compData = $stmt->fetch();
    $compTotal = (int)$compData['total'];
    $compComplied = (int)$compData['complied'];

    // Also count from history
    $stmt = $db->prepare("SELECT
        COUNT(*) as total,
        SUM(CASE WHEN complied = 1 THEN 1 ELSE 0 END) as complied
        FROM inspection_history WHERE report_date BETWEEN ? AND ?");
    $stmt->execute([$from, $to . ' 23:59:59']);
    $compHist = $stmt->fetch();
    $compTotal += (int)$compHist['total'];
    $compComplied += (int)$compHist['complied'];

    $complianceRate = $compTotal > 0 ? round($compComplied / $compTotal * 100, 1) : 0;

    // ---- 3. Risk distribution (from all current records) ----
    // We'll compute this client-side from predict.php data, but also provide establishment counts
    $stmt = $db->query("SELECT COUNT(*) as total FROM sanitary_records");
    $totalEstablishments = (int)$stmt->fetch()['total'];

    // ---- 4. Top violations (from inspection reports) ----
    $violationKeywords = [
        'Improper waste disposal' => 'waste|garbage|disposal',
        'Poor sanitation' => 'dirty|unsanitary|sanitation',
        'Pest infestation' => 'pest|infest|rodent|cockroach',
        'No health certificates' => 'health certificate|medical certificate|no permit',
        'Expired products' => 'expired|stale',
        'Sewage issues' => 'sewage|sewer|drainage',
        'Food handling violations' => 'food handling|hair restraint|gloves',
        'Contamination risk' => 'contaminat|cross.contamination',
        'Structural issues' => 'crack|leak|repair|structural',
        'No sanitary permit' => 'no permit|permit.expired|unlicensed'
    ];

    $stmt = $db->prepare("SELECT recommendation, remarks FROM inspection_reports WHERE report_date BETWEEN ? AND ?");
    $stmt->execute([$from, $to . ' 23:59:59']);
    $allRemarks = $stmt->fetchAll();

    $stmt = $db->prepare("SELECT recommendation, remarks FROM inspection_history WHERE report_date BETWEEN ? AND ?");
    $stmt->execute([$from, $to . ' 23:59:59']);
    $allRemarks = array_merge($allRemarks, $stmt->fetchAll());

    $violationCounts = [];
    foreach ($violationKeywords as $label => $pattern) {
        $count = 0;
        foreach ($allRemarks as $r) {
            $text = strtolower(($r['recommendation'] ?? '') . ' ' . ($r['remarks'] ?? ''));
            if (preg_match("/$pattern/i", $text)) $count++;
        }
        if ($count > 0) $violationCounts[] = ['type' => $label, 'count' => $count];
    }
    usort($violationCounts, fn($a, $b) => $b['count'] - $a['count']);
    $topViolations = array_slice($violationCounts, 0, 10);

    // ---- 5. Barangay breakdown ----
    $stmt = $db->prepare("SELECT barangay, COUNT(*) as count FROM sanitary_records GROUP BY barangay ORDER BY count DESC");
    $stmt->execute();
    $barangayBreakdown = $stmt->fetchAll();

    // ---- 6. Inspector productivity ----
    $stmt = $db->prepare("SELECT
        inspector_name,
        COUNT(*) as total,
        SUM(CASE WHEN complied = 1 THEN 1 ELSE 0 END) as complied,
        SUM(CASE WHEN complied = 0 THEN 1 ELSE 0 END) as not_complied
        FROM inspection_reports
        WHERE report_date BETWEEN ? AND ?
        GROUP BY inspector_name ORDER BY total DESC");
    $stmt->execute([$from, $to . ' 23:59:59']);
    $inspectorProductivity = $stmt->fetchAll();

    // ---- 7. Monthly trend (last 12 months, includes history) ----
    $trendFrom = date('Y-m-d', strtotime('-11 months', strtotime($from)));
    $stmt = $db->prepare("SELECT
        DATE_FORMAT(report_date, '%Y-%m') as month,
        COUNT(*) as total,
        SUM(CASE WHEN complied = 1 THEN 1 ELSE 0 END) as complied,
        SUM(CASE WHEN complied = 0 THEN 1 ELSE 0 END) as not_complied
        FROM (
            SELECT CAST(report_date AS DATETIME) as report_date, CAST(complied AS UNSIGNED) as complied FROM inspection_reports WHERE report_date >= ?
            UNION ALL
            SELECT CAST(report_date AS DATETIME) as report_date, CAST(complied AS UNSIGNED) as complied FROM inspection_history WHERE report_date >= ?
        ) combined
        GROUP BY DATE_FORMAT(report_date, '%Y-%m')
        ORDER BY month ASC");
    $stmt->execute([$trendFrom, $trendFrom]);
    $monthlyTrend = $stmt->fetchAll();

    // ---- 8. Establishment compliance rankings ----
    $stmt = $db->prepare("
        SELECT establishment, COUNT(*) as total,
            SUM(CASE WHEN complied = 1 THEN 1 ELSE 0 END) as complied,
            SUM(CASE WHEN complied = 0 THEN 1 ELSE 0 END) as not_complied,
            MAX(report_date) as last_inspection
        FROM (
            SELECT CAST(establishment AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci as establishment, CAST(complied AS UNSIGNED) as complied, CAST(report_date AS DATETIME) as report_date FROM inspection_reports WHERE report_date BETWEEN ? AND ?
            UNION ALL
            SELECT CAST(establishment AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci as establishment, CAST(complied AS UNSIGNED) as complied, CAST(report_date AS DATETIME) as report_date FROM inspection_history WHERE report_date BETWEEN ? AND ?
        ) combined
        WHERE establishment IS NOT NULL AND establishment != ''
        GROUP BY establishment
        ORDER BY not_complied DESC, total DESC
        LIMIT 30
    ");
    $stmt->execute([$from, $to . ' 23:59:59', $from, $to . ' 23:59:59']);
    $establishmentRankings = [];
    foreach ($stmt->fetchAll() as $row) {
        $rate = $row['total'] > 0 ? round($row['complied'] / $row['total'] * 100, 1) : 0;
        $establishmentRankings[] = [
            'establishment' => $row['establishment'],
            'totalInspections' => (int)$row['total'],
            'complied' => (int)$row['complied'],
            'notComplied' => (int)$row['not_complied'],
            'complianceRate' => $rate,
            'lastInspection' => $row['last_inspection']
        ];
    }

    // ---- 9. Inspector efficiency metrics ----
    $stmt = $db->prepare("
        SELECT
            inspector_name,
            COUNT(*) as total,
            SUM(CASE WHEN complied = 1 THEN 1 ELSE 0 END) as complied,
            SUM(CASE WHEN complied = 0 THEN 1 ELSE 0 END) as not_complied,
            MIN(report_date) as first_report,
            MAX(report_date) as last_report,
            COUNT(DISTINCT DATE(report_date)) as active_days
        FROM (
            SELECT CAST(inspector_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci as inspector_name, CAST(complied AS UNSIGNED) as complied, CAST(report_date AS DATETIME) as report_date FROM inspection_reports WHERE report_date BETWEEN ? AND ?
            UNION ALL
            SELECT CAST(inspector_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci as inspector_name, CAST(complied AS UNSIGNED) as complied, CAST(report_date AS DATETIME) as report_date FROM inspection_history WHERE report_date BETWEEN ? AND ?
        ) combined
        WHERE inspector_name IS NOT NULL AND inspector_name != ''
        GROUP BY inspector_name
        ORDER BY total DESC
    ");
    $stmt->execute([$from, $to . ' 23:59:59', $from, $to . ' 23:59:59']);
    $inspectorEfficiency = [];
    foreach ($stmt->fetchAll() as $row) {
        $daysSpan = 1;
        if ($row['first_report'] && $row['last_report']) {
            $daysSpan = max(1, (int)(new DateTime($row['last_report']))->diff(new DateTime($row['first_report']))->days);
        }
        $avgPerDay = $daysSpan > 0 ? round($row['total'] / $daysSpan, 2) : 0;
        $compRate = $row['total'] > 0 ? round($row['complied'] / $row['total'] * 100, 1) : 0;
        $inspectorEfficiency[] = [
            'inspector' => $row['inspector_name'],
            'totalInspections' => (int)$row['total'],
            'complied' => (int)$row['complied'],
            'notComplied' => (int)$row['not_complied'],
            'complianceRate' => $compRate,
            'activeDays' => (int)$row['active_days'],
            'avgPerDay' => $avgPerDay,
            'periodDays' => $daysSpan
        ];
    }

    jsonResponse(true, [
        'period'              => $period,
        'periodLabel'         => $periodLabel,
        'from'                => $from,
        'to'                  => $to,
        'totalInspections'    => $totalInspections,
        'complianceRate'      => $complianceRate,
        'totalEstablishments' => $totalEstablishments,
        'topViolations'       => $topViolations,
        'barangayBreakdown'   => $barangayBreakdown,
        'inspectorProductivity' => $inspectorProductivity,
        'monthlyTrend'        => $monthlyTrend,
        'establishmentRankings' => $establishmentRankings,
        'inspectorEfficiency'   => $inspectorEfficiency,
        'generatedAt'         => date('Y-m-d H:i:s')
    ]);

} catch (PDOException $e) {
    error_log('export_analytics.php error: ' . $e->getMessage());
    errorResponse('Database error. Please try again.', 500);
}
