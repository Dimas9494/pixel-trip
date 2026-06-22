<?php
/**
 * PIXEL TRIP — Auto Metadata Updater
 * Upload to: pixeltripnft.website/Test/update-metadata.php
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

define('EVOLVE_CONTRACT', strtolower('0x8D0b7Eb6A057ed921a1d6E245b899Beca1B1Bf77'));
define('RPC_URL',         'https://ethereum-rpc.publicnode.com');
define('METADATA_DIR',    __DIR__ . '/metadata/');
define('IMAGE_STAGE2',    'https://pixeltripnft.website/Test/stage2/images');
define('IMAGE_STAGE3',    'https://pixeltripnft.website/Test/stage3/images');
define('VARIANT_MAP_FILE', __DIR__ . '/variant-map.json');
define('CHAR_MAP_FILE',    __DIR__ . '/char-map.json');

// Contract call selectors (keccak256 first 4 bytes)
define('SEL_EVOLVED_STAGE',    '74b7661f');
define('SEL_STAGE1_CHARACTER', '3d73cef2');

// Health check: GET /update-metadata.php?health=1
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['health'])) {
    $dirOk = is_dir(METADATA_DIR) && is_writable(METADATA_DIR);
    echo json_encode([
        'ok'           => $dirOk,
        'metadataDir'  => METADATA_DIR,
        'writable'     => $dirOk,
        'contract'     => EVOLVE_CONTRACT,
        'charMap'      => file_exists(CHAR_MAP_FILE),
        'variantMap'   => file_exists(VARIANT_MAP_FILE),
    ]);
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
$txHash   = preg_replace('/[^0-9a-fA-Fx]/', '', $body['txHash'] ?? '');
$charName = preg_replace('/[^A-Za-z_]/', '', $body['charName'] ?? '');
$newStage = intval($body['newStage'] ?? 0);

if (!$tokenId) {
    http_response_code(400);
    echo json_encode(['error' => 'tokenId required']);
    exit;
}

// ── RPC helpers ─────────────────────────────────────────────────────────────

function rpcCall(string $method, array $params): ?array {
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
            if (array_key_exists('result', $json)) return $json['result'];
        }
        usleep(500000);
    }
    return null;
}

function encodeUint256Call(string $selector, int $tokenId): string {
    return '0x' . $selector . str_pad(dechex($tokenId), 64, '0', STR_PAD_LEFT);
}

function ethCall(string $contract, string $data): ?string {
    return rpcCall('eth_call', [['to' => $contract, 'data' => $data], 'latest']);
}

function decodeUint8(?string $hex): int {
    if (!$hex || $hex === '0x') return 0;
    $hex = ltrim(substr($hex, 2), '0') ?: '0';
    return (int) hexdec($hex);
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
    $contract = EVOLVE_CONTRACT;
    $stageHex = ethCall($contract, encodeUint256Call(SEL_EVOLVED_STAGE, $tokenId));
    $charHex  = ethCall($contract, encodeUint256Call(SEL_STAGE1_CHARACTER, $tokenId));
    $stage    = decodeUint8($stageHex);
    $charId   = decodeUint8($charHex);
    $charMap  = loadCharIdToName();
    $charName = $charMap[$charId] ?? '';
    return ['stage' => $stage, 'charId' => $charId, 'charName' => $charName];
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

$STAGE2_VARIANTS = [
    'Ape_Beard' => [
        ['slug'=>'Frog_Hat_Ape',   'bg'=>'Kaleidoscope',  'frame'=>'Rain_Window'],
        ['slug'=>'Green_Neon_Ape', 'bg'=>'Infinity_Loop',  'frame'=>'Pi_Digits'],
        ['slug'=>'Hippie_Ape',     'bg'=>'Facets',         'frame'=>'Phantom_Trace'],
        ['slug'=>'Kiss_Ape',       'bg'=>'Eddy_Field',     'frame'=>'Blizzard_Wall'],
        ['slug'=>'Red_Cap_Ape',    'bg'=>'Kaleidoscope',   'frame'=>'Hourglass_Turn'],
        ['slug'=>'Zombie_Ape',     'bg'=>'Data_Stream',    'frame'=>'Pink_Glass'],
        ['slug'=>'Neon_Beard',     'bg'=>'Kaleidoscope',   'frame'=>'Rain_Window'],
        ['slug'=>'Winter_Beard',   'bg'=>'Plasma_Flow',    'frame'=>'Morse_Sos'],
        ['slug'=>'Cyborg_Beard',   'bg'=>'Viscous',        'frame'=>'Hex_Grid_Edge'],
        ['slug'=>'Crown_Beard',    'bg'=>'Hologram',       'frame'=>'Vine_Creep'],
        ['slug'=>'Frost_Beard',    'bg'=>'Water_Gleam',    'frame'=>'Isometric_Grid'],
        ['slug'=>'Golden_Beard',   'bg'=>'Event_Horizon',  'frame'=>'Color_Wheel_Border'],
    ],
    'Beanie_Cyclops' => [
        ['slug'=>'Astro_Cyclops',      'bg'=>'Facets',         'frame'=>'Deep_Space'],
        ['slug'=>'Crown_Cyclops',      'bg'=>'Grid_Tunnel',    'frame'=>'Checker_Scroll'],
        ['slug'=>'Golden_Cyclops',     'bg'=>'Wave_Moire',     'frame'=>'Isometric_Grid'],
        ['slug'=>'Mohawk_Cyclops',     'bg'=>'Hologram',       'frame'=>'Dust_Orbit'],
        ['slug'=>'Respirator_Cyclops', 'bg'=>'Mandala_Spiral', 'frame'=>'Fractal_Edge'],
        ['slug'=>'Tribe_Cyclops',      'bg'=>'Waves',          'frame'=>'Time_Loop_Scar'],
        ['slug'=>'Viking_Cyclops',     'bg'=>'Network',        'frame'=>'Nexus_Pulse'],
        ['slug'=>'Shadow_Cyclops',     'bg'=>'Grid_Tunnel',    'frame'=>'Checker_Scroll'],
        ['slug'=>'Neon_Cyclops',       'bg'=>'Facets',         'frame'=>'Deep_Space'],
        ['slug'=>'Winter_Cyclops',     'bg'=>'Data_Stream',    'frame'=>'Pink_Glass'],
        ['slug'=>'Cyborg_Cyclops',     'bg'=>'Kaleidoscope',   'frame'=>'Hourglass_Turn'],
        ['slug'=>'Frost_Cyclops',      'bg'=>'Facets',         'frame'=>'Phantom_Trace'],
    ],
    'Diva' => [
        ['slug'=>'Shadow_Diva', 'bg'=>'Axis_Spin',           'frame'=>'Snow_Static'],
        ['slug'=>'Cyborg_Diva', 'bg'=>'Fusion_Meta_Caustic', 'frame'=>'Pink_Glass'],
        ['slug'=>'Demon_Diva',  'bg'=>'Waves',               'frame'=>'Chromosome_Paint'],
        ['slug'=>'Glitch_Diva', 'bg'=>'Crystal',             'frame'=>'Light_Veil'],
        ['slug'=>'Golden_Diva', 'bg'=>'Glitter',             'frame'=>'Mandala_Spin'],
        ['slug'=>'Rusty_Diva',  'bg'=>'Blob_Capsule',        'frame'=>'Mandala_Reveal'],
        ['slug'=>'Zombie_Diva', 'bg'=>'Finale_Cosmos_Waves', 'frame'=>'Sandfall_Cascade'],
        ['slug'=>'Neon_Diva',   'bg'=>'Axis_Spin',           'frame'=>'Snow_Static'],
        ['slug'=>'Winter_Diva', 'bg'=>'Network',             'frame'=>'Nexus_Pulse'],
        ['slug'=>'Crown_Diva',  'bg'=>'Mandala_Spiral',      'frame'=>'Fractal_Edge'],
        ['slug'=>'Frost_Diva',  'bg'=>'Hologram',            'frame'=>'Dust_Orbit'],
    ],
    'Alpine_Hunter' => [
        ['slug'=>'Cyborg_Hunter', 'bg'=>'Event_Horizon', 'frame'=>'Color_Wheel_Border'],
        ['slug'=>'Ghost_Hunter',  'bg'=>'Water_Gleam',   'frame'=>'Isometric_Grid'],
        ['slug'=>'Golden_Hunter', 'bg'=>'Hologram',      'frame'=>'Vine_Creep'],
        ['slug'=>'Graph_Hunter',  'bg'=>'Viscous',       'frame'=>'Hex_Grid_Edge'],
        ['slug'=>'Winter_Hunter', 'bg'=>'Plasma_Flow',   'frame'=>'Morse_Sos'],
        ['slug'=>'Crown_Hunter',  'bg'=>'Hologram',      'frame'=>'Vine_Creep'],
        ['slug'=>'Frost_Hunter',  'bg'=>'Water_Gleam',   'frame'=>'Isometric_Grid'],
    ],
];

if ($newStage === 2) {
    $variants = $STAGE2_VARIANTS[$charName] ?? [];
    if (empty($variants)) {
        http_response_code(400);
        echo json_encode(['error' => "No variants for character: $charName"]);
        exit;
    }

    $variantMap = [];
    if (file_exists(VARIANT_MAP_FILE)) {
        $variantMap = json_decode(file_get_contents(VARIANT_MAP_FILE), true) ?: [];
    }
    $variant = $variantMap[(string)$tokenId] ?? $variants[$tokenId % count($variants)];
    $displayName = str_replace('_', ' ', $variant['slug']);
    $metadata    = [
        'name'          => "PIXEL TRIP — $displayName #$tokenId",
        'description'   => 'PIXEL TRIP — 4444 animated pixel portraits on a three-layer journey.',
        'image'         => IMAGE_STAGE2 . "/{$variant['slug']}.gif",
        'animation_url' => IMAGE_STAGE2 . "/{$variant['slug']}.gif",
        'external_url'  => 'https://pixeltripnft.website',
        'attributes'    => [
            ['trait_type' => 'Background', 'value' => $variant['bg']],
            ['trait_type' => 'Character',  'value' => $variant['slug']],
            ['trait_type' => 'Frame',      'value' => $variant['frame']],
            ['trait_type' => 'Stage',      'value' => '2'],
        ],
    ];
} else {
    $displayName = str_replace('_', ' ', $charName);
    $metadata    = [
        'name'          => "PIXEL TRIP — $displayName Stage 3 #$tokenId",
        'description'   => 'PIXEL TRIP — A fully ascended traveler. Reached Stage 3 through the burn-to-evolve journey.',
        'image'         => IMAGE_STAGE3 . "/$charName.gif",
        'animation_url' => IMAGE_STAGE3 . "/$charName.gif",
        'external_url'  => 'https://pixeltripnft.website',
        'attributes'    => [
            ['trait_type' => 'Character', 'value' => $charName],
            ['trait_type' => 'Stage',     'value' => '3'],
        ],
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
    'ok'       => true,
    'tokenId'  => $tokenId,
    'stage'    => $newStage,
    'file'     => "metadata/$tokenId",
    'variant'  => $metadata['attributes'][1]['value'] ?? $charName,
    'image'    => $metadata['image'],
]);
