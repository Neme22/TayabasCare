<?php
/**
 * TayabasCare Risk Scoring Engine — 5-Factor Formula (0-100 scale)
 * Shared utility used by predict.php, alerts.php, pattern_analysis.php
 */

/**
 * Fuzzy match establishment names (substring containment for names > 4 chars)
 */
function matchEstablishment($estabName, $recordName) {
    $estab = strtolower(trim($estabName));
    $name = strtolower(trim($recordName));
    if ($estab === '' || $name === '') return false;
    if ($estab === $name) return true;
    $shorter = strlen($estab) < strlen($name) ? $estab : $name;
    $longer = strlen($estab) < strlen($name) ? $name : $estab;
    if (strlen($shorter) > 4 && strpos($longer, $shorter) !== false) return true;
    return false;
}

function calculateRiskScore($businessName, $inspections, $sanitaryRecord) {

    $today = new DateTime();

    // Deduplicate: keep only the latest version per report_date
    // (inspection_history rows are revisions of the same real-world inspection)
    $byDate = [];
    foreach ($inspections as $insp) {
        $d = $insp['report_date'] ?? $insp['date'] ?? null;
        $key = $d ?: 'no_date_' . ($insp['id'] ?? uniqid());
        if (!isset($byDate[$key]) || ($insp['id'] ?? 0) > ($byDate[$key]['id'] ?? 0)) {
            $byDate[$key] = $insp;
        }
    }
    $inspections = array_values($byDate);

    // ---- FACTOR 1: Number of Previous Violations (0-25 pts) ----
    $violationKeywords = ['violation', 'failed', 'non-compliant', 'dirty', 'unsanitary',
                          'pest', 'contaminated', 'sewage', 'unsafe', 'expired', 'no permit',
                          'improper', 'garbage', 'waste', 'polluted', 'infest',
                          'marumi', 'baho', 'basura', 'dumi', 'ipis', 'daga'];
    $violationPattern = '/\b(' . implode('|', array_map('preg_quote', $violationKeywords)) . ')\b/i';

    $violationCount = 0;
    foreach ($inspections as $insp) {
        $complied   = array_key_exists('complied', $insp) && $insp['complied'] !== null
            ? (bool)$insp['complied'] : false;
        $remarks    = strtolower($insp['recommendation'] ?? '') . ' ' . strtolower($insp['status'] ?? '');
        $hasKeyword = preg_match($violationPattern, $remarks) === 1;
        if (!$complied || $hasKeyword) $violationCount++;
    }

    $sanitaryRemarks = strtolower($sanitaryRecord['remarks'] ?? '');
    if ($sanitaryRemarks && preg_match($violationPattern, $sanitaryRemarks) === 1) {
        $violationCount++;
    }

    $factor1 = min(25, $violationCount * 8);

    // ---- FACTOR 2: Time Since Last Inspection (0-20 pts) ----
    $lastInspDate = null;
    foreach ($inspections as $insp) {
        $d = $insp['date'] ?? $insp['report_date'] ?? null;
        if ($d) {
            try {
                $dt = new DateTime($d);
                if (!$lastInspDate || $dt > $lastInspDate) $lastInspDate = $dt;
            } catch (Exception $e) {
                continue;
            }
        }
    }

    if ($lastInspDate) {
        $diff = $today->diff($lastInspDate);
        // Future-dated reports should not score as "fresh" — treat as long overdue
        $daysSince = $diff->invert ? (int)$diff->days : (int)$diff->days;
        if ($diff->invert) {
            // Date is in the future — data error, treat as never inspected (max risk)
            $daysSince = 9999;
        }
        if      ($daysSince <= 30)  $factor2 = 0;
        else if ($daysSince <= 60)  $factor2 = 5;
        else if ($daysSince <= 90)  $factor2 = 10;
        else if ($daysSince <= 180) $factor2 = 15;
        else                        $factor2 = 20;
    } else {
        $factor2 = 20;
    }

    // ---- FACTOR 3: Establishment Category (0-20 pts) ----
    $businessType = strtolower(trim($sanitaryRecord['business_type'] ?? 'Other'));

    $highRiskCategories = [
        'food establishment', 'restaurant', 'carenderia', 'eatery', 'food',
        'canteen', 'bakery', 'meat shop', 'fish market', 'wet market',
        'slaughterhouse', 'slaughter', 'hotel', 'lodging', 'hospital',
        'clinic', 'pharmacy', 'salon', 'barber', 'spa', 'gym',
        'dental', 'laboratory'
    ];
    $medRiskCategories = [
        'retail store', 'convenience store', 'store', 'shop', 'market',
        'mall', 'school', 'office', 'warehouse', 'gasoline station',
        'gasoline', 'hardware', 'factory', 'laundry', 'printing',
        'bank', 'trading', 'insurance', 'construction'
    ];

    $factor3 = 5;

    if ($businessType !== 'other' && $businessType !== '') {
        foreach ($highRiskCategories as $cat) {
            if ($businessType === $cat || strpos($businessType, $cat) !== false) {
                $factor3 = 20; break;
            }
        }
        if ($factor3 === 5) {
            foreach ($medRiskCategories as $cat) {
                if ($businessType === $cat || strpos($businessType, $cat) !== false) {
                    $factor3 = 12; break;
                }
            }
        }
    }

    if ($factor3 === 5) {
        $nameL = strtolower($businessName);
        $highRiskKeywords   = ['restaurant', 'carenderia', 'eatery', 'food', 'canteen', 'bakery',
                               'meat', 'fish', 'wet market', 'slaughter', 'hotel', 'lodging',
                               'hospital', 'clinic', 'pharmacy', 'salon', 'barber', 'spa', 'gym',
                               'dental', 'laboratory', 'funeral', 'resort', 'pool', 'bar', 'pub'];
        $medRiskKeywords    = ['store', 'shop', 'market', 'mall', 'school', 'office', 'warehouse',
                               'gasoline', 'hardware', 'factory', 'laundry', 'printing',
                               'bank', 'insurance', 'realty', 'construction', 'trading',
                               'internet cafe', 'computer shop', 'veterinary'];

        foreach ($highRiskKeywords as $t) {
            if (preg_match('/\b' . preg_quote($t, '/') . '\b/i', $nameL)) { $factor3 = 20; break; }
        }
        if ($factor3 === 5) {
            foreach ($medRiskKeywords as $t) {
                if (preg_match('/\b' . preg_quote($t, '/') . '\b/i', $nameL)) { $factor3 = 12; break; }
            }
        }
    }

    // ---- FACTOR 4: Compliance History Percentage (0-20 pts) ----
    $totalInsp  = count($inspections);
    $compliedCount = 0;
    if ($totalInsp > 0) {
        foreach ($inspections as $insp) {
            $complied = array_key_exists('complied', $insp) && $insp['complied'] !== null
                ? (bool)$insp['complied'] : false;
            if ($complied) $compliedCount++;
        }
        $complianceRate = $compliedCount / $totalInsp;
        $factor4 = (int)round((1 - $complianceRate) * 20);
    } else {
        $factor4 = 10;
    }

    // ---- FACTOR 5: Follow-up Action Completion (0-15 pts) ----
    $pendingCount = 0;
    foreach ($inspections as $insp) {
        $status = strtolower($insp['status'] ?? '');
        if ($status === 'pending' || $status === 'for follow-up') $pendingCount++;
    }
    if (isset($sanitaryRecord['result_xray']) && $sanitaryRecord['result_xray'] !== null && !$sanitaryRecord['result_xray'])  $pendingCount++;
    if (isset($sanitaryRecord['result_stool']) && $sanitaryRecord['result_stool'] !== null && !$sanitaryRecord['result_stool'])  $pendingCount++;

    $factor5 = min(15, $pendingCount * 5);

    // ---- TOTAL SCORE ----
    $totalScore = $factor1 + $factor2 + $factor3 + $factor4 + $factor5;

    // ---- RISK LEVEL ----
    if      ($totalScore >= 60) $riskLevel = 'HIGH';
    else if ($totalScore >= 30) $riskLevel = 'MODERATE';
    else                        $riskLevel = 'LOW';

    // ---- RECOMMENDATION ----
    $recommendations = [];
    if ($factor3 === 20 && $factor1 >= 8) {
        $recommendations[] = 'Food/health establishment with violations — prioritize PD 856 compliance review.';
    }
    if ($factor1 >= 16) $recommendations[] = 'Immediate re-inspection required due to repeated violations.';
    if ($factor2 >= 15 && $factor5 >= 10) {
        $recommendations[] = 'Long-overdue inspection with unresolved follow-ups — schedule immediately.';
    } else if ($factor2 >= 15) {
        $recommendations[] = 'Schedule inspection — establishment has not been visited in over 3 months.';
    }
    if ($factor4 >= 15 && $factor1 >= 16) {
        $recommendations[] = 'Persistent non-compliance — escalate to City Health Officer.';
    } else if ($factor4 >= 15) {
        $recommendations[] = 'Low compliance history — inspector follow-up and enforcement recommended.';
    }
    if ($factor5 >= 10 && $factor2 < 15) $recommendations[] = 'Multiple pending follow-up actions remain unresolved.';
    if (empty($recommendations)) $recommendations[] = 'Establishment appears compliant. Continue routine monitoring.';

    return [
        'totalScore'      => $totalScore,
        'riskLevel'       => $riskLevel,
        'businessType'    => $sanitaryRecord['business_type'] ?? 'Other',
        'factors'         => [
            'violations'      => ['score' => $factor1, 'max' => 25, 'label' => 'Previous Violations',        'count' => $violationCount],
            'timeSinceLast'   => ['score' => $factor2, 'max' => 20, 'label' => 'Time Since Last Inspection', 'days'  => $lastInspDate ? (int)$today->diff($lastInspDate)->days : null],
            'estabType'       => ['score' => $factor3, 'max' => 20, 'label' => 'Establishment Category'],
            'compliance'      => ['score' => $factor4, 'max' => 20, 'label' => 'Compliance History',         'rate'  => $totalInsp > 0 ? round($compliedCount / $totalInsp * 100) : null],
            'followUp'        => ['score' => $factor5, 'max' => 15, 'label' => 'Pending Follow-up Actions',  'count' => $pendingCount],
        ],
        'recommendations' => $recommendations,
        'totalInspections'=> $totalInsp,
        'lastInspected'   => $lastInspDate ? $lastInspDate->format('M j, Y') : 'Never',
    ];
}
