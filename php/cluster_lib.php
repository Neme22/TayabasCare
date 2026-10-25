<?php
// ============================================================
// Shared barangay-cluster helpers.
// Used by clusters.php (admin assigns inspectors to clusters),
// inspection.php (record scoping) and inspection_schedules.php
// (cluster guard).
//
// The 66 barangays are partitioned into 5 FIXED clusters in code
// (fixedClusterBarangays below). The admin does not edit the
// partition — they only choose which inspector owns each cluster
// (stored in cluster_assignments).
// ============================================================

function ensureClusterTables(PDO $db): void
{
    try {
        $db->exec(
            "CREATE TABLE IF NOT EXISTS cluster_assignments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                cluster_number TINYINT NOT NULL,
                inspector_full_name VARCHAR(255) NOT NULL,
                UNIQUE KEY uq_cluster (cluster_number)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
        );
    } catch (PDOException $e) {
        error_log('cluster tables create: ' . $e->getMessage());
    }
}

/**
 * Fixed partition of the official 66 Tayabas barangays into
 * Cluster 1-5 (alphabetical blocks; zone families never split).
 *
 * @return array<int, string[]> cluster_number => barangay names
 */
function fixedClusterBarangays(): array
{
    return [
        1 => [
            'Alitao', 'Alsam Ibaba', 'Alsam Ilaya', 'Alupay',
            'Angeles Zone I', 'Angeles Zone II', 'Angeles Zone III', 'Angeles Zone IV',
            'Angustias Zone I', 'Angustias Zone II', 'Angustias Zone III', 'Angustias Zone IV',
            'Anos', 'Ayaas',
        ],
        2 => [
            'Baguio', 'Banilad', 'Bukal Ibaba', 'Bukal Ilaya',
            'Calantas', 'Calumpang', 'Camaysa', 'Dapdap',
            'Domoit Kanluran', 'Domoit Silangan', 'Gibanga', 'Ibas',
            'Ilasan Ibaba', 'Ilasan Ilaya',
        ],
        3 => [
            'Ipilan', 'Isabang', 'Katigan Kanluran', 'Katigan Silangan',
            'Lakawan', 'Lalo', 'Lawigue', 'Lita',
            'Malaoa', 'Masin', 'Mate', 'Mateuna',
            'Mayowe', 'Nangka Ibaba',
        ],
        4 => [
            'Nangka Ilaya', 'Opias',
            'Palale Ibaba', 'Palale Ilaya', 'Palale Kanluran', 'Palale Silangan',
            'Pandakaki', 'Pook', 'Potol',
            'San Diego Zone I', 'San Diego Zone II', 'San Diego Zone III', 'San Diego Zone IV',
        ],
        5 => [
            'San Isidro Zone I', 'San Isidro Zone II', 'San Isidro Zone III', 'San Isidro Zone IV',
            'San Roque Zone I', 'San Roque Zone II',
            'Talolong', 'Tamlong', 'Tongko', 'Valencia', 'Wakas',
        ],
    ];
}

/** Cluster number that owns a barangay ('' when not in the fixed partition). */
function fixedClusterForBarangay(string $barangay): int
{
    static $lookup = null;
    if ($lookup === null) {
        $lookup = [];
        foreach (fixedClusterBarangays() as $n => $names) {
            foreach ($names as $name) {
                $lookup[mb_strtolower($name)] = $n;
            }
        }
    }
    return $lookup[mb_strtolower(trim($barangay))] ?? 0;
}

/** Resolve the session user's inspector full name ('' when not an inspector). */
function sessionInspectorFullName(PDO $db): string
{
    if (($_SESSION['role'] ?? '') !== 'inspector') {
        return '';
    }
    $username = trim($_SESSION['username'] ?? '');
    if ($username === '') {
        return '';
    }
    try {
        $stmt = $db->prepare("SELECT full_name FROM inspector_accounts WHERE username = ?");
        $stmt->execute([$username]);
        return trim((string)($stmt->fetchColumn() ?: ''));
    } catch (PDOException $e) {
        return '';
    }
}

/** cluster_number => inspector_full_name from cluster_assignments (admin-managed). */
function clusterOwners(PDO $db): array
{
    try {
        ensureClusterTables($db);
        $rows = $db->query("SELECT cluster_number, inspector_full_name FROM cluster_assignments")->fetchAll();
        $out = [];
        foreach ($rows as $r) {
            $owner = trim($r['inspector_full_name']);
            if ($owner !== '' && $owner !== 'Unassigned') {
                $out[(int)$r['cluster_number']] = $owner;
            }
        }
        return $out;
    } catch (PDOException $e) {
        error_log('clusterOwners: ' . $e->getMessage());
        return [];
    }
}

/**
 * Barangays of the session inspector's cluster.
 * Returns [] when the inspector has no cluster assigned.
 */
function clusterBarangaysForSession(PDO $db): array
{
    $fullName = sessionInspectorFullName($db);
    if ($fullName === '') {
        return [];
    }
    $owners = clusterOwners($db);
    $fixed  = fixedClusterBarangays();
    foreach ($owners as $n => $owner) {
        if (strcasecmp($owner, $fullName) === 0) {
            return $fixed[$n] ?? [];
        }
    }
    return [];
}

/**
 * Pending (not-yet-done) schedules follow the cluster owners: any row whose
 * establishment sits in a clustered barangay is re-attributed to that
 * cluster's current inspector. Historical (done) rows keep the inspector
 * who actually performed them. Call inside a transaction on reshuffle.
 */
function syncPendingSchedulesToOwners(PDO $db, array $owners): void
{
    foreach (fixedClusterBarangays() as $n => $names) {
        $owner = trim($owners[$n] ?? '');
        if ($owner === '' || $owner === 'Unassigned') {
            continue;
        }
        $ph = implode(',', array_fill(0, count($names), '?'));
        $stmt = $db->prepare(
            "UPDATE inspection_schedules s
             JOIN sanitary_records r ON r.business_name = s.establishment
             SET s.inspector_name = ?
             WHERE s.done = 0 AND r.barangay IN ($ph)"
        );
        $stmt->execute(array_merge([$owner], $names));
    }
}
