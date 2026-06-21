// Netlify Function: metadata
// GET /.netlify/functions/metadata?id=TOKEN_ID
// Serves dynamic ERC-721 metadata for EvolvePixelTrip Stage 2 / Stage 3 tokens.
// Reads (charId, stage) from the contract, then picks the correct Stage 2 variant.

import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

const EVOLVE_CONTRACT = process.env.EVOLVE_CONTRACT || '0x44dC167e639e238B8fCbd3A0b72D69Bd03F0d1Bc';
const RPC_URL = process.env.MAINNET_RPC_URL || 'https://ethereum-rpc.publicnode.com';
const IMAGE_BASE = (process.env.IMAGE_BASE_URL || 'https://pixeltripnft.website/Test/stage2/images').replace(/\/$/, '');

// ── Inline data ───────────────────────────────────────────────────────────────

// charId (from EvolvePixelTrip.stage1Character mapping) → Stage 1 character name
const CHAR_ID_TO_NAME = {
  1:  'Ape_Beard',
  45: 'Beanie_Cyclops',
  80: 'Diva',
  81: 'Alpine_Hunter',
};

// Stage 1 character name → Stage 2 variant pool (picked deterministically by tokenId)
const STAGE2_VARIANTS = {
  Ape_Beard: [
    { slug: 'Frog_Hat_Ape',   bg: 'Kaleidoscope',   frame: 'Rain_Window' },
    { slug: 'Green_Neon_Ape', bg: 'Infinity_Loop',   frame: 'Pi_Digits' },
    { slug: 'Hippie_Ape',     bg: 'Facets',          frame: 'Phantom_Trace' },
    { slug: 'Kiss_Ape',       bg: 'Eddy_Field',      frame: 'Blizzard_Wall' },
    { slug: 'Red_Cap_Ape',    bg: 'Kaleidoscope',    frame: 'Hourglass_Turn' },
    { slug: 'Zombie_Ape',     bg: 'Data_Stream',     frame: 'Pink_Glass' },
    { slug: 'Neon_Beard',     bg: 'Kaleidoscope',    frame: 'Rain_Window' },
    { slug: 'Winter_Beard',   bg: 'Plasma_Flow',     frame: 'Morse_Sos' },
    { slug: 'Cyborg_Beard',   bg: 'Viscous',         frame: 'Hex_Grid_Edge' },
    { slug: 'Crown_Beard',    bg: 'Hologram',        frame: 'Vine_Creep' },
    { slug: 'Frost_Beard',    bg: 'Water_Gleam',     frame: 'Isometric_Grid' },
    { slug: 'Golden_Beard',   bg: 'Event_Horizon',   frame: 'Color_Wheel_Border' },
  ],
  Beanie_Cyclops: [
    { slug: 'Astro_Cyclops',       bg: 'Facets',          frame: 'Deep_Space' },
    { slug: 'Crown_Cyclops',       bg: 'Grid_Tunnel',     frame: 'Checker_Scroll' },
    { slug: 'Golden_Cyclops',      bg: 'Wave_Moire',      frame: 'Isometric_Grid' },
    { slug: 'Mohawk_Cyclops',      bg: 'Hologram',        frame: 'Dust_Orbit' },
    { slug: 'Respirator_Cyclops',  bg: 'Mandala_Spiral',  frame: 'Fractal_Edge' },
    { slug: 'Tribe_Cyclops',       bg: 'Waves',           frame: 'Time_Loop_Scar' },
    { slug: 'Viking_Cyclops',      bg: 'Network',         frame: 'Nexus_Pulse' },
    { slug: 'Shadow_Cyclops',      bg: 'Grid_Tunnel',     frame: 'Checker_Scroll' },
    { slug: 'Neon_Cyclops',        bg: 'Facets',          frame: 'Deep_Space' },
    { slug: 'Winter_Cyclops',      bg: 'Data_Stream',     frame: 'Pink_Glass' },
    { slug: 'Cyborg_Cyclops',      bg: 'Kaleidoscope',    frame: 'Hourglass_Turn' },
    { slug: 'Frost_Cyclops',       bg: 'Facets',          frame: 'Phantom_Trace' },
  ],
  Diva: [
    { slug: 'Shadow_Diva',  bg: 'Axis_Spin',            frame: 'Snow_Static' },
    { slug: 'Cyborg_Diva',  bg: 'Fusion_Meta_Caustic',  frame: 'Pink_Glass' },
    { slug: 'Demon_Diva',   bg: 'Waves',                frame: 'Chromosome_Paint' },
    { slug: 'Glitch_Diva',  bg: 'Crystal',              frame: 'Light_Veil' },
    { slug: 'Golden_Diva',  bg: 'Glitter',              frame: 'Mandala_Spin' },
    { slug: 'Rusty_Diva',   bg: 'Blob_Capsule',         frame: 'Mandala_Reveal' },
    { slug: 'Zombie_Diva',  bg: 'Finale_Cosmos_Waves',  frame: 'Sandfall_Cascade' },
    { slug: 'Neon_Diva',    bg: 'Axis_Spin',            frame: 'Snow_Static' },
    { slug: 'Winter_Diva',  bg: 'Network',              frame: 'Nexus_Pulse' },
    { slug: 'Crown_Diva',   bg: 'Mandala_Spiral',       frame: 'Fractal_Edge' },
    { slug: 'Frost_Diva',   bg: 'Hologram',             frame: 'Dust_Orbit' },
  ],
  Alpine_Hunter: [
    { slug: 'Cyborg_Hunter',  bg: 'Event_Horizon',  frame: 'Color_Wheel_Border' },
    { slug: 'Ghost_Hunter',   bg: 'Water_Gleam',    frame: 'Isometric_Grid' },
    { slug: 'Golden_Hunter',  bg: 'Hologram',       frame: 'Vine_Creep' },
    { slug: 'Graph_Hunter',   bg: 'Viscous',        frame: 'Hex_Grid_Edge' },
    { slug: 'Winter_Hunter',  bg: 'Plasma_Flow',    frame: 'Morse_Sos' },
    { slug: 'Crown_Hunter',   bg: 'Hologram',       frame: 'Vine_Creep' },
    { slug: 'Frost_Hunter',   bg: 'Water_Gleam',    frame: 'Isometric_Grid' },
  ],
};

// ── Contract ABI ──────────────────────────────────────────────────────────────

const TOKEN_INFO_ABI = [
  {
    name: 'tokenInfo',
    type: 'function',
    inputs: [{ type: 'uint256', name: '' }],
    outputs: [
      { type: 'uint8', name: 'charId' },
      { type: 'uint8', name: 'stage' },
    ],
    stateMutability: 'view',
  },
];

// ── Handler ───────────────────────────────────────────────────────────────────

export async function handler(event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  const tokenId = event.queryStringParameters?.id;
  if (!tokenId || isNaN(Number(tokenId))) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing or invalid ?id= param' }) };
  }

  try {
    const client = createPublicClient({ chain: mainnet, transport: http(RPC_URL) });

    const [charId, stage] = await client.readContract({
      address: EVOLVE_CONTRACT,
      abi: TOKEN_INFO_ABI,
      functionName: 'tokenInfo',
      args: [BigInt(tokenId)],
    });

    // stage 0 means token doesn't exist in this contract
    if (stage === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Token not found' }) };
    }

    const charName = CHAR_ID_TO_NAME[Number(charId)];

    if (stage === 2) {
      const variants = charName ? STAGE2_VARIANTS[charName] : null;
      if (!variants || variants.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: `No Stage 2 variants for charId=${charId}` }) };
      }

      // Deterministic variant selection — same tokenId always gets same variant
      const variant = variants[Number(tokenId) % variants.length];
      const displayName = variant.slug.replace(/_/g, ' ');

      const metadata = {
        name: `PIXEL TRIP — ${displayName} #${tokenId}`,
        description:
          '🌀 PIXEL TRIP — 4444 animated pixel portraits on a three-layer journey: ' +
          'living backgrounds, unique characters, and glitch frames that loop forever. ' +
          'Every trip is one of a kind.',
        image: `${IMAGE_BASE}/${variant.slug}.gif`,
        animation_url: `${IMAGE_BASE}/${variant.slug}.gif`,
        external_url: 'https://pixeltripnft.website',
        attributes: [
          { trait_type: 'Background', value: variant.bg },
          { trait_type: 'Character',  value: variant.slug },
          { trait_type: 'Frame',      value: variant.frame },
          { trait_type: 'Stage',      value: '2' },
        ],
      };

      return { statusCode: 200, headers, body: JSON.stringify(metadata) };
    }

    if (stage === 3) {
      const displayCharName = (charName || `Character #${charId}`).replace(/_/g, ' ');

      const metadata = {
        name: `PIXEL TRIP — ${displayCharName} Stage 3 #${tokenId}`,
        description:
          '🌀 PIXEL TRIP — A fully ascended traveler. ' +
          'Reached Stage 3 through the burn-to-evolve journey.',
        image: `${IMAGE_BASE.replace('/stage2/', '/stage3/')}/${charName || charId}.gif`,
        animation_url: `${IMAGE_BASE.replace('/stage2/', '/stage3/')}/${charName || charId}.gif`,
        external_url: 'https://pixeltripnft.website',
        attributes: [
          { trait_type: 'Character', value: charName || `Character #${charId}` },
          { trait_type: 'Stage',     value: '3' },
        ],
      };

      return { statusCode: 200, headers, body: JSON.stringify(metadata) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: `Unexpected stage ${stage}` }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
}
