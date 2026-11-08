<?php
require_once 'config.php';
require_once 'storage.php';

if (!isset($_SESSION['user_id'])) {
    http_response_code(403);
    echo json_encode(['success' => false, 'data' => null, 'message' => 'Not authorized.']);
    exit();
}

$path = $_GET['path'] ?? '';
if ($path === '') {
    http_response_code(404);
    echo json_encode(['success' => false, 'data' => null, 'message' => 'File not found.']);
    exit();
}

// Resolve absolute path (legacy project uploads/ or new ST: storage)
$realFile = null;
if (str_starts_with($path, 'ST:')) {
    $resolved = resolveStoredFile($path);
    if ($resolved) $realFile = realpath($resolved);
} else {
    $realBase = realpath(__DIR__ . '/../uploads/');
    $candidate = realpath(__DIR__ . '/../' . $path);
    if ($realBase && $candidate && str_starts_with($candidate, $realBase . DIRECTORY_SEPARATOR) && is_file($candidate)) {
        $realFile = $candidate;
    }
}

if (!$realFile || !is_file($realFile)) {
    http_response_code(404);
    echo json_encode(['success' => false, 'data' => null, 'message' => 'File not found.']);
    exit();
}

// Ownership: the file must belong to a record the session user may view.
// Admin: allowed. Inspector: must own the report (cluster/inspector match) or burial record.
$isAdmin = (($_SESSION['role'] ?? '') === 'admin');
if (!$isAdmin) {
    $owned = false;
    $stmt = $db->prepare("
        SELECT 1 AS ok FROM inspection_reports WHERE file_path = ? LIMIT 1
    ");
    $stmt->execute([$path]);
    if ($row = $stmt->fetch()) {
        // Ownership enforced like requireReportOwnership: inspector_name matches session
        $stmt2 = $db->prepare("
            SELECT 1 AS ok FROM inspection_reports
            WHERE file_path = ? AND (inspector_name = ? OR inspector_name = (SELECT full_name FROM inspector_accounts WHERE username = ? LIMIT 1))
            LIMIT 1
        ");
        $stmt2->execute([$path, $_SESSION['username'] ?? '', $_SESSION['username'] ?? '']);
        $owned = (bool)$stmt2->fetch();
        if (!$owned) {
            // Fall back: any report row + inspector role = allow only if username matches either field;
            // otherwise check history table ownership too
            $stmt3 = $db->prepare("
                SELECT 1 AS ok FROM inspection_history
                WHERE file_path = ? AND (inspector_name = ? OR inspector_name = (SELECT full_name FROM inspector_accounts WHERE username = ? LIMIT 1))
                LIMIT 1
            ");
            $stmt3->execute([$path, $_SESSION['username'] ?? '', $_SESSION['username'] ?? '']);
            $owned = (bool)$stmt3->fetch();
        }
    } else {
        $stmt2 = $db->prepare("
            SELECT 1 AS ok FROM inspection_history WHERE file_path = ? AND (inspector_name = ? OR inspector_name = (SELECT full_name FROM inspector_accounts WHERE username = ? LIMIT 1)) LIMIT 1
        ");
        $stmt2->execute([$path, $_SESSION['username'] ?? '', $_SESSION['username'] ?? '']);
        $owned = (bool)$stmt2->fetch();
        if (!$owned) {
            $stmt3 = $db->prepare("
                SELECT 1 AS ok FROM burial_records WHERE file_path = ? AND (inspector = ? OR inspector = (SELECT full_name FROM inspector_accounts WHERE username = ? LIMIT 1)) LIMIT 1
            ");
            $stmt3->execute([$path, $_SESSION['username'] ?? '', $_SESSION['username'] ?? '']);
            $owned = (bool)$stmt3->fetch();
        }
    }
    if (!$owned) {
        // Admin-only burial check for admins handled above; for inspectors with no owning row: deny
        http_response_code(403);
        echo json_encode(['success' => false, 'data' => null, 'message' => 'Not authorized for this file.']);
        exit();
    }
}

// Decrypt if encrypted (TENC1), else stream legacy plaintext
$servePath = $realFile;
$tmpOut = null;
if (isEncryptedFile($realFile)) {
    $tmpOut = tempnam(sys_get_temp_dir(), 'dl_');
    try {
        decryptFileTo($realFile, $tmpOut);
    } catch (RuntimeException $e) {
        @unlink($tmpOut);
        http_response_code(500);
        echo json_encode(['success' => false, 'data' => null, 'message' => 'Failed to decrypt file.']);
        exit();
    }
    $servePath = $tmpOut;
}

$displayBase = basename(str_starts_with($path, 'ST:') ? substr($path, 3) : $realFile);
$safeName = preg_replace('/[^\w.\-]/', '_', $displayBase);
// Prefer original name from owning record when available
$nameStmt = $db->prepare("
    SELECT file_name FROM (
        SELECT file_name FROM inspection_reports WHERE file_path = ? AND file_name IS NOT NULL AND file_name <> ''
        UNION ALL
        SELECT file_name FROM inspection_history WHERE file_path = ? AND file_name IS NOT NULL AND file_name <> ''
        UNION ALL
        SELECT file_name FROM burial_records WHERE file_path = ? AND file_name IS NOT NULL AND file_name <> ''
    ) t LIMIT 1
");
$nameStmt->execute([$path, $path, $path]);
$origName = $nameStmt->fetchColumn();
if ($origName) {
    $safeName = preg_replace('/[^\w.\-]/', '_', basename($origName));
}

$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mime = finfo_file($finfo, $servePath);
finfo_close($finfo);

$ext = strtolower(pathinfo($safeName, PATHINFO_EXTENSION));
$knownMimes = [
    'pdf'  => 'application/pdf',
    'jpg'  => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'png'  => 'image/png',
    'gif'  => 'image/gif',
    'webp' => 'image/webp',
    'svg'  => 'image/svg+xml',
    'txt'  => 'text/plain',
];
if (isset($knownMimes[$ext])) {
    $mime = $knownMimes[$ext];
} elseif ($mime === false || $mime === 'application/octet-stream') {
    $mime = 'application/octet-stream';
}

header('Content-Type: ' . $mime);
header('Content-Disposition: inline; filename="' . $safeName . '"');
header('Content-Length: ' . filesize($servePath));
header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, max-age=3600');
readfile($servePath);

if ($tmpOut) @unlink($tmpOut);
exit();
