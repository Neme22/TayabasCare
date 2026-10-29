<?php
require_once 'auth_check.php';
require_once 'activity_log.php';
require_once 'csrf.php';
require_once 'cluster_lib.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'OPTIONS') { http_response_code(200); exit(); }

if (csrfNeeded()) {
    requireCsrf();
}

// ---- POST: Create/update schedule ----
// Admin can schedule for anyone; inspectors may only schedule for themselves
// (auto-schedule from compliance deadlines).
if ($method === 'POST') {
    try {
        $input = json_decode(file_get_contents('php://input'), true);

        $inspector    = trim($input['inspector'] ?? '');
        $schedDate    = trim($input['schedDate'] ?? '');
        $notes        = trim($input['notes'] ?? '');
        $establishment = trim($input['establishment'] ?? '');
        $riskLevel    = trim($input['riskLevel'] ?? '');

        if (!$inspector || !$schedDate) {
            errorResponse('Missing data', 400);
        }

        $sessionRole = $_SESSION['role'] ?? '';

        // Resolve the establishment's barangay once — used by the inspector
        // cluster guard and by the cluster-owner alignment below.
        $estabBarangay = '';
        if ($establishment !== '') {
            try {
                $b = $db->prepare("SELECT barangay FROM sanitary_records WHERE business_name = ? ORDER BY id DESC LIMIT 1");
                $b->execute([$establishment]);
                $estabBarangay = trim((string)($b->fetchColumn() ?: ''));
            } catch (PDOException $e) {
                $estabBarangay = '';
            }
        }

        if ($sessionRole !== 'admin') {
            requireRole('inspector');
            $sessionUser = trim($_SESSION['username'] ?? '');
            $fullName = trim($_SESSION['full_name'] ?? (($_SESSION['username'] ?? '')));
            // Resolve the inspector's full name from inspector_accounts
            try {
                $u = $db->prepare("SELECT full_name FROM inspector_accounts WHERE username = ?");
                $u->execute([$sessionUser]);
                $fullName = trim((string)($u->fetchColumn() ?: $fullName));
            } catch (PDOException $e) {
                // keep fallback
            }
            $allowed = array_filter([
                strtolower($sessionUser),
                strtolower($fullName),
                strtolower(explode(' ', $fullName)[0] ?? ''),
            ]);
            if (!in_array(strtolower($inspector), $allowed, true)) {
                errorResponse('Inspectors can only create schedules for themselves.', 403);
            }

            // Cluster guard: inspectors may only schedule establishments whose
            // barangay belongs to their assigned cluster. Unknown/legacy
            // establishments (no sanitary record) are allowed; inspectors
            // without a cluster are unrestricted.
            if ($estabBarangay !== '') {
                $myBarangays = clusterBarangaysForSession($db);
                if ($myBarangays && !in_array(strtolower($estabBarangay), array_map('strtolower', $myBarangays), true)) {
                    errorResponse('You can only schedule inspections for establishments in your assigned cluster.', 403);
                }
            }
        }

        // The cluster's assigned inspector is who inspects: when the
        // establishment sits in a clustered barangay that has a current
        // owner, store that owner regardless of the submitted name.
        if ($estabBarangay !== '') {
            ensureClusterTables($db);
            $clusterN = fixedClusterForBarangay($estabBarangay, $db);
            $ownersMap = clusterOwners($db);
            if ($clusterN && !empty($ownersMap[$clusterN])) {
                $inspector = $ownersMap[$clusterN];
            }
        }

        // Try with new columns first, fall back to old schema
        try {
            $stmt = $db->prepare("
                INSERT INTO inspection_schedules (inspector_name, establishment, risk_level, schedDate, notes)
                VALUES (?, ?, ?, ?, ?)
            ");
            $stmt->execute([$inspector, $establishment ?: null, $riskLevel ?: null, $schedDate, $notes]);
        } catch (PDOException $e) {
            // Fallback: old schema without establishment/risk_level columns
            $stmt = $db->prepare("
                INSERT INTO inspection_schedules (inspector_name, schedDate, notes)
                VALUES (?, ?, ?)
            ");
            $stmt->execute([$inspector, $schedDate, $notes]);
        }

        logActivity($db, 'CREATE', 'schedule', null, $inspector, "Scheduled: $schedDate for " . ($establishment ?: 'general'));
        jsonResponse(true, null, 'Schedule saved.');
    } catch (PDOException $e) {
        error_log('inspection_schedules.php error: ' . $e->getMessage());
        errorResponse('Database error. Please try again.', 500);
    }
}

// ---- GET: List schedules (admin sees all; inspectors only their cluster) ----
if ($method === 'GET') {
    requireRole(['admin', 'inspector']);
    try {
        $where = [];
        $params = [];

        if (!empty($_GET['inspector'])) {
            $where[] = "inspector_name = ?";
            $params[] = $_GET['inspector'];
        }
        if (!empty($_GET['from'])) {
            $where[] = "schedDate >= ?";
            $params[] = $_GET['from'];
        }
        if (!empty($_GET['to'])) {
            $where[] = "schedDate <= ?";
            $params[] = $_GET['to'];
        }

        // Inspectors only receive schedules for establishments in their
        // cluster's barangays (each inspector sees only their own cluster;
        // admin keeps the full list). Rows whose establishment can't be
        // resolved to a sanitary record fall back to own-name matching so
        // legacy/unknown rows still reach their own inspector.
        if (($_SESSION['role'] ?? '') === 'inspector') {
            $myBarangays = clusterBarangaysForSession($db);
            $fullName = sessionInspectorFullName($db);
            $username = trim($_SESSION['username'] ?? '');
            $variants = array_values(array_unique(array_filter([
                strtolower($fullName),
                strtolower($username),
                strtolower(explode(' ', $fullName)[0] ?? ''),
            ], fn($v) => $v !== '')));

            if ($myBarangays) {
                $ph = implode(',', array_fill(0, count($myBarangays), '?'));
                $clusterRule = "establishment IN (SELECT business_name FROM sanitary_records WHERE barangay IN ($ph))";
                if ($variants) {
                    $namePh = implode(',', array_fill(0, count($variants), '?'));
                    $where[] = "($clusterRule OR (
                        (establishment IS NULL OR establishment = '' OR establishment NOT IN
                            (SELECT business_name FROM sanitary_records WHERE business_name IS NOT NULL AND business_name <> ''))
                        AND LOWER(inspector_name) IN ($namePh)
                    ))";
                    array_push($params, ...$myBarangays, ...$variants);
                } else {
                    $where[] = "($clusterRule)";
                    array_push($params, ...$myBarangays);
                }
            } elseif ($variants) {
                // No cluster assigned → only rows named for this inspector
                $namePh = implode(',', array_fill(0, count($variants), '?'));
                $where[] = "LOWER(inspector_name) IN ($namePh)";
                array_push($params, ...$variants);
            } else {
                $where[] = "1 = 0";   // no cluster and no identity → see nothing
            }
        }

        $sql = "SELECT * FROM inspection_schedules";
        if ($where) $sql .= " WHERE " . implode(" AND ", $where);
        $sql .= " ORDER BY schedDate ASC";

        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        jsonResponse(true, $stmt->fetchAll());
    } catch (PDOException $e) {
        error_log('inspection_schedules.php error: ' . $e->getMessage());
        errorResponse('Database error. Please try again.', 500);
    }
}

// ---- PUT: Mark schedule as done (admin only) ----
if ($method === 'PUT') {
    requireRole('admin');
    try {
        $input = json_decode(file_get_contents('php://input'), true);
        $id = intval($input['id'] ?? 0);
        if (!$id) errorResponse('Schedule ID required');

        $db->prepare("UPDATE inspection_schedules SET done = 1 WHERE id = ?")->execute([$id]);
        logActivity($db, 'UPDATE', 'schedule', $id, '', 'Schedule marked complete');
        jsonResponse(true, null, 'Schedule marked complete.');
    } catch (PDOException $e) {
        error_log('inspection_schedules.php error: ' . $e->getMessage());
        errorResponse('Database error. Please try again.', 500);
    }
}

// ---- DELETE: Archive schedule (admin only) ----
if ($method === 'DELETE') {
    requireRole('admin');
    try {
        $id = intval($_GET['id'] ?? 0);
        if (!$id) errorResponse('Schedule ID required');
        $reason = trim($_GET['reason'] ?? '');

        $stmt = $db->prepare("SELECT * FROM inspection_schedules WHERE id = ?");
        $stmt->execute([$id]);
        $schedule = $stmt->fetch();
        if (!$schedule) errorResponse('Schedule not found.', 404);

        $db->beginTransaction();
        $db->prepare("INSERT INTO archive_data (archive_type, data_json, reason, expiry_date) VALUES ('schedule', ?, ?, NULL)")
            ->execute([json_encode($schedule), $reason]);
        $db->prepare("DELETE FROM inspection_schedules WHERE id = ?")->execute([$id]);
        $db->commit();

        logActivity($db, 'ARCHIVE', 'schedule', $id, $schedule['inspector_name'] ?? '',
            "Archived schedule for " . ($schedule['schedDate'] ?? '') . ($reason !== '' ? ": $reason" : ''));
        jsonResponse(true, null, 'Schedule archived.');
    } catch (PDOException $e) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('inspection_schedules.php error: ' . $e->getMessage());
        errorResponse('Database error. Please try again.', 500);
    }
}

errorResponse('Method not allowed', 405);
