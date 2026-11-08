<?php
/**
 * TayabasCare Risk Scoring Engine — Merit system (0-100)
 * Shared utility used by predict.php, alerts.php, pattern_analysis.php
 *
 * Every establishment starts at 100 merits. Each OPEN (not-yet-complied)
 * violation finding costs 5 demerits. Complying a violation restores those
 * 5 merits. Risk levels from merits:
 *   LOW      = exactly 100
 *   MODERATE = 99–65
 *   HIGH     = 64 and below
 * totalScore is an alias of merits for downstream consumers.
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

    // Last inspection date (display only)
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

    $totalInsp = count($inspections);

    // ---- MERIT SCORE ----
    // 1 open violation finding = 5 demerits; complying restores 5 merits.
    $openCount = count($openViolations);
    $demerits  = $openCount * 5;
    $merits    = max(0, 100 - $demerits);

    // LOW = exactly 100; MODERATE = 99–65; HIGH = 64 and below
    if ($merits === 100) {
        $riskLevel = 'LOW';
    } elseif ($merits >= 65) {
        $riskLevel = 'MODERATE';
    } else {
        $riskLevel = 'HIGH';
    }

    // ---- RECOMMENDATIONS ----
    $recommendations = [];
    if (!empty($openViolations)) {
        $labels = implode('; ', array_column($openViolations, 'label'));
        $word = $openCount === 1 ? 'violation' : 'violations';
        $recommendations[] = "{$openCount} open {$word} ({$demerits} demerits, {$merits} merits): {$labels} — compliancy restores 5 merits each.";
    } else {
        $recommendations[] = 'No open violations — 100 merits. Continue routine monitoring.';
    }

    return [
        'merits'           => $merits,
        'demerits'         => $demerits,
        'openViolationCount' => $openCount,
        // Alias so alerts/pattern/AI keep working; equals merits
        'totalScore'       => $merits,
        'riskLevel'        => $riskLevel,
        'matchedViolations' => $openViolations,
        'levelReason'      => !empty($openViolations)
            ? "{$openCount} open violation(s) → {$demerits} demerits → {$merits} merits ({$riskLevel}): "
                . implode(', ', array_column($openViolations, 'label'))
            : 'No open violations — 100 merits (LOW).',
        'businessType'     => $sanitaryRecord['business_type'] ?? 'Other',
        'factors'          => [
            'merits' => [
                'score'    => $merits,
                'max'      => 100,
                'label'    => 'Merit Score',
                'count'    => $openCount,
                'demerits' => $demerits,
            ],
        ],
        'recommendations'  => $recommendations,
        'totalInspections' => $totalInsp,
        'lastInspected'    => $lastInspDate ? $lastInspDate->format('M j, Y') : 'Never',
    ];
}

/**
 * Returns a lookup index of all establishment names and permits that are currently archived.
 * Any establishment or permit present here is omitted from active prescription / alerts / pattern analysis.
 */
function getArchivedEstablishmentIndex(PDO $db): array {
    $archived = [
        'names'   => [],
        'permits' => [],
        'ids'     => []
    ];
    try {
        $stmt = $db->query("SELECT data_json, archive_type FROM archive_data WHERE archive_type IN ('sanitary', 'report', 'reports')");
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $raw = $row['data_json'] ?? '';
            if (function_exists('decryptField')) {
                $raw = decryptField($raw, 'archive_data.data_json');
            }
            $data = json_decode($raw, true);
            if (!is_array($data)) continue;

            if (!empty($data['id'])) {
                $archived['ids'][(int)$data['id']] = true;
            }
            if (!empty($data['business_name'])) {
                $archived['names'][strtolower(trim($data['business_name']))] = true;
            }
            if (!empty($data['establishment'])) {
                $archived['names'][strtolower(trim($data['establishment']))] = true;
            }
            if (!empty($data['permit_no'])) {
                $archived['permits'][strtolower(trim($data['permit_no']))] = true;
            }
        }
    } catch (PDOException $e) {
        error_log('getArchivedEstablishmentIndex error: ' . $e->getMessage());
    }
    return $archived;
}

/**
 * Check whether an establishment is currently archived in archive_data.
 */
function isEstablishmentArchived(?string $name, ?string $permit, array $archivedIndex, ?int $id = null): bool {
    if ($id && isset($archivedIndex['ids'][$id])) return true;
    if ($name && isset($archivedIndex['names'][strtolower(trim($name))])) return true;
    if ($permit && isset($archivedIndex['permits'][strtolower(trim($permit))])) return true;
    return false;
}
