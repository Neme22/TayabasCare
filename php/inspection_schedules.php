<?php
require_once 'auth_check.php';
require_once 'activity_log.php';
require_once 'csrf.php';
require_once 'cluster_lib.php';
require_once 'inspector_notif_lib.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'OPTIONS') { http_response_code(200); exit(); }

if (csrfNeeded()) {
    requireCsrf();
}

ensureScheduleDutyColumn($db);

// ---- POST: Create/update schedule ----
// Admin can schedule single or multiple dates for duty (Inspections, Sanitary, Burial);
// inspectors may only schedule for themselves (auto-schedule from compliance deadlines).
if ($method === 'POST') {
    try {
        $input = json_decode(file_get_contents('php://input'), true) ?: [];

        $inspector     = trim($input['inspector'] ?? '');
        $schedDate     = trim($input['schedDate'] ?? '');
        $schedDatesRaw = $input['schedDates'] ?? null;
        $rawDutyType   = trim($input['dutyType'] ?? ($input['duty_type'] ?? ''));
        $notes         = trim($input['notes'] ?? '');
        $establishment = trim($input['establishment'] ?? '');
        $riskLevel     = trim($input['riskLevel'] ?? '');

        // Normalize & validate dates (supports single schedDate or array schedDates)
        $dates = [];
        if (is_array($schedDatesRaw) && count($schedDatesRaw) > 0) {
            foreach ($schedDatesRaw as $d) {
                $d = trim((string)$d);
                if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) {
                    $dates[] = $d;
                }
            }
        } elseif ($schedDate !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $schedDate)) {
            $dates[] = $schedDate;
        }
        $dates = array_values(array_unique($dates));
        sort($dates);

        // Normalize dutyType
        $dutyType = '';
        if ($rawDutyType !== '') {
            $dutyMap = [
                'inspections' => 'Inspections',
                'inspection'  => 'Inspections',
                'sanitary'    => 'Sanitary',
                'burial'      => 'Burial'
            ];
            $key = strtolower($rawDutyType);
            if (!isset($dutyMap[$key])) {
                errorResponse('Invalid duty type. Allowed values: Inspections, Sanitary, Burial.', 400);
            }
            $dutyType = $dutyMap[$key];
        }

        if (!$inspector || empty($dates)) {
            errorResponse('Missing inspector or valid schedule date(s).', 400);
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
            if ($dutyType !== '') {
                errorResponse('Only administrators can assign duty schedules.', 403);
            }
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
        } else {
            // Canonicalize inspector full_name when possible
            $ident = resolveInspectorIdentity($db, $inspector);
            if ($ident['full_name'] !== '') {
                $inspector = $ident['full_name'];
            }
        }

        $db->beginTransaction();
        foreach ($dates as $d) {
            if ($dutyType !== '' && $establishment === '') {
                // Prevent duplicate active duty entry for the exact same inspector, date, and duty_type
                $dupStmt = $db->prepare(
                    "SELECT id FROM inspection_schedules
                     WHERE LOWER(inspector_name) = LOWER(?) AND schedDate = ? AND duty_type = ? AND done = 0
                     LIMIT 1"
                );
                $dupStmt->execute([$inspector, $d, $dutyType]);
                $existingId = $dupStmt->fetchColumn();
                if ($existingId) {
                    if ($notes !== '') {
                        $db->prepare("UPDATE inspection_schedules SET notes = ? WHERE id = ?")->execute([$notes, $existingId]);
                    }
                    continue;
                }
            }

            $stmt = $db->prepare("
                INSERT INTO inspection_schedules (inspector_name, establishment, duty_type, risk_level, schedDate, notes)
                VALUES (?, ?, ?, ?, ?, ?)
            ");
            $stmt->execute([
                $inspector,
                $establishment !== '' ? $establishment : null,
                $dutyType !== '' ? $dutyType : null,
                $riskLevel !== '' ? $riskLevel : null,
                $d,
                $notes
            ]);
        }
        $db->commit();

        if ($dutyType !== '') {
            $dateSummary = count($dates) > 1
                ? count($dates) . ' day(s): ' . implode(', ', $dates)
                : $dates[0];
            logActivity($db, 'CREATE', 'schedule', null, $inspector, "Scheduled $dutyType duty ($dateSummary)");
        } else {
            logActivity($db, 'CREATE', 'schedule', null, $inspector, "Scheduled: " . implode(', ', $dates) . " for " . ($establishment ?: 'general'));
        }

        // Create persistent in-app bell notification for the inspector when admin schedules
        if ($sessionRole === 'admin') {
            $dateLabels = array_map(fn($dt) => date('M j, Y', strtotime($dt)), $dates);
            if ($dutyType !== '') {
                $notifTitle = "New {$dutyType} Duty Schedule";
                if (count($dates) === 1) {
                    $notifMsg = "You are scheduled for {$dutyType} duty on {$dateLabels[0]}.";
                } else {
                    $shortLabels = array_map(fn($dt) => date('M j', strtotime($dt)), $dates);
                    $notifMsg = "You are scheduled for {$dutyType} duty for " . count($dates) . " days (" . implode(', ', $shortLabels) . ").";
                }
            } else {
                $notifTitle = 'New Inspection Schedule';
                $notifMsg = "You are scheduled for inspection"
                    . ($establishment !== '' ? " at {$establishment}" : '')
                    . " on {$dateLabels[0]}.";
            }
            if ($notes !== '') {
                $notifMsg .= " Note: {$notes}";
            }
            createInspectorNotification(
                $db,
                $inspector,
                'assigned',
                $dutyType,
                $notifTitle,
                $notifMsg,
                $dates[0],
                $dates
            );
        }

        jsonResponse(true, [
            'inspector' => $inspector,
            'dutyType'  => $dutyType,
            'dates'     => $dates
        ], 'Schedule saved.');
    } catch (PDOException $e) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('inspection_schedules.php error: ' . $e->getMessage());
        errorResponse('Database error. Please try again.', 500);
    }
}

// ---- GET: List schedules (admin sees all; inspectors only their cluster) ----
if ($method === 'GET') {
    requireRole(['admin', 'inspector']);
    try {
        // Automatically sync duty shift completion status with calendar date (past = Done, today/future = Pending)
        try {
            $todayPh = (new DateTimeImmutable('now', new DateTimeZone('Asia/Manila')))->format('Y-m-d');
            $db->prepare(
                "UPDATE inspection_schedules
                 SET done = 1
                 WHERE done = 0 AND schedDate < ?"
            )->execute([$todayPh]);
            $db->prepare(
                "UPDATE inspection_schedules
                 SET done = 0
                 WHERE done = 1 AND duty_type IS NOT NULL AND duty_type <> '' AND schedDate >= ?"
            )->execute([$todayPh]);
        } catch (PDOException $e) {
            error_log('inspection_schedules auto-done error: ' . $e->getMessage());
        }

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
        // duty schedules and legacy/unknown rows still reach their own inspector.
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
                    $where[] = "($clusterRule OR LOWER(inspector_name) IN ($namePh))";
                    array_push($params, ...$myBarangays, ...$variants);
                } else {
                    $where[] = "($clusterRule)";
                    array_push($params, ...$myBarangays);
                }
            } elseif ($variants) {
                // No cluster assigned -> only rows named for this inspector
                $namePh = implode(',', array_fill(0, count($variants), '?'));
                $where[] = "LOWER(inspector_name) IN ($namePh)";
                array_push($params, ...$variants);
            } else {
                $where[] = "1 = 0";   // no cluster and no identity -> see nothing
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
