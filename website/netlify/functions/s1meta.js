// Netlify Function: s1meta
// GET /.netlify/functions/s1meta?id=TOKEN_ID
//
// Serves metadata for ALL tokens in the original Stage 1 collection.
// - If token is unevolved (stage=0): proxies metadata from the original server
// - If token is Stage 2/3: returns evolved metadata with new art
//
// No external dependencies — pure Node.js fetch + raw JSON-RPC.

const EVOLVE_CONTRACT  = process.env.EVOLVE_CONTRACT  || '';
const STAGE1_META_BASE = (process.env.STAGE1_META_BASE || 'https://pixeltripnft.website/Test/metadata').replace(/\/$/, '');
const IMAGE_BASE       = (process.env.IMAGE_BASE_URL   || 'https://pixeltripnft.website/Test/stage2/images').replace(/\/$/, '');
const RPC_URL          = process.env.MAINNET_RPC_URL   || 'https://ethereum-rpc.publicnode.com';

// ── Minimal ABI encoder / eth_call ────────────────────────────────────────────

import { createHash } from 'node:crypto';

// Compute keccak256 using OpenSSL (Node 20 + OpenSSL 3 supports it)
// Falls back to pre-computed values if unavailable
function keccak256Selector(sig) {
  for (const algo of ['keccak256', 'keccak-256']) {
    try {
      return createHash(algo).update(sig, 'utf8').digest('hex').slice(0, 8);
    } catch { /* try next */ }
  }
  // Fallback: pre-computed selectors (verified from Solidity ABI)
  const known = {
    'evolvedStage(uint256)':    'ab6dd60d',
    'stage1Character(uint256)': '237885d8',
  };
  return known[sig] ?? null;
}

const SEL_EVOLVED_STAGE    = keccak256Selector('evolvedStage(uint256)');
const SEL_STAGE1_CHARACTER = keccak256Selector('stage1Character(uint256)');

function encodeCall(selector, tokenId) {
  return '0x' + selector + BigInt(tokenId).toString(16).padStart(64, '0');
}

function decodeUint8(hex) {
  if (!hex || hex === '0x') return 0;
  const data = hex.startsWith('0x') ? hex.slice(2) : hex;
  return parseInt(data.slice(0, 64), 16);
}

async function ethCall(to, data) {
  const res = await fetch(RPC_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to, data }, 'latest'], id: 1 }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

// ── Inline variant data ───────────────────────────────────────────────────────

const CHAR_ID_TO_NAME = {
  1: 'Ape_Beard', 45: 'Beanie_Cyclops', 80: 'Diva', 81: 'Alpine_Hunter',
};

const STAGE2_VARIANTS = {
  Ape_Beard: [
    { slug: 'Frog_Hat_Ape',   bg: 'Kaleidoscope',  frame: 'Rain_Window' },
    { slug: 'Green_Neon_Ape', bg: 'Infinity_Loop',  frame: 'Pi_Digits' },
    { slug: 'Hippie_Ape',     bg: 'Facets',         frame: 'Phantom_Trace' },
    { slug: 'Kiss_Ape',       bg: 'Eddy_Field',     frame: 'Blizzard_Wall' },
    { slug: 'Red_Cap_Ape',    bg: 'Kaleidoscope',   frame: 'Hourglass_Turn' },
    { slug: 'Zombie_Ape',     bg: 'Data_Stream',    frame: 'Pink_Glass' },
    { slug: 'Neon_Beard',     bg: 'Kaleidoscope',   frame: 'Rain_Window' },
    { slug: 'Winter_Beard',   bg: 'Plasma_Flow',    frame: 'Morse_Sos' },
    { slug: 'Cyborg_Beard',   bg: 'Viscous',        frame: 'Hex_Grid_Edge' },
    { slug: 'Crown_Beard',    bg: 'Hologram',       frame: 'Vine_Creep' },
    { slug: 'Frost_Beard',    bg: 'Water_Gleam',    frame: 'Isometric_Grid' },
    { slug: 'Golden_Beard',   bg: 'Event_Horizon',  frame: 'Color_Wheel_Border' },
  ],
  Beanie_Cyclops: [
    { slug: 'Astro_Cyclops',      bg: 'Facets',         frame: 'Deep_Space' },
    { slug: 'Crown_Cyclops',      bg: 'Grid_Tunnel',    frame: 'Checker_Scroll' },
    { slug: 'Golden_Cyclops',     bg: 'Wave_Moire',     frame: 'Isometric_Grid' },
    { slug: 'Mohawk_Cyclops',     bg: 'Hologram',       frame: 'Dust_Orbit' },
    { slug: 'Respirator_Cyclops', bg: 'Mandala_Spiral', frame: 'Fractal_Edge' },
    { slug: 'Tribe_Cyclops',      bg: 'Waves',          frame: 'Time_Loop_Scar' },
    { slug: 'Viking_Cyclops',     bg: 'Network',        frame: 'Nexus_Pulse' },
    { slug: 'Shadow_Cyclops',     bg: 'Grid_Tunnel',    frame: 'Checker_Scroll' },
    { slug: 'Neon_Cyclops',       bg: 'Facets',         frame: 'Deep_Space' },
    { slug: 'Winter_Cyclops',     bg: 'Data_Stream',    frame: 'Pink_Glass' },
    { slug: 'Cyborg_Cyclops',     bg: 'Kaleidoscope',   frame: 'Hourglass_Turn' },
    { slug: 'Frost_Cyclops',      bg: 'Facets',         frame: 'Phantom_Trace' },
  ],
  Diva: [
    { slug: 'Shadow_Diva', bg: 'Axis_Spin',           frame: 'Snow_Static' },
    { slug: 'Cyborg_Diva', bg: 'Fusion_Meta_Caustic', frame: 'Pink_Glass' },
    { slug: 'Demon_Diva',  bg: 'Waves',               frame: 'Chromosome_Paint' },
    { slug: 'Glitch_Diva', bg: 'Crystal',             frame: 'Light_Veil' },
    { slug: 'Golden_Diva', bg: 'Glitter',             frame: 'Mandala_Spin' },
    { slug: 'Rusty_Diva',  bg: 'Blob_Capsule',        frame: 'Mandala_Reveal' },
    { slug: 'Zombie_Diva', bg: 'Finale_Cosmos_Waves', frame: 'Sandfall_Cascade' },
    { slug: 'Neon_Diva',   bg: 'Axis_Spin',           frame: 'Snow_Static' },
    { slug: 'Winter_Diva', bg: 'Network',             frame: 'Nexus_Pulse' },
    { slug: 'Crown_Diva',  bg: 'Mandala_Spiral',      frame: 'Fractal_Edge' },
    { slug: 'Frost_Diva',  bg: 'Hologram',            frame: 'Dust_Orbit' },
  ],
  Alpine_Hunter: [
    { slug: 'Cyborg_Hunter', bg: 'Event_Horizon', frame: 'Color_Wheel_Border' },
    { slug: 'Ghost_Hunter',  bg: 'Water_Gleam',   frame: 'Isometric_Grid' },
    { slug: 'Golden_Hunter', bg: 'Hologram',      frame: 'Vine_Creep' },
    { slug: 'Graph_Hunter',  bg: 'Viscous',       frame: 'Hex_Grid_Edge' },
    { slug: 'Winter_Hunter', bg: 'Plasma_Flow',   frame: 'Morse_Sos' },
    { slug: 'Crown_Hunter',  bg: 'Hologram',      frame: 'Vine_Creep' },
    { slug: 'Frost_Hunter',  bg: 'Water_Gleam',   frame: 'Isometric_Grid' },
  ],
};

// ── Handler ───────────────────────────────────────────────────────────────────

const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

export async function handler(event) {
  const tokenId = event.queryStringParameters?.id;
  if (!tokenId || isNaN(Number(tokenId))) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing or invalid ?id= param' }) };
  }

  try {
    // Fetch evolvedStage and stage1Character in parallel
    const [stageHex, charHex] = await Promise.all([
      EVOLVE_CONTRACT ? ethCall(EVOLVE_CONTRACT, encodeCall(SEL_EVOLVED_STAGE,    tokenId)) : Promise.resolve('0x'),
      EVOLVE_CONTRACT ? ethCall(EVOLVE_CONTRACT, encodeCall(SEL_STAGE1_CHARACTER, tokenId)) : Promise.resolve('0x'),
    ]);

    const stage  = decodeUint8(stageHex);
    const charId = decodeUint8(charHex);

    // Stage 0 → proxy original metadata from the user's server
    if (stage === 0) {
      const upstream = await fetch(`${STAGE1_META_BASE}/${tokenId}`);
      if (!upstream.ok) {
        return { statusCode: upstream.status, headers: HEADERS, body: JSON.stringify({ error: 'Original metadata not found' }) };
      }
      const meta = await upstream.json();
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify(meta) };
    }

    const charName = CHAR_ID_TO_NAME[charId];

    if (stage === 2) {
      const variants = charName ? STAGE2_VARIANTS[charName] : null;
      if (!variants?.length) {
        return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: `No Stage 2 variants for charId=${charId}` }) };
      }
      const variant     = variants[Number(tokenId) % variants.length];
      const displayName = variant.slug.replace(/_/g, ' ');
      return {
        statusCode: 200, headers: HEADERS,
        body: JSON.stringify({
          name:          `PIXEL TRIP — ${displayName} #${tokenId}`,
          description:   'PIXEL TRIP — 4444 animated pixel portraits on a three-layer journey.',
          image:         `${IMAGE_BASE}/${variant.slug}.gif`,
          animation_url: `${IMAGE_BASE}/${variant.slug}.gif`,
          external_url:  'https://pixeltripnft.website',
          attributes: [
            { trait_type: 'Background', value: variant.bg },
            { trait_type: 'Character',  value: variant.slug },
            { trait_type: 'Frame',      value: variant.frame },
            { trait_type: 'Stage',      value: '2' },
          ],
        }),
      };
    }

    if (stage === 3) {
      const displayCharName = (charName || `Character #${charId}`).replace(/_/g, ' ');
      const stage3Base      = IMAGE_BASE.replace('/stage2/', '/stage3/');
      return {
        statusCode: 200, headers: HEADERS,
        body: JSON.stringify({
          name:          `PIXEL TRIP — ${displayCharName} Stage 3 #${tokenId}`,
          description:   'PIXEL TRIP — A fully ascended tripper. Reached Stage 3 through the burn-to-evolve journey.',
          image:         `${stage3Base}/${charName || charId}.gif`,
          animation_url: `${stage3Base}/${charName || charId}.gif`,
          external_url:  'https://pixeltripnft.website',
          attributes: [
            { trait_type: 'Character', value: charName || `Character #${charId}` },
            { trait_type: 'Stage',     value: '3' },
          ],
        }),
      };
    }

    return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: `Unexpected stage ${stage}` }) };

  } catch (err) {
    console.error('[s1meta]', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
}
