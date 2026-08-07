import {
  STAGE1_ADDRESS,
  STAGE1_ABI,
  BURNABLE_CHARS,
  CHAR_NAME_TO_ID,
  DIRECT_TO_S3_CHARS,
  RECEIPT_RPC_URL,
  IMAGE_STAGE1,
} from "../burn/config.js";
import ONE_OF_ONE from "./one-of-one.json";
import CHARACTER_SAMPLES from "./character-samples.json";

/** Holder vote — characters awaiting Stage 2 art (excludes Direct S3 and 1/1). */
export const VOTE_PAGE_ENABLED = true;

function defaultVoteApiUrl() {
  if (import.meta.env.VITE_VOTE_API_URL) {
    return import.meta.env.VITE_VOTE_API_URL;
  }
  // Production Netlify build — same-origin function (works on custom domains too).
  if (import.meta.env.PROD) {
    return "/.netlify/functions/votes";
  }
  return "https://pixeltripnft.website/vote-api.php";
}

export const VOTE_API_URL = defaultVoteApiUrl();

export const VOTE_BUILD = "2026-08-07-vote-110c-v13";

/** Rolling 7-day window — one vote per wallet, no changes or cancel. */
export const VOTE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

const ONE_OF_ONE_SET = new Set(ONE_OF_ONE);

/** Stage 2 art shipped — exclude from vote ballot and leaderboard. */
export function isVoteReleasedCharacter(name, burnableSet = BURNABLE_CHARS) {
  return burnableSet.has(name);
}

/** No Stage 2 yet — not Direct S3, not 1/1, with a sample NFT image. */
export function computeVoteEligible(burnableSet = BURNABLE_CHARS) {
  return Object.keys(CHAR_NAME_TO_ID)
    .filter((name) => !burnableSet.has(name))
    .filter((name) => !DIRECT_TO_S3_CHARS.has(name))
    .filter((name) => !ONE_OF_ONE_SET.has(name))
    .filter((name) => CHARACTER_SAMPLES[name])
    .sort((a, b) => a.localeCompare(b));
}

export const VOTE_ELIGIBLE = computeVoteEligible(BURNABLE_CHARS);

export const CHARACTER_IMAGES = Object.fromEntries(
  VOTE_ELIGIBLE.map((name) => [name, `${IMAGE_STAGE1}/${CHARACTER_SAMPLES[name]}.gif`]),
);

export function voteWeight(balance) {
  const n = Number(balance) || 0;
  if (n <= 0) return 0;
  if (n <= 10) return 1;
  if (n <= 15) return 2;
  return 3;
}

export function voteWeightLabel(balance) {
  const w = voteWeight(balance);
  if (w <= 0) return "Not eligible";
  return `${w} point${w === 1 ? "" : "s"}`;
}

export function formatCharacter(name) {
  return name.replace(/_/g, " ");
}

export function isVoteLocked(vote) {
  if (!vote?.updated) return false;
  return Date.now() - new Date(vote.updated).getTime() < VOTE_COOLDOWN_MS;
}

export function nextVoteDate(vote) {
  if (!vote?.updated) return null;
  return new Date(new Date(vote.updated).getTime() + VOTE_COOLDOWN_MS);
}

export function formatNextVote(vote) {
  const d = nextVoteDate(vote);
  if (!d) return "";
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export { STAGE1_ADDRESS, STAGE1_ABI, RECEIPT_RPC_URL, IMAGE_STAGE1 };
