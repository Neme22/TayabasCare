<?php
require_once 'auth_check.php';
require_once 'csrf.php';
require_once 'activity_log.php';
require_once 'cluster_lib.php';     // fixed partition + shared helpers

// ============================================================
// Cluster <-> inspector assignments (admin-managed, 5 clusters).
// The 66 barangays per cluster are FIXED in cluster_lib.php —
// the admin only chooses the inspector that owns each cluster.
// GET  — any logged-in user: fixed clusters + owners + myCluster
// POST — admin only: replace-all inspector assignments (reshuffle)
// ============================================================

$method = $_SERVER['REQUEST_METHOD'];
if (csrfNeeded()) {
    requireCsrf();
}

ensureClusterTables($db);

/** All 5 clusters: fixed barangays + current inspector owner (if any). */
function loadClusters(PDO $db): array
{
    $owners = clusterOwners($db);
    $fixed  = fixedClusterBarangays();
    $out = [];
    foreach ([1, 2, 3, 4, 5] as $n) {
        $out[] = [
            'cluster_number'      => $n,
            'inspector_full_name' => $owners[$n] ?? '',
            'barangays'           => $fixed[$n] ?? [],
        ];
    }
    return $out;
}

// ---- GET ----
if ($method === 'GET') {
    try {
        $clusters = loadClusters($db);

        if (!empty($_GET['barangays'])) {
            $flat = [];
            foreach ($clusters as $c) {
                foreach ($c['barangays'] as $brgy) {
                    $flat[$brgy] = $c['cluster_number'];
                }
            }
            jsonResponse(true, ['barangays' => $flat]);
        }

        // myCluster: filled for inspector sessions (username -> full name)
        $myCluster = null;
        if (($_SESSION['role'] ?? '') === 'inspector') {
            $fullName = sessionInspectorFullName($db);
            if ($fullName !== '') {
                foreach ($clusters as $c) {
                    if (strcasecmp($c['inspector_full_name'], $fullName) === 0) {
                        $myCluster = $c;
                        break;
                    }
                }
            }
        }

        jsonResponse(true, ['clusters' => $clusters, 'myCluster' => $myCluster]);
    } catch (PDOException $e) {
        error_log('clusters.php GET: ' . $e->getMessage());
        errorResponse('An error occurred. Please try again.', 500);
    }
}

// ---- POST (admin only): replace-all inspector assignments ----
if ($method === 'POST') {
    requireRole('admin');
    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input)) {
        errorResponse('Invalid payload.', 400);
    }

    // Accept either a bare array or { assignments: [...] }
    $list = isset($input['assignments']) && is_array($input['assignments'])
        ? $input['assignments']
        : $input;

    $owners = [];   // cluster_number => inspector full name ('' = unassigned)
    foreach ($list as $entry) {
        if (!is_array($entry)) continue;
        $num = (int)($entry['cluster_number'] ?? 0);
        if ($num < 1 || $num > 5) {
            errorResponse('Cluster number must be 1-5.', 400);
        }
        $owners[$num] = trim((string)($entry['inspector_full_name'] ?? ''));
    }

    // One owner per cluster: all 5 clusters must be present (5 inspectors)
    for ($i = 1; $i <= 5; $i++) {
        if (!isset($owners[$i])) {
            errorResponse('All 5 clusters (Cluster 1-5) are required — one cluster per inspector.', 400);
        }
    }

    try {
        $db->beginTransaction();

        $db->exec("DELETE FROM cluster_assignments");
        $insStmt = $db->prepare(
            "INSERT INTO cluster_assignments (cluster_number, inspector_full_name) VALUES (?, ?)"
        );
        foreach ($owners as $num => $fullName) {
            $insStmt->execute([$num, $fullName !== '' ? $fullName : 'Unassigned']);
        }

        // Pending schedules follow the new owners (historical rows untouched)
        syncPendingSchedulesToOwners($db, $owners);

        $db->commit();

        logActivity($db, 'UPDATE', 'cluster', null, $_SESSION['username'] ?? '', 'Cluster inspector assignments saved (5 clusters)');
        jsonResponse(true, loadClusters($db), 'Cluster assignments saved.');
    } catch (PDOException $e) {
        if ($db->inTransaction()) $db->rollBack();
        error_log('clusters.php POST: ' . $e->getMessage());
        errorResponse('Database error. Please try again.', 500);
    }
}

errorResponse('Method not allowed', 405);
