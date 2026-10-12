<?php
// Error handling: log but never display
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

// Session configuration: 35-minute server-side lifetime (frontend auto-logout at 30 min)
ini_set('session.gc_maxlifetime', 2100);
ini_set('session.use_strict_mode', 1);

// Hardened session cookie flags
session_set_cookie_params([
    'lifetime' => 0,
    'path'     => '/',
    'httponly' => true,
    'samesite' => 'Lax',
]);

// Start session before any output (must be before headers)
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

// Database Configuration
define('DB_HOST', 'localhost');
define('DB_USER', 'root');
define('DB_PASS', '');
define('DB_NAME', 'tayabascare_db');

// Load secrets (API keys, mail credentials)
require_once __DIR__ . '/secrets.php';

// Database Connection
class Database {
    private $host = DB_HOST;
    private $user = DB_USER;
    private $pass = DB_PASS;
    private $dbname = DB_NAME;
    private $conn;

    public function connect() {
        $this->conn = null;
        try {
            $dsn = "mysql:host=" . $this->host . ";dbname=" . $this->dbname . ";charset=utf8mb4";
            $options = [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ];
            $this->conn = new PDO($dsn, $this->user, $this->pass, $options);
            return $this->conn;
        } catch(PDOException $e) {
            error_log('DB connection failed: ' . $e->getMessage());
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode(['success' => false, 'data' => null, 'message' => 'Database connection failed. Please try again later.']);
            exit();
        }
    }
}

// CORS Headers — restrict to local origin
$allowedOrigins = ['http://localhost', 'http://localhost:80', 'http://127.0.0.1', 'http://localhost:8080'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Credentials: true');
} else {
    header('Access-Control-Allow-Origin: http://localhost');
}
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-CSRF-Token');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// Helper function
function jsonResponse($success, $data = null, $message = '') {
    echo json_encode([
        'success' => $success,
        'data' => $data,
        'message' => $message
    ], JSON_INVALID_UTF8_SUBSTITUTE | JSON_UNESCAPED_UNICODE);
    exit();
}

function errorResponse($message, $code = 400) {
    http_response_code($code);
    jsonResponse(false, null, $message);
}

$database = new Database();
$db = $database->connect();
