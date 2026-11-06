<?php
/**
 * App-level field & file encryption (AES-256-GCM) + blind indexes.
 * Key lives in php/.env as APP_ENCRYPTION_KEY (base64, 32 bytes) — never in the DB.
 *
 * Ciphertext format: 'enc1:' . base64(iv(12) || tag(16) || ct)
 * File format:       'TENC1' || iv(12) || tag(16) || ct
 * AAD = "table.column" so ciphertext cannot be swapped between columns.
 */

function encKey(): string {
    static $key = null;
    if ($key !== null) return $key;
    $b64 = getenv('APP_ENCRYPTION_KEY') ?: '';
    $key = $b64 !== '' ? base64_decode($b64, true) : false;
    if ($key === false || strlen($key) !== 32) {
        throw new RuntimeException('APP_ENCRYPTION_KEY missing or not 32 bytes (base64). Generate: php -r "echo base64_encode(random_bytes(32));"');
    }
    return $key;
}

/** Derived HMAC key for blind indexes — no extra env var needed. */
function blindKey(): string {
    return hash_hmac('sha256', 'blind-v1', encKey(), true);
}

function encryptField(string $plain, string $aad): string {
    if ($plain === '') return $plain;
    // Idempotent: never double-encrypt (e.g. re-saving an already-fetched ciphertext row)
    if (str_starts_with($plain, 'enc1:')) return $plain;
    $iv = random_bytes(12);
    $tag = '';
    $ct = openssl_encrypt($plain, 'aes-256-gcm', encKey(), OPENSSL_RAW_DATA, $iv, $tag, $aad);
    if ($ct === false) throw new RuntimeException('openssl_encrypt failed');
    return 'enc1:' . base64_encode($iv . $tag . $ct);
}

/**
 * Decrypt a stored value. Non-enc1 values (legacy plaintext) pass through unchanged
 * so old rows keep working before the migrator runs. Returns null on auth failure.
 */
function decryptField(string $stored, string $aad): ?string {
    if ($stored === '' || !str_starts_with($stored, 'enc1:')) return $stored;
    $raw = base64_decode(substr($stored, 5), true);
    if ($raw === false || strlen($raw) < 29) return null;
    $iv = substr($raw, 0, 12);
    $tag = substr($raw, 12, 16);
    $ct = substr($raw, 28);
    $pt = openssl_decrypt($ct, 'aes-256-gcm', encKey(), OPENSSL_RAW_DATA, $iv, $tag, $aad);
    return $pt === false ? null : $pt;
}

/** Blind index for exact-match lookups on encrypted name columns. */
function blindIndex(string $value): string {
    return hash_hmac('sha256', mb_strtolower(trim($value)), blindKey());
}

/** Blind index matching SQL LOWER(TRIM(x)) normalization. */
function blindIndexLowerTrim(string $value): string {
    return hash_hmac('sha256', strtolower(trim($value)), blindKey());
}

function encryptFileInPlace(string $path): void {
    $plain = file_get_contents($path);
    if ($plain === false) throw new RuntimeException("Cannot read file: $path");
    $iv = random_bytes(12);
    $tag = '';
    $ct = openssl_encrypt($plain, 'aes-256-gcm', encKey(), OPENSSL_RAW_DATA, $iv, $tag, 'file.v1');
    if ($ct === false) throw new RuntimeException('File encryption failed');
    if (file_put_contents($path, 'TENC1' . $iv . $tag . $ct, LOCK_EX) === false) {
        throw new RuntimeException("Cannot write encrypted file: $path");
    }
}

function decryptFileTo(string $encPath, string $outPath): void {
    $raw = file_get_contents($encPath);
    if ($raw === false) throw new RuntimeException("Cannot read file: $encPath");
    if (str_starts_with($raw, 'TENC1')) {
        $body = substr($raw, 5);
        $iv = substr($body, 0, 12);
        $tag = substr($body, 12, 16);
        $ct = substr($body, 28);
        $pt = openssl_decrypt($ct, 'aes-256-gcm', encKey(), OPENSSL_RAW_DATA, $iv, $tag, 'file.v1');
        if ($pt === false) throw new RuntimeException('File decryption failed');
        file_put_contents($outPath, $pt, LOCK_EX);
    } else {
        // Legacy plaintext file — stream as-is
        if (!copy($encPath, $outPath)) throw new RuntimeException('File copy failed');
    }
}

function isEncryptedFile(string $path): bool {
    $fh = fopen($path, 'rb');
    if (!$fh) return false;
    $magic = fread($fh, 5);
    fclose($fh);
    return $magic === 'TENC1';
}

/**
 * Decrypt a DB row's encrypted columns in place (by table name).
 * Returns the row with decrypted string values; null columns stay null.
 */
function decryptRow(string $table, array $row): array {
    static $cols = null;
    if ($cols === null) $cols = encryptedColumnsByTable();
    if (!isset($cols[$table])) return $row;
    foreach ($cols[$table] as $col) {
        if (isset($row[$col]) && is_string($row[$col]) && $row[$col] !== '') {
            $dec = decryptField($row[$col], $table . '.' . $col);
            if ($dec !== null) $row[$col] = $dec;
        }
    }
    // Blind-index helper columns are internal — strip from API output
    foreach (['_bi'] as $suffix) {
        // handled per-column below
    }
    if (str_ends_with($table, '') ) { /* no-op */ }
    return $row;
}

/** Remove blind-index columns from API output. */
function stripBiColumns(array $row): array {
    foreach (array_keys($row) as $k) {
        if (str_ends_with($k, '_bi')) unset($row[$k]);
    }
    return $row;
}

/**
 * Master list of encrypted columns per table (must match migrate_encrypt.php).
 * Blind-index columns: name => bi column using blindIndex() normalization.
 */
function encryptedColumnsByTable(): array {
    return [
        // Safe core only: display PII with no SQL predicates/type-sensitive use.
        // business_name/establishment/remarks/death_date/booleans deliberately plaintext.
        'sanitary_records' => [
            'owner_first_name', 'owner_middle_name', 'owner_last_name',
            'personnel_list', 'sex', 'building_street', 'corporation_name',
            'admin_risk_remarks',
        ],
        'burial_records' => [
            'deceased', 'death_place', 'cause_of_death', 'informant',
            'sex', 'age',
        ],
        'inspection_reports' => ['file_name'],
        'inspection_history' => ['file_name'],
        'archive_data' => ['data_json'],
    ];
}

/** Blind-index column map: table => [plaintext col => bi col]. Safe-core scope: none needed. */
function blindIndexColumnsByTable(): array {
    return [];
}
