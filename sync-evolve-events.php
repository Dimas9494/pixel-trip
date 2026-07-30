<?php
/**
 * PIXEL TRIP — Server-side metadata sync (Evolve contract events + reconcile)
 * Upload to: pixeltripnft.website/public_html/sync-evolve-events.php
 *
 * Listens for Evolved(...) logs and POSTs sync to update-metadata.php.
 * Also reconciles tokens whose on-chain stage is ahead of the server JSON.
 *
 * Cron (every 2 minutes):
 *   php /home/hippie/web/pixeltripnft.website/public_html/sync-evolve-events.php
 *
 * HTTP (optional, set CRON_SECRET env on host):
 *   GET /sync-evolve-events.php?key=YOUR_SECRET
 */

define('EVOLVE_CONTRACT', strtolower(getenv('EVOLVE_CONTRACT') ?: '0x1B174b30A0ABA50bd73aF305caDB01e23bfda0EC'));
define('RPC_URL', getenv('MAINNET_RPC_URL') ?: 'https://ethereum-rpc.publicnode.com');
define('STATE_FILE', __DIR__ . '/evolve-sync-state.json');
define('METADATA_DIR', __DIR__ . '/metadata/');
define('ASSIGNMENTS_FILE', __DIR__ . '/token-assignments.json');
define('STAGE3_ASSIGNMENTS_FILE', __DIR__ . '/stage3-assignments.json');
define('UPDATE_METADATA_URL', getenv('UPDATE_METADATA_URL') ?: 'https://pixeltripnft.website/update-metadata.php');
define('EVOLVED_TOPIC', '0xb88806e586caa1c8544d9a44dab35f37182d4ec617d3d3f1c839b37df45a01b8');
define('CRON_SECRET', getenv('CRON_SECRET') ?: '');
define('FIRST_RUN_LOOKBACK', (int)(getenv('EVOLVE_SYNC_LOOKBACK') ?: 120000)); // ~2 weeks of blocks
define('LOG_CHUNK', 2000);

$isCli = (php_sapi_name() === 'cli');

if (!$isCli) {
    header('Content-Type: application/json');
    if (CRON_SECRET !== '' && ($_GET['key'] ?? '') !== CRON_SECRET) {
        http_response_code(403);
        echo json_encode(['error' => 'Forbidden — set ?key=CRON_SECRET']);
        exit;
    }
}

function rpcCall(string $method, array $params) {
    for ($attempt = 0; $attempt < 3; $attempt++) {
        $ch = curl_init(RPC_URL);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode(['jsonrpc' => '2.0', 'method' => $method, 'params' => $params, 'id' => 1]),
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            CURLOPT_TIMEOUT        => 30,
        ]);
        $res  = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($res && $code === 200) {
            $json = json_decode($res, true);
            if (is_array($json) && array_key_exists('result', $json)) {
                return $json['result'];
            }
        }
        usleep(400000);
    }
    return null;
}

function hexToInt(?string $hex): int {
    if (!$hex || $hex === '0x') {
        return 0;
    }
    return (int) hexdec(substr(str_pad(substr($hex, 2), 64, '0', STR_PAD_LEFT), -16));
}

function loadState(): array {
    if (!file_exists(STATE_FILE)) {
        return ['lastBlock' => 0, 'lastRun' => null];
    }
    $data = json_decode(file_get_contents(STATE_FILE), true);
    return is_array($data) ? $data : ['lastBlock' => 0, 'lastRun' => null];
}

function saveState(int $lastBlock): void {
    file_put_contents(STATE_FILE, json_encode([
        'lastBlock' => $lastBlock,
        'lastRun'   => gmdate('c'),
    ], JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
}

function syncToken(int $tokenId, ?int $burnTokenId = null): array {
    $payload = ['tokenId' => $tokenId, 'sync' => true];
    if ($burnTokenId) {
        $payload['burnTokenId'] = $burnTokenId;
    }
    $ch = curl_init(UPDATE_METADATA_URL);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload),
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_TIMEOUT        => 90,
    ]);
    $res  = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $data = json_decode($res ?: '', true) ?: [];
    $ok   = ($code >= 200 && $code < 300 && !empty($data['ok']));
    return ['ok' => $ok, 'http' => $code, 'data' => $data, 'error' => $data['error'] ?? null];
}

function readFileStage(int $tokenId): int {
    $path = METADATA_DIR . $tokenId;
    if (!file_exists($path)) {
        return 0;
    }
    $meta = json_decode(file_get_contents($path), true);
    if (!is_array($meta)) {
        return 0;
    }
    $stage = 0;
    foreach ($meta['attributes'] ?? [] as $attr) {
        if (($attr['trait_type'] ?? '') === 'Stage') {
            $stage = max($stage, (int)($attr['value'] ?? 0));
        }
        if (($attr['trait_type'] ?? '') === 'Stage_1') {
            $stage = max($stage, 1);
        }
    }
    return $stage;
}

function readOnChainStage(int $tokenId): int {
    $url = UPDATE_METADATA_URL . '?health=1&testToken=' . $tokenId;
    $raw = @file_get_contents($url);
    if (!$raw) {
        return 0;
    }
    $data = json_decode($raw, true);
    return (int)($data['onChain']['stage'] ?? 0);
}

function collectTrackedTokenIds(): array {
    $ids = [];
    foreach ([ASSIGNMENTS_FILE, STAGE3_ASSIGNMENTS_FILE] as $file) {
        if (!file_exists($file)) {
            continue;
        }
        $map = json_decode(file_get_contents($file), true) ?: [];
        foreach (array_keys($map) as $tid) {
            if (ctype_digit((string)$tid)) {
                $ids[(int)$tid] = true;
            }
        }
    }
    return array_keys($ids);
}

function findStaleTokens(array $extraIds = []): array {
    $ids = collectTrackedTokenIds();
    foreach ($extraIds as $id) {
        $ids[] = (int)$id;
    }
    $ids = array_values(array_unique(array_filter($ids)));

    $stale = [];
    foreach ($ids as $tokenId) {
        $chain = readOnChainStage($tokenId);
        if ($chain < 2) {
            continue;
        }
        $file = readFileStage($tokenId);
        if ($file < $chain) {
            $stale[] = $tokenId;
        }
    }
    return $stale;
}

function fetchEvolvedEvents(int $fromBlock, int $toBlock): array {
    $events = [];
    $cursor = $fromBlock;
    while ($cursor <= $toBlock) {
        $chunkTo = min($cursor + LOG_CHUNK - 1, $toBlock);
        $logs = rpcCall('eth_getLogs', [[
            'address'   => EVOLVE_CONTRACT,
            'fromBlock' => '0x' . dechex($cursor),
            'toBlock'   => '0x' . dechex($chunkTo),
            'topics'    => [EVOLVED_TOPIC],
        ]]);
        if (is_array($logs)) {
            foreach ($logs as $log) {
                $keepId  = hexToInt($log['topics'][2] ?? '0x0');
                $data    = substr($log['data'] ?? '0x', 2);
                $burnId  = hexToInt('0x' . substr($data, 0, 64));
                $newStage = hexToInt('0x' . substr($data, 64, 64));
                if ($keepId > 0) {
                    $events[] = [
                        'keepId'   => $keepId,
                        'burnId'   => $burnId,
                        'newStage' => $newStage,
                        'block'    => hexToInt($log['blockNumber'] ?? '0x0'),
                        'tx'       => $log['transactionHash'] ?? '',
                    ];
                }
            }
        }
        $cursor = $chunkTo + 1;
        usleep(100000);
    }
    usort($events, fn($a, $b) => ($a['block'] <=> $b['block']) ?: ($a['keepId'] <=> $b['keepId']));
    return $events;
}

// ── Main ─────────────────────────────────────────────────────────────────────

$state   = loadState();
$latest  = hexToInt(rpcCall('eth_blockNumber', []));
if ($latest <= 0) {
    $out = ['ok' => false, 'error' => 'RPC unavailable'];
    echo json_encode($out, JSON_PRETTY_PRINT);
    exit($isCli ? 1 : 500);
}

$fromBlock = ($state['lastBlock'] ?? 0) > 0
    ? ($state['lastBlock'] + 1)
    : max(0, $latest - FIRST_RUN_LOOKBACK);

$report = [
    'ok'         => true,
    'fromBlock'  => $fromBlock,
    'toBlock'    => $latest,
    'events'     => 0,
    'synced'     => [],
    'reconciled' => [],
    'failed'     => [],
];

if ($fromBlock <= $latest) {
    $events = fetchEvolvedEvents($fromBlock, $latest);
    $report['events'] = count($events);

    $keepFromEvents = [];
    foreach ($events as $ev) {
        $keepFromEvents[$ev['keepId']] = $ev['burnId'] ?: null;
    }
    foreach ($keepFromEvents as $keepId => $burnId) {
        $r = syncToken((int)$keepId, $burnId ? (int)$burnId : null);
        if ($r['ok']) {
            $report['synced'][] = ['tokenId' => (int)$keepId, 'source' => 'event', 'stage' => $r['data']['stage'] ?? null];
        } else {
            $report['failed'][] = ['tokenId' => (int)$keepId, 'source' => 'event', 'error' => $r['error'] ?? 'sync failed'];
        }
    }
}

$eventKeepIds = array_column($report['synced'], 'tokenId');
foreach (findStaleTokens($eventKeepIds) as $tokenId) {
    $r = syncToken($tokenId, null);
    if ($r['ok']) {
        $report['reconciled'][] = ['tokenId' => $tokenId, 'stage' => $r['data']['stage'] ?? null];
    } else {
        $report['failed'][] = ['tokenId' => $tokenId, 'source' => 'reconcile', 'error' => $r['error'] ?? 'sync failed'];
    }
}

saveState($latest);

echo json_encode($report, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
