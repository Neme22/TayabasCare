<?php
require_once 'auth_check.php';

// ============================================================
// Risk Score History Endpoint
// Returns historical risk scores for trend analysis
// ============================================================

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit(); }
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    errorResponse('Method not allowed. Use GET.', 405);
}

try {
    // Ensure table exists
    $db->exec("CREATE TABLE IF NOT EXISTS risk_scores (
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
        INDEX idx_recorded (recorded_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $action = $_GET['action'] ?? 'latest';

    if ($action === 'latest') {
        // Get latest score per establishment
        $stmt = $db->query("
            SELECT r.* FROM risk_scores r
            INNER JOIN (
                SELECT establishment, MAX(recorded_at) as max_date
                FROM risk_scores GROUP BY establishment
            ) latest ON r.establishment = latest.establishment AND r.recorded_at = latest.max_date
            ORDER BY r.total_score DESC
        ");
        jsonResponse(true, $stmt->fetchAll());
    }

    if ($action === 'trend') {
        // Get trend data for all establishments (last 30 days)
        $establishment = $_GET['establishment'] ?? '';
        $days = intval($_GET['days'] ?? 30);

        if ($establishment) {
            $stmt = $db->prepare("
                SELECT total_score, risk_level, recorded_at
                FROM risk_scores
                WHERE establishment = ? AND recorded_at > DATE_SUB(NOW(), INTERVAL ? DAY)
                ORDER BY recorded_at ASC
            ");
            $stmt->execute([$establishment, $days]);
        } else {
            // Aggregate trend: average score per day
            $stmt = $db->prepare("
                SELECT DATE(recorded_at) as date,
                       AVG(total_score) as avg_score,
                       SUM(CASE WHEN risk_level = 'HIGH' THEN 1 ELSE 0 END) as high_count,
                       SUM(CASE WHEN risk_level = 'MODERATE' THEN 1 ELSE 0 END) as mod_count,
                       SUM(CASE WHEN risk_level = 'LOW' THEN 1 ELSE 0 END) as low_count,
                       COUNT(*) as total
                FROM risk_scores
                WHERE recorded_at > DATE_SUB(NOW(), INTERVAL ? DAY)
                GROUP BY DATE(recorded_at)
                ORDER BY date ASC
            ");
            $stmt->execute([$days]);
        }
        jsonResponse(true, $stmt->fetchAll());
    }

    if ($action === 'establishment') {
        // Get all historical scores for a specific establishment
        $name = $_GET['name'] ?? '';
        if (!$name) errorResponse('Establishment name required');

        $stmt = $db->prepare("
            SELECT * FROM risk_scores
            WHERE establishment = ?
            ORDER BY recorded_at DESC
            LIMIT 50
        ");
        $stmt->execute([$name]);
        jsonResponse(true, $stmt->fetchAll());
    }

    errorResponse('Unknown action: ' . $action);
} catch (PDOException $e) {
    error_log('risk_history.php error: ' . $e->getMessage());
    errorResponse('Database error. Please try again.', 500);
}
?>
