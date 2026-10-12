<?php
require_once 'auth_check.php';
require_once 'activity_log.php';
require_once 'csrf.php';

$method = $_SERVER['REQUEST_METHOD'];
if ($method === 'OPTIONS') { http_response_code(200); exit(); }

// GET is open to all authenticated users; write operations require admin
if ($method !== 'GET' && csrfNeeded()) { requireCsrf(); }

// Ensure table exists
try {
    $db->exec("CREATE TABLE IF NOT EXISTS calendar_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        event_date DATE NOT NULL,
        start_time VARCHAR(10) DEFAULT NULL,
        end_time VARCHAR(10) DEFAULT NULL,
        place VARCHAR(255) DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
} catch (PDOException $e) {
    error_log('calendar_events create table: ' . $e->getMessage());
}

// ---- POST: Create event (admin only) ----
if ($method === 'POST') {
    requireRole('admin');
    try {
        $input = json_decode(file_get_contents('php://input'), true);
        $title      = trim($input['title'] ?? '');
        $eventDate  = trim($input['event_date'] ?? '');
        $startTime  = trim($input['start_time'] ?? '');
        $endTime    = trim($input['end_time'] ?? '');
        $place      = trim($input['place'] ?? '');
        $notes      = trim($input['notes'] ?? '');

        if (!$title || !$eventDate) {
            errorResponse('Title and date are required.', 400);
        }

        $stmt = $db->prepare("INSERT INTO calendar_events (title, event_date, start_time, end_time, place, notes) VALUES (?, ?, ?, ?, ?, ?)");
        $stmt->execute([$title, $eventDate, $startTime ?: null, $endTime ?: null, $place ?: null, $notes ?: null]);

        logActivity($db, 'CREATE', 'calendar_event', null, $_SESSION['username'] ?? '', "Event: $title on $eventDate");
        jsonResponse(true, ['id' => $db->lastInsertId()], 'Event created.');
    } catch (PDOException $e) {
        error_log('calendar_events POST error: ' . $e->getMessage());
        errorResponse('Database error.', 500);
    }
}

// ---- GET: List events ----
if ($method === 'GET') {
    try {
        $where = [];
        $params = [];
        if (!empty($_GET['from'])) { $where[] = "event_date >= ?"; $params[] = $_GET['from']; }
        if (!empty($_GET['to']))   { $where[] = "event_date <= ?"; $params[] = $_GET['to']; }

        $sql = "SELECT * FROM calendar_events";
        if ($where) $sql .= " WHERE " . implode(" AND ", $where);
        $sql .= " ORDER BY event_date ASC, start_time ASC";

        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        jsonResponse(true, $stmt->fetchAll());
    } catch (PDOException $e) {
        error_log('calendar_events GET error: ' . $e->getMessage());
        errorResponse('Database error.', 500);
    }
}

// ---- PUT: Update event (admin only) ----
if ($method === 'PUT') {
    requireRole('admin');
    try {
        $input = json_decode(file_get_contents('php://input'), true);
        $id = intval($input['id'] ?? 0);
        if (!$id) errorResponse('Event ID required');

        $fields = [];
        $params = [];
        foreach (['title', 'event_date', 'start_time', 'end_time', 'place', 'notes'] as $f) {
            if (isset($input[$f])) { $fields[] = "$f = ?"; $params[] = $input[$f]; }
        }
        if (empty($fields)) errorResponse('Nothing to update');
        $params[] = $id;

        $db->prepare("UPDATE calendar_events SET " . implode(', ', $fields) . " WHERE id = ?")->execute($params);
        logActivity($db, 'UPDATE', 'calendar_event', $id, '', 'Event updated');
        jsonResponse(true, null, 'Event updated.');
    } catch (PDOException $e) {
        error_log('calendar_events PUT error: ' . $e->getMessage());
        errorResponse('Database error.', 500);
    }
}

// ---- DELETE: Remove event (admin only) ----
if ($method === 'DELETE') {
    requireRole('admin');
    try {
        $id = intval($_GET['id'] ?? 0);
        if (!$id) errorResponse('Event ID required');

        $db->prepare("DELETE FROM calendar_events WHERE id = ?")->execute([$id]);
        logActivity($db, 'DELETE', 'calendar_event', $id, '', 'Event deleted');
        jsonResponse(true, null, 'Event deleted.');
    } catch (PDOException $e) {
        error_log('calendar_events DELETE error: ' . $e->getMessage());
        errorResponse('Database error.', 500);
    }
}

errorResponse('Method not allowed', 405);