import {
  BURNABLE_CHARS,
  CHAR_NAME_TO_ID,
  DIRECT_TO_S3_CHARS,
  IMAGE_STAGE2,
  SITE_BASE,
  STAGE2_VARIANTS,
} from "../burn/config.js";
import STAGE3_MAP_BUNDLE from "../burn/stage3-variants.json";
import ONE_OF_ONE from "./one-of-one.json";
import CHARACTER_SAMPLES from "./character-samples.json";
import CHARACTER_SUPPLY from "./character-supply.json";
import { fetchWithTimeout } from "../shared/fetch-timeout.js";

const ONE_OF_ONE_SET = new Set(ONE_OF_ONE);
const DIRECT_S3 = DIRECT_TO_S3_CHARS;

let stage3Map = STAGE3_MAP_BUNDLE;
let stage3VoteClosed = new Set(STAGE3_MAP_BUNDLE.stage3VoteClosedCharacters ?? []);
let stage3CatalogPromise = null;

function applyStage3CatalogRemote(remote) {
  if (!remote || typeof remote !== "object") return;
  stage3Map = {
    ...stage3Map,
    ...remote,
    fromStage2Slug: {
      ...(stage3Map.fromStage2Slug || {}),
      ...(remote.fromStage2Slug || {}),
    },
  };
  const closed = remote.stage3VoteClosedCharacters ?? stage3Map.stage3VoteClosedCharacters ?? [];
  stage3VoteClosed = new Set(closed);
}

/** Merge stage3-variants.json from metadata host (same file as burn / vote-api.php). */
export function loadStage3VoteCatalog() {
  if (stage3CatalogPromise) return stage3CatalogPromise;
  stage3CatalogPromise = (async () => {
    try {
      const res = await fetchWithTimeout(`${SITE_BASE}/stage3-variants.json?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const remote = await res.json();
      applyStage3CatalogRemote(remote);
      console.log(
        `[vote-stage3] catalog loaded (${Object.keys(remote.fromStage2Slug || {}).length} fromStage2, ` +
          `${stage3VoteClosed.size} vote-closed)`,
      );
    } catch (err) {
      console.warn("[vote-stage3] bundled stage3 catalog:", err.message);
    }
    return { stage3Map, stage3VoteClosed };
  })();
  return stage3CatalogPromise;
}

/** Stage 3 art program finished for this S1 line (no ballot, no new votes). */
export function isStage3ProgramClosedForCharacter(baseCharacter) {
  return stage3VoteClosed.has(baseCharacter);
}

/** Max Stage 3 NFTs achievable from N Stage 1 copies (pair-burn: S1→S2→S3). */
export function maxStage3Slots(baseCharacter, supply = CHARACTER_SUPPLY) {
  const n = Number(supply[baseCharacter]) || 0;
  return Math.floor(n / 4);
}

/** Max drawable Stage 3 arts: largest even count <= floor(N/4), min 1 when cap is 1. */
export function maxStage3ArtSlots(baseCharacter, supply = CHARACTER_SUPPLY) {
  const n = Number(supply[baseCharacter]) || 0;
  const cap = Math.floor(n / 4);
  if (cap <= 0) return 0;
  if (cap === 1) return 1;
  return cap % 2 === 0 ? cap : cap - 1;
}

export function computeStage3VoteCharacters(burnableSet = BURNABLE_CHARS) {
  return [...burnableSet]
    .filter((name) => !DIRECT_S3.has(name))
    .filter((name) => !ONE_OF_ONE_SET.has(name))
    .filter((name) => CHARACTER_SAMPLES[name])
    .filter((name) => maxStage3Slots(name) > 0)
    .filter((name) => (STAGE2_VARIANTS[name]?.length ?? 0) > 0)
    .filter((name) => !isStage3ArtCompleteForCharacter(name))
    .filter((name) => voteableStage2Variants(name).length > 0)
    .sort((a, b) => a.localeCompare(b));
}

export function stage2VariantsFor(baseCharacter, catalog = STAGE2_VARIANTS) {
  return catalog[baseCharacter] ?? [];
}

export function stage2ImageUrl(slug) {
  return `${IMAGE_STAGE2}/${slug}.gif`;
}

export function hasStage3Art(s2Slug) {
  return Boolean(stage3Map.fromStage2Slug?.[s2Slug]);
}

/** Vote counts until the chosen S2 variant ships Stage 3 art (no weekly timer). */
/** Stage 3 poll: one vote = one leaderboard point (holder tiers apply to Stage 2 only). */
export function stage3VoteWeight(balance) {
  return (Number(balance) || 0) > 0 ? 1 : 0;
}

export function isStage3VoteRowActive(row) {
  if (!row?.s2Slug) return false;
  return !hasStage3Art(row.s2Slug);
}

export function migrateStage3WalletVotes(raw) {
  if (!raw || typeof raw !== "object") return {};
  if (typeof raw.baseCharacter === "string" && raw.s2Slug) {
    return { [raw.baseCharacter]: raw };
  }
  const out = {};
  for (const [key, row] of Object.entries(raw)) {
    if (row && typeof row === "object" && row.s2Slug) out[key] = row;
  }
  return out;
}

export function activeStage3VotesByCharacter(walletVotes) {
  const byChar = migrateStage3WalletVotes(walletVotes);
  const active = {};
  for (const [base, row] of Object.entries(byChar)) {
    if (isStage3VoteRowActive(row)) active[base] = row;
  }
  return active;
}

export function stage3ArtCountForBase(baseCharacter, catalog = STAGE2_VARIANTS) {
  return stage2VariantsFor(baseCharacter, catalog).filter((v) => hasStage3Art(v.slug)).length;
}

/** All drawable Stage 3 art slots filled (see maxStage3ArtSlots). */
export function isStage3ArtCompleteForCharacter(
  baseCharacter,
  supply = CHARACTER_SUPPLY,
  catalog = STAGE2_VARIANTS,
) {
  if (isStage3ProgramClosedForCharacter(baseCharacter)) return true;
  const artCap = maxStage3ArtSlots(baseCharacter, supply);
  if (artCap <= 0) return true;
  return stage3ArtCountForBase(baseCharacter, catalog) >= artCap;
}

/** Variants holders can vote to prioritize for upcoming Stage 3 art. */
export function voteableStage2Variants(baseCharacter, catalog = STAGE2_VARIANTS) {
  return stage2VariantsFor(baseCharacter, catalog).filter((v) => !hasStage3Art(v.slug));
}

export function sumPointsForCharacter(leaderboard, baseCharacter) {
  let total = 0;
  for (const row of leaderboard) {
    if (row.baseCharacter === baseCharacter) {
      total += Number(row.points) || 0;
    }
  }
  return total;
}

/** Character removed from ballot when all drawable S3 art exists — not when vote points hit a cap. */
export function isCharacterVoteClosed(baseCharacter, _leaderboard, supply = CHARACTER_SUPPLY) {
  return isStage3ArtCompleteForCharacter(baseCharacter, supply);
}

export function characterVoteProgress(baseCharacter, leaderboard, supply = CHARACTER_SUPPLY) {
  const cap = maxStage3Slots(baseCharacter, supply);
  const points = sumPointsForCharacter(leaderboard, baseCharacter);
  return {
    cap,
    points,
    closed: isStage3ArtCompleteForCharacter(baseCharacter, supply),
  };
}

export function characterStage3ArtProgress(
  baseCharacter,
  supply = CHARACTER_SUPPLY,
  catalog = STAGE2_VARIANTS,
) {
  const artCap = maxStage3ArtSlots(baseCharacter, supply);
  const drawn = stage3ArtCountForBase(baseCharacter, catalog);
  return {
    artCap,
    drawn,
    remaining: Math.max(0, artCap - drawn),
    complete: artCap > 0 && drawn >= artCap,
  };
}

export { CHARACTER_SAMPLES, CHARACTER_SUPPLY, STAGE2_VARIANTS };
