<?php
// ============================================================
// Shared helpers for auto-recorded accomplishment fields (14-23):
//   14-17  9.1/9.2 Health Card M/F  (from sanitary records)
//   18-23  10.1/10.2/10.3 Exhumation/Skeletal/Cadaver M/F (from burial records)
//
// Values are COMPUTED from source records for a given month — they are
// never blindly incremented. The inspector's Add/Edit modal fetches them
// (GET ?autoFields=1) and the server recomputes them again on save, so
// the fields are always correct and cannot be edited by the inspector.
// ============================================================

/** Full name of the logged-in user from inspector_accounts, or ''. */
function accomplishmentSessionFullName($db) {
    $username = trim($_SESSION['username'] ?? '');
    if ($username === '') return '';
    try {
        $stmt = $db->prepare("SELECT full_name FROM inspector_accounts WHERE username = ?");
        $stmt->execute([$username]);
        return trim((string)($stmt->fetchColumn() ?: ''));
    } catch (PDOException $e) {
        error_log('accomplishment_auto fullName error: ' . $e->getMessage());
        return '';
    }
}

/** Identity names to match records against: [fullName, username] (unique, non-empty). */
function accomplishmentSessionNames($db) {
    $names = [
        trim($_SESSION['username'] ?? ''),
        accomplishmentSessionFullName($db),
    ];
    $names = array_values(array_unique(array_filter($names)));
    return $names;
}

/** Build an SQL LOWER(x) IN (...) fragment + params from a list of names. */
function accomplishmentNamesInClause($column, array $names) {
    if (!$names) return ['0', []]; // matches nothing
    $ph = implode(',', array_fill(0, count($names), '?'));
    $params = array_map('strtolower', $names);
    return ["LOWER($column) IN ($ph)", $params];
}

/** Parse a date string to [month, year]; falls back to current date. */
function accomplishmentDateMonthYear($dateStr) {
    $ts = strtotime((string)$dateStr);
    if ($ts === false) return [(int)date('n'), (int)date('Y')];
    return [(int)date('n', $ts), (int)date('Y', $ts)];
}

/**
 * Food vs Non-Food from the Sanitary Permit category.
 * permit_no format: 001-00-FM → category code FM → fullname "Food Manufacturing".
 * Rule: if the category's fullname has no "Food" in it → Non-Food.
 * ("Non Food Commercial" explicitly stays Non-Food.)
 */
function accomplishmentPermitCategoryFullname($permitNo) {
    $map = [
        'FM'  => 'Food Manufacturing',
        'FR'  => 'Food Retail',
        'FS'  => 'Food Serving',
        'IE'  => 'Industrial Establishment',
        'IS'  => 'Individual Services',
        'NFC' => 'Non Food Commercial',
        'PDD' => 'Public Disposal of Death',
        'PPI' => 'Public Place Institu.',
        'PPL' => 'Public Place Lodging',
        'PPO' => 'Public Place Others',
        'PPR' => 'Public Place Recreational',
        'PPT' => 'Public Place Tonsorial',
        'PPTD'=> 'Public Place Transfort Depo',
        'RFV' => 'Raw Food Vendor',
        'SFV' => 'Street Food Vendor',
        'WRS' => 'Water Refiling Station',
    ];
    $parts = explode('-', (string)$permitNo);
    $code = strtoupper(trim($parts[2] ?? ''));
    return $map[$code] ?? '';
}

function accomplishmentPermitIsFood($permitNo) {
    $fullname = strtolower(accomplishmentPermitCategoryFullname($permitNo));
    if ($fullname === '') return false; // no recognized category → Non-Food
    $hasFood  = strpos($fullname, 'food') !== false;
    $hasNonFood = strpos($fullname, 'non food') !== false || strpos($fullname, 'non-food') !== false;
    return $hasFood && !$hasNonFood;
}

/**
 * Auto-recorded field indices (0-based) — everything the system computes:
 *   4/5    3.1/3.2 Inspections of food / non-food establishments
 *   12/13  8.1/8.2 Issuance of sanitary permits food / non-food
 *   14-17  9.1/9.2 Health cards food/non-food M/F
 *   18-23  10.x Exhumation/Skeletal/Cadaver M/F
 */
function accomplishmentAutoIndices() {
    return [4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
}

/** Food check for an establishment: permit category first, name keywords as fallback. */
function accomplishmentEstablishmentIsFood($db, $establishment, $establishmentId = null) {
    try {
        // 1) Direct link to a sanitary record → its permit category decides
        if ($establishmentId) {
            $stmt = $db->prepare("SELECT permit_no FROM sanitary_records WHERE id = ?");
            $stmt->execute([$establishmentId]);
            $permit = $stmt->fetchColumn();
            if ($permit) return accomplishmentPermitIsFood($permit);
        }
        // 2) Match by business name → permit category decides
        $name = trim((string)$establishment);
        if ($name !== '') {
            $stmt = $db->prepare("SELECT permit_no FROM sanitary_records WHERE LOWER(TRIM(business_name)) = LOWER(?) ORDER BY id DESC LIMIT 1");
            $stmt->execute([$name]);
            $permit = $stmt->fetchColumn();
            if ($permit) return accomplishmentPermitIsFood($permit);
        }
    } catch (PDOException $e) {
        error_log('accomplishmentEstablishmentIsFood: ' . $e->getMessage());
    }
    // 3) No permit anywhere — fall back to food keywords in the name
    $nameL = strtolower((string)$establishment);
    foreach (['food', 'restaurant', 'carenderia', 'carinderia', 'eatery', 'canteen', 'bakery',
              'meat', 'fish', 'wet market', 'slaughter', 'siomai', 'bbq', 'grill', 'diner'] as $t) {
        if (preg_match('/\b' . preg_quote($t, '/') . '\b/', $nameL)) return true;
    }
    return false;
}

/**
 * Compute the auto-tracked accomplishment values for one inspector + month.
 * Returns a 24-number array; only accomplishmentAutoIndices() are non-zero.
 * $names: identity names to match against record owner columns (fullName/username).
 */
function accomplishmentComputeAutoFields($db, array $names, $month, $year) {
    $out = array_fill(0, 24, 0);
    $month = (int)$month;
    $year  = (int)$year;
    if (!$names || $month < 1 || $month > 12) return $out;

    // ---- 4-5: 3.1/3.2 Inspections of food / non-food establishments ----
    try {
        [$in, $p1] = accomplishmentNamesInClause('inspector_name', $names);
        $stmt = $db->prepare("
            SELECT establishment, establishment_id
            FROM inspection_reports
            WHERE MONTH(report_date) = ? AND YEAR(report_date) = ? AND $in
        ");
        $stmt->execute(array_merge([$month, $year], $p1));
        foreach ($stmt->fetchAll() as $r) {
            if (accomplishmentEstablishmentIsFood($db, $r['establishment'] ?? '', $r['establishment_id'] ?? null)) {
                $out[4]++;
            } else {
                $out[5]++;
            }
        }
    } catch (PDOException $e) {
        error_log('accomplishmentComputeAutoFields inspections: ' . $e->getMessage());
    }

    // ---- 12-17: sanitary records → 8.x permits issued + 9.x health cards ----
    try {
        [$in, $p2] = accomplishmentNamesInClause('created_by', $names);
        $stmt = $db->prepare("
            SELECT id, permit_no, sex, personnel_list
            FROM sanitary_records
            WHERE MONTH(date) = ? AND YEAR(date) = ? AND $in
        ");
        $stmt->execute(array_merge([$month, $year], $p2));
        foreach ($stmt->fetchAll() as $r) {
            $isFood = accomplishmentPermitIsFood($r['permit_no'] ?? '');

            // 8.1/8.2: one permit issued per record
            $out[$isFood ? 12 : 13]++;

            // 9.1/9.2: owner + every personnel, by sex
            $base = $isFood ? 14 : 16;
            $persons = [];
            if (trim($r['sex'] ?? '') !== '') $persons[] = $r['sex'];
            $personnel = json_decode($r['personnel_list'] ?? '[]', true);
            if (is_array($personnel)) {
                foreach ($personnel as $p) {
                    if (is_array($p) && trim($p['sex'] ?? '') !== '') $persons[] = $p['sex'];
                }
            }
            foreach ($persons as $s) {
                $abbr = strtoupper(substr(trim((string)$s), 0, 1)); // Male→M, Female→F
                if ($abbr === 'M')      $out[$base]++;
                elseif ($abbr === 'F')  $out[$base + 1]++;
            }
        }
    } catch (PDOException $e) {
        error_log('accomplishmentComputeAutoFields sanitary: ' . $e->getMessage());
    }

    // ---- 18-23: Burial certificates (exhumation / skeletal / cadaver) by sex ----
    try {
        [$in, $p3] = accomplishmentNamesInClause('inspector', $names);
        $stmt = $db->prepare("
            SELECT type, sex
            FROM burial_records
            WHERE MONTH(datetime) = ? AND YEAR(datetime) = ? AND $in
        ");
        $stmt->execute(array_merge([$month, $year], $p3));
        $idxMap = [
            'exhumation' => ['M' => 18, 'F' => 19],
            'skeletal'   => ['M' => 20, 'F' => 21],
            'cadaver'    => ['M' => 22, 'F' => 23],
        ];
        foreach ($stmt->fetchAll() as $r) {
            $type = $r['type'] ?? '';
            $abbr = strtoupper(substr(trim($r['sex'] ?? ''), 0, 1));
            if (isset($idxMap[$type]) && ($abbr === 'M' || $abbr === 'F')) {
                $out[$idxMap[$type][$abbr]]++;
            }
        }
    } catch (PDOException $e) {
        error_log('accomplishmentComputeAutoFields burial: ' . $e->getMessage());
    }

    return $out;
}

/**
 * Merge computed auto values into a client fields array (normalized to 24).
 * Per auto index: computed value wins when > 0 (source of truth); when the
 * source has nothing for that month, the EXISTING stored value is kept —
 * this protects historical rows that predate auto-recording.
 * Client-sent values for auto indices are always ignored.
 *
 * $storedFields: the row's current fields array (null when no row exists).
 */
function accomplishmentMergeAutoFields($db, $fields, $names, $month, $year, $storedFields = null) {
    $norm = function ($v) { return is_numeric($v) ? (float)$v : 0; };
    $pad = function ($arr) use ($norm) {
        $arr = array_map($norm, is_array($arr) ? $arr : []);
        return array_slice($arr + array_fill(0, 24, 0), 0, 24);
    };

    $fields = $pad($fields);
    $stored = $pad($storedFields);

    $auto = accomplishmentComputeAutoFields($db, $names, $month, $year);
    foreach (accomplishmentAutoIndices() as $i) {
        $fields[$i] = $auto[$i] > 0 ? $auto[$i] : $stored[$i];
    }

    return array_map(function ($v) { return ($v == (int)$v) ? (int)$v : round($v, 2); }, $fields);
}
