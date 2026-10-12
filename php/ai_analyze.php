<?php
require_once 'auth_check.php';
require_once 'csrf.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit(); }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    die(json_encode(['success' => false, 'data' => null, 'message' => 'Method not allowed']));
}

requireCsrf();

// Rate limit: max 10 AI requests per user per hour
try {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    $rateStmt = $db->prepare("
        SELECT COUNT(*) as cnt FROM activity_log
        WHERE action = 'AI_ANALYZE' AND (username = ? OR ip_address = ?)
        AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)
    ");
    $rateStmt->execute([$_SESSION['username'] ?? '', $ip]);
    $aiCount = $rateStmt->fetch()['cnt'] ?? 0;
    if ($aiCount >= 10) {
        http_response_code(429);
        die(json_encode(['success' => false, 'data' => null, 'message' => 'AI analysis rate limit exceeded. Please try again later.']));
    }
} catch (PDOException $e) {
    // If rate check fails, allow attempt
}

$input          = json_decode(file_get_contents('php://input'), true);
$businessName   = trim($input['businessName']   ?? 'Unknown Establishment');
$riskLevel      = trim($input['riskLevel']      ?? 'LOW');
$totalScore     = intval($input['totalScore']   ?? 0);
$totalViolations= intval($input['totalViolations'] ?? 0);
$lastInspected  = trim($input['lastInspected']  ?? 'N/A');
$barangay       = trim($input['barangay']       ?? 'N/A');
$recommendations= $input['recommendations']     ?? [];
$recoText       = implode(', ', $recommendations);

// Check for cached AI analysis in the latest inspection report for this establishment
$cachedAnalysis = null;
try {
    $cacheStmt = $db->prepare("
        SELECT ai_analysis FROM inspection_reports
        WHERE establishment = ? AND ai_analysis IS NOT NULL AND ai_analysis != ''
        ORDER BY report_date DESC LIMIT 1
    ");
    $cacheStmt->execute([$businessName]);
    $cacheRow = $cacheStmt->fetch();
    if ($cacheRow && !empty($cacheRow['ai_analysis'])) {
        $cachedAnalysis = json_decode($cacheRow['ai_analysis'], true);
    }
} catch (PDOException $e) {
    // Column may not exist yet — continue without cache
}

// If we have a cached analysis with matching risk level, return it
if ($cachedAnalysis && isset($cachedAnalysis['aiAssessment'])) {
    echo json_encode(['success' => true, 'data' => $cachedAnalysis, 'message' => ''], JSON_INVALID_UTF8_SUBSTITUTE | JSON_UNESCAPED_UNICODE);
    exit();
}

// Generate new AI analysis
$prompt = "You are a sanitation compliance expert for the City Health Office of Tayabas City, Philippines.

Based on Presidential Decree No. 856 (Code on Sanitation of the Philippines), analyze this establishment and give a short AI risk assessment.

Establishment: $businessName
Barangay: $barangay
Risk Level: $riskLevel
Risk Score: $totalScore out of 100
Total Violations on Record: $totalViolations
Last Inspected: $lastInspected
System Recommendations: $recoText

Write a 2-3 sentence AI assessment explaining WHY this establishment is $riskLevel risk and what the City Health Office should do. Be specific and professional. Use simple English.

Return ONLY valid JSON with no extra text:
{
  \"aiAssessment\": \"your 2-3 sentence assessment here\"
}";

// Free models to try in order (verified working)
$models = [
    'liquid/lfm-2.5-2.6b:free',
    'nex-agi/nex-n2.5-mini:free',
    'nex-agi/nex-n2.5-pro:free',
];

$rawText   = '';
$lastError = 'All models failed to respond.';

foreach ($models as $model) {
    $payload = json_encode([
        'model'    => $model,
        'messages' => [
            ['role' => 'user', 'content' => $prompt]
        ]
    ]);

    $ch = curl_init('https://openrouter.ai/api/v1/chat/completions');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . OPENROUTER_API_KEY,
            'HTTP-Referer: ' . (isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : 'http://localhost'),
            'X-Title: TayabasCare'
        ],
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_CONNECTTIMEOUT => 10,
    ]);

    $result  = curl_exec($ch);
    $curlErr = curl_error($ch);
    curl_close($ch);

    if ($curlErr) {
        error_log('AI curl error: ' . $curlErr);
        $lastError = 'Connection to AI service failed. Please try again.';
        continue;
    }

    $apiResponse = json_decode($result, true);
    $content = $apiResponse['choices'][0]['message']['content'] ?? '';

    if (isset($apiResponse['error']) || empty($content)) {
        $lastError = $apiResponse['error']['message'] ?? 'Empty response from model';
        continue;
    }

    $rawText = $content;
    break;
}

if (!$rawText) {
    echo json_encode(['success' => false, 'data' => null, 'message' => $lastError]);
    exit();
}

// Parse the AI response
$cleaned  = preg_replace('/```json|```/', '', $rawText);
$analysis = json_decode(trim($cleaned), true);

if (json_last_error() !== JSON_ERROR_NONE) {
    $analysis = ['aiAssessment' => trim(strip_tags($rawText))];
}

// Cache the result in the latest inspection report for this establishment
try {
    $updateStmt = $db->prepare("
        UPDATE inspection_reports SET ai_analysis = ?
        WHERE establishment = ? AND (ai_analysis IS NULL OR ai_analysis = '')
        ORDER BY report_date DESC LIMIT 1
    ");
    $updateStmt->execute([json_encode($analysis), $businessName]);
} catch (PDOException $e) {
    // Caching is best-effort — don't fail the request
}

echo json_encode(['success' => true, 'data' => $analysis, 'message' => ''], JSON_INVALID_UTF8_SUBSTITUTE | JSON_UNESCAPED_UNICODE);
