/**
 * Live burn catalog — fetch stage2-variants.json from metadata server (FTP upload),
 * fall back to bundled JSON when offline or stale Netlify build.
 */
import STAGE2_FALLBACK from "./stage2-variants.json";
import { SITE_BASE } from "./config.js";
import { fetchWithTimeout } from "../shared/fetch-timeout.js";

let variants = STAGE2_FALLBACK;
let burnable = new Set(Object.keys(STAGE2_FALLBACK));
let loadPromise = null;

export function getStage2Variants() {
  return variants;
}

export function getBurnableChars() {
  return burnable;
}

export function isBurnableChar(name) {
  return burnable.has(name);
}

export function loadBurnProgram() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const res = await fetchWithTimeout(`${SITE_BASE}/stage2-variants.json?t=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const remote = await res.json();
      const keys = remote && typeof remote === "object" ? Object.keys(remote) : [];
      if (keys.length > 0) {
        // Union: server wins on conflicts; keep bundled entries not yet on FTP.
        variants = { ...STAGE2_FALLBACK, ...remote };
        burnable = new Set(Object.keys(variants));
        console.log(
          `[burn-program] ${burnable.size} characters (${keys.length} from server, ${Object.keys(STAGE2_FALLBACK).length} bundled)`,
        );
      }
    } catch (err) {
      console.warn("[burn-program] bundled catalog:", err.message);
    }
    return { variants, burnable };
  })();
  return loadPromise;
}
