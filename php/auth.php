<?php
require_once 'config.php';
require_once 'csrf.php';
require_once 'activity_log.php';
// session_start() is now called in config.php before headers

$method = $_SERVER['REQUEST_METHOD'];

switch($method) {
    case 'POST':
        login();
        break;
    case 'GET':
        checkSession();
        break;
    case 'DELETE':
        requireCsrf();
        logout();
        break;
    default:
        errorResponse('Invalid request method', 405);
}

function login() {
    global $db;
    $input = json_decode(file_get_contents('php://input'), true);
    $username = $input['username'] ?? '';
    $password = $input['password'] ?? '';

    if (empty($username) || empty($password)) {
        errorResponse('Username and password required');
    }

    // Rate limiting: max 5 failed attempts per IP within 15 minutes
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    if ($ip) {
        try {
            $rateStmt = $db->prepare("
                SELECT COUNT(*) as cnt FROM activity_log
                WHERE action = 'LOGIN' AND details LIKE '%FAILED%' AND ip_address = ?
                AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)
            ");
            $rateStmt->execute([$ip]);
            $failCount = $rateStmt->fetch()['cnt'] ?? 0;
            if ($failCount >= 5) {
                errorResponse('Too many failed login attempts. Please try again in 15 minutes.', 429);
            }
        } catch (PDOException $e) {
            // Fail closed: if rate check cannot run, do not allow the attempt
            error_log('Login rate check failed: ' . $e->getMessage());
            errorResponse('Service temporarily unavailable. Please try again later.', 503);
        }
    }

    try {
        // Step 1: Find user in users table
        $stmt = $db->prepare("SELECT * FROM users WHERE username = ?");
        $stmt->execute([$username]);
        $user = $stmt->fetch();

        // Step 2: If not found at all, check inspector_accounts and auto-create in users
        if (!$user) {
            $stmtIA = $db->prepare("SELECT * FROM inspector_accounts WHERE username = ?");
            $stmtIA->execute([$username]);
            $inspector = $stmtIA->fetch();
            if ($inspector) {
                $db->prepare("INSERT IGNORE INTO users (username, password, role) VALUES (?, ?, 'inspector')")
                   ->execute([$inspector['username'], $inspector['password']]);
                $stmt2 = $db->prepare("SELECT * FROM users WHERE username = ?");
                $stmt2->execute([$username]);
                $user = $stmt2->fetch();
            }
        }

        // Step 3: Verify password
        $passwordMatched = false;
        if ($user) {
            // Try users table password
            if (password_verify($password, $user['password'])) {
                $passwordMatched = true;
            } elseif (strlen($user['password']) === 32 && ctype_xdigit($user['password'])) {
                // MD5 fallback
                if (md5($password) === $user['password']) {
                    $passwordMatched = true;
                    $newHash = password_hash($password, PASSWORD_DEFAULT);
                    $db->prepare("UPDATE users SET password = ? WHERE id = ?")->execute([$newHash, $user['id']]);
                }
            } else {
                // Plain text fallback
                if ($user['password'] === $password) {
                    $passwordMatched = true;
                    $newHash = password_hash($password, PASSWORD_DEFAULT);
                    $db->prepare("UPDATE users SET password = ? WHERE id = ?")->execute([$newHash, $user['id']]);
                }
            }

            // Step 4: If still failed, try inspector_accounts password (handles out-of-sync hashes)
            if (!$passwordMatched) {
                $stmtIA = $db->prepare("SELECT password FROM inspector_accounts WHERE username = ?");
                $stmtIA->execute([$username]);
                $iaRow = $stmtIA->fetch();
                if ($iaRow && password_verify($password, $iaRow['password'])) {
                    $passwordMatched = true;
                    // Sync the password back into users table
                    $db->prepare("UPDATE users SET password = ? WHERE id = ?")
                       ->execute([$iaRow['password'], $user['id']]);
                }
            }
        }

        if ($passwordMatched && $user) {
            // Prevent session fixation
            session_regenerate_id(true);

            // Check if user already had an active session on another device/browser
            $existingToken = null;
            try {
                $stmtCheck = $db->prepare("SELECT current_session_token FROM users WHERE id = ?");
                $stmtCheck->execute([$user['id']]);
                $existingToken = $stmtCheck->fetchColumn();
            } catch (PDOException $e) {
                $col = $db->query("SHOW COLUMNS FROM users LIKE 'current_session_token'");
                if (!$col->fetch()) {
                    $db->exec("ALTER TABLE users ADD COLUMN current_session_token VARCHAR(128) NULL DEFAULT NULL AFTER role");
                }
            }

            if (!empty($existingToken)) {
                // Record in activity log that the previous session was terminated due to concurrent login
                logActivity($db, 'LOGOUT', 'auth', $user['id'], $user['username'], 'Logged out: account signed in on another device');
            }

            // Generate unique session token for single active device enforcement
            $sessionToken = bin2hex(random_bytes(32));

            // Store new token in users
            try {
                $db->prepare("UPDATE users SET current_session_token = ? WHERE id = ?")->execute([$sessionToken, $user['id']]);
            } catch (PDOException $e) {
                $col = $db->query("SHOW COLUMNS FROM users LIKE 'current_session_token'");
                if (!$col->fetch()) {
                    $db->exec("ALTER TABLE users ADD COLUMN current_session_token VARCHAR(128) NULL DEFAULT NULL AFTER role");
                    $db->prepare("UPDATE users SET current_session_token = ? WHERE id = ?")->execute([$sessionToken, $user['id']]);
                }
            }

            $_SESSION['user_id'] = $user['id'];
            $_SESSION['username'] = $user['username'];
            $_SESSION['role'] = $user['role'];
            $_SESSION['email'] = $user['email'] ?? '';
            $_SESSION['session_token'] = $sessionToken;

            $fullName = $user['username'];
            if ($user['role'] === 'inspector') {
                $nameStmt = $db->prepare("SELECT full_name FROM inspector_accounts WHERE username = ?");
                $nameStmt->execute([$user['username']]);
                $nameRow = $nameStmt->fetch();
                if ($nameRow) $fullName = $nameRow['full_name'];
            }

            logActivity($db, 'LOGIN', 'auth', $user['id'], $user['username'], "Role: {$user['role']}");

            // Include CSRF token for the frontend to use in subsequent requests
            require_once __DIR__ . '/csrf.php';

            jsonResponse(true, [
                'user_id'  => $user['id'],
                'username' => $user['username'],
                'email'    => $user['email'] ?? '',
                'role'     => $user['role'],
                'fullName' => $fullName,
                'redirect' => $user['role'] === 'admin' ? 'admin' : 'inspector',
                'csrf_token' => csrfToken()
            ], 'Login successful');
        } else {
            // Log failed attempt for rate limiting
            logActivity($db, 'LOGIN', 'auth', null, $username, 'FAILED: Invalid credentials');
            errorResponse('Invalid username or password', 401);
        }

    } catch(PDOException $e) {
        error_log('Login error: ' . $e->getMessage());
        errorResponse('Login failed. Please try again later.', 500);
    }
}

function checkSession() {
    global $db;
    require_once __DIR__ . '/csrf.php';
    if (!isset($_SESSION['user_id'])) {
        errorResponse('No active session', 401);
    }

    $userId = $_SESSION['user_id'] ?? null;
    $sessToken = $_SESSION['session_token'] ?? null;

    if ($userId && $userId > 0) {
        try {
            $stmt = $db->prepare("SELECT current_session_token FROM users WHERE id = ?");
            $stmt->execute([$userId]);
            $dbToken = $stmt->fetchColumn();

            // Check if token in DB does not match this session's token (logged in on another device)
            if (empty($sessToken) || $dbToken !== $sessToken) {
                session_unset();
                session_destroy();
                http_response_code(401);
                echo json_encode([
                    'success' => false,
                    'code'    => 'CONCURRENT_LOGIN',
                    'message' => 'Your account has been logged in on another device. You have been logged out.'
                ]);
                exit();
            }
        } catch (PDOException $e) {
            error_log('checkSession token verification error: ' . $e->getMessage());
        }
    }

    $respData = [
        'user_id'    => $_SESSION['user_id'],
        'username'   => $_SESSION['username'],
        'email'      => $_SESSION['email'] ?? '',
        'role'       => $_SESSION['role'],
        'csrf_token' => csrfToken()
    ];
    // Release PHP session lock immediately so frequent heartbeat polling never blocks UI or other requests
    session_write_close();

    jsonResponse(true, $respData, 'Session active');
}

function logout() {
    global $db;
    $userId = $_SESSION['user_id'] ?? null;
    $sessToken = $_SESSION['session_token'] ?? null;
    if ($userId && $sessToken) {
        try {
            // Only clear token if this session is the active one
            $db->prepare("UPDATE users SET current_session_token = NULL WHERE id = ? AND current_session_token = ?")
               ->execute([$userId, $sessToken]);
        } catch (PDOException $e) {
            error_log('logout clear token error: ' . $e->getMessage());
        }
    }
    logActivity($db, 'LOGOUT', 'auth', $userId, $_SESSION['username'] ?? '');
    session_unset();
    session_destroy();
    jsonResponse(true, null, 'Logged out successfully');
}
