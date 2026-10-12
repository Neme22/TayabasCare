<?php
/**
 * CSRF Protection Helper
 * Requires a session-based token on all state-changing requests (POST/PUT/DELETE).
 * Token is sent via X-CSRF-Token header or csrf_token form field.
 */

/**
 * Generate or retrieve the current session's CSRF token.
 */
function csrfToken(): string {
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

/**
 * Validate the CSRF token from the request.
 * Checks X-CSRF-Token header first, then csrf_token POST field.
 * Returns true if valid, false otherwise.
 */
function validateCsrf(): bool {
    // CLI requests (cron) skip CSRF
    if (php_sapi_name() === 'cli') {
        return true;
    }

    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? $_POST['csrf_token'] ?? '';

    if (empty($_SESSION['csrf_token']) || empty($token)) {
        return false;
    }

    return hash_equals($_SESSION['csrf_token'], $token);
}

/**
 * Require a valid CSRF token or abort with 403.
 * Call this at the top of any POST/PUT/DELETE handler.
 */
function requireCsrf(): void {
    if (!validateCsrf()) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['success' => false, 'data' => null, 'message' => 'Invalid or missing CSRF token.']);
        exit();
    }
}

/**
 * Check if the current request method needs CSRF validation.
 */
function csrfNeeded(): bool {
    return in_array($_SERVER['REQUEST_METHOD'] ?? '', ['POST', 'PUT', 'DELETE', 'PATCH'], true);
}
