<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TayabasCare Database Setup</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 15px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            max-width: 800px;
            width: 100%;
            padding: 40px;
        }
        h1 {
            color: #667eea;
            margin-bottom: 10px;
            font-size: 28px;
        }
        .subtitle {
            color: #666;
            margin-bottom: 30px;
            font-size: 14px;
        }
        .step {
            background: #f8f9fa;
            border-left: 4px solid #667eea;
            padding: 15px 20px;
            margin: 15px 0;
            border-radius: 5px;
        }
        .step.success {
            border-left-color: #10b981;
            background: #ecfdf5;
        }
        .step.error {
            border-left-color: #ef4444;
            background: #fef2f2;
        }
        .step-title {
            font-weight: bold;
            color: #333;
            margin-bottom: 5px;
        }
        .step-message {
            color: #666;
            font-size: 14px;
        }
        .success-icon {
            color: #10b981;
            font-size: 18px;
            margin-right: 8px;
        }
        .error-icon {
            color: #ef4444;
            font-size: 18px;
            margin-right: 8px;
        }
        .info-icon {
            color: #667eea;
            font-size: 18px;
            margin-right: 8px;
        }
        .btn {
            background: #667eea;
            color: white;
            padding: 12px 30px;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
            margin-top: 20px;
            transition: background 0.3s;
        }
        .btn:hover {
            background: #5568d3;
        }
        .config-info {
            background: #fff7ed;
            border: 1px solid #fed7aa;
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
        }
        .config-info strong {
            color: #c2410c;
        }
        code {
            background: #f1f5f9;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            color: #dc2626;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🏥 TayabasCare Database Setup</h1>
        <p class="subtitle">One-time database initialization</p>

        <div class="config-info">
            <strong>📝 Current Configuration:</strong><br>
            Host: <code>localhost</code><br>
            Database: <code>tayabascare_db</code><br>
            Username: <code>root</code><br>
            Password: <code>(empty)</code>
        </div>

<?php
// Authentication guard — only logged-in admins can run setup
session_start();
if (!isset($_SESSION['user_id']) || ($_SESSION['role'] ?? '') !== 'admin') {
    // Allow first-time setup when no users exist yet
    $host = 'localhost';
    $user = 'root';
    $pass = '';
    $dbname = 'tayabascare_db';
    $allowUnauthenticated = false;
    try {
        $checkPdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8mb4", $user, $pass);
        $checkPdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $cnt = $checkPdo->query("SELECT COUNT(*) as c FROM users")->fetch()['c'];
        if ($cnt == 0) $allowUnauthenticated = true;
    } catch (PDOException $e) {
        $allowUnauthenticated = true; // DB doesn't exist yet
    }
    if (!$allowUnauthenticated) {
        http_response_code(403);
        die('<div style="max-width:500px;margin:80px auto;font-family:sans-serif;text-align:center;">
            <h2 style="color:#dc2626;">Access Denied</h2>
            <p>You must be logged in as an admin to run database setup.</p>
            <a href="../index.html" style="display:inline-block;margin-top:15px;padding:10px 24px;background:#1e40af;color:#fff;border-radius:8px;text-decoration:none;">Go to Login</a>
        </div>');
    }
}

// Guard: prevent re-running setup if database already exists with data
$host = 'localhost';
$user = 'root';
$pass = '';
$dbname = 'tayabascare_db';

try {
    $guardPdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8mb4", $user, $pass);
    $guardPdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $tableCheck = $guardPdo->query("SELECT COUNT(*) as cnt FROM users")->fetch();
    if ($tableCheck && $tableCheck['cnt'] > 0) {
        // Database already set up — block re-running
        if ($_SERVER['REQUEST_METHOD'] === 'GET' && !isset($_GET['force'])) {
            echo '<div style="background:#fef2f2;border:1px solid #fca5a5;padding:20px;border-radius:12px;max-width:600px;margin:40px auto;font-family:sans-serif;">';
            echo '<h2 style="color:#dc2626;margin:0 0 10px;">Setup Already Completed</h2>';
            echo '<p style="color:#374151;">The database already exists with ' . $tableCheck['cnt'] . ' user(s). Running setup again could cause issues.</p>';
            echo '<p style="margin-top:15px;"><a href="../admin.html" style="background:#1e40af;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Go to Admin Dashboard</a> ';
            echo '<a href="?force=1" style="background:#dc2626;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-left:10px;">Force Re-run</a></p>';
            echo '</div>';
            exit();
        }
    }
} catch (PDOException $e) {
    // Database doesn't exist yet — this is fine, proceed with setup
}

// Database configuration
$dbname = 'tayabascare_db';

$steps = [];

try {
    // Step 1: Connect to MySQL server
    $steps[] = ['status' => 'processing', 'title' => 'Step 1: Connecting to MySQL server...', 'message' => ''];
    $pdo = new PDO("mysql:host=$host", $user, $pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 1: MySQL Connection', 'message' => 'Successfully connected to MySQL server'];

    // Step 2: Create database
    $steps[] = ['status' => 'processing', 'title' => 'Step 2: Creating database...', 'message' => ''];
    $pdo->exec("CREATE DATABASE IF NOT EXISTS $dbname CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 2: Database Creation', 'message' => "Database '$dbname' created successfully"];

    // Step 3: Connect to the database
    $steps[] = ['status' => 'processing', 'title' => 'Step 3: Connecting to database...', 'message' => ''];
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8mb4", $user, $pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 3: Database Connection', 'message' => "Connected to database '$dbname'"];

    // Step 4: Create inspector_accounts table
    $steps[] = ['status' => 'processing', 'title' => 'Step 4: Creating inspector_accounts table...', 'message' => ''];
    $sql_inspector = "CREATE TABLE IF NOT EXISTS inspector_accounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        username VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role_title VARCHAR(100) DEFAULT 'Field Inspector',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_email (email),
        INDEX idx_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
    $pdo->exec($sql_inspector);
    
    // Check if table has data
    $stmt = $pdo->query("SELECT COUNT(*) as count FROM inspector_accounts");
    $count = $stmt->fetch(PDO::FETCH_ASSOC)['count'];
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 4: Inspector Accounts Table', 'message' => "Table created/verified. Current records: $count"];

    // Step 6: Create burial_records table
    $steps[] = ['status' => 'processing', 'title' => 'Step 6: Creating burial_records table...', 'message' => ''];
    $sql_burial = "CREATE TABLE IF NOT EXISTS burial_records (
        id INT AUTO_INCREMENT PRIMARY KEY,
        type ENUM('cadaver', 'skeletal', 'exhumation') NOT NULL,
        datetime VARCHAR(100),
        deceased VARCHAR(255),
        death_date DATE,
        death_place VARCHAR(255),
        informant VARCHAR(255),
        inspector VARCHAR(255),
        origin VARCHAR(255),
        transfer VARCHAR(255),
        funeral VARCHAR(255),
        cemetery_origin VARCHAR(255),
        cemetery_transfer VARCHAR(255),
        or_number VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_type (type),
        INDEX idx_deceased (deceased)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
    $pdo->exec($sql_burial);
    
    $stmt = $pdo->query("SELECT COUNT(*) as count FROM burial_records");
    $count = $stmt->fetch(PDO::FETCH_ASSOC)['count'];
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 6: Burial Records Table', 'message' => "Table created/verified. Current records: $count"];

    // Step 7: Create archive_data table
    $steps[] = ['status' => 'processing', 'title' => 'Step 7: Creating archive_data table...', 'message' => ''];
    $sql_archive = "CREATE TABLE IF NOT EXISTS archive_data (
        id INT AUTO_INCREMENT PRIMARY KEY,
        archive_type VARCHAR(50) NOT NULL,
        data_json JSON NOT NULL,
        reason TEXT,
        expiry_date DATE,
        archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_type (archive_type),
        INDEX idx_expiry (expiry_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
    $pdo->exec($sql_archive);
    
    $stmt = $pdo->query("SELECT COUNT(*) as count FROM archive_data");
    $count = $stmt->fetch(PDO::FETCH_ASSOC)['count'];
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 7: Archive Data Table', 'message' => "Table created/verified. Current records: $count"];

    // Step 8: Create users table
    $steps[] = ['status' => 'processing', 'title' => 'Step 8: Creating users table...', 'message' => ''];
    $pdo->exec("CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        role ENUM('admin','inspector') DEFAULT 'inspector',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $stmt = $pdo->query("SELECT COUNT(*) as count FROM users");
    $count = $stmt->fetch(PDO::FETCH_ASSOC)['count'];
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 8: Users Table', 'message' => "Table created/verified. Current records: $count"];

    // Step 9: Create sanitary_records table
    $steps[] = ['status' => 'processing', 'title' => 'Step 9: Creating sanitary_records table...', 'message' => ''];
    $pdo->exec("CREATE TABLE IF NOT EXISTS sanitary_records (
        id INT AUTO_INCREMENT PRIMARY KEY,
        record_no VARCHAR(50),
        date DATE,
        permit_no VARCHAR(50),
        personnel_no VARCHAR(50),
        business_name VARCHAR(255),
        owner_first_name VARCHAR(100),
        owner_middle_name VARCHAR(100),
        owner_last_name VARCHAR(100),
        personnel_list JSON,
        sex VARCHAR(10),
        result_xray BOOLEAN DEFAULT 0,
        result_stool BOOLEAN DEFAULT 0,
        barangay VARCHAR(100),
        building_street VARCHAR(255),
        corporation_name VARCHAR(255),
        remarks TEXT,
        business_type VARCHAR(100) DEFAULT 'Other',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_business (business_name),
        INDEX idx_barangay (barangay)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $stmt = $pdo->query("SELECT COUNT(*) as count FROM sanitary_records");
    $count = $stmt->fetch(PDO::FETCH_ASSOC)['count'];
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 9: Sanitary Records Table', 'message' => "Table created/verified. Current records: $count"];

    // Step 10: Create inspection_reports table
    $steps[] = ['status' => 'processing', 'title' => 'Step 10: Creating inspection_reports table...', 'message' => ''];
    $pdo->exec("CREATE TABLE IF NOT EXISTS inspection_reports (
        id INT AUTO_INCREMENT PRIMARY KEY,
        file_name VARCHAR(255),
        recommendation TEXT,
        remarks TEXT,
        complied BOOLEAN DEFAULT 0,
        inspector_name VARCHAR(255),
        establishment VARCHAR(255),
        location VARCHAR(255),
        status VARCHAR(50) DEFAULT 'Submitted',
        report_date DATETIME,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_inspector (inspector_name),
        INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $stmt = $pdo->query("SELECT COUNT(*) as count FROM inspection_reports");
    $count = $stmt->fetch(PDO::FETCH_ASSOC)['count'];
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 10: Inspection Reports Table', 'message' => "Table created/verified. Current records: $count"];

    // Step 11: Create inspection_history table
    $steps[] = ['status' => 'processing', 'title' => 'Step 11: Creating inspection_history table...', 'message' => ''];
    $pdo->exec("CREATE TABLE IF NOT EXISTS inspection_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        inspection_id INT,
        establishment VARCHAR(255),
        location VARCHAR(255),
        inspector_name VARCHAR(255),
        file_name VARCHAR(255),
        remarks TEXT,
        recommendation TEXT,
        complied BOOLEAN,
        status VARCHAR(50),
        report_date DATETIME,
        archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_establishment (establishment),
        INDEX idx_inspection_id (inspection_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $stmt = $pdo->query("SELECT COUNT(*) as count FROM inspection_history");
    $count = $stmt->fetch(PDO::FETCH_ASSOC)['count'];
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 11: Inspection History Table', 'message' => "Table created/verified. Current records: $count"];

    // Step 12: Add business_type column to sanitary_records for risk categorization
    $steps[] = ['status' => 'processing', 'title' => 'Step 12: Adding business_type column...', 'message' => ''];
    try {
        $pdo->exec("ALTER TABLE sanitary_records ADD COLUMN business_type VARCHAR(100) DEFAULT 'Other'");
        $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 12: Business Type Column', 'message' => "Column added to sanitary_records. Existing records default to 'Other'."];
    } catch (PDOException $e) {
        if (str_contains($e->getMessage(), 'Duplicate column')) {
            $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 12: Business Type Column', 'message' => "Column already exists. Skipped."];
        } else {
            throw $e;
        }
    }

    // Step 13: Create password_resets table
    $steps[] = ['status' => 'processing', 'title' => 'Step 13: Creating password_resets table...', 'message' => ''];
    $pdo->exec("CREATE TABLE IF NOT EXISTS password_resets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        otp VARCHAR(10),
        expires_at DATETIME,
        used TINYINT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_user (user_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $stmt = $pdo->query("SELECT COUNT(*) as count FROM password_resets");
    $count = $stmt->fetch(PDO::FETCH_ASSOC)['count'];
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 13: Password Resets Table', 'message' => "Table created/verified. Current records: $count"];

    // Step 14: Create default admin user if none exists
    $steps[] = ['status' => 'processing', 'title' => 'Step 14: Creating default admin user...', 'message' => ''];
    $adminCheck = $pdo->query("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
    $adminCount = $adminCheck->fetch(PDO::FETCH_ASSOC)['count'];
    if ($adminCount == 0) {
        $hashedPassword = password_hash('admin123', PASSWORD_DEFAULT);
        $pdo->prepare("INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, 'admin')")
            ->execute(['admin', $hashedPassword, 'admin@tayabascare.com']);
        $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 14: Default Admin User', 'message' => 'Admin created. Username: admin | Password: admin123 — CHANGE THIS AFTER FIRST LOGIN'];
    } else {
        $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 14: Default Admin User', 'message' => "Admin user already exists ($adminCount found). Skipped."];
    }

// Step 15: Create inspection_schedules table
    $steps[] = ['status' => 'processing', 'title' => 'Step 15: Creating inspection_schedules table...', 'message' => ''];
    $pdo->exec("CREATE TABLE IF NOT EXISTS inspection_schedules (
        id INT AUTO_INCREMENT PRIMARY KEY,
        inspector_name VARCHAR(255) NOT NULL,
        establishment VARCHAR(255) DEFAULT NULL,
        risk_level VARCHAR(20) DEFAULT NULL,
        schedDate DATE NOT NULL,
        notes TEXT,
        done TINYINT DEFAULT 0,
        notified TINYINT DEFAULT 0,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_schedDate (schedDate),
        INDEX idx_inspector (inspector_name),
        INDEX idx_establishment (establishment)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $stmt = $pdo->query("SELECT COUNT(*) as count FROM inspection_schedules");
    $count = $stmt->fetch(PDO::FETCH_ASSOC)['count'];
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 15: Inspection Schedules Table', 'message' => "Table created/verified. Current records: $count"];

    // Step 16: Create alerts table for notification system
    $steps[] = ['status' => 'processing', 'title' => 'Step 16: Creating alerts table...', 'message' => ''];
    $pdo->exec("CREATE TABLE IF NOT EXISTS alerts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        alert_type ENUM('violation_threshold','overdue_followup','high_risk','schedule_reminder') NOT NULL,
        establishment VARCHAR(255),
        barangay VARCHAR(100),
        message TEXT NOT NULL,
        severity ENUM('info','warning','critical') DEFAULT 'warning',
        risk_score INT DEFAULT 0,
        is_read TINYINT DEFAULT 0,
        dismissed TINYINT DEFAULT 0,
        fingerprint VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_type (alert_type),
        INDEX idx_dismissed (dismissed),
        INDEX idx_read (is_read),
        INDEX idx_created (created_at),
        INDEX idx_fingerprint (fingerprint)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $stmt = $pdo->query("SELECT COUNT(*) as count FROM alerts");
    $count = $stmt->fetch(PDO::FETCH_ASSOC)['count'];
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 16: Alerts Table', 'message' => "Table created/verified. Current records: $count"];

    // Step 17: Create risk_schedule_config table for risk-based scheduling intervals
    $steps[] = ['status' => 'processing', 'title' => 'Step 17: Creating risk schedule config table...', 'message' => ''];
    $pdo->exec("CREATE TABLE IF NOT EXISTS risk_schedule_config (
        id INT AUTO_INCREMENT PRIMARY KEY,
        risk_level ENUM('HIGH','MODERATE','LOW') NOT NULL UNIQUE,
        inspection_interval_days INT NOT NULL,
        description VARCHAR(255),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    // Insert default intervals: HIGH=30 days, MODERATE=90 days, LOW=180 days
    $pdo->exec("INSERT IGNORE INTO risk_schedule_config (risk_level, inspection_interval_days, description) VALUES
        ('HIGH', 30, 'High-risk: inspect every 30 days'),
        ('MODERATE', 90, 'Moderate-risk: inspect every 90 days'),
        ('LOW', 180, 'Low-risk: inspect every 180 days')");
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 17: Risk Schedule Config', 'message' => "Table created with default intervals (HIGH=30d, MODERATE=90d, LOW=180d)."];

    // Step 18: Create activity_log table for audit trail
    $steps[] = ['status' => 'processing', 'title' => 'Step 18: Creating activity log table...', 'message' => ''];
    $pdo->exec("CREATE TABLE IF NOT EXISTS activity_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        username VARCHAR(100),
        action VARCHAR(30) NOT NULL,
        module VARCHAR(50) NOT NULL,
        record_id INT,
        record_label VARCHAR(255),
        details TEXT,
        ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user (user_id),
        INDEX idx_module (module),
        INDEX idx_action (action),
        INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $stmt = $pdo->query("SELECT COUNT(*) as count FROM activity_log");
    $count = $stmt->fetch(PDO::FETCH_ASSOC)['count'];
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 18: Activity Log Table', 'message' => "Table created/verified. Current records: $count"];

    // Step 19: Create notification_log table for email tracking
    $steps[] = ['status' => 'processing', 'title' => 'Step 19: Creating notification log table...', 'message' => ''];
    $pdo->exec("CREATE TABLE IF NOT EXISTS notification_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        schedule_id INT,
        inspector_name VARCHAR(255),
        email VARCHAR(255),
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status ENUM('sent','failed') DEFAULT 'sent',
        error_message TEXT,
        INDEX idx_sent (sent_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $stmt = $pdo->query("SELECT COUNT(*) as count FROM notification_log");
    $count = $stmt->fetch(PDO::FETCH_ASSOC)['count'];
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 19: Notification Log Table', 'message' => "Table created/verified. Current records: $count"];

    // Step 20: Add missing columns for file_path and compliance_deadline
    $steps[] = ['status' => 'processing', 'title' => 'Step 20: Adding missing columns...', 'message' => ''];
    $alterSteps = [];
    $alters = [
        ["ALTER TABLE inspection_reports ADD COLUMN file_path VARCHAR(500) DEFAULT NULL", "file_path on inspection_reports"],
        ["ALTER TABLE inspection_reports ADD COLUMN compliance_deadline DATE DEFAULT NULL", "compliance_deadline on inspection_reports"],
        ["ALTER TABLE inspection_history ADD COLUMN file_path VARCHAR(500) DEFAULT NULL", "file_path on inspection_history"],
        ["ALTER TABLE archive_data ADD COLUMN sub_type VARCHAR(50) DEFAULT NULL", "sub_type on archive_data"],
        ["ALTER TABLE archive_data ADD COLUMN archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP", "archived_at on archive_data"],
    ];
    foreach ($alters as [$sql, $desc]) {
        try {
            $pdo->exec($sql);
            $alterSteps[] = "Added $desc";
        } catch (PDOException $e) {
            if (str_contains($e->getMessage(), 'Duplicate column')) {
                $alterSteps[] = "$desc already exists";
            } else {
                $alterSteps[] = "FAILED $desc: " . $e->getMessage();
            }
        }
    }
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 20: Missing Columns', 'message' => implode('; ', $alterSteps)];

    // Step 21: Add file columns to burial_records
    $steps[] = ['status' => 'processing', 'title' => 'Step 21: Adding file columns to burial_records...', 'message' => ''];
    $burialAlterResults = [];
    $burialAlters = [
        ["ALTER TABLE burial_records ADD COLUMN file_name VARCHAR(255) DEFAULT NULL", "file_name on burial_records"],
        ["ALTER TABLE burial_records ADD COLUMN file_path VARCHAR(500) DEFAULT NULL", "file_path on burial_records"],
    ];
    foreach ($burialAlters as [$sql, $desc]) {
        try {
            $pdo->exec($sql);
            $burialAlterResults[] = "Added $desc";
        } catch (PDOException $e) {
            if (str_contains($e->getMessage(), 'Duplicate column')) {
                $burialAlterResults[] = "$desc already exists";
            } else {
                $burialAlterResults[] = "FAILED $desc: " . $e->getMessage();
            }
        }
    }
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 21: Burial File Columns', 'message' => implode('; ', $burialAlterResults)];

    // Step 22: Add ai_analysis column to inspection_reports for caching AI assessments
    $steps[] = ['status' => 'processing', 'title' => 'Step 22: Adding AI analysis column...', 'message' => ''];
    try {
        $pdo->exec("ALTER TABLE inspection_reports ADD COLUMN ai_analysis TEXT DEFAULT NULL");
        $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 22: AI Analysis Column', 'message' => "Added ai_analysis to inspection_reports for caching AI risk assessments."];
    } catch (PDOException $e) {
        if (str_contains($e->getMessage(), 'Duplicate column')) {
            $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 22: AI Analysis Column', 'message' => "Column already exists. Skipped."];
        } else {
            $steps[count($steps)-1] = ['status' => 'error', 'title' => 'Step 22: AI Analysis Column', 'message' => "FAILED: " . $e->getMessage()];
        }
    }

    // Step 23: Create risk_scores table for historical risk tracking
    $steps[] = ['status' => 'processing', 'title' => 'Step 23: Creating risk_scores table...', 'message' => ''];
    $pdo->exec("CREATE TABLE IF NOT EXISTS risk_scores (
        id INT AUTO_INCREMENT PRIMARY KEY,
        establishment VARCHAR(255) NOT NULL,
        barangay VARCHAR(100),
        total_score INT NOT NULL,
        risk_level VARCHAR(20) NOT NULL,
        factor_violations INT DEFAULT 0,
        factor_time INT DEFAULT 0,
        factor_category INT DEFAULT 0,
        factor_compliance INT DEFAULT 0,
        factor_followup INT DEFAULT 0,
        recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_establishment (establishment),
        INDEX idx_risk_level (risk_level),
        INDEX idx_recorded (recorded_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $stmt = $pdo->query("SELECT COUNT(*) as count FROM risk_scores");
    $count = $stmt->fetch(PDO::FETCH_ASSOC)['count'];
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 23: Risk Scores History', 'message' => "Table created/verified. Current records: $count"];

    // Step 24: Create violation_categories lookup table
    $steps[] = ['status' => 'processing', 'title' => 'Step 24: Creating violation categories table...', 'message' => ''];
    $pdo->exec("CREATE TABLE IF NOT EXISTS violation_categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(20) NOT NULL UNIQUE,
        label VARCHAR(100) NOT NULL,
        description TEXT,
        risk_weight INT DEFAULT 1,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("INSERT IGNORE INTO violation_categories (code, label, description, risk_weight) VALUES
        ('PEST', 'Pest Control', 'Pest infestation, rodent/cockroach presence', 3),
        ('WASTE', 'Waste Disposal', 'Improper waste disposal, garbage issues', 2),
        ('WATER', 'Water & Sanitation', 'Poor water quality, sanitation issues', 2),
        ('FOOD', 'Food Handling', 'Food handling violations, cross-contamination', 3),
        ('STRUCT', 'Structural Issues', 'Structural damage, cracks, leaks', 1),
        ('HYGIENE', 'Personal Hygiene', 'Lack of hair restraints, gloves, uniforms', 2),
        ('DRAIN', 'Drainage Issues', 'Drainage problems, sewage overflow', 2),
        ('CERT', 'No Health Certificates', 'Missing health/medical certificates', 2),
        ('EXPIRED', 'Expired Products', 'Expired or stale products on premises', 3),
        ('CONTAM', 'Contamination Risk', 'Cross-contamination risks', 3),
        ('PERMIT', 'No Sanitary Permit', 'Missing or expired sanitary permits', 2),
        ('OTHER', 'Other Violations', 'Other sanitary violations not categorized above', 1)");
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 24: Violation Categories', 'message' => "Table created with 12 violation categories."];

    // Step 25: Add violation_codes column to inspection_reports and inspection_history
    $steps[] = ['status' => 'processing', 'title' => 'Step 25: Adding violation_codes columns...', 'message' => ''];
    $vcAlterResults = [];
    $vcAlters = [
        ["ALTER TABLE inspection_reports ADD COLUMN violation_codes TEXT DEFAULT NULL", "violation_codes on inspection_reports"],
        ["ALTER TABLE inspection_history ADD COLUMN violation_codes TEXT DEFAULT NULL", "violation_codes on inspection_history"],
    ];
    foreach ($vcAlters as [$sql, $desc]) {
        try {
            $pdo->exec($sql);
            $vcAlterResults[] = "Added $desc";
        } catch (PDOException $e) {
            if (str_contains($e->getMessage(), 'Duplicate column')) {
                $vcAlterResults[] = "$desc already exists";
            } else {
                $vcAlterResults[] = "FAILED $desc: " . $e->getMessage();
            }
        }
    }
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 25: Violation Codes Columns', 'message' => implode('; ', $vcAlterResults)];

    // Step 26: Add establishment_id FK column to inspection_reports and inspection_history
    $steps[] = ['status' => 'processing', 'title' => 'Step 26: Adding establishment_id columns...', 'message' => ''];
    $eidAlterResults = [];
    $eidAlters = [
        ["ALTER TABLE inspection_reports ADD COLUMN establishment_id INT DEFAULT NULL", "establishment_id on inspection_reports"],
        ["ALTER TABLE inspection_reports ADD INDEX idx_establishment_id (establishment_id)", "index on inspection_reports.establishment_id"],
        ["ALTER TABLE inspection_history ADD COLUMN establishment_id INT DEFAULT NULL", "establishment_id on inspection_history"],
        ["ALTER TABLE inspection_history ADD INDEX idx_establishment_id (establishment_id)", "index on inspection_history.establishment_id"],
    ];
    foreach ($eidAlters as [$sql, $desc]) {
        try {
            $pdo->exec($sql);
            $eidAlterResults[] = "Added $desc";
        } catch (PDOException $e) {
            if (str_contains($e->getMessage(), 'Duplicate column') || str_contains($e->getMessage(), 'Duplicate key')) {
                $eidAlterResults[] = "$desc already exists";
            } else {
                $eidAlterResults[] = "FAILED $desc: " . $e->getMessage();
            }
        }
    }
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 26: Establishment ID Columns', 'message' => implode('; ', $eidAlterResults)];

    // Performance indexes for hot query paths
    $perfIndexes = [
        ["ALTER TABLE inspection_reports ADD INDEX idx_report_date (report_date)", "report_date on inspection_reports"],
        ["ALTER TABLE inspection_history ADD INDEX idx_report_date (report_date)", "report_date on inspection_history"],
        ["ALTER TABLE sanitary_records ADD INDEX idx_created (created_at)", "created_at on sanitary_records"],
        ["ALTER TABLE activity_log ADD INDEX idx_ip_action (ip_address, action, created_at)", "composite rate-limit index on activity_log"],
    ];
    foreach ($perfIndexes as [$sql, $desc]) {
        try { $pdo->exec($sql); } catch (PDOException $e) { /* column/index may already exist */ }
    }

    // Step 27: Create scoring_weights table for formula visibility
    $steps[] = ['status' => 'processing', 'title' => 'Step 27: Creating scoring weights table...', 'message' => ''];
    $pdo->exec("CREATE TABLE IF NOT EXISTS scoring_weights (
        id INT AUTO_INCREMENT PRIMARY KEY,
        factor_name VARCHAR(50) NOT NULL UNIQUE,
        max_points INT NOT NULL,
        description VARCHAR(255),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $pdo->exec("INSERT IGNORE INTO scoring_weights (factor_name, max_points, description) VALUES
        ('violations', 25, 'Number of previous violations (0-25 pts)'),
        ('time_since_last', 20, 'Time since last inspection (0-20 pts)'),
        ('category', 20, 'Establishment category risk (0-20 pts)'),
        ('compliance', 20, 'Compliance history percentage (0-20 pts)'),
        ('followup', 15, 'Pending follow-up actions (0-15 pts)')");
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 27: Scoring Weights', 'message' => "Table created with 5 factor weights."];

    // Step 28: Add notification_type column to notification_log
    $steps[] = ['status' => 'processing', 'title' => 'Step 28: Adding notification type column...', 'message' => ''];
    try {
        $pdo->exec("ALTER TABLE notification_log ADD COLUMN notification_type VARCHAR(50) DEFAULT 'schedule_reminder'");
        $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 28: Notification Type Column', 'message' => "Added notification_type to notification_log."];
    } catch (PDOException $e) {
        if (str_contains($e->getMessage(), 'Duplicate column')) {
            $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 28: Notification Type Column', 'message' => "Column already exists. Skipped."];
        } else {
            $steps[count($steps)-1] = ['status' => 'error', 'title' => 'Step 28: Notification Type Column', 'message' => "FAILED: " . $e->getMessage()];
        }
    }

    // Step 29: Create accomplishment_records table
    $steps[] = ['status' => 'processing', 'title' => 'Step 29: Creating accomplishment records table...', 'message' => ''];
    $pdo->exec("CREATE TABLE IF NOT EXISTS accomplishment_records (
        id INT AUTO_INCREMENT PRIMARY KEY,
        inspector_name VARCHAR(255) NOT NULL,
        month INT NOT NULL,
        year INT NOT NULL,
        fields JSON NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_entry (inspector_name, month, year),
        INDEX idx_period (year, month)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $stmt = $pdo->query("SELECT COUNT(*) as count FROM accomplishment_records");
    $count = $stmt->fetch(PDO::FETCH_ASSOC)['count'];
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 29: Accomplishment Records Table', 'message' => "Table created/verified. Current records: $count"];

    // Step 30: Create admin_recovery_codes table
    $steps[] = ['status' => 'processing', 'title' => 'Step 30: Creating admin recovery codes table...', 'message' => ''];
    $pdo->exec("CREATE TABLE IF NOT EXISTS admin_recovery_codes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        code_hash CHAR(64) NOT NULL,
        used_at DATETIME NULL,
        expires_at DATETIME NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_code_hash (code_hash),
        INDEX idx_user_unused (user_id, used_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $stmt = $pdo->query("SELECT COUNT(*) as count FROM admin_recovery_codes");
    $count = $stmt->fetch(PDO::FETCH_ASSOC)['count'];
    $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 30: Admin Recovery Codes Table', 'message' => "Table created/verified. Current codes: $count"];

    // Step 30b: Extend activity_log.action enum so recovery/OTP audit rows are queryable
    $steps[] = ['status' => 'processing', 'title' => 'Step 30b: Extending activity log actions...', 'message' => ''];
    try {
        $pdo->exec("ALTER TABLE activity_log MODIFY action ENUM(
            'CREATE','UPDATE','DELETE','LOGIN','LOGOUT','EXPORT','IMPORT','RESTORE',
            'ADMIN_RECOVERY','ADMIN_RECOVERY_GENERATE','ADMIN_RECOVERY_EMAIL','OTP_VERIFY'
        ) NOT NULL");
        $steps[count($steps)-1] = ['status' => 'success', 'title' => 'Step 30b: Activity Log Actions', 'message' => 'action enum includes ADMIN_RECOVERY* and OTP_VERIFY'];
    } catch (PDOException $e) {
        $steps[count($steps)-1] = ['status' => 'error', 'title' => 'Step 30b: Activity Log Actions', 'message' => 'FAILED: ' . $e->getMessage()];
    }

    // Final verification
    $steps[] = ['status' => 'success', 'title' => '✅ Setup Complete!', 'message' => 'All 30 database tables created + missing columns added. Default admin: username=admin, password=admin123. Generate recovery codes and hand the printout to the Sanitary Head Officer.'];

} catch(PDOException $e) {
    $steps[] = ['status' => 'error', 'title' => '❌ Error Occurred', 'message' => $e->getMessage()];
}

// Display all steps
foreach ($steps as $step) {
    $class = $step['status'];
    $icon = '';
    if ($step['status'] === 'success') {
        $icon = '<span class="success-icon">✓</span>';
    } elseif ($step['status'] === 'error') {
        $icon = '<span class="error-icon">✗</span>';
    } else {
        $icon = '<span class="info-icon">ℹ</span>';
    }
    
    $safeTitle = htmlspecialchars($step['title'], ENT_QUOTES, 'UTF-8');
    $safeMsg   = htmlspecialchars($step['message'], ENT_QUOTES, 'UTF-8');
    echo "<div class='step $class'>";
    echo "<div class='step-title'>$icon$safeTitle</div>";
    echo "<div class='step-message'>$safeMsg</div>";
    echo "</div>";
}
?>

        <div style="text-align: center; margin-top: 30px;">
            <a href="../admin.html" class="btn">Go to Admin Dashboard</a>
            <a href="../index.html" class="btn" style="background: #10b981; margin-left: 10px;">Go to Login</a>
        </div>

        <div class="config-info" style="margin-top: 30px; background: #eff6ff; border-color: #bfdbfe;">
            <strong>📌 Next Steps:</strong><br>
            1. Go to Admin Dashboard to add inspectors<br>
            2. Check PHPMyAdmin to verify tables were created<br>
            3. Generate Admin Recovery Codes (Settings → Admin Recovery Codes) and hand the sealed printout to the Sanitary Head Officer<br>
            4. Try adding an inspector and check the database<br>
            5. If you still have issues, check browser console for errors (F12)
        </div>
    </div>
</body>
</html>