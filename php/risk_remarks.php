<?php
require_once 'auth_check.php';
require_once 'csrf.php';

// Admin-only free-text risk remark on the Prescribe detail view
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit(); }

requireRole('admin');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method not allowed. Use POST.']);
    exit;
}

if (csrfNeeded()) {
    requireCsrf();
}

try {
    // Lazy migration (same pattern as predict.php)
    $col = $db->query("SHOW COLUMNS FROM sanitary_records LIKE 'admin_risk_remarks'");
    if (!$col->fetch()) {
        $db->exec("ALTER TABLE sanitary_records ADD COLUMN admin_risk_remarks TEXT NULL AFTER remarks");
    }

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $businessName = trim($input['businessName'] ?? '');
    $remark = trim($input['remark'] ?? '');

    if ($businessName === '') {
        echo json_encode(['success' => false, 'message' => 'businessName is required.']);
        exit;
    }

    $stmt = $db->prepare("SELECT id FROM sanitary_records WHERE business_name = ? ORDER BY id ASC LIMIT 1");
    $stmt->execute([$businessName]);
    $row = $stmt->fetch();
    if (!$row) {
        echo json_encode(['success' => false, 'message' => 'Establishment not found.']);
        exit;
    }

    $update = $db->prepare("UPDATE sanitary_records SET admin_risk_remarks = ? WHERE id = ?");
    $update->execute([$remark === '' ? null : $remark, $row['id']]);

    jsonResponse(true, [
        'businessName' => $businessName,
        'adminRiskRemarks' => $remark === '' ? null : $remark,
    ], $remark === '' ? 'Risk remark cleared.' : 'Risk remark saved.');
} catch (PDOException $e) {
    error_log('risk_remarks.php: ' . $e->getMessage());
    errorResponse('Could not save risk remark.');
}
exit;
