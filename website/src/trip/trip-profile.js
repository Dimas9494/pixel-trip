const PROFILE_KEY = "pixeltrip-holder-profile-v1";
const CLAIM_KEY = "pixeltrip-trip-card-v2";

export function normalizeWallet(wallet) {
  return wallet?.startsWith("0x") ? wallet.toLowerCase() : null;
}

export function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveProfile({ wallet, holderName }) {
  const w = normalizeWallet(wallet);
  if (!w) return;
  const prev = loadProfile();
  const next = {
    wallet: w,
    holderName: prev?.wallet === w ? prev.holderName || "" : "",
    updatedAt: new Date().toISOString(),
  };
  if (holderName !== undefined) {
    next.holderName = String(holderName).trim().slice(0, 24);
  }
  localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
}

export function resolveHolderName(wallet) {
  const w = normalizeWallet(wallet);
  if (!w) return "";
  const profile = loadProfile();
  if (profile?.wallet === w && profile.holderName) return profile.holderName;
  try {
    const raw = localStorage.getItem(CLAIM_KEY) || localStorage.getItem("pixeltrip-trip-card-v1");
    if (!raw) return "";
    const claim = JSON.parse(raw);
    if (claim.wallet?.toLowerCase() === w && claim.holderName) return claim.holderName;
  } catch {
    /* ignore */
  }
  return "";
}

export function formatWalletLabel(wallet, holderName, shortFn) {
  const addr = shortFn(wallet);
  return holderName ? `${holderName} · ${addr}` : addr;
}
