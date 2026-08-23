<?php
/**
 * Shared evolution lineage helpers for update-metadata.php and backfill script.
 */

if (!defined('EVOLUTION_LINEAGE_FILE')) {
    define('EVOLUTION_LINEAGE_FILE', __DIR__ . '/evolution-lineage.json');
}
if (!defined('BURN_SNAPSHOTS_DIR')) {
    define('BURN_SNAPSHOTS_DIR', __DIR__ . '/burn-snapshots/');
}
if (!defined('SELF_SNAPSHOTS_DIR')) {
    define('SELF_SNAPSHOTS_DIR', __DIR__ . '/self-snapshots/');
}
if (!defined('TOKEN_PAGE_BASE')) {
    define('TOKEN_PAGE_BASE', getenv('TOKEN_PAGE_BASE') ?: 'https://pixeltrip.netlify.app/token.html');
}
if (!defined('EVOLUTION_VIEWER_BASE')) {
    define('EVOLUTION_VIEWER_BASE', getenv('EVOLUTION_VIEWER_BASE') ?: 'https://pixeltripnft.website/evolution.php');
}
if (!defined('EVOLUTION_HTML_DIR')) {
    define('EVOLUTION_HTML_DIR', __DIR__ . '/evolution');
}
if (!defined('EVOLUTION_HTML_BASE')) {
    define('EVOLUTION_HTML_BASE', getenv('EVOLUTION_HTML_BASE') ?: 'https://pixeltripnft.website/evolution');
}

function evolutionViewerUrl(int $tokenId): string {
    return EVOLUTION_VIEWER_BASE . '?id=' . $tokenId;
}

function staticEvolutionViewerUrl(int $tokenId, int $version = 1): string {
    return EVOLUTION_HTML_BASE . '/' . $tokenId . '.html?v=' . $version;
}

function stageShortLabel(int $stage): string {
    return match ($stage) {
        1 => 'Genesis',
        3 => 'Ascended',
        default => 'Awakened',
    };
}

function evolutionStageImageUrl(string $base, string $slug, int $stage, int $tokenId): string {
    return rtrim($base, '/') . '/' . $slug . '.gif?v=' . $stage . '-' . $tokenId;
}

function inferStage2SlugFromMeta(array $meta): string {
    $char = metaCharacterFromArray($meta);
    if ($char === '') {
        return '';
    }
    if (str_starts_with($char, 'Full_')) {
        return substr($char, 5);
    }

    $s3File = defined('STAGE3_MAP_FILE') ? STAGE3_MAP_FILE : (__DIR__ . '/stage3-variants.json');
    if (file_exists($s3File)) {
        $maps = json_decode(file_get_contents($s3File), true) ?: [];
        foreach ($maps['fromStage2Slug'] ?? [] as $s2Slug => $entry) {
            if (($entry['slug'] ?? '') === $char) {
                return $s2Slug;
            }
        }
    }

    return '';
}

function inferStage2Stage(int $tokenId, array $meta): ?array {
    $snapPath = SELF_SNAPSHOTS_DIR . $tokenId . '/stage-2.json';
    if (file_exists($snapPath)) {
        $snap = json_decode(file_get_contents($snapPath), true);
        $summary = $snap['summary'] ?? null;
        if (!empty($summary['image'])) {
            return [
                'stage' => 2,
                'short' => stageShortLabel(2),
                'image' => $summary['image'],
            ];
        }
    }

    $assignFile = defined('ASSIGNMENTS_FILE') ? ASSIGNMENTS_FILE : (__DIR__ . '/token-assignments.json');
    if (file_exists($assignFile)) {
        $assignments = json_decode(file_get_contents($assignFile), true) ?: [];
        $slug = $assignments[(string)$tokenId]['slug'] ?? '';
        if ($slug !== '') {
            $s2Base = defined('IMAGE_STAGE2') ? IMAGE_STAGE2 : 'https://pixeltripnft.website/stage2/images';
            return [
                'stage' => 2,
                'short' => stageShortLabel(2),
                'image' => evolutionStageImageUrl($s2Base, $slug, 2, $tokenId),
            ];
        }
    }

    $slug = inferStage2SlugFromMeta($meta);
    if ($slug !== '') {
        $s2Base = defined('IMAGE_STAGE2') ? IMAGE_STAGE2 : 'https://pixeltripnft.website/stage2/images';
        return [
            'stage' => 2,
            'short' => stageShortLabel(2),
            'image' => evolutionStageImageUrl($s2Base, $slug, 2, $tokenId),
        ];
    }

    return null;
}

function ensureStage1Present(array &$stages, int $tokenId): void {
    if (!isset($stages[1])) {
        $stages[1] = [
            'stage' => 1,
            'short' => stageShortLabel(1),
            'image' => 'https://pixeltripnft.website/images/' . $tokenId . '.gif',
        ];
    }
}

function buildEvolutionStages(int $tokenId, array $meta, array $lineageEntry): array {
    $currentStage = metaStageFromArray($meta);
    if ($currentStage < 2) {
        $currentStage = (int)($meta['evolution_history']['currentStage'] ?? 0);
    }
    $currentImage = $meta['image'] ?? '';
    $stages = [];

    foreach ($lineageEntry['self'] ?? [] as $entry) {
        $st = (int)($entry['stage'] ?? 0);
        if ($st > 0 && !empty($entry['image'])) {
            $stages[$st] = [
                'stage' => $st,
                'short' => stageShortLabel($st),
                'image' => $entry['image'],
            ];
        }
    }
    foreach ($meta['evolution_history']['self'] ?? [] as $entry) {
        $st = (int)($entry['stage'] ?? 0);
        if ($st > 0 && !empty($entry['image'])) {
            $stages[$st] = [
                'stage' => $st,
                'short' => stageShortLabel($st),
                'image' => $entry['image'],
            ];
        }
    }
    if ($currentStage >= 2 && $currentImage) {
        $stages[$currentStage] = [
            'stage' => $currentStage,
            'short' => stageShortLabel($currentStage),
            'image' => $currentImage,
        ];
    }

    ensureStage1Present($stages, $tokenId);
    if ($currentStage >= 3 && !isset($stages[2])) {
        $stage2 = inferStage2Stage($tokenId, $meta);
        if ($stage2) {
            $stages[2] = $stage2;
        }
    }

    ksort($stages);
    $stages = array_values($stages);

    if (count($stages) < 2) {
        $stages = [
            ['stage' => 1, 'short' => 'Genesis', 'image' => 'https://pixeltripnft.website/images/' . $tokenId . '.gif'],
        ];
        if ($currentImage) {
            $st = max(2, $currentStage);
            $stages[] = ['stage' => $st, 'short' => stageShortLabel($st), 'image' => $currentImage];
        }
    }

    return $stages;
}

function renderEvolutionViewerHtml(int $tokenId, array $stages, string $title = ''): string {
    if (count($stages) < 2) {
        return '';
    }
    $active = count($stages) - 1;
    $title = $title ?: ('PIXEL TRIP #' . $tokenId);
    $titleEsc = htmlspecialchars($title, ENT_QUOTES, 'UTF-8');
    $heroSrc = htmlspecialchars($stages[$active]['image'] ?? '', ENT_QUOTES, 'UTF-8');
    $stagesJson = json_encode($stages, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $pillFont = count($stages) >= 3 ? '10px' : '11px';
    $pillPad = count($stages) >= 3 ? '8px 4px' : '8px 6px';

    return <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{$titleEsc}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; background: #0a0a12; color: #e8e8f0; font-family: system-ui, sans-serif; overflow: hidden; }
    body { display: flex; flex-direction: column; }
    .stage {
      flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center;
      position: relative; padding: 8px 40px;
    }
    .hero {
      max-width: 100%; max-height: 100%; width: auto; height: auto;
      image-rendering: pixelated; display: block;
    }
    .nav {
      position: absolute; top: 50%; transform: translateY(-50%);
      width: 32px; height: 56px; border: none; border-radius: 4px;
      background: rgba(0,0,0,.55); color: #fff; font-size: 26px; line-height: 1;
      cursor: pointer; opacity: .85;
    }
    .nav:hover { opacity: 1; background: rgba(0,229,255,.25); }
    .nav:disabled { opacity: .25; cursor: default; }
    .prev { left: 6px; }
    .next { right: 6px; }
    .bar {
      flex-shrink: 0; display: flex; gap: 6px; padding: 8px 10px 10px;
      background: linear-gradient(transparent, rgba(0,0,0,.35));
    }
    .pill {
      flex: 1; min-height: 40px; padding: {$pillPad}; border: 2px solid #2e2e3e;
      border-radius: 8px; background: #12121c; color: #8a8a9a;
      font-size: {$pillFont}; font-weight: 700; letter-spacing: .03em; cursor: pointer;
      text-transform: uppercase;
    }
    .pill.on {
      border-color: #00e5ff; color: #00e5ff; background: #0a1820;
      box-shadow: 0 0 12px rgba(0,229,255,.2);
    }
    .pill small { display: block; font-size: 9px; font-weight: 500; opacity: .75; margin-top: 2px; text-transform: none; }
  </style>
</head>
<body>
  <div class="stage">
    <button type="button" class="nav prev" id="prev" aria-label="Previous">&#8249;</button>
    <img class="hero" id="hero" src="{$heroSrc}" alt="{$titleEsc}" />
    <button type="button" class="nav next" id="next" aria-label="Next">&#8250;</button>
  </div>
  <div class="bar" id="bar"></div>
  <script>
    const stages = {$stagesJson};
    let active = {$active};
    const hero = document.getElementById("hero");
    const bar = document.getElementById("bar");
    const prev = document.getElementById("prev");
    const next = document.getElementById("next");
    function draw() {
      const s = stages[active];
      if (!s) return;
      hero.src = s.image;
      bar.innerHTML = stages.map((st, i) =>
        `<button type="button" class="pill\${i === active ? " on" : ""}" data-i="\${i}">
          Stage \${st.stage}<small>\${st.short || ""}</small>
        </button>`
      ).join("");
      bar.querySelectorAll(".pill").forEach(btn =>
        btn.addEventListener("click", () => { active = +btn.dataset.i; draw(); })
      );
      prev.disabled = active <= 0;
      next.disabled = active >= stages.length - 1;
    }
    prev.addEventListener("click", () => { if (active > 0) { active--; draw(); } });
    next.addEventListener("click", () => { if (active < stages.length - 1) { active++; draw(); } });
    hero.addEventListener("click", () => { active = (active + 1) % stages.length; draw(); });
    draw();
  </script>
</body>
</html>

HTML;
}

function writeEvolutionViewerHtml(int $tokenId, array $meta, array $lineageEntry): bool {
    $stages = buildEvolutionStages($tokenId, $meta, $lineageEntry);
    if (count($stages) < 2) {
        return false;
    }
    $html = renderEvolutionViewerHtml($tokenId, $stages, $meta['name'] ?? '');
    if ($html === '') {
        return false;
    }
    ensureSnapshotDir(EVOLUTION_HTML_DIR);
    return file_put_contents(EVOLUTION_HTML_DIR . '/' . $tokenId . '.html', $html) !== false;
}

function findEvolvedTokenIds(): array {
    $ids = [];
    $add = function (int $id) use (&$ids) {
        if ($id > 0) {
            $ids[$id] = true;
        }
    };

    if (defined('METADATA_DIR') && is_dir(METADATA_DIR)) {
        foreach (scandir(METADATA_DIR) ?: [] as $file) {
            if ($file === '.' || $file === '..' || !ctype_digit($file)) {
                continue;
            }
            $tokenId = (int)$file;
            $meta = readTokenMetadataFile($tokenId);
            if ($meta && metaStageFromArray($meta) >= 2) {
                $add($tokenId);
            }
        }
    }

    foreach (array_keys(loadEvolutionLineage()) as $key) {
        $add((int)$key);
    }

    $ids = array_keys($ids);
    sort($ids, SORT_NUMERIC);
    return $ids;
}

function generateAllEvolutionViewers(bool $rewriteMetadata = true, bool $dryRun = false): array {
    $generated = [];
    $skipped = [];
    $errors = [];

    foreach (findEvolvedTokenIds() as $tokenId) {
        $meta = readTokenMetadataFile($tokenId);
        if (!$meta) {
            $skipped[] = ['tokenId' => $tokenId, 'reason' => 'metadata missing'];
            continue;
        }
        $stage = metaStageFromArray($meta);
        if ($stage < 2) {
            $stage = (int)($meta['evolution_history']['currentStage'] ?? 0);
        }
        if ($stage < 2) {
            $skipped[] = ['tokenId' => $tokenId, 'reason' => 'stage < 2'];
            continue;
        }

        $lineage = loadEvolutionLineage()[lineageKey($tokenId)] ?? [
            'self' => $meta['evolution_history']['self'] ?? [],
            'burned' => [],
        ];
        $stages = buildEvolutionStages($tokenId, $meta, $lineage);
        if (count($stages) < 2) {
            $skipped[] = ['tokenId' => $tokenId, 'reason' => 'insufficient stages'];
            continue;
        }

        if ($dryRun) {
            $generated[] = ['tokenId' => $tokenId, 'stage' => $stage, 'stages' => count($stages)];
            continue;
        }

        if (!writeEvolutionViewerHtml($tokenId, $meta, $lineage)) {
            $errors[] = ['tokenId' => $tokenId, 'reason' => 'write failed'];
            continue;
        }

        if ($rewriteMetadata) {
            enrichMetadataWithEvolution($meta, $tokenId, $stage, $lineage);
            file_put_contents(
                METADATA_DIR . $tokenId,
                json_encode($meta, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
            );
        }

        $generated[] = [
            'tokenId'       => $tokenId,
            'stage'         => $stage,
            'stages'        => count($stages),
            'animation_url' => $meta['animation_url'] ?? staticEvolutionViewerUrl($tokenId),
        ];
    }

    return [
        'generated' => $generated,
        'skipped'   => $skipped,
        'errors'    => $errors,
    ];
}

function firstSelfStageImage(array $lineageEntry, int $stage = 1): string {
    foreach ($lineageEntry['self'] ?? [] as $entry) {
        if ((int)($entry['stage'] ?? 0) === $stage && !empty($entry['image'])) {
            return $entry['image'];
        }
    }
    foreach ($lineageEntry['self'] ?? [] as $entry) {
        if (!empty($entry['image'])) {
            return $entry['image'];
        }
    }
    return '';
}

function applyOpenSeaEvolutionMedia(array &$metadata, int $tokenId, int $newStage, array $lineageEntry): void {
    $selfCount = count($lineageEntry['self'] ?? []);
    if ($selfCount === 0 && $newStage < 2) {
        return;
    }

    // OpenSea: image = current stage, animation_url = static HTML evolution viewer.
    if ($newStage >= 2) {
        $metadata['animation_url'] = staticEvolutionViewerUrl($tokenId);
    }
}

function metaStageFromArray(array $meta): int {
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

function metaCharacterFromArray(array $meta): string {
    foreach ($meta['attributes'] ?? [] as $attr) {
        if (($attr['trait_type'] ?? '') === 'Character') {
            return (string)($attr['value'] ?? '');
        }
    }
    return '';
}

function readTokenMetadataFile(int $tokenId): ?array {
    $path = METADATA_DIR . $tokenId;
    if (!file_exists($path)) {
        return null;
    }
    $meta = json_decode(file_get_contents($path), true);
    return is_array($meta) ? $meta : null;
}

function metaEntryFromFile(int $tokenId, ?array $meta = null): array {
    $meta = $meta ?? readTokenMetadataFile($tokenId) ?? [];
    $stage = metaStageFromArray($meta);
    if ($stage === 0) {
        $stage = 1;
    }
    return [
        'tokenId'    => $tokenId,
        'stage'      => $stage,
        'name'       => $meta['name'] ?? "PIXEL TRIP #$tokenId",
        'image'      => $meta['image'] ?? $meta['animation_url'] ?? ('https://pixeltripnft.website/images/' . $tokenId . '.gif'),
        'character'  => metaCharacterFromArray($meta),
        'recordedAt' => gmdate('c'),
    ];
}

function loadEvolutionLineage(): array {
    if (!file_exists(EVOLUTION_LINEAGE_FILE)) {
        return [];
    }
    $data = json_decode(file_get_contents(EVOLUTION_LINEAGE_FILE), true);
    return is_array($data) ? $data : [];
}

function saveEvolutionLineage(array $lineage): void {
    file_put_contents(
        EVOLUTION_LINEAGE_FILE,
        json_encode($lineage, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT)
    );
}

function ensureSnapshotDir(string $dir): void {
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
}

function writeJsonSnapshot(string $path, array $payload): void {
    $dir = dirname($path);
    ensureSnapshotDir($dir);
    file_put_contents($path, json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
}

function lineageKey(int $tokenId): string {
    return (string)$tokenId;
}

function appendUniqueEntry(array &$list, array $entry, string $idField = 'tokenId'): void {
    $id = (string)($entry[$idField] ?? '');
    $stage = (int)($entry['stage'] ?? 0);
    foreach ($list as $existing) {
        if ((string)($existing[$idField] ?? '') === $id && (int)($existing['stage'] ?? 0) === $stage) {
            return;
        }
    }
    $list[] = $entry;
}

function writeBurnedTokenMetadata(int $burnTokenId, array $burnEntry, int $keepTokenId, int $newStage): void {
    $stageLabel = $burnEntry['stage'] === 2 ? 'Stage 2' : 'Stage 1';
    $intoLabel  = $newStage === 3 ? 'Stage 3' : 'Stage 2';
    $metadata = [
        'name'          => ($burnEntry['name'] ?? "PIXEL TRIP #$burnTokenId") . ' (Sacrificed)',
        'description'   => "This PIXEL TRIP traveler was sacrificed in the burn-to-evolve ritual. "
            . "Token #$burnTokenId ($stageLabel) was destroyed so #$keepTokenId could ascend to $intoLabel. "
            . 'View the full evolution journey: ' . TOKEN_PAGE_BASE . '?id=' . $keepTokenId,
        'image'         => $burnEntry['image'] ?? '',
        'animation_url' => $burnEntry['image'] ?? '',
        'external_url'  => TOKEN_PAGE_BASE . '?id=' . $keepTokenId,
        'attributes'    => [
            ['trait_type' => 'Status',       'value' => 'Sacrificed'],
            ['trait_type' => 'Stage',        'value' => (string)$burnEntry['stage']],
            ['trait_type' => 'Evolved Into', 'value' => "#$keepTokenId"],
        ],
    ];
    if (!empty($burnEntry['character'])) {
        $metadata['attributes'][] = ['trait_type' => 'Character', 'value' => $burnEntry['character']];
    }
    file_put_contents(
        METADATA_DIR . $burnTokenId,
        json_encode($metadata, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
    );
}

function recordEvolutionLineage(int $keepTokenId, int $burnTokenId, int $newStage): array {
    if (!$burnTokenId) {
        return loadEvolutionLineage()[lineageKey($keepTokenId)] ?? ['self' => [], 'burned' => []];
    }

    $lineage = loadEvolutionLineage();
    $key = lineageKey($keepTokenId);
    if (!isset($lineage[$key])) {
        $lineage[$key] = ['self' => [], 'burned' => []];
    }

    $keepMeta = readTokenMetadataFile($keepTokenId);
    $burnMeta = readTokenMetadataFile($burnTokenId);

    if ($keepMeta) {
        $selfEntry = metaEntryFromFile($keepTokenId, $keepMeta);
        appendUniqueEntry($lineage[$key]['self'], $selfEntry);
        writeJsonSnapshot(
            SELF_SNAPSHOTS_DIR . $keepTokenId . '/stage-' . $selfEntry['stage'] . '.json',
            ['metadata' => $keepMeta, 'summary' => $selfEntry]
        );
    }

    if ($burnMeta) {
        $burnEntry = metaEntryFromFile($burnTokenId, $burnMeta);
        appendUniqueEntry($lineage[$key]['burned'], $burnEntry);
        writeJsonSnapshot(
            BURN_SNAPSHOTS_DIR . $burnTokenId . '.json',
            ['metadata' => $burnMeta, 'summary' => $burnEntry, 'evolvedInto' => $keepTokenId]
        );
        writeBurnedTokenMetadata($burnTokenId, $burnEntry, $keepTokenId, $newStage);
    }

    saveEvolutionLineage($lineage);
    return $lineage[$key];
}

function buildEvolutionHistoryPayload(int $tokenId, int $currentStage, array $lineageEntry): array {
    $history = [];
    foreach ($lineageEntry['self'] ?? [] as $entry) {
        $history[] = array_merge($entry, ['role' => 'self']);
    }
    foreach ($lineageEntry['burned'] ?? [] as $entry) {
        $history[] = array_merge($entry, ['role' => 'burned']);
    }
    usort($history, fn($a, $b) => ((int)$a['stage'] <=> (int)$b['stage']) ?: ((int)$a['tokenId'] <=> (int)$b['tokenId']));

    return [
        'tokenId'      => $tokenId,
        'currentStage' => $currentStage,
        'self'         => $lineageEntry['self'] ?? [],
        'burned'       => $lineageEntry['burned'] ?? [],
        'timeline'     => $history,
        'tokenPage'    => TOKEN_PAGE_BASE . '?id=' . $tokenId,
    ];
}

function rebuildLineageForPatch(int $keepTokenId, int $burnTokenId, int $newStage, string $charName): array {
    $lineage = loadEvolutionLineage();
    $key = lineageKey($keepTokenId);
    $lineage[$key] = ['self' => [], 'burned' => []];

    $selfStage = $newStage === 3 ? 2 : 1;
    $selfS1 = [
        'tokenId'    => $keepTokenId,
        'stage'      => 1,
        'name'       => "PIXEL TRIP — $charName #$keepTokenId",
        'image'      => 'https://pixeltripnft.website/images/' . $keepTokenId . '.gif',
        'character'  => $charName,
        'recordedAt' => gmdate('c'),
    ];
    appendUniqueEntry($lineage[$key]['self'], $selfS1);
    writeJsonSnapshot(
        SELF_SNAPSHOTS_DIR . $keepTokenId . '/stage-1.json',
        ['metadata' => readTokenMetadataFile($keepTokenId), 'summary' => $selfS1]
    );

    if ($newStage === 3) {
        $assignFile = defined('ASSIGNMENTS_FILE') ? ASSIGNMENTS_FILE : (__DIR__ . '/token-assignments.json');
        if (file_exists($assignFile)) {
            $assignments = json_decode(file_get_contents($assignFile), true) ?: [];
            $v = $assignments[(string)$keepTokenId] ?? null;
            if ($v && !empty($v['slug'])) {
                $s2Base = defined('IMAGE_STAGE2') ? IMAGE_STAGE2 : 'https://pixeltripnft.website/stage2/images';
                $selfS2 = [
                    'tokenId'    => $keepTokenId,
                    'stage'      => 2,
                    'name'       => 'PIXEL TRIP — ' . str_replace('_', ' ', $v['slug']) . " #$keepTokenId",
                    'image'      => $s2Base . '/' . $v['slug'] . '.gif?v=2-' . $keepTokenId,
                    'character'  => $v['slug'],
                    'recordedAt' => gmdate('c'),
                ];
                appendUniqueEntry($lineage[$key]['self'], $selfS2);
            }
        }
    }

    $burnMeta = readTokenMetadataFile($burnTokenId);
    if (!$burnMeta) {
        $burnMeta = [
            'name'        => "PIXEL TRIP — $charName #$burnTokenId",
            'image'       => 'https://pixeltripnft.website/images/' . $burnTokenId . '.gif',
            'attributes'  => [
                ['trait_type' => 'Character', 'value' => $charName],
                ['trait_type' => 'Stage_1', 'value' => '1'],
            ],
        ];
    }
    $burnEntry = metaEntryFromFile($burnTokenId, $burnMeta);
    if ($burnEntry['stage'] <= 1 || str_contains($burnMeta['name'] ?? '', 'Sacrificed')) {
        $burnEntry['stage'] = $newStage === 3 ? 2 : 1;
    }
    appendUniqueEntry($lineage[$key]['burned'], $burnEntry);
    writeJsonSnapshot(
        BURN_SNAPSHOTS_DIR . $burnTokenId . '.json',
        ['metadata' => $burnMeta, 'summary' => $burnEntry, 'evolvedInto' => $keepTokenId]
    );
    writeBurnedTokenMetadata($burnTokenId, $burnEntry, $keepTokenId, $newStage);

    saveEvolutionLineage($lineage);
    return $lineage[$key];
}

function buildOpenSeaMediaFiles(int $tokenId, int $currentStage, array $lineageEntry, string $currentImage): array {
    $files = [];
    $seen = [];

    $push = function (string $uri, string $label) use (&$files, &$seen) {
        if (!$uri || isset($seen[$uri])) {
            return;
        }
        $seen[$uri] = true;
        $type = str_ends_with(strtolower(parse_url($uri, PHP_URL_PATH) ?? ''), '.gif')
            ? 'image/gif'
            : 'image/png';
        $files[] = [
            'uri'  => $uri,
            'type' => $type,
            'name' => $label,
        ];
    };

    foreach ($lineageEntry['self'] ?? [] as $entry) {
        $push($entry['image'] ?? '', 'Stage ' . ($entry['stage'] ?? '?') . ' — #' . ($entry['tokenId'] ?? $tokenId));
    }
    if ($currentImage) {
        $push($currentImage, 'Stage ' . $currentStage . ' — #' . $tokenId);
    }

    usort($files, fn($a, $b) => strcmp($a['name'], $b['name']));
    return $files;
}

function enrichMetadataWithEvolution(array &$metadata, int $tokenId, int $newStage, array $lineageEntry, bool $skipViewer = false): void {
    if (empty($lineageEntry['self']) && !empty($metadata['evolution_history']['self'])) {
        $lineageEntry['self'] = $metadata['evolution_history']['self'];
    }

    $stages = buildEvolutionStages($tokenId, $metadata, $lineageEntry);
    if (count($stages) >= 2 && $newStage >= 2) {
        applyOpenSeaEvolutionMedia($metadata, $tokenId, $newStage, $lineageEntry);
        if (!$skipViewer) {
            writeEvolutionViewerHtml($tokenId, $metadata, $lineageEntry);
        }
    }

    if ($newStage >= 3 && count($stages) >= 3) {
        if (empty($metadata['evolution_history'])) {
            $metadata['evolution_history'] = [
                'tokenId'      => $tokenId,
                'currentStage' => $newStage,
                'self'         => [],
                'tokenPage'    => TOKEN_PAGE_BASE . '?id=' . $tokenId,
            ];
        }
        foreach ($stages as $stageEntry) {
            if ((int)$stageEntry['stage'] >= $newStage) {
                continue;
            }
            $hasStage = false;
            foreach ($metadata['evolution_history']['self'] ?? [] as $existing) {
                if ((int)($existing['stage'] ?? 0) === (int)$stageEntry['stage']) {
                    $hasStage = true;
                    break;
                }
            }
            if (!$hasStage) {
                $metadata['evolution_history']['self'][] = [
                    'tokenId' => $tokenId,
                    'stage'   => $stageEntry['stage'],
                    'image'   => $stageEntry['image'],
                ];
            }
        }
        if (empty($lineageEntry['self']) && !empty($metadata['evolution_history']['self'])) {
            $lineageEntry['self'] = $metadata['evolution_history']['self'];
        }
    }

    if (empty($lineageEntry['self'])) {
        return;
    }

    $history = buildEvolutionHistoryPayload($tokenId, $newStage, $lineageEntry);
    unset($history['burned'], $history['timeline']);
    $metadata['evolution_history'] = $history;
    $metadata['external_url'] = TOKEN_PAGE_BASE . '?id=' . $tokenId;

    $currentImage = $metadata['image'] ?? $metadata['animation_url'] ?? '';

    // Keep properties.files for non-OpenSea marketplaces; OpenSea ignores it.
    $mediaFiles = buildOpenSeaMediaFiles($tokenId, $newStage, $lineageEntry, $currentImage);
    if ($mediaFiles) {
        $metadata['properties'] = ['files' => $mediaFiles];
    }

    if (!str_contains($metadata['description'] ?? '', 'Evolution timeline:')) {
        $metadata['description'] .= ' Evolution timeline: ' . TOKEN_PAGE_BASE . '?id=' . $tokenId;
    }
}
