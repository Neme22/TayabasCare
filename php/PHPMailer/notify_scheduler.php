<?php
session_start();
require_once __DIR__ . '/../config.php';
if (!isset($_SESSION['user_id']) || ($_SESSION['role'] ?? '') !== 'admin') {
    http_response_code(403);
    echo json_encode(['success' => false, 'message' => 'Admin access required.']);
    exit();
}
require_once __DIR__ . '/Exception.php';
require_once __DIR__ . '/PHPMailer.php';
require_once __DIR__ . '/SMTP.php';

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

// Find schedules where the date is exactly tomorrow
$tomorrow = date('Y-m-d', strtotime('+1 day'));

$stmt = $db->prepare("
    SELECT s.schedDate, s.notes, s.inspector_name, i.email
    FROM inspection_schedules s
    JOIN inspector_accounts i ON i.full_name = s.inspector_name
    WHERE s.schedDate = ? AND s.done = 0 AND s.notified = 0
");
$stmt->execute([$tomorrow]);
$schedules = $stmt->fetchAll();

$sent = 0;
$failed = 0;

foreach ($schedules as $s) {
    $mail = new PHPMailer(true);
    try {
        $mail->isSMTP();
        $mail->Host       = MAIL_HOST;
        $mail->SMTPAuth   = true;
        $mail->Username   = MAIL_USERNAME;
        $mail->Password   = MAIL_PASSWORD;
        $mail->SMTPSecure = 'tls';
        $mail->Port       = MAIL_PORT;
        $mail->SMTPOptions = [
            'ssl' => [
                'verify_peer'       => false,
                'verify_peer_name'  => false,
                'allow_self_signed' => true
            ]
        ];
        $mail->setFrom(MAIL_FROM, MAIL_FROMNAME);
        $mail->addAddress($s['email'], $s['inspector_name']);
        $mail->Subject = 'TayabasCare – Inspection Reminder for ' . date('F j, Y', strtotime($s['schedDate']));
        $mail->Body    =
            "Dear {$s['inspector_name']},\n\n" .
            "This is a reminder that you have an inspection scheduled TOMORROW:\n\n" .
            "   Date: " . date('F j, Y', strtotime($s['schedDate'])) . "\n" .
            ($s['notes'] ? "   Note: {$s['notes']}\n" : '') .
            "\nPlease prepare accordingly.\n\n" .
            "– TayabasCare System";
        $mail->send();

        // Mark as notified so it doesn't send again
        $db->prepare("UPDATE inspection_schedules SET notified = 1 WHERE schedDate = ? AND inspector_name = ? LIMIT 1")
           ->execute([$s['schedDate'], $s['inspector_name']]);

        $sent++;
    } catch (Exception $e) {
        $failed++;
    }
}

echo "Done. Sent: $sent | Failed: $failed";
?>