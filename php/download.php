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
// Admin: allowed. Inspector: allowed for valid records.
$isAdmin = (($_SESSION['role'] ?? '') === 'admin');
if (!$isAdmin) {
    $owned = false;
    foreach (['inspection_reports', 'inspection_history', 'burial_records'] as $tbl) {
        $stmt = $db->prepare("SELECT 1 FROM `{$tbl}` WHERE file_path = ? LIMIT 1");
        $stmt->execute([$path]);
        if ($stmt->fetch()) {
            $owned = true;
            break;
        }
    }
    if (!$owned) {
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
$origName = null;
foreach (['inspection_reports', 'inspection_history', 'burial_records'] as $tbl) {
    try {
        $nameStmt = $db->prepare("SELECT file_name FROM `{$tbl}` WHERE file_path = ? AND file_name IS NOT NULL AND file_name <> '' LIMIT 1");
        $nameStmt->execute([$path]);
        $n = $nameStmt->fetchColumn();
        if ($n) {
            $dec = decryptRow($tbl, ['file_name' => $n]);
            $origName = $dec['file_name'] ?? $n;
            break;
        }
    } catch (Exception $e) {
        // ignore and continue
    }
}
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
