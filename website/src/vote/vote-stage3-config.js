import {
  BURNABLE_CHARS,
  CHAR_NAME_TO_ID,
  DIRECT_TO_S3_CHARS,
  IMAGE_STAGE2,
  STAGE2_VARIANTS,
} from "../burn/config.js";
import STAGE3_MAP from "../burn/stage3-variants.json";
import ONE_OF_ONE from "./one-of-one.json";
import CHARACTER_SAMPLES from "./character-samples.json";
import CHARACTER_SUPPLY from "./character-supply.json";

const ONE_OF_ONE_SET = new Set(ONE_OF_ONE);
const DIRECT_S3 = DIRECT_TO_S3_CHARS;

/** Max Stage 3 NFTs achievable from N Stage 1 copies (pair-burn: S1→S2→S3). */
export function maxStage3Slots(baseCharacter, supply = CHARACTER_SUPPLY) {
  const n = Number(supply[baseCharacter]) || 0;
  return Math.floor(n / 4);
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
  return Boolean(STAGE3_MAP.fromStage2Slug?.[s2Slug]);
}

export function stage3ArtCountForBase(baseCharacter, catalog = STAGE2_VARIANTS) {
  return stage2VariantsFor(baseCharacter, catalog).filter((v) => hasStage3Art(v.slug)).length;
}

/** All Stage 3 art slots for this character are drawn (count >= floor(supply/4)). */
export function isStage3ArtCompleteForCharacter(
  baseCharacter,
  supply = CHARACTER_SUPPLY,
  catalog = STAGE2_VARIANTS,
) {
  const cap = maxStage3Slots(baseCharacter, supply);
  if (cap <= 0) return true;
  return stage3ArtCountForBase(baseCharacter, catalog) >= cap;
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

export function isCharacterVoteClosed(baseCharacter, leaderboard, supply = CHARACTER_SUPPLY) {
  const cap = maxStage3Slots(baseCharacter, supply);
  if (cap <= 0) return true;
  return sumPointsForCharacter(leaderboard, baseCharacter) >= cap;
}

export function characterVoteProgress(baseCharacter, leaderboard, supply = CHARACTER_SUPPLY) {
  const cap = maxStage3Slots(baseCharacter, supply);
  const points = sumPointsForCharacter(leaderboard, baseCharacter);
  return { cap, points, closed: cap > 0 && points >= cap };
}

export { CHARACTER_SAMPLES, CHARACTER_SUPPLY, STAGE2_VARIANTS };
