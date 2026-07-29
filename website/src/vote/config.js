import {
  STAGE1_ADDRESS,
  STAGE1_ABI,
  BURNABLE_CHARS,
  RECEIPT_RPC_URL,
  IMAGE_STAGE1,
} from "../burn/config.js";
import ONE_OF_ONE from "./one-of-one.json";
import CHARACTER_SAMPLES from "./character-samples.json";

/** Holder vote page — burnable characters only (Stage 2 live). */
export const VOTE_PAGE_ENABLED = true;

function defaultVoteApiUrl() {
  if (import.meta.env.VITE_VOTE_API_URL) {
    return import.meta.env.VITE_VOTE_API_URL;
  }
  if (typeof location !== "undefined" && location.hostname.includes("netlify.app")) {
    return "/.netlify/functions/votes";
  }
  return "https://pixeltripnft.website/vote-api.php";
}

export const VOTE_API_URL = defaultVoteApiUrl();

export const VOTE_BUILD = "2026-07-29-vote-v4";

/** Rolling 7-day window — one vote per wallet, no changes or cancel. */
export const VOTE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

const ONE_OF_ONE_SET = new Set(ONE_OF_ONE);

/** Burnable characters (Stage 2 art live), not 1/1, with a sample NFT image. */
export const VOTE_ELIGIBLE = [...BURNABLE_CHARS]
  .filter((name) => !ONE_OF_ONE_SET.has(name))
  .filter((name) => CHARACTER_SAMPLES[name])
  .sort((a, b) => a.localeCompare(b));

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
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export { STAGE1_ADDRESS, STAGE1_ABI, RECEIPT_RPC_URL, IMAGE_STAGE1 };
