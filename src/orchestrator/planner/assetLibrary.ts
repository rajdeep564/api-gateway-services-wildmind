/**
 * WildMind AI Planner — Asset Library (Planner Memory)
 *
 * Stores and retrieves previously generated assets per user.
 * The planner can query this library before generating new assets,
 * allowing reuse of existing logos, images, music, or voice tracks.
 *
 * Storage:
 *   - Primary: Redis (fast, TTL-based)
 *   - Fallback: In-memory Map (dev / no-Redis)
 *
 * Asset lifecycle:
 *   - Assets stored after successful generation
 *   - 30-day TTL in Redis (configurable)
 *   - Tagged with assetType, prompt, style, tone for semantic matching
 *
 * Usage in planner:
 *   const library = await getUserAssetLibrary(userId);
 *   const existing = findMatchingAsset(library, { assetType: 'image', style: 'logo' });
 *   if (existing) → inject into plan step as context (skip generation)
 */

import { v4 as uuidv4 } from "uuid";
import { redisSetSafe, redisGetSafe } from "../../config/redisClient";

// ---------------------------------------------------------------------------
// Asset Types
// ---------------------------------------------------------------------------

export type AssetType =
  | "image"
  | "video"
  | "music"
  | "voice"
  | "script"
  | "logo";

export interface StoredAsset {
  assetId: string;
  userId: string;
  assetType: AssetType;
  /** URL to the stored asset (CDN or internal storage) */
  url: string;
  /** The prompt that generated this asset */
  prompt: string;
  /** Tags for semantic matching */
  tags: string[];
  style?: string;
  tone?: string;
  /** Original service that generated this */
  generatedBy: string;
  /** Job ID this asset came from */
  jobId: string;
  createdAt: number;
  /** TTL in seconds (default 30 days) */
  ttlSeconds: number;
}

export interface AssetLibrary {
  userId: string;
  assets: StoredAsset[];
  lastUpdated: number;
}

export interface AssetMatch {
  asset: StoredAsset;
  /** 0–1 score of how well this asset matches the request */
  relevanceScore: number;
  /** Why this asset was selected */
  reason: string;
}

// ---------------------------------------------------------------------------
// Storage config
// ---------------------------------------------------------------------------

const LIBRARY_TTL_SECONDS = parseInt(
  process.env.ASSET_LIBRARY_TTL_SECONDS ?? "2592000",
  10,
); // 30 days
const inMemoryLibraries = new Map<string, AssetLibrary>();

function isRedisAvailable(): boolean {
  return Boolean(process.env.REDIS_URL);
}

function redisKey(userId: string): string {
  return `wildmind:assets:${userId}`;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Load the full asset library for a user.
 * Returns an empty library if the user has no stored assets.
 */
export async function getUserAssetLibrary(
  userId: string,
): Promise<AssetLibrary> {
  if (isRedisAvailable()) {
    const stored = await redisGetSafe<AssetLibrary>(redisKey(userId));
    return stored ?? { userId, assets: [], lastUpdated: Date.now() };
  }
  return (
    inMemoryLibraries.get(userId) ?? {
      userId,
      assets: [],
      lastUpdated: Date.now(),
    }
  );
}

/**
 * Save a newly generated asset into the user's library.
 * Called by OrchestratorAgent after each successful step.
 */
export async function storeAsset(
  userId: string,
  asset: Omit<StoredAsset, "assetId" | "userId" | "createdAt" | "ttlSeconds">,
): Promise<StoredAsset> {
  const library = await getUserAssetLibrary(userId);

  const newAsset: StoredAsset = {
    ...asset,
    assetId: `asset_${uuidv4().replace(/-/g, "").slice(0, 12)}`,
    userId,
    createdAt: Date.now(),
    ttlSeconds: LIBRARY_TTL_SECONDS,
  };

  library.assets.push(newAsset);
  library.lastUpdated = Date.now();

  // Keep max 50 assets per user (drop oldest)
  if (library.assets.length > 50) {
    library.assets = library.assets
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50);
  }

  await _saveLibrary(library);
  console.log(
    `[AssetLibrary] Stored ${newAsset.assetType} asset ${newAsset.assetId} for user ${userId}`,
  );
  return newAsset;
}

/**
 * Delete an asset by ID from the user's library.
 */
export async function deleteAsset(
  userId: string,
  assetId: string,
): Promise<boolean> {
  const library = await getUserAssetLibrary(userId);
  const before = library.assets.length;
  library.assets = library.assets.filter((a) => a.assetId !== assetId);

  if (library.assets.length < before) {
    await _saveLibrary(library);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Semantic matching
// ---------------------------------------------------------------------------

/**
 * Find the most relevant existing asset for a given request.
 *
 * Matching algorithm:
 *   - Exact assetType match (required)
 *   - Style keyword overlap with stored tags
 *   - Recency bonus (newer = more relevant)
 *   - Minimum relevance threshold: 0.40
 *
 * @returns AssetMatch if a suitable asset is found, null otherwise
 */
export function findMatchingAsset(
  library: AssetLibrary,
  request: {
    assetType: AssetType;
    style?: string;
    tags?: string[];
    minRelevance?: number;
  },
): AssetMatch | null {
  const { assetType, style = "", tags = [], minRelevance = 0.4 } = request;

  const candidates = library.assets.filter((a) => a.assetType === assetType);
  if (candidates.length === 0) return null;

  const requestKeywords = [
    ...style.toLowerCase().split(/\s+/),
    ...tags.map((t) => t.toLowerCase()),
  ].filter(Boolean);

  const now = Date.now();
  const ONE_DAY_MS = 86_400_000;

  let bestMatch: AssetMatch | null = null;

  for (const asset of candidates) {
    let score = 0;

    // Style / tag overlap
    const assetKeywords = [
      ...asset.tags.map((t) => t.toLowerCase()),
      asset.style?.toLowerCase() ?? "",
      asset.tone?.toLowerCase() ?? "",
    ].filter(Boolean);

    if (requestKeywords.length > 0) {
      const overlap = requestKeywords.filter((kw) =>
        assetKeywords.some((ak) => ak.includes(kw)),
      );
      score += (overlap.length / requestKeywords.length) * 0.7;
    } else {
      score += 0.5; // no style filter = any asset is acceptable
    }

    // Recency bonus (max 0.3 for assets created today)
    const ageMs = now - asset.createdAt;
    const recencyBonus = Math.max(0, 0.3 * (1 - ageMs / (30 * ONE_DAY_MS)));
    score += recencyBonus;

    if (
      score >= minRelevance &&
      (!bestMatch || score > bestMatch.relevanceScore)
    ) {
      bestMatch = {
        asset,
        relevanceScore: score,
        reason: `${assetType} asset matched with score ${score.toFixed(2)} (style overlap + recency)`,
      };
    }
  }

  return bestMatch;
}

/**
 * Check library and inject existing assets into a plan's steps.
 * Steps that already have a matching asset get a `reuseAsset` field set,
 * which the WorkflowEngine uses to skip generation and use stored output.
 *
 * @returns Modified steps with `reuseAsset` set where matches found
 */
export async function injectReuseableAssets(
  steps: Array<any>,
  library: AssetLibrary,
  style: string,
): Promise<{ steps: any[]; reuseCount: number }> {
  let reuseCount = 0;

  const modified = steps.map((step) => {
    // Only try to reuse single-asset steps (not utility steps)
    const REUSEABLE_SERVICES = [
      "fal_image",
      "fal_image_pro",
      "bfl_image",
      "minimax_music",
      "fal_music",
    ];
    if (!REUSEABLE_SERVICES.includes(step.service)) return step;

    const assetType: AssetType = step.service.includes("music")
      ? "music"
      : step.service.includes("voice")
        ? "voice"
        : "image";

    const match = findMatchingAsset(library, { assetType, style });
    if (!match) return step;

    reuseCount++;
    console.log(
      `[AssetLibrary] Reusing ${assetType} asset ${match.asset.assetId} for step "${step.label}" (score: ${match.relevanceScore.toFixed(2)})`,
    );

    return {
      ...step,
      reuseAsset: {
        assetId: match.asset.assetId,
        url: match.asset.url,
        reason: match.reason,
      },
    };
  });

  return { steps: modified, reuseCount };
}

// ---------------------------------------------------------------------------
// Asset extraction from step outputs
// ---------------------------------------------------------------------------

/**
 * Attempt to extract a public URL from a generation service output.
 * Different services use different response shapes.
 */
export function extractAssetUrl(
  output: any,
  serviceType: string,
): string | null {
  if (!output) return null;

  // Common keys across providers
  const candidates = [
    output.url,
    output.imageUrl,
    output.videoUrl,
    output.audioUrl,
    output.image_url,
    output.video_url,
    output.audio_url,
    output.images?.[0]?.url,
    output.videos?.[0]?.url,
    output.result?.url,
    output.data?.url,
  ];

  return (
    candidates.find((c) => typeof c === "string" && c.startsWith("http")) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function _saveLibrary(library: AssetLibrary): Promise<void> {
  if (isRedisAvailable()) {
    await redisSetSafe(redisKey(library.userId), library, LIBRARY_TTL_SECONDS);
  } else {
    inMemoryLibraries.set(library.userId, library);
  }
}
