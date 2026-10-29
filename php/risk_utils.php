<?php
/**
 * TayabasCare Risk Scoring Engine — 5-Factor Formula (0-100 scale)
 * Shared utility used by predict.php, alerts.php, pattern_analysis.php
 *
 * riskLevel is severity-driven: max severity of OPEN (not-yet-complied)
 * violations per static PD 856 mapping. totalScore remains the 5-factor
 * analytics score and may decouple from riskLevel (a LOW row can carry
 * a non-zero score).
 */

// ---- Severity rank + static PD 856 severity maps ----
const VIOLATION_SEVERITY_RANK = ['LOW' => 0, 'MODERATE' => 1, 'HIGH' => 2];

// violation_codes (from getCollectedViolationCodes) → severity + English label
const VIOLATION_CODE_META = [
    'CONTAM'  => ['severity' => 'HIGH',     'label' => 'Food/environmental contamination'],
    'FOOD'    => ['severity' => 'HIGH',     'label' => 'Food safety violation (handling, storage, cross-contamination)'],
    'WATER'   => ['severity' => 'HIGH',     'label' => 'No potable water supply'],
    'PEST'    => ['severity' => 'HIGH',     'label' => 'Pest infestation (rodents, cockroaches, flies)'],
    'EXPIRED' => ['severity' => 'MODERATE', 'label' => 'Expired product/permit found'],
    'DRAIN'   => ['severity' => 'MODERATE', 'label' => 'Drainage/comfort-room sanitation deficiency'],
    'PERMIT'  => ['severity' => 'MODERATE', 'label' => 'No valid sanitary permit'],
    'CERT'    => ['severity' => 'MODERATE', 'label' => 'Worker/food handler without health certificate'],
    'HYGIENE' => ['severity' => 'MODERATE', 'label' => 'Poor personal hygiene / no handwashing facility'],
    'WASTE'   => ['severity' => 'MODERATE', 'label' => 'Improper waste disposal'],
    'STRUCT'  => ['severity' => 'MODERATE', 'label' => 'Structural defect / repair needed'],
    'OTHER'   => ['severity' => 'MODERATE', 'label' => 'Other sanitary violation (unclassified)'],
];

// Free-text patterns (Tagalog first, then English) → English label + severity.
// Labels matching VIOLATION_CODE_META entries are identical so payload dedupe works.
// Never match bare "clean" — recommendations say "keep premises clean".
const VIOLATION_TEXT_PATTERNS = [
    // Tagalog
    ['pattern' => '/marumi/',            'label' => 'Dirty/unclean conditions',                    'severity' => 'MODERATE'],
    ['pattern' => '/\bdumi/',           'label' => 'Dirty/unclean conditions',                    'severity' => 'MODERATE'],
    ['pattern' => '/\bbaho/',           'label' => 'Foul odor / sewage smell',                    'severity' => 'HIGH'],
    ['pattern' => '/\bbasura/',         'label' => 'Improper waste disposal / accumulated garbage', 'severity' => 'MODERATE'],
    ['pattern' => '/\bipis/',           'label' => 'Cockroach infestation',                       'severity' => 'HIGH'],
    ['pattern' => '/\bdaga/',           'label' => 'Rodent/rat infestation',                      'severity' => 'HIGH'],
    ['pattern' => '/\blangaw/',         'label' => 'Fly infestation',                             'severity' => 'HIGH'],
    ['pattern' => '/panis\w*/',         'label' => 'Spoiled/expired food',                        'severity' => 'HIGH'],
    ['pattern' => '/\bimbornal/',       'label' => 'Sewage/drainage discharge',                   'severity' => 'HIGH'],
    // English — HIGH
    ['pattern' => '/cross.?contamination|contaminat\w*/', 'label' => 'Food/environmental contamination', 'severity' => 'HIGH'],
    ['pattern' => '/\bno potable water|non.?potable|unsafe water|polluted water|water not potable|contaminated water/', 'label' => 'No potable water supply', 'severity' => 'HIGH'],
    ['pattern' => '/\bsewage\b|\bsewer\b|improper drainage/', 'label' => 'Sewage/drainage discharge', 'severity' => 'HIGH'],
    ['pattern' => '/\bpest\b|infest\w*|rodent|cockroach|\brats?\b|\bflies\b/', 'label' => 'Pest infestation (rodents, cockroaches, flies)', 'severity' => 'HIGH'],
    ['pattern' => '/\bexpired food\b|\bstale food\b|spoiled/', 'label' => 'Spoiled/expired food', 'severity' => 'HIGH'],
    // English — MODERATE (incl. generic fallbacks)
    ['pattern' => '/\bdirty\b|\bunclean\b|not clean|unsanitary/', 'label' => 'Dirty/unclean conditions', 'severity' => 'MODERATE'],
    ['pattern' => '/\bviolation\b|non.?compliant|\bfailed\b|\bimproper\b|unsafe/', 'label' => 'General sanitary violation', 'severity' => 'MODERATE'],
    ['pattern' => '/no permit|sanitary permit|permit expired|without permit/', 'label' => 'No valid sanitary permit', 'severity' => 'MODERATE'],
    ['pattern' => '/health certificate|medical certificate/', 'label' => 'Worker/food handler without health certificate', 'severity' => 'MODERATE'],
    ['pattern' => '/garbage|\bwaste\b|disposal/', 'label' => 'Improper waste disposal', 'severity' => 'MODERATE'],
    ['pattern' => '/handwash|no soap/', 'label' => 'Poor personal hygiene / no handwashing facility', 'severity' => 'MODERATE'],
    ['pattern' => '/\bcrack|\bleak\b|structural|repair/', 'label' => 'Structural defect / repair needed', 'severity' => 'MODERATE'],
];

/**
 * Deduplicate: keep only the latest version per report_date
 * (inspection_history rows are revisions of the same real-world inspection)
 */
function dedupeInspections(array $inspections): array {
    $byDate = [];
    foreach ($inspections as $insp) {
        $d = $insp['report_date'] ?? $insp['date'] ?? null;
        $key = $d ?: 'no_date_' . ($insp['id'] ?? uniqid());
        if (!isset($byDate[$key]) || ($insp['id'] ?? 0) > ($byDate[$key]['id'] ?? 0)) {
            $byDate[$key] = $insp;
        }
    }
    return array_values($byDate);
}

/**
 * Classify OPEN (not-yet-complied) violations across reports.
 * A report is open iff complied is falsy (null, 0, '0', false).
 * Returns flat list of {label, severity, source} deduped by label.
 */
function classifyOpenViolations(array $inspections): array {
    $inspections = dedupeInspections($inspections);
    $findings = [];
    $seen = [];

    foreach ($inspections as $insp) {
        $complied = array_key_exists('complied', $insp) && $insp['complied'] !== null
            ? (bool)$insp['complied'] : false;
        if ($complied) continue;

        // Codes from violation_codes JSON
        $codes = json_decode($insp['violation_codes'] ?? '', true);
        if (is_array($codes)) {
            foreach ($codes as $code) {
                $code = strtoupper(trim((string)$code));
                if ($code === '') continue;
                $meta = VIOLATION_CODE_META[$code] ?? [
                    'severity' => 'MODERATE',
                    'label'    => "Other violation ({$code})",
                ];
                $key = strtolower($meta['label']);
                if (!isset($seen[$key])) {
                    $seen[$key] = true;
                    $findings[] = ['label' => $meta['label'], 'severity' => $meta['severity'], 'source' => 'code'];
                }
            }
        }

        // Free text: remarks + recommendation (Tagalog and English)
        $text = strtolower(trim($insp['remarks'] ?? '') . ' ' . trim($insp['recommendation'] ?? ''));
        if ($text !== '') {
            foreach (VIOLATION_TEXT_PATTERNS as $row) {
                if (preg_match($row['pattern'], $text) === 1) {
                    $key = strtolower($row['label']);
                    if (!isset($seen[$key])) {
                        $seen[$key] = true;
                        $findings[] = ['label' => $row['label'], 'severity' => $row['severity'], 'source' => 'text'];
                    }
                }
            }
        }
    }

    return array_values($findings);
}

/**
 * Max severity of open findings; LOW when none.
 */
function maxSeverity(array $findings): string {
    $max = 'LOW';
    foreach ($findings as $f) {
        $s = $f['severity'] ?? 'LOW';
        if ((VIOLATION_SEVERITY_RANK[$s] ?? 0) > VIOLATION_SEVERITY_RANK[$max]) {
            $max = $s;
        }
    }
    return $max;
}

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

/**
 * Classify establishment as FOOD or NON-FOOD from business_type / name.
 * Used by pattern analysis violation-pattern chart.
 */
function isFoodEstablishment(string $businessType, string $businessName = ''): bool {
    $haystack = strtolower(trim($businessType) . ' ' . trim($businessName));
    $foodKeywords = [
        'food', 'restaurant', 'carenderia', 'karinderya', 'carinderia', 'eatery',
        'canteen', 'bakery', 'bakeshop', 'meat', 'butcher', 'fish', 'seafood',
        'wet market', 'slaughter', 'diner', 'cafe', 'coffee', 'fastfood', 'fast food',
        'pizza', 'burger', 'lechon', 'chicken', 'catering', 'milk tea', 'juice',
        'beverage', 'drink', 'ice cream', 'hotel', 'lodging', 'inn',
    ];
    foreach ($foodKeywords as $kw) {
        if ($kw !== '' && strpos($haystack, $kw) !== false) return true;
    }
    return false;
}

function foodOrNonFoodLabel(string $businessType, string $businessName = ''): string {
    return isFoodEstablishment($businessType, $businessName)
        ? 'FOOD Establishment'
        : 'NON FOOD Establishment';
}

function calculateRiskScore($businessName, $inspections, $sanitaryRecord) {

    $today = new DateTime();

    $inspections = dedupeInspections($inspections);
    $openViolations = classifyOpenViolations($inspections);

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
        // Never inspected: no time penalty (level is severity-driven)
        $factor2 = 0;
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
        // Never inspected: no unknown-compliance penalty (level is severity-driven)
        $factor4 = 0;
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
    // Severity-driven: max severity of open (not-yet-complied) violations.
    // totalScore remains the 5-factor analytics score and may decouple from riskLevel.
    $riskLevel = maxSeverity($openViolations);

    // ---- RECOMMENDATION ----
    $recommendations = [];
    if (!empty($openViolations)) {
        $labels = implode('; ', array_column($openViolations, 'label'));
        $word = count($openViolations) === 1 ? 'violation' : 'violations';
        $recommendations[] = "Open {$riskLevel} {$word}: {$labels} — establishment remains {$riskLevel} until compliance is verified.";
    }
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
        'matchedViolations' => $openViolations,
        'levelReason'     => !empty($openViolations)
            ? "Open {$riskLevel} violation(s): " . implode(', ', array_column($openViolations, 'label'))
            : 'No open violations.',
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
