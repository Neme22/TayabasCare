<?php
require_once 'config.php';
require_once 'auth_check.php';
require_once 'csrf.php';
require_once 'storage.php';
require_once 'activity_log.php';

const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const AVATAR_ALLOWED_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
const AVATAR_ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function ensureProfilePictureColumn(PDO $db): void {
    static $checked = false;
    if ($checked) return;
    $checked = true;
    try {
        $cols = $db->query("SHOW COLUMNS FROM users LIKE 'profile_picture'")->fetchAll();
        if (empty($cols)) {
            $db->exec("ALTER TABLE users ADD COLUMN profile_picture VARCHAR(255) NOT NULL DEFAULT ''");
        }
    } catch (PDOException $e) {
        error_log('ensureProfilePictureColumn error: ' . $e->getMessage());
    }
}

function avatarUrlForPath(?string $storedPath): ?string {
    $path = trim((string)($storedPath ?? ''));
    if ($path === '') return null;
    if (!resolveStoredFile($path)) return null;
    return 'php/profile.php?action=avatar&v=' . substr(sha1($path), 0, 12);
}

function resolveUserAvatarAbsolute(?string $storedPath): ?string {
    $path = trim((string)($storedPath ?? ''));
    if ($path === '' || !str_starts_with($path, 'ST:avatars/')) {
        return null;
    }
    $resolved = resolveStoredFile($path);
    if (!$resolved) return null;
    $realFile = realpath($resolved);
    $avatarBase = realpath(storageRoot() . DIRECTORY_SEPARATOR . 'avatars');
    if (!$realFile || !$avatarBase) return null;
    if (!str_starts_with($realFile, $avatarBase . DIRECTORY_SEPARATOR)) return null;
    return is_file($realFile) ? $realFile : null;
}

function safeDeleteAvatarFile(?string $storedPath): void {
    $abs = resolveUserAvatarAbsolute($storedPath);
    if ($abs && is_file($abs)) {
        @unlink($abs);
    }
}

function formatDisplayNameFallback(string $username, string $role): string {
    $trimmed = trim($username);
    if ($trimmed === '') {
        return $role === 'admin' ? 'Admin' : 'Inspector';
    }
    if ($role === 'admin' && strtolower($trimmed) === 'admin') {
        return 'Admin';
    }
    return ucfirst($trimmed);
}

function fetchCurrentProfile(PDO $db): array {
    ensureProfilePictureColumn($db);
    $userId   = (int)($_SESSION['user_id'] ?? 0);
    $username = (string)($_SESSION['username'] ?? '');
    $role     = (string)($_SESSION['role'] ?? '');
    $email    = (string)($_SESSION['email'] ?? '');
    $storedPicture = '';

    if ($userId > 0) {
        $stmt = $db->prepare("SELECT username, email, role, profile_picture FROM users WHERE id = ? LIMIT 1");
        $stmt->execute([$userId]);
        $row = $stmt->fetch();
        if ($row) {
            $username      = (string)$row['username'];
            $email         = (string)($row['email'] ?? $email);
            $role          = (string)($row['role'] ?? $role);
            $storedPicture = (string)($row['profile_picture'] ?? '');
        }
    }

    $fullName = formatDisplayNameFallback($username, $role);
    if ($role === 'inspector' && $username !== '') {
        try {
            $stmtIA = $db->prepare("SELECT full_name, email FROM inspector_accounts WHERE username = ? LIMIT 1");
            $stmtIA->execute([$username]);
            $ia = $stmtIA->fetch();
            if ($ia) {
                if (!empty($ia['full_name'])) $fullName = (string)$ia['full_name'];
                if (!empty($ia['email']))     $email    = (string)$ia['email'];
            }
        } catch (PDOException $e) {
            error_log('fetchCurrentProfile inspector lookup error: ' . $e->getMessage());
        }
    }

    $avatarUrl = avatarUrlForPath($storedPicture);

    return [
        'user_id'   => $userId,
        'username'  => $username,
        'email'     => $email,
        'role'      => $role,
        'fullName'  => $fullName,
        'hasAvatar' => $avatarUrl !== null,
        'avatarUrl' => $avatarUrl,
    ];
}

function handleGetAvatar(PDO $db): void {
    ensureProfilePictureColumn($db);
    $userId = (int)($_SESSION['user_id'] ?? 0);
    if ($userId <= 0) {
        http_response_code(404);
        exit();
    }

    $stmt = $db->prepare("SELECT profile_picture FROM users WHERE id = ? LIMIT 1");
    $stmt->execute([$userId]);
    $storedPath = (string)($stmt->fetchColumn() ?: '');

    // Release session lock before decrypting/streaming bytes
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }

    $realFile = resolveUserAvatarAbsolute($storedPath);
    if (!$realFile) {
        http_response_code(404);
        echo json_encode(['success' => false, 'data' => null, 'message' => 'Avatar not found.']);
        exit();
    }

    $servePath = $realFile;
    $tmpOut = null;
    if (isEncryptedFile($realFile)) {
        $tmpOut = tempnam(sys_get_temp_dir(), 'av_');
        try {
            decryptFileTo($realFile, $tmpOut);
        } catch (RuntimeException $e) {
            @unlink($tmpOut);
            http_response_code(500);
            echo json_encode(['success' => false, 'data' => null, 'message' => 'Failed to load avatar.']);
            exit();
        }
        $servePath = $tmpOut;
    }

    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime = finfo_file($finfo, $servePath);
    finfo_close($finfo);

    if (!in_array($mime, AVATAR_ALLOWED_MIMES, true)) {
        if ($tmpOut) @unlink($tmpOut);
        http_response_code(415);
        exit();
    }

    header('Content-Type: ' . $mime);
    header('Content-Length: ' . filesize($servePath));
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, no-store, max-age=0');
    readfile($servePath);

    if ($tmpOut) @unlink($tmpOut);
    exit();
}

function handleUploadAvatar(PDO $db): void {
    ensureProfilePictureColumn($db);
    $userId = (int)($_SESSION['user_id'] ?? 0);
    if ($userId <= 0) {
        errorResponse('Valid user session required.', 403);
    }

    if (empty($_FILES['avatar']) || !isset($_FILES['avatar']['error'])) {
        errorResponse('Please choose an image file to upload.', 400);
    }

    $file = $_FILES['avatar'];
    $err  = (int)$file['error'];
    if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) {
        errorResponse('Image is too large. Maximum allowed size is 2 MB.', 400);
    }
    if ($err !== UPLOAD_ERR_OK || empty($file['tmp_name'])) {
        errorResponse('Image upload failed. Please try again.', 400);
    }

    if ((int)$file['size'] <= 0 || (int)$file['size'] > AVATAR_MAX_BYTES) {
        errorResponse('Image size must be under 2 MB.', 400);
    }

    $ext = strtolower(pathinfo((string)($file['name'] ?? ''), PATHINFO_EXTENSION));
    if (!in_array($ext, AVATAR_ALLOWED_EXTS, true)) {
        errorResponse('Unsupported image format. Please use JPG, PNG, WebP, or GIF.', 400);
    }

    $tmp = $file['tmp_name'];
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime = finfo_file($finfo, $tmp);
    finfo_close($finfo);

    if (!in_array($mime, AVATAR_ALLOWED_MIMES, true)) {
        errorResponse('Uploaded file is not a valid image.', 400);
    }

    $imgInfo = @getimagesize($tmp);
    if ($imgInfo === false || ($imgInfo[0] ?? 0) <= 0 || ($imgInfo[1] ?? 0) <= 0) {
        errorResponse('Image file appears corrupted or invalid.', 400);
    }

    $dir  = ensureStorage('avatars');
    $name = bin2hex(random_bytes(16)) . '.enc';
    $dest = $dir . DIRECTORY_SEPARATOR . $name;

    if (!is_uploaded_file($tmp) || !move_uploaded_file($tmp, $dest)) {
        errorResponse('Failed to save profile picture.', 500);
    }

    try {
        encryptFileInPlace($dest);
    } catch (RuntimeException $e) {
        @unlink($dest);
        error_log('Avatar encrypt failed: ' . $e->getMessage());
        errorResponse('Failed to encrypt profile picture.', 500);
    }

    $relPath = storageRelPath('avatars', $name);

    // Fetch existing avatar path before updating so it can be cleaned up
    $oldStmt = $db->prepare("SELECT profile_picture FROM users WHERE id = ? LIMIT 1");
    $oldStmt->execute([$userId]);
    $oldPath = (string)($oldStmt->fetchColumn() ?: '');

    $upd = $db->prepare("UPDATE users SET profile_picture = ? WHERE id = ?");
    $upd->execute([$relPath, $userId]);

    if ($oldPath !== '' && $oldPath !== $relPath) {
        safeDeleteAvatarFile($oldPath);
    }

    logActivity($db, 'UPDATE_AVATAR', 'profile', $userId, $_SESSION['username'] ?? '', 'Updated profile picture');

    jsonResponse(true, [
        'hasAvatar' => true,
        'avatarUrl' => avatarUrlForPath($relPath),
    ], 'Profile picture updated successfully.');
}

function handleRemoveAvatar(PDO $db): void {
    ensureProfilePictureColumn($db);
    $userId = (int)($_SESSION['user_id'] ?? 0);
    if ($userId <= 0) {
        errorResponse('Valid user session required.', 403);
    }

    $oldStmt = $db->prepare("SELECT profile_picture FROM users WHERE id = ? LIMIT 1");
    $oldStmt->execute([$userId]);
    $oldPath = (string)($oldStmt->fetchColumn() ?: '');

    $db->prepare("UPDATE users SET profile_picture = '' WHERE id = ?")->execute([$userId]);
    safeDeleteAvatarFile($oldPath);

    logActivity($db, 'REMOVE_AVATAR', 'profile', $userId, $_SESSION['username'] ?? '', 'Removed profile picture');

    jsonResponse(true, [
        'hasAvatar' => false,
        'avatarUrl' => null,
    ], 'Profile picture removed.');
}

// ---- Router ----
requireRole(['admin', 'inspector']);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $action = $_GET['action'] ?? 'me';
    if ($action === 'avatar') {
        handleGetAvatar($db);
    } elseif ($action === 'me') {
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
        jsonResponse(true, fetchCurrentProfile($db), 'Profile loaded.');
    } else {
        errorResponse('Invalid action.', 400);
    }
} elseif ($method === 'POST') {
    requireCsrf();
    $action = $_POST['action'] ?? '';
    if ($action === '' && empty($_POST)) {
        $jsonBody = json_decode(file_get_contents('php://input'), true);
        if (is_array($jsonBody)) {
            $action = $jsonBody['action'] ?? '';
        }
    }

    if ($action === 'upload_avatar') {
        handleUploadAvatar($db);
    } elseif ($action === 'remove_avatar') {
        handleRemoveAvatar($db);
    } else {
        errorResponse('Invalid action.', 400);
    }
} else {
    errorResponse('Method not allowed.', 405);
}
