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
 * HTTP reconcile only (fast, no log scan):
 *   GET /sync-evolve-events.php?reconcile=1
 *
 * HTTP reconcile one token (after failed evolve sync):
 *   GET /sync-evolve-events.php?reconcile=1&tokenId=806&burnTokenId=123
 *
 * CLI full reconcile (scan all Stage 1 metadata files once):
 *   php sync-evolve-events.php --full-reconcile
 */

define('EVOLVE_CONTRACT', strtolower(getenv('EVOLVE_CONTRACT') ?: '0x1B174b30A0ABA50bd73aF305caDB01e23bfda0EC'));
define('RPC_URL', getenv('MAINNET_RPC_URL') ?: 'https://ethereum-rpc.publicnode.com');
define('STATE_FILE', __DIR__ . '/evolve-sync-state.json');
define('METADATA_DIR', __DIR__ . '/metadata/');
define('ASSIGNMENTS_FILE', __DIR__ . '/token-assignments.json');
define('STAGE3_ASSIGNMENTS_FILE', __DIR__ . '/stage3-assignments.json');
define('EVOLUTION_LINEAGE_FILE', __DIR__ . '/evolution-lineage.json');
define('BURN_SNAPSHOTS_DIR', __DIR__ . '/burn-snapshots/');
define('UPDATE_METADATA_URL', getenv('UPDATE_METADATA_URL') ?: 'https://pixeltripnft.website/update-metadata.php');
define('EVOLVED_TOPIC', '0xb88806e586caa1c8544d9a44dab35f37182d4ec617d3d3f1c839b37df45a01b8');
define('CRON_SECRET', getenv('CRON_SECRET') ?: '');
define('FIRST_RUN_LOOKBACK', (int)(getenv('EVOLVE_SYNC_LOOKBACK') ?: 120000)); // CLI ~2 weeks
define('HTTP_LOOKBACK', (int)(getenv('EVOLVE_SYNC_HTTP_LOOKBACK') ?: 8000));   // HTTP ~1 day
define('RECONCILE_LOOKBACK', (int)(getenv('EVOLVE_RECONCILE_LOOKBACK') ?: 50000)); // ~7 days
define('RECONCILE_SCAN_BATCH', (int)(getenv('EVOLVE_RECONCILE_SCAN_BATCH') ?: 80));
define('LOG_CHUNK', 2000);

$isCli = (php_sapi_name() === 'cli');
$reconcileOnly = $isCli
    ? in_array('--reconcile', $argv ?? [], true) || in_array('--full-reconcile', $argv ?? [], true)
    : !empty($_GET['reconcile']);
$fullReconcile = $isCli && in_array('--full-reconcile', $argv ?? [], true);

if ($isCli) {
    @set_time_limit(0);
}

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
    $defaults = ['lastBlock' => 0, 'lastRun' => null, 'pendingSync' => [], 'reconcileCursor' => 0];
    if (!file_exists(STATE_FILE)) {
        return $defaults;
    }
    $data = json_decode(file_get_contents(STATE_FILE), true);
    return is_array($data) ? array_merge($defaults, $data) : $defaults;
}

function saveState(array $state, ?int $lastBlock = null): void {
    if ($lastBlock !== null) {
        $state['lastBlock'] = $lastBlock;
    }
    $state['lastRun'] = gmdate('c');
    file_put_contents(STATE_FILE, json_encode($state, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
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

function collectAssignmentTokenIds(): array {
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

function collectLineageTokenIds(): array {
    if (!file_exists(EVOLUTION_LINEAGE_FILE)) {
        return [];
    }
    $lineage = json_decode(file_get_contents(EVOLUTION_LINEAGE_FILE), true) ?: [];
    $ids = [];
    foreach (array_keys($lineage) as $tid) {
        if (ctype_digit((string)$tid)) {
            $ids[(int)$tid] = true;
        }
    }
    return array_keys($ids);
}

function collectGenesisMetadataIds(): array {
    $ids = [];
    if (!is_dir(METADATA_DIR)) {
        return $ids;
    }
    foreach (glob(METADATA_DIR . '*') ?: [] as $path) {
        if (!is_file($path)) {
            continue;
        }
        $tokenId = basename($path);
        if (!ctype_digit($tokenId)) {
            continue;
        }
        if (readFileStage((int)$tokenId) < 2) {
            $ids[] = (int)$tokenId;
        }
    }
    sort($ids, SORT_NUMERIC);
    return $ids;
}

function nextGenesisScanBatch(array &$state, ?int $batchSize = null): array {
    $limit = $batchSize ?? RECONCILE_SCAN_BATCH;
    $all = collectGenesisMetadataIds();
    $cursor = max(0, (int)($state['reconcileCursor'] ?? 0));
    if ($cursor >= count($all)) {
        $cursor = 0;
    }
    $batch = array_slice($all, $cursor, $limit);
    $state['reconcileCursor'] = $cursor + count($batch);
    if ($state['reconcileCursor'] >= count($all)) {
        $state['reconcileCursor'] = 0;
    }
    return $batch;
}

function loadBurnIdForKeep(int $keepId, array $eventMap = []): ?int {
    if (!empty($eventMap[$keepId])) {
        return (int)$eventMap[$keepId];
    }

    if (file_exists(EVOLUTION_LINEAGE_FILE)) {
        $lineage = json_decode(file_get_contents(EVOLUTION_LINEAGE_FILE), true) ?: [];
        foreach ($lineage[(string)$keepId]['burned'] ?? [] as $entry) {
            $burnId = (int)($entry['tokenId'] ?? 0);
            if ($burnId > 0) {
                return $burnId;
            }
        }
    }

    if (is_dir(BURN_SNAPSHOTS_DIR)) {
        foreach (glob(BURN_SNAPSHOTS_DIR . '*.json') ?: [] as $path) {
            $snap = json_decode(file_get_contents($path), true) ?: [];
            if ((int)($snap['evolvedInto'] ?? 0) === $keepId) {
                return (int)basename($path, '.json');
            }
        }
    }

    return null;
}

function buildEventKeepMap(array $events): array {
    $map = [];
    foreach ($events as $ev) {
        $keepId = (int)($ev['keepId'] ?? 0);
        $burnId = (int)($ev['burnId'] ?? 0);
        if ($keepId > 0) {
            $map[$keepId] = $burnId ?: ($map[$keepId] ?? null);
        }
    }
    return $map;
}

function collectReconcileCandidateIds(array $extraIds, array $eventKeepIds, array $scanBatch, array $pendingSync): array {
    $ids = array_merge(
        collectAssignmentTokenIds(),
        collectLineageTokenIds(),
        $eventKeepIds,
        $extraIds,
        $scanBatch,
        array_map('intval', array_keys($pendingSync))
    );
    return array_values(array_unique(array_filter(array_map('intval', $ids))));
}

function findStaleTokens(array $candidateIds, array $eventMap = []): array {
    $stale = [];
    foreach ($candidateIds as $tokenId) {
        $tokenId = (int)$tokenId;
        if ($tokenId <= 0) {
            continue;
        }
        $chain = readOnChainStage($tokenId);
        if ($chain < 2) {
            continue;
        }
        $file = readFileStage($tokenId);
        if ($file < $chain) {
            $stale[] = [
                'tokenId' => $tokenId,
                'burnId'  => loadBurnIdForKeep($tokenId, $eventMap),
                'chain'   => $chain,
                'file'    => $file,
            ];
        }
    }
    return $stale;
}

function fetchEvolvedEvents(int $fromBlock, int $toBlock, array &$state, bool $saveProgress = false): array {
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
        if ($saveProgress) {
            saveState($state, $chunkTo);
        }
        $cursor = $chunkTo + 1;
        usleep(100000);
    }
    usort($events, fn($a, $b) => ($a['block'] <=> $b['block']) ?: ($a['keepId'] <=> $b['keepId']));
    return $events;
}

function syncKeepToken(int $keepId, ?int $burnId, array &$state, array &$report, string $source): void {
    $r = syncToken($keepId, $burnId ?: null);
    $key = (string)$keepId;
    if ($r['ok']) {
        unset($state['pendingSync'][$key]);
        if ($source === 'event') {
            $report['synced'][] = ['tokenId' => $keepId, 'source' => $source, 'stage' => $r['data']['stage'] ?? null];
        } else {
            $report['reconciled'][] = ['tokenId' => $keepId, 'source' => $source, 'stage' => $r['data']['stage'] ?? null];
        }
        return;
    }

    $state['pendingSync'][$key] = $burnId ?: ($state['pendingSync'][$key] ?? null);
    $report['failed'][] = [
        'tokenId' => $keepId,
        'source'  => $source,
        'error'   => $r['error'] ?? 'sync failed',
    ];
}

// ── Main ─────────────────────────────────────────────────────────────────────

$state   = loadState();
$latest  = hexToInt(rpcCall('eth_blockNumber', []));
if ($latest <= 0) {
    $out = ['ok' => false, 'error' => 'RPC unavailable'];
    echo json_encode($out, JSON_PRETTY_PRINT);
    exit($isCli ? 1 : 500);
}

$requestedTokenId = isset($_GET['tokenId']) ? (int)$_GET['tokenId'] : 0;
$requestedBurnId  = isset($_GET['burnTokenId']) ? (int)$_GET['burnTokenId'] : 0;
$httpLightReconcile = !$isCli && $reconcileOnly && !$fullReconcile && $requestedTokenId <= 0;
$extraIds = $requestedTokenId > 0 ? [$requestedTokenId] : [];

// Fast path for dApp: ?reconcile=1&tokenId=N — skip log scans and bulk checks.
if (!$isCli && $reconcileOnly && $requestedTokenId > 0) {
    $report = [
        'ok'             => true,
        'mode'           => 'reconcile-target',
        'tokenId'        => $requestedTokenId,
        'pendingRetries' => count($state['pendingSync'] ?? []),
        'synced'         => [],
        'reconciled'     => [],
        'failed'         => [],
    ];
    $burnId = $requestedBurnId ?: loadBurnIdForKeep($requestedTokenId, []);
    syncKeepToken($requestedTokenId, $burnId, $state, $report, 'request');
    saveState($state);
    echo json_encode($report, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    exit;
}

$report = [
    'ok'               => true,
    'mode'             => $reconcileOnly ? 'reconcile' : 'events+reconcile',
    'fromBlock'        => null,
    'toBlock'          => $latest,
    'events'           => 0,
    'recentEvents'     => 0,
    'scanBatch'        => 0,
    'pendingRetries'   => count($state['pendingSync'] ?? []),
    'synced'           => [],
    'reconciled'       => [],
    'failed'           => [],
];

$eventMap = [];

if (!$reconcileOnly) {
    $lookback = $isCli ? FIRST_RUN_LOOKBACK : HTTP_LOOKBACK;
    $fromBlock = ($state['lastBlock'] ?? 0) > 0
        ? ($state['lastBlock'] + 1)
        : max(0, $latest - $lookback);
    $report['fromBlock'] = $fromBlock;

    if ($fromBlock <= $latest) {
        $events = fetchEvolvedEvents($fromBlock, $latest, $state, true);
        $report['events'] = count($events);
        $eventMap = buildEventKeepMap($events);

        foreach ($eventMap as $keepId => $burnId) {
            syncKeepToken((int)$keepId, $burnId ? (int)$burnId : null, $state, $report, 'event');
        }
    }
    saveState($state, $latest);
} else {
    if (!$httpLightReconcile) {
        $fromBlock = max(0, $latest - RECONCILE_LOOKBACK);
        $recentEvents = fetchEvolvedEvents($fromBlock, $latest, $state, false);
        $report['recentEvents'] = count($recentEvents);
        $eventMap = buildEventKeepMap($recentEvents);
    } else {
        $report['mode'] = 'reconcile-light';
    }
}

foreach ($state['pendingSync'] ?? [] as $keepId => $burnId) {
    syncKeepToken((int)$keepId, $burnId ? (int)$burnId : null, $state, $report, 'pending');
}

$httpScanBatch = min(12, RECONCILE_SCAN_BATCH);
$scanBatch = $fullReconcile
    ? collectGenesisMetadataIds()
    : ($httpLightReconcile ? [] : nextGenesisScanBatch($state, $isCli ? RECONCILE_SCAN_BATCH : $httpScanBatch));
$report['scanBatch'] = count($scanBatch);
$report['fullReconcile'] = $fullReconcile;

$eventKeepIds = array_keys($eventMap);
$candidateIds = collectReconcileCandidateIds(
    $extraIds,
    $eventKeepIds,
    $scanBatch,
    $state['pendingSync'] ?? []
);

foreach (findStaleTokens($candidateIds, $eventMap) as $row) {
    $keepId = (int)$row['tokenId'];
    $already = false;
    foreach (array_merge($report['synced'], $report['reconciled']) as $done) {
        if ((int)($done['tokenId'] ?? 0) === $keepId) {
            $already = true;
            break;
        }
    }
    if ($already) {
        continue;
    }
    syncKeepToken($keepId, $row['burnId'] ? (int)$row['burnId'] : null, $state, $report, 'reconcile');
}

saveState($state);

echo json_encode($report, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
