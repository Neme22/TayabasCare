<?php
require_once 'config.php';
require_once 'csrf.php';
require_once 'activity_log.php';
// session_start() is now called in config.php before headers

$method = $_SERVER['REQUEST_METHOD'];

switch($method) {
    case 'POST':
        requireCsrf();
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
            // If rate check fails, allow login attempt
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
            $_SESSION['user_id'] = $user['id'];
            $_SESSION['username'] = $user['username'];
            $_SESSION['role'] = $user['role'];
            $_SESSION['email'] = $user['email'] ?? '';

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
                'redirect' => $user['role'] === 'admin' ? 'admin.html' : 'inspector.html',
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
    require_once __DIR__ . '/csrf.php';
    if (isset($_SESSION['user_id'])) {
        jsonResponse(true, [
            'user_id'  => $_SESSION['user_id'],
            'username' => $_SESSION['username'],
            'email'    => $_SESSION['email'] ?? '',
            'role'     => $_SESSION['role'],
            'csrf_token' => csrfToken()
        ], 'Session active');
    } else {
        errorResponse('No active session', 401);
    }
}

function logout() {
    global $db;
    logActivity($db, 'LOGOUT', 'auth', $_SESSION['user_id'] ?? null, $_SESSION['username'] ?? '');
    session_destroy();
    jsonResponse(true, null, 'Logged out successfully');
}
?>