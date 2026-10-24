<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: http://localhost');

/**
 * Tayabas City barangays — official PSGC list.
 *
 * Single source of truth for sanitary + burial dropdowns.
 * Refreshes from psgc.cloud server-side when online; falls back to the
 * embedded 66-barangay snapshot so the list works offline / on any host.
 */

const TAYABAS_PSGC_CODE = '0405647000';
const PSGC_BARANGAYS_URL = 'https://psgc.cloud/api/cities-municipalities/' . TAYABAS_PSGC_CODE . '/barangays';
const BARANGAYS_CACHE_TTL = 604800; // 7 days
const BARANGAYS_CACHE_FILE = __DIR__ . '/barangays_cache.json';

/**
 * Official PSGC snapshot (66 barangays, codes 0405647001–0405647066).
 * Source: https://psgc.cloud/api/cities-municipalities/0405647000/barangays
 */
function officialTayabasBarangays(): array
{
    return [
        ['name' => 'Alitao', 'code' => '0405647001'],
        ['name' => 'Alupay', 'code' => '0405647002'],
        ['name' => 'Angeles Zone I', 'code' => '0405647003'],
        ['name' => 'Angeles Zone II', 'code' => '0405647004'],
        ['name' => 'Angeles Zone III', 'code' => '0405647005'],
        ['name' => 'Angeles Zone IV', 'code' => '0405647006'],
        ['name' => 'Angustias Zone I', 'code' => '0405647007'],
        ['name' => 'Angustias Zone II', 'code' => '0405647008'],
        ['name' => 'Angustias Zone III', 'code' => '0405647009'],
        ['name' => 'Angustias Zone IV', 'code' => '0405647010'],
        ['name' => 'Anos', 'code' => '0405647011'],
        ['name' => 'Ayaas', 'code' => '0405647012'],
        ['name' => 'Baguio', 'code' => '0405647013'],
        ['name' => 'Banilad', 'code' => '0405647014'],
        ['name' => 'Calantas', 'code' => '0405647015'],
        ['name' => 'Camaysa', 'code' => '0405647016'],
        ['name' => 'Dapdap', 'code' => '0405647017'],
        ['name' => 'Gibanga', 'code' => '0405647018'],
        ['name' => 'Alsam Ibaba', 'code' => '0405647019'],
        ['name' => 'Bukal Ibaba', 'code' => '0405647020'],
        ['name' => 'Ilasan Ibaba', 'code' => '0405647021'],
        ['name' => 'Nangka Ibaba', 'code' => '0405647022'],
        ['name' => 'Palale Ibaba', 'code' => '0405647023'],
        ['name' => 'Ibas', 'code' => '0405647024'],
        ['name' => 'Alsam Ilaya', 'code' => '0405647025'],
        ['name' => 'Bukal Ilaya', 'code' => '0405647026'],
        ['name' => 'Ilasan Ilaya', 'code' => '0405647027'],
        ['name' => 'Nangka Ilaya', 'code' => '0405647028'],
        ['name' => 'Palale Ilaya', 'code' => '0405647029'],
        ['name' => 'Ipilan', 'code' => '0405647030'],
        ['name' => 'Isabang', 'code' => '0405647031'],
        ['name' => 'Calumpang', 'code' => '0405647032'],
        ['name' => 'Domoit Kanluran', 'code' => '0405647033'],
        ['name' => 'Katigan Kanluran', 'code' => '0405647034'],
        ['name' => 'Palale Kanluran', 'code' => '0405647035'],
        ['name' => 'Lakawan', 'code' => '0405647036'],
        ['name' => 'Lalo', 'code' => '0405647037'],
        ['name' => 'Lawigue', 'code' => '0405647038'],
        ['name' => 'Lita', 'code' => '0405647039'],
        ['name' => 'Malaoa', 'code' => '0405647040'],
        ['name' => 'Masin', 'code' => '0405647041'],
        ['name' => 'Mate', 'code' => '0405647042'],
        ['name' => 'Mateuna', 'code' => '0405647043'],
        ['name' => 'Mayowe', 'code' => '0405647044'],
        ['name' => 'Opias', 'code' => '0405647045'],
        ['name' => 'Pandakaki', 'code' => '0405647046'],
        ['name' => 'Pook', 'code' => '0405647047'],
        ['name' => 'Potol', 'code' => '0405647048'],
        ['name' => 'San Diego Zone I', 'code' => '0405647049'],
        ['name' => 'San Diego Zone II', 'code' => '0405647050'],
        ['name' => 'San Diego Zone III', 'code' => '0405647051'],
        ['name' => 'San Diego Zone IV', 'code' => '0405647052'],
        ['name' => 'San Isidro Zone I', 'code' => '0405647053'],
        ['name' => 'San Isidro Zone II', 'code' => '0405647054'],
        ['name' => 'San Isidro Zone III', 'code' => '0405647055'],
        ['name' => 'San Isidro Zone IV', 'code' => '0405647056'],
        ['name' => 'San Roque Zone I', 'code' => '0405647057'],
        ['name' => 'San Roque Zone II', 'code' => '0405647058'],
        ['name' => 'Domoit Silangan', 'code' => '0405647059'],
        ['name' => 'Katigan Silangan', 'code' => '0405647060'],
        ['name' => 'Palale Silangan', 'code' => '0405647061'],
        ['name' => 'Talolong', 'code' => '0405647062'],
        ['name' => 'Tamlong', 'code' => '0405647063'],
        ['name' => 'Tongko', 'code' => '0405647064'],
        ['name' => 'Valencia', 'code' => '0405647065'],
        ['name' => 'Wakas', 'code' => '0405647066'],
    ];
}

function isValidBarangayList(array $list): bool
{
    if (count($list) < 60) {
        return false;
    }
    foreach ($list as $item) {
        if (!isset($item['name'], $item['code']) || $item['name'] === '' || $item['code'] === '') {
            return false;
        }
        if (strpos((string)$item['code'], '0405647') !== 0) {
            return false;
        }
    }
    return true;
}

function normalizeBarangays(array $raw): array
{
    $out = [];
    foreach ($raw as $item) {
        if (!is_array($item)) {
            continue;
        }
        $name = trim((string)($item['name'] ?? $item['barangay_name'] ?? ''));
        $code = trim((string)($item['code'] ?? ''));
        if ($name === '') {
            continue;
        }
        if ($code !== '' && strpos($code, '0405647') !== 0) {
            continue;
        }
        $out[] = ['name' => $name, 'code' => $code !== '' ? $code : null];
    }
    usort($out, fn($a, $b) => strcmp($a['name'], $b['name']));
    return $out;
}

function readBarangaysCache(): ?array
{
    if (!is_readable(BARANGAYS_CACHE_FILE)) {
        return null;
    }
    $raw = @file_get_contents(BARANGAYS_CACHE_FILE);
    if ($raw === false) {
        return null;
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded) || !isset($decoded['fetched_at'], $decoded['data'])) {
        return null;
    }
    if ((time() - (int)$decoded['fetched_at']) > BARANGAYS_CACHE_TTL) {
        return null;
    }
    $list = normalizeBarangays($decoded['data']);
    return isValidBarangayList($list) ? $list : null;
}

function writeBarangaysCache(array $list): void
{
    @file_put_contents(
        BARANGAYS_CACHE_FILE,
        json_encode(['fetched_at' => time(), 'data' => $list], JSON_UNESCAPED_UNICODE),
        LOCK_EX
    );
}

function fetchLiveBarangays(): ?array
{
    $ctx = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => 4,
            'header' => "Accept: application/json\r\nUser-Agent: TayabasCare\r\n",
        ],
        'ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
        ],
    ]);

    $body = @file_get_contents(PSGC_BARANGAYS_URL, false, $ctx);
    if ($body === false) {
        if (function_exists('curl_init')) {
            $ch = curl_init(PSGC_BARANGAYS_URL);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 4,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_HTTPHEADER => ['Accept: application/json'],
            ]);
            $body = curl_exec($ch);
            curl_close($ch);
        }
    }
    if ($body === false || $body === '') {
        return null;
    }

    $decoded = json_decode($body, true);
    if (!is_array($decoded)) {
        return null;
    }

    $list = normalizeBarangays($decoded);
    return isValidBarangayList($list) ? $list : null;
}

// ── Resolve list: cache → live PSGC → stale cache → embedded snapshot ──
$barangays = readBarangaysCache();
if ($barangays === null) {
    $live = fetchLiveBarangays();
    if ($live !== null) {
        $barangays = $live;
        writeBarangaysCache($barangays);
    }
}
if ($barangays === null) {
    $barangays = normalizeBarangays(officialTayabasBarangays());
}

echo json_encode(['success' => true, 'data' => $barangays, 'message' => '']);
