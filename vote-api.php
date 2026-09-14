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
define('VOTES_S3_FILE', __DIR__ . '/votes-stage3.json');
define('STAGE2_VARIANTS_FILE', __DIR__ . '/stage2-variants.json');
define('STAGE3_VARIANTS_FILE', __DIR__ . '/stage3-variants.json');
define('CHAR_MAP_FILE', __DIR__ . '/char-map.json');
define('SUPPLY_FILE', __DIR__ . '/character-supply.json');
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

function loadVotesS3(): array {
    if (!file_exists(VOTES_S3_FILE)) {
        return [];
    }
    $data = json_decode(file_get_contents(VOTES_S3_FILE), true);
    return is_array($data) ? $data : [];
}

function saveVotes(array $votes): void {
    file_put_contents(
        VOTES_FILE,
        json_encode($votes, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT)
    );
}

function saveVotesS3(array $votes): void {
    file_put_contents(
        VOTES_S3_FILE,
        json_encode($votes, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT)
    );
}

function loadSupply(): array {
    if (!file_exists(SUPPLY_FILE)) {
        return [];
    }
    $data = json_decode(file_get_contents(SUPPLY_FILE), true);
    return is_array($data) ? $data : [];
}

function loadStage2Variants(): array {
    if (!file_exists(STAGE2_VARIANTS_FILE)) {
        return [];
    }
    $data = json_decode(file_get_contents(STAGE2_VARIANTS_FILE), true);
    return is_array($data) ? $data : [];
}

function loadStage3VariantsRoot(): array {
    if (!file_exists(STAGE3_VARIANTS_FILE)) {
        return [];
    }
    $data = json_decode(file_get_contents(STAGE3_VARIANTS_FILE), true);
    return is_array($data) ? $data : [];
}

function loadStage3FromS2Map(): array {
    $data = loadStage3VariantsRoot();
    return is_array($data['fromStage2Slug'] ?? null) ? $data['fromStage2Slug'] : [];
}

function loadStage3VoteClosedCharacters(): array {
    $list = loadStage3VariantsRoot()['stage3VoteClosedCharacters'] ?? [];
    return is_array($list) ? $list : [];
}

function isStage3ProgramClosedForCharacter(string $baseCharacter): bool {
    return in_array($baseCharacter, loadStage3VoteClosedCharacters(), true);
}

function stage3ArtCountForBase(string $baseCharacter): int {
    $variants = loadStage2Variants()[$baseCharacter] ?? [];
    $fromS2 = loadStage3FromS2Map();
    $n = 0;
    foreach ($variants as $v) {
        $slug = $v['slug'] ?? '';
        if ($slug !== '' && isset($fromS2[$slug])) {
            $n++;
        }
    }
    return $n;
}

function isStage3ArtCompleteForCharacter(string $baseCharacter): bool {
    if (isStage3ProgramClosedForCharacter($baseCharacter)) {
        return true;
    }
    $artCap = maxStage3ArtSlots($baseCharacter);
    if ($artCap <= 0) {
        return true;
    }
    return stage3ArtCountForBase($baseCharacter) >= $artCap;
}

function maxStage3ArtSlots(string $baseCharacter): int {
    $n = (int) ((loadSupply()[$baseCharacter] ?? 0));
    $cap = intdiv($n, 4);
    if ($cap <= 0) {
        return 0;
    }
    if ($cap === 1) {
        return 1;
    }
    return ($cap % 2 === 0) ? $cap : ($cap - 1);
}

function maxStage3Slots(string $baseCharacter): int {
    $supply = loadSupply();
    $n = (int) ($supply[$baseCharacter] ?? 0);
    return intdiv($n, 4);
}

function normalizeS2Slug(string $slug): ?string {
    if (!preg_match('/^[A-Za-z_]+$/', $slug)) {
        return null;
    }
    return $slug;
}

function sumStage3PointsForCharacter(array $leaderboard, string $baseCharacter): int {
    $total = 0;
    foreach ($leaderboard as $row) {
        if (($row['baseCharacter'] ?? '') === $baseCharacter) {
            $total += (int) ($row['points'] ?? 0);
        }
    }
    return $total;
}

function isStage3CharacterClosed(string $baseCharacter, array $leaderboard): bool {
    $cap = maxStage3Slots($baseCharacter);
    if ($cap <= 0) {
        return true;
    }
    return sumStage3PointsForCharacter($leaderboard, $baseCharacter) >= $cap;
}

function migrateVotesS3Wallet(mixed $walletVotes): array
{
    if (!is_array($walletVotes)) {
        return [];
    }
    if (isset($walletVotes['baseCharacter']) && is_string($walletVotes['baseCharacter'])) {
        return [$walletVotes['baseCharacter'] => $walletVotes];
    }
    $out = [];
    foreach ($walletVotes as $key => $row) {
        if (!is_array($row) || !isset($row['s2Slug'])) {
            continue;
        }
        $out[(string) $key] = $row;
    }
    return $out;
}

function isStage3VoteRowActive(array $row): bool
{
    $s2 = $row['s2Slug'] ?? '';
    if ($s2 === '') {
        return false;
    }
    return !isset(loadStage3FromS2Map()[$s2]);
}

function getStage3VoteForCharacter(array $votes, string $address, string $baseCharacter): ?array
{
    $wallet = migrateVotesS3Wallet($votes[$address] ?? null);
    return $wallet[$baseCharacter] ?? null;
}

function canVoteStage3Character(array $votes, string $address, string $baseCharacter): bool
{
    $row = getStage3VoteForCharacter($votes, $address, $baseCharacter);
    if (!$row) {
        return true;
    }
    return !isStage3VoteRowActive($row);
}

function activeStage3VotesByCharacter(mixed $walletVotes): array
{
    $wallet = migrateVotesS3Wallet($walletVotes);
    $active = [];
    foreach ($wallet as $base => $row) {
        if (isStage3VoteRowActive($row)) {
            $active[$base] = $row;
        }
    }
    return $active;
}

function buildLeaderboardS3(array $votes): array {
    $burnable = array_flip(loadBurnableChars());
    $fromS2 = loadStage3FromS2Map();
    $totals = [];
    $voters = 0;
    foreach ($votes as $address => $walletVotes) {
        if (!is_string($address) || !str_starts_with($address, '0x')) {
            continue;
        }
        foreach (migrateVotesS3Wallet($walletVotes) as $base => $row) {
            if (!isStage3VoteRowActive($row)) {
                continue;
            }
            $s2 = $row['s2Slug'] ?? '';
            $weight = (int) ($row['weight'] ?? 0);
            if (!$base || !$s2 || $weight <= 0 || !isset($burnable[$base])) {
                continue;
            }
            if (isset($fromS2[$s2])) {
                continue;
            }
            if (isStage3ArtCompleteForCharacter($base)) {
                continue;
            }
            $voters++;
            $key = $base . "\0" . $s2;
            $totals[$key] = ($totals[$key] ?? 0) + 1;
        }
    }
    arsort($totals);
    $leaderboard = [];
    foreach ($totals as $key => $points) {
        [$baseCharacter, $s2Slug] = explode("\0", $key, 2);
        $leaderboard[] = [
            'baseCharacter' => $baseCharacter,
            's2Slug'        => $s2Slug,
            'points'        => $points,
        ];
    }
    return ['leaderboard' => $leaderboard, 'voterCount' => $voters];
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

function isCharacterReleased(string $char): bool {
    $burnable = array_flip(loadBurnableChars());
    return isset($burnable[$char]);
}

function voteStatus(?array $row): array {
    if (!$row || !isVoteActive($row)) {
        return ['active' => false, 'canVote' => true, 'nextVoteAt' => null];
    }
    if (isCharacterReleased($row['character'] ?? '')) {
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
    $eligible = array_flip(eligibleCharacters());
    $totals = [];
    $voters = 0;
    foreach ($votes as $row) {
        if (!isVoteActive($row)) {
            continue;
        }
        $char = $row['character'] ?? '';
        $weight = (int) ($row['weight'] ?? 0);
        if (!$char || $weight <= 0 || isCharacterReleased($char)) {
            continue;
        }
        if (!isset($eligible[$char])) {
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

$poll = $_GET['poll'] ?? '';

if ($_SERVER['REQUEST_METHOD'] === 'GET' && $poll === 'stage3' && ($_GET['action'] ?? '') === 'leaderboard') {
    $votes = loadVotesS3();
    echo json_encode(['ok' => true, 'poll' => 'stage3', ...buildLeaderboardS3($votes)]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET' && $poll === 'stage3' && ($_GET['action'] ?? '') === 'mine') {
    $address = normalizeAddress($_GET['address'] ?? '');
    if (!$address) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid address']);
        exit;
    }
    $votes = loadVotesS3();
    $active = activeStage3VotesByCharacter($votes[$address] ?? null);
    $baseFilter = normalizeCharacter($_GET['baseCharacter'] ?? '');
    $mine = ($baseFilter && isset($active[$baseFilter])) ? $active[$baseFilter] : null;
    echo json_encode([
        'ok'                => true,
        'poll'              => 'stage3',
        'votesByCharacter'  => $active,
        'vote'              => $mine,
        'canVote'           => true,
    ]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET' && ($_GET['action'] ?? '') === 'health') {
    echo json_encode([
        'ok'          => true,
        'votesFile'   => file_exists(VOTES_FILE),
        'votesS3File' => file_exists(VOTES_S3_FILE),
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
    $mine = $votes[$address] ?? null;
    if ($mine && !isVoteActive($mine)) {
        $mine = null;
    }
    if ($mine && isCharacterReleased($mine['character'] ?? '')) {
        $mine = null;
    }
    $status = voteStatus($votes[$address] ?? null);
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
$postPoll = $body['poll'] ?? 'stage2';

if ($postPoll === 'stage3') {
    $baseCharacter = normalizeCharacter($body['baseCharacter'] ?? '');
    $s2Slug = normalizeS2Slug($body['s2Slug'] ?? '');
    if (!$address || !$baseCharacter || !$s2Slug) {
        http_response_code(400);
        echo json_encode(['error' => 'address, baseCharacter and s2Slug required']);
        exit;
    }
    $burnable = array_flip(loadBurnableChars());
    if (!isset($burnable[$baseCharacter])) {
        http_response_code(400);
        echo json_encode(['error' => 'Character not in Stage 2 burn program']);
        exit;
    }
    if (isStage3ArtCompleteForCharacter($baseCharacter)) {
        http_response_code(400);
        echo json_encode(['error' => 'Stage 3 art is complete for this character']);
        exit;
    }
    $variants = loadStage2Variants()[$baseCharacter] ?? [];
    $slugOk = false;
    foreach ($variants as $v) {
        if (($v['slug'] ?? '') === $s2Slug) {
            $slugOk = true;
            break;
        }
    }
    if (!$slugOk) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid Stage 2 variant for character']);
        exit;
    }
    if (isset(loadStage3FromS2Map()[$s2Slug])) {
        http_response_code(400);
        echo json_encode(['error' => 'This Stage 2 variant already has Stage 3 art']);
        exit;
    }
    $balance = readBalance($address);
    if ($balance <= 0) {
        http_response_code(403);
        echo json_encode(['error' => 'Wallet must hold at least 1 PIXEL TRIP NFT to vote', 'balance' => $balance]);
        exit;
    }
    $weight = 1;
    $votes = loadVotesS3();
    if (!canVoteStage3Character($votes, $address, $baseCharacter)) {
        http_response_code(429);
        echo json_encode([
            'error' => 'You already have an active vote for this character. Vote again after that Stage 3 art ships.',
            'vote'  => getStage3VoteForCharacter($votes, $address, $baseCharacter),
        ]);
        exit;
    }
    $wallet = migrateVotesS3Wallet($votes[$address] ?? null);
    $wallet[$baseCharacter] = [
        's2Slug'  => $s2Slug,
        'weight'  => $weight,
        'balance' => $balance,
        'updated' => gmdate('c'),
    ];
    $votes[$address] = $wallet;
    saveVotesS3($votes);
    $active = activeStage3VotesByCharacter($wallet);
    echo json_encode([
        'ok'                => true,
        'poll'              => 'stage3',
        'address'           => $address,
        'baseCharacter'     => $baseCharacter,
        's2Slug'            => $s2Slug,
        'weight'            => $weight,
        'balance'           => $balance,
        'vote'              => $active[$baseCharacter] ?? null,
        'votesByCharacter'  => $active,
        'canVote'           => true,
        'leaderboard'       => buildLeaderboardS3($votes)['leaderboard'],
    ]);
    exit;
}

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
