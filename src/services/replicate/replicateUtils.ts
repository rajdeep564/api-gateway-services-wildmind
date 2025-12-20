/**
 * Replicate Service Utilities
 * Shared utility functions and constants used across replicate services
 */

// Use dynamic import signature to avoid type requirement during build-time
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Replicate = require("replicate");
import { ApiError } from "../../utils/errorHandler";
import { env } from "../../config/env";

// Constants
export const DEFAULT_BG_MODEL_A =
  "851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc";

export const DEFAULT_BG_MODEL_B =
  "lucataco/remove-bg:95fcc2a26d3899cd6c2691c900465aaeff466285a65c14638cc5f36f34befaf1";

// Version map for community models that require explicit version hashes
export const DEFAULT_VERSION_BY_MODEL: Record<string, string> = {
  "fermatresearch/magic-image-refiner":
    "507ddf6f977a7e30e46c0daefd30de7d563c72322f9e4cf7cbac52ef0f667b13",
  "philz1337x/clarity-upscaler":
    "dfad41707589d68ecdccd1dfa600d55a208f9310748e44bfe35b4a6291453d5e",
  "851-labs/background-remover":
    "a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc",
  "lucataco/remove-bg":
    "95fcc2a26d3899cd6c2691c900465aaeff466285a65c14638cc5f36f34befaf1",
  "nightmareai/real-esrgan":
    "f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa",
  "mv-lab/swin2sr":
    "a01b0512004918ca55d02e554914a9eca63909fa83a29ff0f115c78a7045574f",
  "prunaai/z-image-turbo":
    "7ea16386290ff5977c7812e66e462d7ec3954d8e007a8cd18ded3e7d41f5d7cf",
};

// Types
export type SubmitReturn = {
  requestId: string;
  historyId: string;
  model: string;
  status: "submitted";
};

/**
 * Composes a model specification string with optional version
 */
export function composeModelSpec(modelBase: string, maybeVersion?: string): string {
  const version = maybeVersion || DEFAULT_VERSION_BY_MODEL[modelBase];
  return version ? `${modelBase}:${version}` : modelBase;
}

/**
 * Clamps a number between min and max values
 */
export function clamp(n: any, min: number, max: number): number {
  const x = Number(n);
  if (Number.isNaN(x)) return min;
  return Math.max(min, Math.min(max, x));
}

/**
 * Downloads an image from URL and converts to data URI
 */
export async function downloadToDataUri(
  sourceUrl: string
): Promise<{ dataUri: string; ext: string } | null> {
  try {
    const res = await fetch(sourceUrl as any);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/png";
    const ext =
      contentType.includes("jpeg") || contentType.includes("jpg")
        ? "jpg"
        : contentType.includes("webp")
          ? "webp"
          : "png";
    const ab = await res.arrayBuffer();
    const b64 = Buffer.from(new Uint8Array(ab)).toString("base64");
    return { dataUri: `data:${contentType};base64,${b64}`, ext };
  } catch {
    return null;
  }
}

/**
 * Extracts the first URL from Replicate output
 */
export function extractFirstUrl(output: any): string {
  try {
    if (!output) return "";
    if (typeof output === "string") return output;
    if (Array.isArray(output)) {
      const item = output[0];
      if (!item) return "";
      if (typeof item === "string") return item;
      if (item && typeof item.url === "function") return String(item.url());
      if (item && typeof item.url === "string") return String(item.url);
      return "";
    }
    if (typeof output.url === "function") return String(output.url());
    if (typeof output.url === "string") return String(output.url);
    return "";
  } catch {
    return "";
  }
}

/**
 * Builds a standardized image file name for Replicate outputs
 */
export const buildReplicateImageFileName = (historyId?: string, index: number = 0) => {
  if (historyId) {
    return `${historyId}-image-${index + 1}`;
  }
  return `image-${Date.now()}-${index + 1}-${Math.random().toString(36).slice(2, 6)}`;
};

/**
 * Resolves a single item URL from Replicate SDK output
 */
export async function resolveItemUrl(item: any): Promise<string> {
  try {
    if (!item) return "";
    if (typeof item === "string") return item;
    // Replicate SDK file-like item: item.url() may be sync or async
    const maybeUrlFn = (item as any).url;
    if (typeof maybeUrlFn === "function") {
      const result = maybeUrlFn.call(item);
      if (result && typeof (result as any).then === "function") {
        const awaited = await result;
        // Some SDKs may return URL objects or objects with toString()
        return typeof awaited === "string" ? awaited : String(awaited);
      }
      return typeof result === "string" ? result : String(result);
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * Resolves multiple URLs from Replicate output (array or single)
 */
export async function resolveOutputUrls(output: any): Promise<string[]> {
  try {
    if (!output) return [];
    if (Array.isArray(output)) {
      const urls: string[] = [];
      for (const it of output) {
        const u = await resolveItemUrl(it);
        if (u) urls.push(u);
      }
      return urls;
    }
    const single = await resolveItemUrl(output);
    return single ? [single] : [];
  } catch {
    return [];
  }
}

/**
 * Resolves if WAN model should use fast variant based on body parameters
 */
export async function resolveWanModelFast(body: any): Promise<boolean> {
  const s = (body?.speed ?? "").toString().toLowerCase();
  const m = (body?.model ?? "").toString().toLowerCase();
  const speedFast =
    s === "fast" || s === "true" || s.includes("fast") || body?.speed === true;
  const modelFast = m.includes("fast");
  return speedFast || modelFast;
}

/**
 * Ensures Replicate client is initialized with API key
 */
export function ensureReplicate(): any {
  // env.replicateApiKey already handles REPLICATE_API_TOKEN as fallback in env.ts
  const key = env.replicateApiKey as string;
  if (!key) {
    // eslint-disable-next-line no-console
    console.error("[replicateQueue] Missing REPLICATE_API_TOKEN");
    throw new ApiError("Replicate API key not configured", 500);
  }
  return new Replicate({ auth: key });
}

/**
 * Gets the latest version of a Replicate model
 */
export async function getLatestModelVersion(
  replicate: any,
  modelBase: string
): Promise<string | null> {
  try {
    // Prefer model slug with latest version lookup; fallback to using model slug directly in predictions.create
    const [owner, name] = modelBase.split("/");
    if (!owner || !name) return null;
    const model = await replicate.models.get(`${owner}/${name}`);
    const latestVersion =
      (model as any)?.latest_version?.id ||
      (Array.isArray((model as any)?.versions)
        ? (model as any).versions[0]?.id
        : null);
    return latestVersion || null;
  } catch {
    return null;
  }
}
