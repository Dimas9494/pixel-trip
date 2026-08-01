<?php
/**
 * PIXEL TRIP — Holder voting API (Stage 2/3 art priority)
 * Upload to: pixeltripnft.website/vote-api.php
 *
 * GET  ?action=leaderboard
 * GET  ?action=mine&address=0x...
 * POST { "address": "0x...", "character": "Happy_Slime" }
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

define('STAGE1_ADDRESS', '0xadf9c3c2d2946b3c80913b9e022dc2ce9e93afd9');
define('RPC_URL', 'https://ethereum-rpc.publicnode.com');
define('VOTES_FILE', __DIR__ . '/votes.json');
define('STAGE2_VARIANTS_FILE', __DIR__ . '/stage2-variants.json');
define('CHAR_MAP_FILE', __DIR__ . '/char-map.json');
define('ONE_OF_ONE_FILE', __DIR__ . '/one-of-one.json');
define('VOTE_COOLDOWN_SEC', 7 * 24 * 3600);

function rpcCall(string $method, array $params) {
    for ($attempt = 0; $attempt < 3; $attempt++) {
        $ch = curl_init(RPC_URL);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode(['jsonrpc' => '2.0', 'method' => $method, 'params' => $params, 'id' => 1]),
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            CURLOPT_TIMEOUT        => 15,
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

function encodeBalanceOf(string $address): string {
    $addr = strtolower(ltrim($address, '0x'));
    return '0x70a08231' . str_pad($addr, 64, '0', STR_PAD_LEFT);
}

function decodeUint256($hex): int {
    if (!$hex || $hex === '0x') {
        return 0;
    }
    return (int) hexdec(substr(str_pad(substr($hex, 2), 64, '0', STR_PAD_LEFT), -16));
}

function voteWeight(int $balance): int {
    if ($balance <= 0) {
        return 0;
    }
    if ($balance <= 10) {
        return 1;
    }
    if ($balance <= 15) {
        return 2;
    }
    return 3;
}

function loadVotes(): array {
    if (!file_exists(VOTES_FILE)) {
        return [];
    }
    $data = json_decode(file_get_contents(VOTES_FILE), true);
    return is_array($data) ? $data : [];
}

function saveVotes(array $votes): void {
    file_put_contents(
        VOTES_FILE,
        json_encode($votes, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT)
    );
}

function loadBurnableChars(): array {
    if (!file_exists(STAGE2_VARIANTS_FILE)) {
        return [];
    }
    $data = json_decode(file_get_contents(STAGE2_VARIANTS_FILE), true) ?: [];
    return array_keys($data);
}

function loadAllChars(): array {
    if (!file_exists(CHAR_MAP_FILE)) {
        return [];
    }
    $data = json_decode(file_get_contents(CHAR_MAP_FILE), true) ?: [];
    return array_keys($data);
}

function normalizeAddress(string $address): ?string {
    if (!preg_match('/^0x[a-fA-F0-9]{40}$/', $address)) {
        return null;
    }
    return strtolower($address);
}

function normalizeCharacter(string $character): ?string {
    if (!preg_match('/^[A-Za-z_]+$/', $character)) {
        return null;
    }
    return $character;
}

function readBalance(string $address): int {
    $hex = rpcCall('eth_call', [
        ['to' => STAGE1_ADDRESS, 'data' => encodeBalanceOf($address)],
        'latest',
    ]);
    return decodeUint256($hex);
}

function loadOneOfOne(): array {
    if (file_exists(ONE_OF_ONE_FILE)) {
        $data = json_decode(file_get_contents(ONE_OF_ONE_FILE), true);
        if (is_array($data)) {
            return $data;
        }
    }
    return [
        'Bryan', 'You_Know', 'Brey_Skull', 'Costa', 'Wale_Moca', 'Tic_Punk',
        'Medici', 'Gary', 'Adam_Beam', 'Norm', 'Vitalik', 'Tinoch_Punk', 'TMA_Bag',
    ];
}

function voteReleaseAliases(): array {
    return ['Derpy_Slime' => 'Derpy_Slug'];
}

function isVoteReleasedCharacter(string $character): bool {
    if ($character === '') {
        return false;
    }
    $burnable = array_flip(loadBurnableChars());
    if (isset($burnable[$character])) {
        return true;
    }
    $aliases = voteReleaseAliases();
    if (isset($aliases[$character])) {
        return isset($burnable[$aliases[$character]]);
    }
    return false;
}

function voteTimestamp(array $row): int {
    $updated = $row['updated'] ?? '';
    if (!$updated) {
        return 0;
    }
    $ts = strtotime($updated);
    return $ts ?: 0;
}

function isVoteActive(array $row): bool {
    $ts = voteTimestamp($row);
    return $ts > 0 && (time() - $ts) < VOTE_COOLDOWN_SEC;
}

function voteStatus(?array $row): array {
    if (!$row || !isVoteActive($row)) {
        return ['active' => false, 'canVote' => true, 'nextVoteAt' => null];
    }
    if (isVoteReleasedCharacter($row['character'] ?? '')) {
        return ['active' => false, 'canVote' => true, 'nextVoteAt' => null, 'released' => true];
    }
    $ts = voteTimestamp($row);
    return [
        'active'     => true,
        'canVote'    => false,
        'nextVoteAt' => gmdate('c', $ts + VOTE_COOLDOWN_SEC),
    ];
}

function buildLeaderboard(array $votes): array {
    $totals = [];
    $voters = 0;
    foreach ($votes as $row) {
        if (!isVoteActive($row)) {
            continue;
        }
        $char = $row['character'] ?? '';
        if (isVoteReleasedCharacter($char)) {
            continue;
        }
        $weight = (int) ($row['weight'] ?? 0);
        if (!$char || $weight <= 0) {
            continue;
        }
        $voters++;
        $totals[$char] = ($totals[$char] ?? 0) + $weight;
    }
    arsort($totals);
    $leaderboard = [];
    foreach ($totals as $character => $points) {
        $leaderboard[] = ['character' => $character, 'points' => $points];
    }
    return ['leaderboard' => $leaderboard, 'voterCount' => $voters];
}

function loadDirectToS3Chars(): array {
    return [
        'Brain_Zombie', 'Crimson_Samurai', 'Cyber_Bear',
        'Flame_Skull', 'Gold_Warrior', 'Winged_Demon',
    ];
}

function eligibleCharacters(): array {
    $all = loadAllChars();
    $burnable = array_flip(loadBurnableChars());
    $oneOfOne = array_flip(loadOneOfOne());
    $directS3 = array_flip(loadDirectToS3Chars());
    $out = [];
    foreach ($all as $name) {
        if (isset($burnable[$name]) || isset($oneOfOne[$name]) || isset($directS3[$name])) {
            continue;
        }
        $out[] = $name;
    }
    sort($out);
    return $out;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET' && ($_GET['action'] ?? '') === 'health') {
    echo json_encode([
        'ok'          => true,
        'votesFile'   => file_exists(VOTES_FILE),
        'writable'    => is_writable(dirname(VOTES_FILE)),
        'storage'     => (file_exists(VOTES_FILE) || is_writable(dirname(VOTES_FILE))) ? 'file' : 'none',
        'eligible'    => count(eligibleCharacters()),
        'weightTiers' => ['1-10' => 1, '11-15' => 2, '16+' => 3],
        'cooldownDays'=> 7,
        'oneOfOneExcluded' => count(loadOneOfOne()),
    ]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET' && ($_GET['action'] ?? '') === 'eligible') {
    echo json_encode(['characters' => eligibleCharacters()]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET' && ($_GET['action'] ?? '') === 'leaderboard') {
    $votes = loadVotes();
    echo json_encode(['ok' => true, ...buildLeaderboard($votes)]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET' && ($_GET['action'] ?? '') === 'mine') {
    $address = normalizeAddress($_GET['address'] ?? '');
    if (!$address) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid address']);
        exit;
    }
    $votes = loadVotes();
    $row = $votes[$address] ?? null;
    $mine = $row;
    if ($mine && !isVoteActive($mine)) {
        $mine = null;
    }
    if ($mine && isVoteReleasedCharacter($mine['character'] ?? '')) {
        $mine = null;
    }
    $status = voteStatus($row);
    echo json_encode(['ok' => true, 'vote' => $mine, ...$status]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'GET or POST only']);
    exit;
}

$body = json_decode(file_get_contents('php://input'), true) ?: [];
$address = normalizeAddress($body['address'] ?? '');
$character = normalizeCharacter($body['character'] ?? '');

if (!$address || !$character) {
    http_response_code(400);
    echo json_encode(['error' => 'address and character required']);
    exit;
}

$eligible = eligibleCharacters();
if (!in_array($character, $eligible, true)) {
    http_response_code(400);
    echo json_encode(['error' => 'Character is not eligible (Stage 2 live, Direct S3, 1/1, or unknown)']);
    exit;
}

$balance = readBalance($address);
$weight = voteWeight($balance);
if ($weight <= 0) {
    http_response_code(403);
    echo json_encode(['error' => 'Wallet must hold at least 1 PIXEL TRIP NFT to vote', 'balance' => $balance]);
    exit;
}

$votes = loadVotes();
$existing = $votes[$address] ?? null;
$status = voteStatus($existing);
if (!$status['canVote']) {
    http_response_code(429);
    echo json_encode([
        'error'      => 'You already voted this week. Votes cannot be changed or cancelled.',
        'nextVoteAt' => $status['nextVoteAt'],
        'vote'       => $existing,
    ]);
    exit;
}

$votes[$address] = [
    'character' => $character,
    'weight'    => $weight,
    'balance'   => $balance,
    'updated'   => gmdate('c'),
];

if (!is_writable(dirname(VOTES_FILE)) && !file_exists(VOTES_FILE)) {
    http_response_code(500);
    echo json_encode(['error' => 'votes.json not writable on server']);
    exit;
}

saveVotes($votes);

echo json_encode([
    'ok'          => true,
    'address'     => $address,
    'character'   => $character,
    'weight'      => $weight,
    'balance'     => $balance,
    'vote'        => $votes[$address],
    'canVote'     => false,
    'nextVoteAt'  => gmdate('c', voteTimestamp($votes[$address]) + VOTE_COOLDOWN_SEC),
    'leaderboard' => buildLeaderboard($votes)['leaderboard'],
]);
