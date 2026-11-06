<?php
/**
 * One-time backfill: encrypt existing plaintext PII in place.
 * Idempotent — skips values already starting with enc1:.
 * Run once in browser: /php/migrate_encrypt.php?token=<MIGRATE_TOKEN>
 * Requires DB user with ALTER (use root temporarily, then swap back).
 */
require_once 'config.php';

$token = $_GET['token'] ?? '';
$expected = getenv('MIGRATE_TOKEN') ?: '';
if ($expected === '' || !hash_equals($expected, $token)) {
    http_response_code(403);
    exit('Forbidden');
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    http_response_code(405);
    exit('GET only');
}

set_time_limit(300);
$report = ['steps' => [], 'encrypted' => 0, 'moved' => 0, 'errors' => []];

function encryptColumnBatch(string $table, string $column, int $batch = 200): int {
    global $db;
    $done = 0;
    $aad = $table . '.' . $column;
    while (true) {
        $stmt = $db->query("SELECT id, `$column` FROM `$table` WHERE `$column` IS NOT NULL AND `$column` <> '' AND `$column` NOT LIKE 'enc1:%' LIMIT $batch");
        $rows = $stmt->fetchAll();
        if (!$rows) break;
        $db->beginTransaction();
        try {
            $upd = $db->prepare("UPDATE `$table` SET `$column` = ? WHERE id = ?");
            foreach ($rows as $r) {
                $upd->execute([encryptField((string)$r[$column], $aad), $r['id']]);
                $done++;
            }
            $db->commit();
        } catch (Throwable $e) {
            if ($db->inTransaction()) $db->rollBack();
            throw $e;
        }
        if (count($rows) < $batch) break;
    }
    return $done;
}

try {
    // 1. Move legacy uploads into encrypted storage FIRST (data_json still plaintext-searchable)
    require_once __DIR__ . '/storage.php';
    $legacyBase = realpath(__DIR__ . '/../uploads');
    if ($legacyBase) {
        foreach (['inspections', 'burial'] as $sub) {
            $dir = $legacyBase . DIRECTORY_SEPARATOR . $sub;
            if (!is_dir($dir)) continue;
            $dest = ensureStorage($sub);
            foreach (scandir($dir) as $f) {
                if ($f === '.' || $f === '..' || $f === '.htaccess') continue;
                $src = $dir . DIRECTORY_SEPARATOR . $f;
                if (!is_file($src)) continue;
                $newName = bin2hex(random_bytes(16)) . '.enc';
                $dst = $dest . DIRECTORY_SEPARATOR . $newName;
                if (!copy($src, $dst)) { $report['errors'][] = "copy failed: $f"; continue; }
                try {
                    encryptFileInPlace($dst);
                    $rel = 'uploads/' . $sub . '/' . $f;
                    $newPath = storageRelPath($sub, $newName);
                    foreach (['inspection_reports', 'inspection_history', 'burial_records'] as $ft) {
                        $db->prepare("UPDATE `$ft` SET file_path = ? WHERE file_path = ?")->execute([$newPath, $rel]);
                    }
                    $db->prepare("UPDATE archive_data SET data_json = REPLACE(data_json, ?, ?) WHERE data_json LIKE ?")
                       ->execute([$rel, $newPath, '%' . $rel . '%']);
                    @unlink($src);
                    $report['moved']++;
                } catch (Throwable $e) {
                    @unlink($dst);
                    $report['errors'][] = "encrypt move $f: " . $e->getMessage();
                }
            }
        }
    }
    $report['steps'][] = "legacy uploads moved+encrypted: {$report['moved']}";

    // 2. Safe-core columns
    foreach (encryptedColumnsByTable() as $table => $columns) {
        if ($table === 'archive_data') continue;
        $t = $db->query("SHOW TABLES LIKE " . $db->quote($table))->fetch();
        if (!$t) { $report['steps'][] = "$table: skipped (missing)"; continue; }
        foreach ($columns as $col) {
            try {
                $n = encryptColumnBatch($table, $col);
                $report['encrypted'] += $n;
                $report['steps'][] = "$table.$col: encrypted $n";
            } catch (Throwable $e) {
                $report['errors'][] = "$table.$col: " . $e->getMessage();
            }
        }
    }

    // 3. archive_data.data_json — encrypt whole blob last
    try {
        $n = encryptColumnBatch('archive_data', 'data_json');
        $report['encrypted'] += $n;
        $report['steps'][] = "archive_data.data_json: encrypted $n";
    } catch (Throwable $e) {
        $report['errors'][] = "archive_data.data_json: " . $e->getMessage();
    }

    header('Content-Type: application/json');
    echo json_encode(['success' => empty($report['errors']), 'data' => $report, 'message' => 'Migration complete'], JSON_PRETTY_PRINT);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'data' => $report, 'message' => $e->getMessage()]);
}
