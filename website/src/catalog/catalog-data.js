import STAGE2_VARIANTS from "../burn/stage2-variants.json";
import STAGE3_MAP from "../burn/stage3-variants.json";
import CHARACTER_SAMPLES from "../vote/character-samples.json";
import { IMAGE_STAGE1 } from "../burn/config.js";

export const CATALOG_BUILD = "2026-08-02-burnable-list";

const S3_POOL = STAGE3_MAP.poolByChar ?? {};
const S3_DEFAULT = STAGE3_MAP.defaultByChar ?? {};

function formatName(name) {
  return name.replace(/_/g, " ");
}

function stage3Info(name) {
  const pool = S3_POOL[name] ?? [];
  if (pool.length) {
    return { hasS3: true, s3Count: pool.length };
  }
  if (S3_DEFAULT[name]) {
    return { hasS3: true, s3Count: 1 };
  }
  return { hasS3: false, s3Count: 0 };
}

/** Stage 1 characters with Stage 2 art — burn 2× same → Stage 2. */
export function buildBurnableList(variants = STAGE2_VARIANTS) {
  return Object.keys(variants)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const sampleId = CHARACTER_SAMPLES[name];
      const s2Variants = variants[name] ?? [];
      const s3 = stage3Info(name);
      return {
        name,
        label: formatName(name),
        s2Count: s2Variants.length,
        hasS3: s3.hasS3,
        s3Count: s3.s3Count,
        imageUrl: sampleId ? `${IMAGE_STAGE1}/${sampleId}.gif` : null,
      };
    })
    .filter((e) => e.imageUrl);
}

export const BURNABLE_LIST = buildBurnableList();

export function burnableStats(list = BURNABLE_LIST) {
  return {
    count: list.length,
    stage3: list.filter((e) => e.hasS3).length,
  };
}

export const BURNABLE_COUNT = burnableStats().count;
export const STAGE3_COUNT = burnableStats().stage3;

export { formatName };
