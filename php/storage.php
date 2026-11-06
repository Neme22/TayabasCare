<?php
/**
 * Encrypted file storage root resolution.
 * Files live OUTSIDE the webroot when STORAGE_ROOT is set (VPS: /srv/tayabascare_storage).
 * Fallback: <project>/storage/ with a deny-all .htaccess (still AES-encrypted on disk).
 */

function storageRoot(): string {
    static $root = null;
    if ($root !== null) return $root;

    $configured = getenv('STORAGE_ROOT') ?: '';
    if ($configured !== '') {
        $path = $configured;
        // Relative paths resolve against the project root (parent of php/)
        if (!preg_match('#^([A-Za-z]:[\\\\/]|/)#', $path)) {
            $path = __DIR__ . '/../' . $path;
        }
        if (!is_dir($path)) {
            @mkdir($path, 0750, true);
        }
        if (is_dir($path) && is_writable($path)) {
            return $root = rtrim($path, '/\\');
        }
        error_log('STORAGE_ROOT not writable, falling back: ' . $path);
    }

    // Fallback: project/storage/ — protected by deny-all .htaccess
    $fallback = __DIR__ . '/../storage';
    if (!is_dir($fallback)) {
        @mkdir($fallback, 0750, true);
        $ht = $fallback . '/.htaccess';
        if (!file_exists($ht)) {
            file_put_contents($ht, "Require all denied\nOptions -Indexes\n");
        }
    }
    return $root = $fallback;
}

function ensureStorage(string $sub): string {
    $dir = storageRoot() . DIRECTORY_SEPARATOR . $sub;
    if (!is_dir($dir)) {
        mkdir($dir, 0750, true);
    }
    return $dir;
}

/**
 * Build a storable file_path value for new uploads: 'ST:<sub>/<name>'
 * (resolved relative to storageRoot()).
 */
function storageRelPath(string $sub, string $name): string {
    return 'ST:' . $sub . '/' . $name;
}

/**
 * Resolve a stored file_path to an absolute filesystem path.
 * - 'ST:sub/name'  → storageRoot()/sub/name
 * - 'uploads/...'  → project root uploads/ (legacy)
 * Returns null if not found.
 */
function resolveStoredFile(string $storedPath): ?string {
    if (str_starts_with($storedPath, 'ST:')) {
        $rel = substr($storedPath, 3);
        $abs = storageRoot() . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $rel);
        return is_file($abs) ? $abs : null;
    }
    // Legacy path relative to project root
    $abs = realpath(__DIR__ . '/../' . $storedPath);
    return ($abs && is_file($abs)) ? $abs : null;
}

/**
 * Validate, store, and encrypt an uploaded attachment.
 * $sub: 'inspections' | 'burial'
 * Returns [sanitizedOriginalName, storedPath] or [null, null] on failure (after errorResponse).
 */
function receiveEncryptedUpload(string $sub): array {
    if (empty($_FILES['attachment']['tmp_name'])) return [null, null];

    $allowedExts = ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'docx', 'xlsx'];
    $maxSize = 10 * 1024 * 1024; // 10MB
    $ext = strtolower(pathinfo($_FILES['attachment']['name'] ?? '', PATHINFO_EXTENSION));

    if (!in_array($ext, $allowedExts, true)) {
        errorResponse('File type not allowed. Allowed: ' . implode(', ', $allowedExts), 400);
    }
    if ($_FILES['attachment']['size'] > $maxSize) {
        errorResponse('File too large. Maximum size is 10MB.', 400);
    }

    $tmp = $_FILES['attachment']['tmp_name'];
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime = finfo_file($finfo, $tmp);
    finfo_close($finfo);
    $allowedMimes = [
        'image/jpeg', 'image/png', 'image/gif', 'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    if (!in_array($mime, $allowedMimes, true)) {
        errorResponse('Invalid file type detected.', 400);
    }

    // Deep content checks (polyglot guard)
    if (str_starts_with($mime, 'image/')) {
        if (@getimagesize($tmp) === false) {
            errorResponse('File content is not a valid image.', 400);
        }
    } elseif ($mime === 'application/pdf') {
        $fh = fopen($tmp, 'rb');
        $magic = $fh ? fread($fh, 4) : '';
        if ($fh) fclose($fh);
        if ($magic !== '%PDF') {
            errorResponse('File content is not a valid PDF.', 400);
        }
    } else {
        // OOXML: must be a ZIP container
        $fh = fopen($tmp, 'rb');
        $magic = $fh ? fread($fh, 2) : '';
        if ($fh) fclose($fh);
        if ($magic !== 'PK') {
            errorResponse('File content is not a valid document.', 400);
        }
    }

    $dir = ensureStorage($sub);
    $name = bin2hex(random_bytes(16)) . '.enc';
    $dest = $dir . DIRECTORY_SEPARATOR . $name;

    if (!move_uploaded_file($tmp, $dest)) {
        errorResponse('Failed to store uploaded file.', 500);
    }
    try {
        encryptFileInPlace($dest);
    } catch (RuntimeException $e) {
        @unlink($dest);
        error_log('Upload encrypt failed: ' . $e->getMessage());
        errorResponse('Failed to store uploaded file.', 500);
    }

    $originalName = preg_replace('/[\x00-\x1f\x7f<>"\'`]/', '', $_FILES['attachment']['name'] ?? '');
    return [$originalName, storageRelPath($sub, $name)];
}
