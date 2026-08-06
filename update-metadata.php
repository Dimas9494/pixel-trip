<?php
/**
 * PIXEL TRIP — Auto Metadata Updater
 * Upload to: pixeltripnft.website/update-metadata.php
 *
 * Called by the dApp after a successful evolve transaction.
 * Verifies the tx on-chain, then writes the new metadata JSON.
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit; }

// ── Config ────────────────────────────────────────────────────────────────────

define('EVOLVE_CONTRACT', strtolower(getenv('EVOLVE_CONTRACT') ?: '0x1B174b30A0ABA50bd73aF305caDB01e23bfda0EC'));
define('STAGE1_ADDRESS',  strtolower('0xadf9c3c2d2946b3c80913b9e022dc2ce9e93afd9'));
define('RPC_URL',         'https://ethereum-rpc.publicnode.com');
define('METADATA_DIR',    __DIR__ . '/metadata/');
define('IMAGE_STAGE2',    'https://pixeltripnft.website/stage2/images');
define('IMAGE_STAGE3',    'https://pixeltripnft.website/stage3/images');
define('VARIANT_MAP_FILE', __DIR__ . '/variant-map.json');
define('CHAR_MAP_FILE',    __DIR__ . '/char-map.json');
define('STAGE3_MAP_FILE',  __DIR__ . '/stage3-variants.json');
define('ASSIGNMENTS_FILE', __DIR__ . '/token-assignments.json');
define('STAGE3_ASSIGNMENTS_FILE', __DIR__ . '/stage3-assignments.json');
define('STAGE2_VARIANTS_FILE', __DIR__ . '/stage2-variants.json');

function assetGifUrl(string $base, string $slug, int $stage, int $tokenId): string {
    return $base . '/' . $slug . '.gif?v=' . $stage . '-' . $tokenId;
}

// Contract call selectors (keccak256 first 4 bytes of function sig)
define('SEL_EVOLVED_STAGE',    'ab6dd60d'); // evolvedStage(uint256)
define('SEL_STAGE1_CHARACTER', '237885d8'); // stage1Character(uint256)

// ── RPC helpers ─────────────────────────────────────────────────────────────

function rpcCall(string $method, array $params) {
    for ($attempt = 0; $attempt < 3; $attempt++) {
        $ch = curl_init(RPC_URL);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode(['jsonrpc'=>'2.0','method'=>$method,'params'=>$params,'id'=>1]),
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            CURLOPT_TIMEOUT        => 15,
        ]);
        $res  = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($res && $code === 200) {
            $json = json_decode($res, true);
            if (is_array($json) && array_key_exists('result', $json)) return $json['result'];
        }
        usleep(500000);
    }
    return null;
}

function encodeUint256Call(string $selector, int $tokenId): string {
    return '0x' . $selector . str_pad(dechex($tokenId), 64, '0', STR_PAD_LEFT);
}

function ethCall(string $contract, string $data) {
    return rpcCall('eth_call', [['to' => $contract, 'data' => $data], 'latest']);
}

function decodeUint8($hex): int {
    if (!$hex || $hex === '0x') return 0;
    $raw = str_pad(substr($hex, 2), 64, '0', STR_PAD_LEFT);
    return (int) hexdec(substr($raw, -2));
}

function decodeUint16($hex): int {
    if (!$hex || $hex === '0x') return 0;
    $raw = str_pad(substr($hex, 2), 64, '0', STR_PAD_LEFT);
    return (int) hexdec(substr($raw, -4));
}

function loadCharIdToName(): array {
    if (!file_exists(CHAR_MAP_FILE)) return [];
    $nameToId = json_decode(file_get_contents(CHAR_MAP_FILE), true) ?: [];
    $idToName = [];
    foreach ($nameToId as $name => $id) {
        $idToName[(int)$id] = $name;
    }
    return $idToName;
}

function readOnChainState(int $tokenId): array {
    if (!EVOLVE_CONTRACT) {
        return ['stage' => 0, 'charId' => 0, 'charName' => ''];
    }
    $contract = EVOLVE_CONTRACT;
    $stageHex = ethCall($contract, encodeUint256Call(SEL_EVOLVED_STAGE, $tokenId));
    $charHex  = ethCall($contract, encodeUint256Call(SEL_STAGE1_CHARACTER, $tokenId));
    $stage    = decodeUint8($stageHex);
    $charId   = decodeUint16($charHex);
    $charMap  = loadCharIdToName();
    $charName = $charMap[$charId] ?? '';
    return ['stage' => $stage, 'charId' => $charId, 'charName' => $charName];
}

function loadStage2VariantsCatalog(): array {
    if (!file_exists(STAGE2_VARIANTS_FILE)) {
        return [];
    }
    return json_decode(file_get_contents(STAGE2_VARIANTS_FILE), true) ?: [];
}

function loadStage3Maps(): array {
    if (!file_exists(STAGE3_MAP_FILE)) {
        return ['fromStage2Slug' => [], 'defaultByChar' => [], 'poolByChar' => []];
    }
    $data = json_decode(file_get_contents(STAGE3_MAP_FILE), true) ?: [];
    return [
        'fromStage2Slug' => $data['fromStage2Slug'] ?? [],
        'defaultByChar'  => $data['defaultByChar'] ?? [],
        'poolByChar'     => $data['poolByChar'] ?? [],
    ];
}

function loadVariantMap(): array {
    if (!file_exists(VARIANT_MAP_FILE)) return [];
    return json_decode(file_get_contents(VARIANT_MAP_FILE), true) ?: [];
}

function saveAssignments(array $assignments): void {
    file_put_contents(
        ASSIGNMENTS_FILE,
        json_encode($assignments, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT)
    );
}

function saveStage3Assignments(array $assignments): void {
    file_put_contents(
        STAGE3_ASSIGNMENTS_FILE,
        json_encode($assignments, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT)
    );
}

function stage3PoolForChar(string $charName): array {
    $maps = loadStage3Maps();
    return $maps['poolByChar'][$charName] ?? [];
}

function stage3PoolSlugSet(string $charName): array {
    return array_column(stage3PoolForChar($charName), 'slug');
}

function scanMetadataForStage3Assignments(): array {
    $out = [];
    if (!is_dir(METADATA_DIR)) return $out;

    $slugToEntry = [];
    foreach (loadStage3Maps()['poolByChar'] as $entries) {
        foreach ($entries as $entry) {
            $slugToEntry[$entry['slug']] = $entry;
        }
    }

    foreach (glob(METADATA_DIR . '*') as $path) {
        if (!is_file($path)) continue;
        $tokenId = basename($path);
        if (!ctype_digit($tokenId)) continue;

        $meta = json_decode(file_get_contents($path), true);
        if (!$meta) continue;

        $charSlug = null;
        $stage    = 0;
        foreach ($meta['attributes'] ?? [] as $attr) {
            if ($attr['trait_type'] === 'Character') $charSlug = $attr['value'];
            if ($attr['trait_type'] === 'Stage') $stage = (int)$attr['value'];
        }
        if ($stage !== 3 || !$charSlug || !isset($slugToEntry[$charSlug])) continue;
        $out[$tokenId] = $slugToEntry[$charSlug];
    }
    return $out;
}

function loadStage3Assignments(): array {
    $assignments = [];
    if (file_exists(STAGE3_ASSIGNMENTS_FILE)) {
        $assignments = json_decode(file_get_contents(STAGE3_ASSIGNMENTS_FILE), true) ?: [];
    }
    $slugToEntry = [];
    foreach (loadStage3Maps()['poolByChar'] as $entries) {
        foreach ($entries as $entry) {
            $slugToEntry[$entry['slug']] = $entry;
        }
    }
    $out = [];
    foreach ($assignments as $tid => $v) {
        $slug = $v['slug'] ?? '';
        if (isset($slugToEntry[$slug])) {
            $out[$tid] = $slugToEntry[$slug];
        }
    }
    foreach (scanMetadataForStage3Assignments() as $tid => $v) {
        if (!isset($out[$tid])) {
            $out[$tid] = $v;
        }
    }
    return $out;
}

function collectUsedStage3Slugs(string $charName, array $s3Assignments, ?int $excludeTokenId = null): array {
    $slugSet = stage3PoolSlugSet($charName);
    $used    = [];
    foreach ($s3Assignments as $tid => $v) {
        if ((int)$tid === $excludeTokenId) continue;
        $slug = $v['slug'] ?? '';
        if (in_array($slug, $slugSet, true)) {
            $used[] = $slug;
        }
    }
    return array_values(array_unique($used));
}

function catalogSlugMap(array $STAGE2_VARIANTS): array {
    $map = [];
    foreach ($STAGE2_VARIANTS as $variants) {
        foreach ($variants as $v) {
            $map[$v['slug']] = $v;
        }
    }
    return $map;
}

function sanitizeAssignments(array $assignments, array $STAGE2_VARIANTS): array {
    $catalog = catalogSlugMap($STAGE2_VARIANTS);
    $out     = [];
    foreach ($assignments as $tid => $v) {
        $slug = $v['slug'] ?? '';
        if (isset($catalog[$slug])) {
            $out[$tid] = $catalog[$slug];
        }
    }
    return $out;
}

function scanMetadataForAssignments(array $STAGE2_VARIANTS): array {
    $out = [];
    if (!is_dir(METADATA_DIR)) return $out;

    $slugToVariant = [];
    foreach ($STAGE2_VARIANTS as $variants) {
        foreach ($variants as $v) {
            $slugToVariant[$v['slug']] = $v;
        }
    }

    $s3ToS2 = [];
    foreach (loadStage3Maps()['fromStage2Slug'] as $s2slug => $s3) {
        $s3ToS2[$s3['slug']] = $s2slug;
    }

    foreach (glob(METADATA_DIR . '*') as $path) {
        if (!is_file($path)) continue;
        $tokenId = basename($path);
        if (!ctype_digit($tokenId)) continue;

        $meta = json_decode(file_get_contents($path), true);
        if (!$meta) continue;

        $charSlug = null;
        $stage    = 0;
        foreach ($meta['attributes'] ?? [] as $attr) {
            if ($attr['trait_type'] === 'Character') $charSlug = $attr['value'];
            if ($attr['trait_type'] === 'Stage') $stage = (int)$attr['value'];
        }
        if ($stage < 2 || !$charSlug) continue;

        if (isset($slugToVariant[$charSlug])) {
            $out[$tokenId] = $slugToVariant[$charSlug];
        } elseif (isset($s3ToS2[$charSlug], $slugToVariant[$s3ToS2[$charSlug]])) {
            $out[$tokenId] = $slugToVariant[$s3ToS2[$charSlug]];
        }
    }
    return $out;
}

function loadAssignments(array $STAGE2_VARIANTS): array {
    $assignments = [];
    if (file_exists(ASSIGNMENTS_FILE)) {
        $assignments = json_decode(file_get_contents(ASSIGNMENTS_FILE), true) ?: [];
    }
    $assignments = sanitizeAssignments($assignments, $STAGE2_VARIANTS);
    foreach (scanMetadataForAssignments($STAGE2_VARIANTS) as $tid => $v) {
        if (!isset($assignments[$tid])) {
            $assignments[$tid] = $v;
        }
    }
    return $assignments;
}

function collectUsedSlugs(string $charName, array $assignments, array $STAGE2_VARIANTS, ?int $excludeTokenId = null): array {
    $variants = $STAGE2_VARIANTS[$charName] ?? [];
    $slugSet  = array_column($variants, 'slug');
    $used     = [];
    foreach ($assignments as $tid => $v) {
        if ((int)$tid === $excludeTokenId) continue;
        $slug = $v['slug'] ?? '';
        if (in_array($slug, $slugSet, true)) {
            $used[] = $slug;
        }
    }
    return array_values(array_unique($used));
}

function resolveStage2Variant(
    int $tokenId,
    string $charName,
    array $STAGE2_VARIANTS,
    array &$assignments,
    bool $persist,
    ?int $excludeTokenId = null
): ?array {
    $key      = (string)$tokenId;
    $variants = $STAGE2_VARIANTS[$charName] ?? [];
    if (empty($variants)) return null;

    if (isset($assignments[$key])) {
        $catalog = catalogSlugMap($STAGE2_VARIANTS);
        $slug    = $assignments[$key]['slug'] ?? '';
        if (isset($catalog[$slug]) && in_array($slug, array_column($variants, 'slug'), true)) {
            return $catalog[$slug];
        }
        unset($assignments[$key]);
    }

    $used         = collectUsedSlugs($charName, $assignments, $STAGE2_VARIANTS, $excludeTokenId);
    $variantMap   = loadVariantMap();
    $preferred    = $variantMap[$key] ?? $variants[$tokenId % count($variants)];
    if ($preferred && !isset(catalogSlugMap($STAGE2_VARIANTS)[$preferred['slug'] ?? ''])) {
        $preferred = $variants[$tokenId % count($variants)];
    }

    if ($preferred && !in_array($preferred['slug'], $used, true)) {
        $chosen = $preferred;
    } else {
        $chosen = null;
        foreach ($variants as $v) {
            if (!in_array($v['slug'], $used, true)) {
                $chosen = $v;
                break;
            }
        }
        if (!$chosen) {
            $chosen = $preferred ?? $variants[0];
        }
    }

    if ($persist) {
        $assignments[$key] = $chosen;
        saveAssignments($assignments);
    }
    return $chosen;
}

function getStage3VariantFromS2(?array $s2, string $charName): ?array {
    // Legacy helper — Stage 3 is no longer tied to Stage 2 slug names.
    return null;
}

function resolveStage3Variant(
    int $tokenId,
    string $charName,
    array $STAGE2_VARIANTS,
    array &$assignments,
    bool $persist,
    ?int $excludeTokenId = null
): ?array {
    $pool = stage3PoolForChar($charName);

    if (empty($pool)) {
        $maps = loadStage3Maps();
        return $maps['defaultByChar'][$charName] ?? null;
    }

    $key            = (string)$tokenId;
    $s3Assignments  = loadStage3Assignments();

    if (isset($s3Assignments[$key])) {
        return $s3Assignments[$key];
    }

    $used = collectUsedStage3Slugs($charName, $s3Assignments, $excludeTokenId ?? $tokenId);
    $preferred = $pool[$tokenId % count($pool)];

    if (!in_array($preferred['slug'], $used, true)) {
        $chosen = $preferred;
    } else {
        $chosen = null;
        foreach ($pool as $entry) {
            if (!in_array($entry['slug'], $used, true)) {
                $chosen = $entry;
                break;
            }
        }
    }

    if (!$chosen) {
        return null;
    }

    if ($persist) {
        $s3Assignments[$key] = $chosen;
        saveStage3Assignments($s3Assignments);
    }
    return $chosen;
}

function loadAndPersistAssignments(array $STAGE2_VARIANTS): array {
    $fromFile = [];
    if (file_exists(ASSIGNMENTS_FILE)) {
        $fromFile = json_decode(file_get_contents(ASSIGNMENTS_FILE), true) ?: [];
    }
    $merged = loadAssignments($STAGE2_VARIANTS);
    if ($merged !== $fromFile) {
        saveAssignments($merged);
    }
    return $merged;
}

// Health check: GET /update-metadata.php?health=1&testToken=103
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['health'])) {
    $dirOk = is_dir(METADATA_DIR) && is_writable(METADATA_DIR);
    $out = [
        'ok'           => $dirOk,
        'metadataDir'  => METADATA_DIR,
        'writable'     => $dirOk,
        'contract'     => EVOLVE_CONTRACT,
        'charMap'      => file_exists(CHAR_MAP_FILE),
        'variantMap'   => file_exists(VARIANT_MAP_FILE),
        'stage3Map'    => file_exists(STAGE3_MAP_FILE),
        'assignments'  => file_exists(ASSIGNMENTS_FILE),
        'stage2Catalog'=> file_exists(STAGE2_VARIANTS_FILE),
    ];
    if (isset($_GET['testToken'])) {
        $out['onChain'] = readOnChainState(intval($_GET['testToken']));
    }
    echo json_encode($out);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['assignments'])) {
    header('Content-Type: application/json');
    echo file_exists(ASSIGNMENTS_FILE)
        ? file_get_contents(ASSIGNMENTS_FILE)
        : '{}';
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['stage3assignments'])) {
    header('Content-Type: application/json');
    echo file_exists(STAGE3_ASSIGNMENTS_FILE)
        ? file_get_contents(STAGE3_ASSIGNMENTS_FILE)
        : '{}';
    exit;
}

// CORS-safe metadata read for the burn dApp (Netlify → pixeltripnft.website)
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['metadata'])) {
    $metaId = intval($_GET['metadata']);
    if ($metaId < 1) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid token id']);
        exit;
    }
    $metaFile = METADATA_DIR . $metaId;
    if (!file_exists($metaFile)) {
        http_response_code(404);
        echo json_encode(['error' => 'Metadata not found']);
        exit;
    }
    echo file_get_contents($metaFile);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'POST only']);
    exit;
}

// ── Parse input ───────────────────────────────────────────────────────────────

$body     = json_decode(file_get_contents('php://input'), true) ?: [];
$tokenId  = intval($body['tokenId'] ?? 0);
$syncMode = !empty($body['sync']);
$burnTokenId = intval($body['burnTokenId'] ?? 0);
$repair      = !empty($body['repair']);
$txHash   = preg_replace('/[^0-9a-fA-Fx]/', '', $body['txHash'] ?? '');
$charName = preg_replace('/[^A-Za-z_]/', '', $body['charName'] ?? '');
$newStage = intval($body['newStage'] ?? 0);

if (!$tokenId) {
    http_response_code(400);
    echo json_encode(['error' => 'tokenId required']);
    exit;
}

// ── Sync mode: read stage from contract, no txHash needed ───────────────────

if ($syncMode) {
    $onChain = readOnChainState($tokenId);
    $newStage = $onChain['stage'];
    $charName = $onChain['charName'];
    if ($newStage < 2) {
        http_response_code(400);
        echo json_encode([
            'error'   => "Token #$tokenId is not evolved on-chain (stage=$newStage)",
            'onChain' => $onChain,
        ]);
        exit;
    }
    if (!$charName) {
        http_response_code(400);
        echo json_encode(['error' => "Unknown charId {$onChain['charId']} — upload char-map.json to /Test/"]);
        exit;
    }
    goto build_metadata;
}

// ── Legacy mode: verify evolve tx ───────────────────────────────────────────

if (!$txHash || !$charName || !in_array($newStage, [2, 3])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing required fields (or use sync:true)']);
    exit;
}

$receipt = rpcCall('eth_getTransactionReceipt', [$txHash]);

if (!$receipt) {
    http_response_code(404);
    echo json_encode(['error' => 'Transaction not found — not confirmed yet?']);
    exit;
}

// Verify: transaction was successful and was sent to EvolvePixelTrip
if ($receipt['status'] !== '0x1') {
    http_response_code(400);
    echo json_encode(['error' => 'Transaction failed on-chain']);
    exit;
}

if (strtolower($receipt['to'] ?? '') !== EVOLVE_CONTRACT) {
    http_response_code(403);
    echo json_encode(['error' => 'Transaction was not sent to EvolvePixelTrip contract']);
    exit;
}

build_metadata:
// ── Build metadata ────────────────────────────────────────────────────────────

$STAGE2_VARIANTS = loadStage2VariantsCatalog();
if (empty($STAGE2_VARIANTS)) {
    http_response_code(500);
    echo json_encode(['error' => 'stage2-variants.json not found on server — upload to public_html/']);
    exit;
}

$responseAssignment = null;

if ($newStage === 2) {
    $variants = $STAGE2_VARIANTS[$charName] ?? [];
    if (empty($variants)) {
        http_response_code(400);
        echo json_encode(['error' => "No variants for character: $charName"]);
        exit;
    }

    $assignments = loadAndPersistAssignments($STAGE2_VARIANTS);
    if ($burnTokenId && isset($assignments[(string)$burnTokenId])) {
        unset($assignments[(string)$burnTokenId]);
    }
    if ($repair) {
        unset($assignments[(string)$tokenId]);
    }
    $variant = resolveStage2Variant($tokenId, $charName, $STAGE2_VARIANTS, $assignments, true);
    if (!$variant) {
        http_response_code(400);
        echo json_encode(['error' => "Could not resolve Stage 2 variant for token #$tokenId"]);
        exit;
    }
    $displayName = str_replace('_', ' ', $variant['slug']);
    $metadata    = [
        'name'          => "PIXEL TRIP — $displayName #$tokenId",
        'description'   => 'PIXEL TRIP — 4444 animated pixel portraits on a three-layer journey.',
        'image'         => assetGifUrl(IMAGE_STAGE2, $variant['slug'], 2, $tokenId),
        'animation_url' => assetGifUrl(IMAGE_STAGE2, $variant['slug'], 2, $tokenId),
        'external_url'  => 'https://pixeltripnft.website',
        'attributes'    => [
            ['trait_type' => 'Background', 'value' => $variant['bg']],
            ['trait_type' => 'Character',  'value' => $variant['slug']],
            ['trait_type' => 'Frame',      'value' => $variant['frame']],
            ['trait_type' => 'Stage',      'value' => '2'],
        ],
    ];
    $responseAssignment = $assignments[(string)$tokenId] ?? $variant;
} else {
    $assignments = loadAndPersistAssignments($STAGE2_VARIANTS);
    if ($burnTokenId && isset($assignments[(string)$burnTokenId])) {
        unset($assignments[(string)$burnTokenId]);
    }
    if ($repair) {
        unset($assignments[(string)$tokenId]);
        $s3a = loadStage3Assignments();
        unset($s3a[(string)$tokenId]);
        saveStage3Assignments($s3a);
    }
    $variant = resolveStage3Variant($tokenId, $charName, $STAGE2_VARIANTS, $assignments, true);
    if (!$variant) {
        http_response_code(400);
        echo json_encode(['error' => "No Stage 3 variant for token #$tokenId ($charName)"]);
        exit;
    }
    $slug = $variant['slug'];
    if (!str_starts_with($slug, 'Full_')) {
        $slug = 'Full_' . $slug;
    }
    $displayName = str_replace('_', ' ', $slug);
    $metadata    = [
        'name'          => "PIXEL TRIP — $displayName #$tokenId",
        'description'   => 'PIXEL TRIP — A fully ascended traveler. Reached Stage 3 through the burn-to-evolve journey.',
        'image'         => assetGifUrl(IMAGE_STAGE3, $slug, 3, $tokenId),
        'animation_url' => assetGifUrl(IMAGE_STAGE3, $slug, 3, $tokenId),
        'external_url'  => 'https://pixeltripnft.website',
        'attributes'    => [
            ['trait_type' => 'Background', 'value' => $variant['bg']],
            ['trait_type' => 'Character',  'value' => $slug],
            ['trait_type' => 'Frame',      'value' => $variant['frame']],
            ['trait_type' => 'Stage',      'value' => '3'],
        ],
    ];
    $s3Saved = loadStage3Assignments();
    $responseAssignment = $s3Saved[(string)$tokenId] ?? [
        'slug'  => $slug,
        'bg'    => $variant['bg'],
        'frame' => $variant['frame'],
    ];
}

// ── Write metadata file ───────────────────────────────────────────────────────

if (!is_dir(METADATA_DIR)) {
    http_response_code(500);
    echo json_encode(['error' => 'Metadata directory not found: ' . METADATA_DIR]);
    exit;
}

if (!is_writable(METADATA_DIR)) {
    http_response_code(500);
    echo json_encode(['error' => 'Metadata directory is not writable. Fix permissions on /Test/metadata/']);
    exit;
}

$filePath = METADATA_DIR . $tokenId;
$json     = json_encode($metadata, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);

if (file_put_contents($filePath, $json) === false) {
    http_response_code(500);
    echo json_encode(['error' => "Failed to write metadata file for token $tokenId"]);
    exit;
}

echo json_encode([
    'ok'         => true,
    'tokenId'    => $tokenId,
    'stage'      => $newStage,
    'file'       => "metadata/$tokenId",
    'variant'    => $metadata['attributes'][1]['value'] ?? $charName,
    'image'      => $metadata['image'],
    'assignment' => $responseAssignment,
]);
