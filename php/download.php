<?php
require_once 'config.php';
if (!isset($_SESSION['user_id'])) {
    http_response_code(403);
    echo json_encode(['success' => false, 'data' => null, 'message' => 'Not authorized.']);
    exit();
}
$path = $_GET['path'] ?? '';
$realBase = realpath(__DIR__ . '/../uploads/');
$realFile = realpath(__DIR__ . '/../' . $path);
if (!$realFile || !str_starts_with($realFile, $realBase . DIRECTORY_SEPARATOR) || !is_file($realFile)) {
    http_response_code(404);
    echo json_encode(['success' => false, 'data' => null, 'message' => 'File not found.']);
    exit();
}
$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mime = finfo_file($finfo, $realFile);
finfo_close($finfo);
header('Content-Type: ' . $mime);
header('Content-Description: File Transfer');
header('Content-Disposition: attachment; filename="' . basename($realFile) . '"');
header('Content-Length: ' . filesize($realFile));
readfile($realFile);