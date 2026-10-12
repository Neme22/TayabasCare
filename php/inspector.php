<?php
require_once 'auth_check.php';
requireRole('admin');
require_once 'activity_log.php';
require_once 'csrf.php';

$method = $_SERVER['REQUEST_METHOD'];

if (csrfNeeded()) {
    requireCsrf();
}

switch($method) {
    case 'GET':    getInspectors();    break;
    case 'POST':   createInspector();  break;
    case 'PUT':    updateInspector();  break;
    case 'DELETE': deleteInspector();  break;
}

function getInspectors() {
    global $db;
    try {
        $stmt = $db->query("SELECT * FROM inspector_accounts ORDER BY created_at DESC");
        $inspectors = $stmt->fetchAll();

        $formatted = array_map(function($i) {
            return [
                'id'       => (int)$i['id'],
                'fullName' => $i['full_name'],
                'email'    => $i['email'],
                'username' => $i['username'],
                'role'     => $i['role_title']
            ];
        }, $inspectors);

        jsonResponse(true, $formatted);
    } catch(PDOException $e) {
        error_log('inspector.php error: ' . $e->getMessage());
        errorResponse('An error occurred. Please try again.', 500);
    }
}

function createInspector() {
    global $db;
    $input = json_decode(file_get_contents('php://input'), true);

    $fullName = trim($input['fullName'] ?? '');
    $email    = trim($input['email']    ?? '');
    $username = trim($input['username'] ?? '');
    $password = $input['password']      ?? '';
    $role     = trim($input['role']     ?? 'Field Inspector');

    if (!$fullName || !$email || !$username || !$password) {
        errorResponse('All fields are required.', 400);
        return;
    }

    // Hash the password securely
    $hashedPassword = password_hash($password, PASSWORD_DEFAULT);

    try {
        $db->beginTransaction();

        // 1. Insert into inspector_accounts
        $stmt = $db->prepare("
            INSERT INTO inspector_accounts (full_name, email, username, password, role_title)
            VALUES (?, ?, ?, ?, ?)
        ");
        $stmt->execute([$fullName, $email, $username, $hashedPassword, $role]);
        $newId = $db->lastInsertId();

        // 2. Insert into users table so the inspector can log in
        $stmtUser = $db->prepare("
            INSERT INTO users (username, password, role)
            VALUES (?, ?, 'inspector')
        ");
        $stmtUser->execute([$username, $hashedPassword]);

        $db->commit();

        logActivity($db, 'CREATE', 'inspector', $newId, $fullName, "Username: $username");
        jsonResponse(true, ['id' => $newId], 'Inspector created successfully');
    } catch(PDOException $e) {
        $db->rollBack();
        // Give a friendly duplicate error
        if (strpos($e->getMessage(), 'Duplicate entry') !== false) {
            errorResponse('Username or email already exists.', 409);
        } else {
            error_log('inspector.php error: ' . $e->getMessage());
            errorResponse('An error occurred. Please try again.', 500);
        }
    }
}

function updateInspector() {
    global $db;
    $input = json_decode(file_get_contents('php://input'), true);

    $id       = (int)($input['id']       ?? 0);
    $fullName = trim($input['fullName']  ?? '');
    $email    = trim($input['email']     ?? '');
    $username = trim($input['username']  ?? '');
    $password = $input['password']       ?? '';
    $role     = trim($input['role']      ?? 'Field Inspector');

    if (!$id) {
        errorResponse('Inspector ID is required.', 400);
        return;
    }

    try {
        $db->beginTransaction();

        // Get old username so we can update users table too
        $stmtOld = $db->prepare("SELECT username FROM inspector_accounts WHERE id = ?");
        $stmtOld->execute([$id]);
        $old = $stmtOld->fetch();
        $oldUsername = $old ? $old['username'] : '';

        if (!empty($password)) {
            // Update with new hashed password
            $hashedPassword = password_hash($password, PASSWORD_DEFAULT);

            $stmt = $db->prepare("
                UPDATE inspector_accounts
                SET full_name=?, email=?, username=?, password=?, role_title=?
                WHERE id=?
            ");
            $stmt->execute([$fullName, $email, $username, $hashedPassword, $role, $id]);

            // Update users table password and username
            $stmtUser = $db->prepare("
                UPDATE users SET username=?, password=? WHERE username=?
            ");
            $stmtUser->execute([$username, $hashedPassword, $oldUsername]);
        } else {
            // Update without changing password
            $stmt = $db->prepare("
                UPDATE inspector_accounts
                SET full_name=?, email=?, username=?, role_title=?
                WHERE id=?
            ");
            $stmt->execute([$fullName, $email, $username, $role, $id]);

            // Update username in users table only
            $stmtUser = $db->prepare("
                UPDATE users SET username=? WHERE username=?
            ");
            $stmtUser->execute([$username, $oldUsername]);
        }

        $db->commit();
        logActivity($db, 'UPDATE', 'inspector', $id, $fullName, "Username: $username");
        jsonResponse(true, null, 'Inspector updated successfully');
    } catch(PDOException $e) {
        $db->rollBack();
        if (strpos($e->getMessage(), 'Duplicate entry') !== false) {
            errorResponse('Username or email already exists.', 409);
        } else {
            error_log('inspector.php error: ' . $e->getMessage());
            errorResponse('An error occurred. Please try again.', 500);
        }
    }
}

function deleteInspector() {
    global $db;
    $id     = $_GET['id']     ?? null;
    $reason = $_GET['reason'] ?? '';

    if (!$id) {
        errorResponse('Inspector ID is required.', 400);
        return;
    }

    try {
        $db->beginTransaction();

        // Fetch before deleting for archive
        $stmt = $db->prepare("SELECT * FROM inspector_accounts WHERE id = ?");
        $stmt->execute([$id]);
        $inspector = $stmt->fetch();

        if (!$inspector) {
            $db->rollBack();
            errorResponse('Inspector not found.', 404);
            return;
        }

        // Archive it
        $archiveStmt = $db->prepare("
            INSERT INTO archive_data (archive_type, data_json, reason, expiry_date)
            VALUES ('inspectors', ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))
        ");
        $archiveStmt->execute([json_encode($inspector), $reason]);

        // Delete from inspector_accounts
        $deleteStmt = $db->prepare("DELETE FROM inspector_accounts WHERE id = ?");
        $deleteStmt->execute([$id]);

        // Delete from users table too so login is revoked
        $deleteUser = $db->prepare("DELETE FROM users WHERE username = ? AND role = 'inspector'");
        $deleteUser->execute([$inspector['username']]);

        $db->commit();
        logActivity($db, 'DELETE', 'inspector', $id, $inspector['full_name'] ?? '', "Archived: $reason");
        jsonResponse(true, null, 'Inspector archived and deleted');
    } catch(PDOException $e) {
        $db->rollBack();
        error_log('inspector.php error: ' . $e->getMessage());
        errorResponse('An error occurred. Please try again.', 500);
    }
}
?>