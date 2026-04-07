import { Request } from "express";
import { creditDistributionData } from "../../data/creditDistribution";
import { generationHistoryRepository } from "../../repository/generationHistoryRepository";
import { probeVideoMeta } from "../media/probe";
import { probeImageMeta } from "../media/imageProbe";
import { uploadDataUriToZata } from "../storage/zataUpload";

export const FAL_PRICING_VERSION = "fal-v1";

// Credits conversion helper for legacy cost estimation paths.
const CREDITS_PER_USD = 2000;
const SEEDANCE_2_USD_PER_1K_TOKENS = 0.014;
const SEEDANCE_2_CREDITS_PER_USD = 4000 / 5.003;

function findCredits(modelName: string): number | null {
  const row = creditDistributionData.find(
    (m) => m.modelName.toLowerCase() === modelName.toLowerCase(),
  );
  return row?.creditsPerGeneration ?? null;
}

function parseSeedance2DurationSeconds(
  duration: unknown,
  fallbackSeconds = 8,
): number {
  if (duration == null || duration === "") return fallbackSeconds;
  if (typeof duration === "number" && Number.isFinite(duration)) {
    return Math.min(15, Math.max(4, duration));
  }
  const text = String(duration).trim().toLowerCase();
  if (text === "auto") return fallbackSeconds;
  const parsed = parseFloat(text.replace(/s$/i, ""));
  if (!Number.isFinite(parsed)) return fallbackSeconds;
  return Math.min(15, Math.max(4, parsed));
}

function getSeedance2EstimatedDimensions(
  resolution: unknown,
  aspectRatio: unknown,
): { width: number; height: number; resolution: "480p" | "720p"; aspectRatio: string } {
  const resolutionText =
    String(resolution || "720p").toLowerCase() === "480p" ? "480p" : "720p";
  const aspectRatioText = String(aspectRatio || "auto").toLowerCase();
  const normalizedAspect =
    aspectRatioText === "21:9" ||
    aspectRatioText === "16:9" ||
    aspectRatioText === "4:3" ||
    aspectRatioText === "1:1" ||
    aspectRatioText === "3:4" ||
    aspectRatioText === "9:16"
      ? aspectRatioText
      : "auto";

  const dims720: Record<string, { width: number; height: number }> = {
    auto: { width: 1280, height: 720 },
    "21:9": { width: 1680, height: 720 },
    "16:9": { width: 1280, height: 720 },
    "4:3": { width: 960, height: 720 },
    "1:1": { width: 720, height: 720 },
    "3:4": { width: 720, height: 960 },
    "9:16": { width: 720, height: 1280 },
  };

  const dims480: Record<string, { width: number; height: number }> = {
    auto: { width: 854, height: 480 },
    "21:9": { width: 1120, height: 480 },
    "16:9": { width: 854, height: 480 },
    "4:3": { width: 640, height: 480 },
    "1:1": { width: 480, height: 480 },
    "3:4": { width: 480, height: 640 },
    "9:16": { width: 480, height: 854 },
  };

  const source = resolutionText === "480p" ? dims480 : dims720;
  const dims = source[normalizedAspect] || source.auto;
  return {
    ...dims,
    resolution: resolutionText,
    aspectRatio: normalizedAspect,
  };
}

type Seedance2Variant = "T2V" | "I2V";

export function computeFalSeedance2CostFromMeta(
  meta?: any,
  variant: Seedance2Variant = "T2V",
): {
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
} {
  const requestedResolution = meta?.resolution;
  const requestedAspectRatio = meta?.aspect_ratio;
  const estimated = getSeedance2EstimatedDimensions(
    requestedResolution,
    requestedAspectRatio,
  );

  // Seedance 2.0 should debit from the requested output settings so the
  // submit estimate and final debit always stay aligned.
  const width = estimated.width;
  const height = estimated.height;
  const durationSec = parseSeedance2DurationSeconds(meta?.duration);

  const tokens = (width * height * durationSec * 24) / 1024;
  const usdCost = (tokens / 1000) * SEEDANCE_2_USD_PER_1K_TOKENS;
  const credits = Math.max(
    1,
    Math.ceil(usdCost * SEEDANCE_2_CREDITS_PER_USD),
  );

  return {
    cost: credits,
    pricingVersion: FAL_PRICING_VERSION,
    meta: {
      model: `Bytedance Seedance 2.0 ${variant}`,
      resolution: estimated.resolution,
      aspect_ratio: estimated.aspectRatio,
      width,
      height,
      durationSec,
      tokens,
      usdCost,
      formula: "((w*h*d*24)/(1024*1000))*0.014*(4000/5.003)",
    },
  };
}

export async function computeFalSeedance2T2vSubmitCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  return computeFalSeedance2CostFromMeta(req.body || {}, "T2V");
}

export async function computeFalSeedance2I2vSubmitCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  return computeFalSeedance2CostFromMeta(req.body || {}, "I2V");
}

export async function computeFalImageCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const { uploadedImages = [], n = 1, model, resolution } = req.body || {};
  // Prefer explicit model rows where available (e.g. Imagen 4, Seedream 4.5); otherwise
  // fallback to Google Nano Banana rows (Gemini image).
  let display: string | null = null;
  const m = (model || "").toLowerCase();
  const hasUploadedImages =
    Array.isArray(uploadedImages) && uploadedImages.length > 0;
  const res = String(resolution || "").toUpperCase();

  // Bytedance Seedream 4.5 on FAL (text-to-image / edit)
  if (
    m.includes("seedream-4.5") ||
    m.includes("seedream_v45") ||
    m.includes("seedreamv45") ||
    m.includes("seedream-v4")
  ) {
    // Matches the creditDistribution row for "Bytedance Seedream-4.5".
    display = "Bytedance Seedream-4.5";
  } else if (
    m.includes("flux-2-pro") ||
    m.includes("flux2pro") ||
    m.includes("flux 2 pro")
  ) {
    // Flux 2 Pro: Use I2I pricing when images are uploaded, T2I pricing otherwise
    // Resolution determines 1K (1080p) vs 2K
    if (hasUploadedImages) {
      // I2I pricing uses the dedicated FLUX.2 image-edit rows.
      display = res === "2K" ? "FLUX.2 [pro] I2I 2K" : "FLUX.2 [pro] I2I 1080p";
    } else {
      // T2I pricing uses the dedicated FLUX.2 text-to-image rows.
      display = res === "2K" ? "FLUX.2 [pro] 2K" : "FLUX.2 [pro] 1080p";
    }
  } else if (m.includes("imagen-4")) {
    // Imagen 4 family
    if (m.includes("ultra")) display = "Imagen 4 Ultra";
    else if (m.includes("fast")) display = "Imagen 4 Fast";
    else display = "Imagen 4";
  } else if (
    m.includes("google/nano-banana-pro") ||
    m.includes("nano-banana-pro")
  ) {
    // Google Nano Banana Pro: resolution-based pricing (same as Replicate)
    const nanoRes = String(res || "2K").toUpperCase();
    const is4K =
      nanoRes === "4K" ||
      nanoRes.includes("AUTO_4K") ||
      nanoRes.includes("2160") ||
      nanoRes.includes("4096");
    if (is4K) {
      display = "Nano banana Pro 4K";
    } else {
      display = "Nano banana Pro 2K"; // Default shared tier for 1K/2K
    }
  } else {
    // Map Gemini image to our Google rows (choose I2I when uploadedImages provided)
    display = hasUploadedImages
      ? "Google nano banana (I2I)"
      : "Google nano banana (T2I)";
  }
  const base = display ? findCredits(display) : null;
  if (base == null) throw new Error("Unsupported FAL image model");
  const count = Math.max(1, Math.min(10, Number(n)));
  const cost = Math.ceil(base * count);
  return {
    cost,
    pricingVersion: FAL_PRICING_VERSION,
    meta: { model: display, n: count },
  };
}

export async function computeFalOutpaintCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const body: any = req.body || {};
  let url: string | undefined =
    typeof body.image_url === "string" && body.image_url.length > 0
      ? body.image_url
      : undefined;
  if (
    !url &&
    typeof body.image === "string" &&
    body.image.startsWith("data:")
  ) {
    try {
      const uid = (req as any)?.uid || "anon";
      const stored = await uploadDataUriToZata({
        dataUri: body.image,
        keyPrefix: `users/${uid}/pricing/outpaint/${Date.now()}`,
        fileName: "source",
      });
      url = stored.publicUrl;
    } catch {
      url = undefined;
    }
  }
  if (!url) throw new Error("image_url is required");

  const meta = await probeImageMeta(url);
  const baseWidth = Number(meta?.width || 0);
  const baseHeight = Number(meta?.height || 0);
  if (
    !isFinite(baseWidth) ||
    !isFinite(baseHeight) ||
    baseWidth <= 0 ||
    baseHeight <= 0
  ) {
    throw new Error("Unable to compute image dimensions for outpaint pricing");
  }

  const clampInt = (value: any, min: number, max: number, fallback: number) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(min, Math.min(max, Math.round(num)));
  };

  const expandLeft = clampInt(body?.expand_left, 0, 700, 0);
  const expandRight = clampInt(body?.expand_right, 0, 700, 0);
  const expandTop = clampInt(body?.expand_top, 0, 700, 0);
  const expandBottom = clampInt(body?.expand_bottom, 0, 700, 400);
  const requestedZoom = Number(body?.zoom_out_percentage ?? 20);
  const zoomOut = Number.isFinite(requestedZoom)
    ? Math.max(0, Math.min(100, requestedZoom))
    : 20;
  const requestedImages = Number(body?.num_images ?? 1);
  const numImages = Number.isFinite(requestedImages)
    ? Math.max(1, Math.min(4, Math.round(requestedImages)))
    : 1;

  const outputWidth = baseWidth + expandLeft + expandRight;
  const outputHeight = baseHeight + expandTop + expandBottom;
  const totalMegapixels = (outputWidth * outputHeight * numImages) / 1_000_000;
  const creditsPerMp = 70; // $0.035 * 2000 credits/USD
  const credits = Math.max(1, Math.ceil(totalMegapixels * creditsPerMp));

  return {
    cost: credits,
    pricingVersion: FAL_PRICING_VERSION,
    meta: {
      model: "fal-ai/outpaint",
      input: { width: baseWidth, height: baseHeight },
      output: { width: outputWidth, height: outputHeight },
      expansions: {
        left: expandLeft,
        right: expandRight,
        top: expandTop,
        bottom: expandBottom,
      },
      zoom_out_percentage: zoomOut,
      num_images: numImages,
      pricing: { megapixels: totalMegapixels, creditsPerMp, credits },
    },
  };
}

function resolveVeoDisplay(
  isFast: boolean,
  kind: "t2v" | "i2v",
  duration?: string,
): string {
  const dur = String(duration || "8s").toLowerCase();
  if (isFast) {
    if (kind === "t2v") {
      if (dur.startsWith("4")) return "veo3 fast t2v 4s";
      if (dur.startsWith("6")) return "veo3 fast t2v 6s";
      return "veo3 fast t2v 8s";
    }
    return "veo3 fast i2v 8s";
  } else {
    if (kind === "t2v") {
      if (dur.startsWith("4")) return "veo3 t2v 4s";
      if (dur.startsWith("6")) return "veo3 t2v 6s";
      return "veo3 t2v 8s";
    }
    return "veo3 i2v 8s";
  }
}

function resolveVeo31Display(
  isFast: boolean,
  kind: "t2v" | "i2v",
  duration?: string,
): string {
  const dur = String(duration || "8s").toLowerCase();
  if (isFast) {
    if (kind === "t2v") {
      if (dur.startsWith("4")) return "Veo 3.1 Fast T2V 4s";
      if (dur.startsWith("6")) return "Veo 3.1 Fast T2V 6s";
      return "Veo 3.1 Fast T2V 8s";
    }
    // Fix: Handle duration for I2V Fast as well
    if (dur.startsWith("4")) return "Veo 3.1 Fast I2V 4s";
    if (dur.startsWith("6")) return "Veo 3.1 Fast I2V 6s";
    return "Veo 3.1 Fast I2V 8s";
  } else {
    if (kind === "t2v") {
      if (dur.startsWith("4")) return "Veo 3.1 T2V 4s";
      if (dur.startsWith("6")) return "Veo 3.1 T2V 6s";
      return "Veo 3.1 T2V 8s";
    }
    // Fix: Handle duration for I2V (non-fast) as well
    if (dur.startsWith("4")) return "Veo 3.1 I2V 4s";
    if (dur.startsWith("6")) return "Veo 3.1 I2V 6s";
    return "Veo 3.1 I2V 8s";
  }
}

function resolveVeo31LiteDisplay(
  kind: "t2v" | "i2v",
  duration?: string,
  resolution?: string,
): string {
  const dur = String(duration || "8s").toLowerCase();
  const res = String(resolution || "720p").toLowerCase();

  if (res === "1080p") {
    return `Veo 3.1 Lite ${kind === "t2v" ? "T2V" : "I2V"} 8s 1080p`;
  }

  if (dur.startsWith("4"))
    return `Veo 3.1 Lite ${kind === "t2v" ? "T2V" : "I2V"} 4s 720p`;
  if (dur.startsWith("6"))
    return `Veo 3.1 Lite ${kind === "t2v" ? "T2V" : "I2V"} 6s 720p`;
  return `Veo 3.1 Lite ${kind === "t2v" ? "T2V" : "I2V"} 8s 720p`;
}

function resolveVeo31LiteFirstLastDisplay(resolution?: string): string {
  const res = String(resolution || "720p").toLowerCase();
  return `Veo 3.1 Lite FFLF2V 8s ${res === "1080p" ? "1080p" : "720p"}`;
}

export async function computeFalVeoTtvSubmitCost(
  req: Request,
  isFast: boolean,
): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const { duration } = req.body || {};
  const display = resolveVeoDisplay(isFast, "t2v", duration);
  const base = findCredits(display);
  if (base == null) throw new Error("Unsupported FAL Veo T2V pricing");
  return {
    cost: Math.ceil(base),
    pricingVersion: FAL_PRICING_VERSION,
    meta: { model: display, duration: duration || "8s" },
  };
}

export async function computeFalVeoI2vSubmitCost(
  req: Request,
  isFast: boolean,
): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const { duration } = req.body || {};
  const display = resolveVeoDisplay(isFast, "i2v", duration);
  const base = findCredits(display);
  if (base == null) throw new Error("Unsupported FAL Veo I2V pricing");
  return {
    cost: Math.ceil(base),
    pricingVersion: FAL_PRICING_VERSION,
    meta: { model: display, duration: duration || "8s" },
  };
}

export async function computeFalVeo31TtvSubmitCost(
  req: Request,
  isFast: boolean,
): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const { duration, generate_audio } = req.body || {};
  const baseDisplay = resolveVeo31Display(isFast, "t2v", duration);
  const hasAudio = generate_audio !== false;
  const display = `${baseDisplay} ${hasAudio ? "AUDIO ON" : "AUDIO OFF"}`;
  const base = findCredits(display);
  if (base == null) throw new Error("Unsupported FAL Veo 3.1 T2V pricing");
  // creditDistribution already encodes the AUDIO ON/OFF price, so no extra discount here
  const cost = Math.ceil(base);
  return {
    cost,
    pricingVersion: FAL_PRICING_VERSION,
    meta: {
      model: display,
      duration: duration || "8s",
      generate_audio: hasAudio,
    },
  };
}

export async function computeFalVeo31I2vSubmitCost(
  req: Request,
  isFast: boolean,
): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const { duration, generate_audio } = req.body || {};
  const baseDisplay = resolveVeo31Display(isFast, "i2v", duration);
  const hasAudio = generate_audio !== false;
  const display = `${baseDisplay} ${hasAudio ? "AUDIO ON" : "AUDIO OFF"}`;
  const base = findCredits(display);
  if (base == null) throw new Error("Unsupported FAL Veo 3.1 I2V pricing");
  const cost = Math.ceil(base);
  return {
    cost,
    pricingVersion: FAL_PRICING_VERSION,
    meta: {
      model: display,
      duration: duration || "8s",
      generate_audio: hasAudio,
    },
  };
}

export async function computeFalVeo31LiteTtvSubmitCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const { duration, resolution } = req.body || {};
  const display = resolveVeo31LiteDisplay("t2v", duration, resolution);
  const base = findCredits(display);
  if (base == null) throw new Error("Unsupported FAL Veo 3.1 Lite T2V pricing");
  return {
    cost: Math.ceil(base),
    pricingVersion: FAL_PRICING_VERSION,
    meta: {
      model: display,
      duration: duration || "8s",
      resolution: resolution || "720p",
      generate_audio: true,
    },
  };
}

export async function computeFalVeo31LiteI2vSubmitCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const { duration, resolution } = req.body || {};
  const display = resolveVeo31LiteDisplay("i2v", duration, resolution);
  const base = findCredits(display);
  if (base == null) throw new Error("Unsupported FAL Veo 3.1 Lite I2V pricing");
  return {
    cost: Math.ceil(base),
    pricingVersion: FAL_PRICING_VERSION,
    meta: {
      model: display,
      duration: duration || "8s",
      resolution: resolution || "720p",
      generate_audio: true,
    },
  };
}

export async function computeFalVeo31LiteFirstLastSubmitCost(
  req: Request,
): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const { resolution } = req.body || {};
  const display = resolveVeo31LiteFirstLastDisplay(resolution);
  const base = findCredits(display);
  if (base == null)
    throw new Error("Unsupported FAL Veo 3.1 Lite FFLF2V pricing");
  return {
    cost: Math.ceil(base),
    pricingVersion: FAL_PRICING_VERSION,
    meta: {
      model: display,
      duration: "8s",
      resolution: String(resolution || "720p").toLowerCase(),
      mode: "fflf2v",
      generate_audio: true,
    },
  };
}

// Sora 2 pricing
export async function computeFalSora2I2vSubmitCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const { duration } = req.body || {};
  const dur = String(duration ?? "8");
  let display = "Sora 2 I2V 8s";
  if (dur.startsWith("4")) display = "Sora 2 I2V 4s";
  else if (dur.startsWith("12")) display = "Sora 2 I2V 12s";
  const base = findCredits(display);
  if (base == null) throw new Error("Unsupported Sora 2 I2V pricing");
  return {
    cost: Math.ceil(base),
    pricingVersion: FAL_PRICING_VERSION,
    meta: { model: display, duration: `${dur}s` },
  };
}

export async function computeFalSora2ProI2vSubmitCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const { duration, resolution } = req.body || {};
  const dur = String(duration ?? "8");
  const res =
    String(resolution || "auto").toLowerCase() === "1080p" ? "1080p" : "720p"; // map auto->720p
  const display = `Sora 2 Pro I2V ${dur}s ${res}`;
  const base = findCredits(display);
  if (base == null) throw new Error("Unsupported Sora 2 Pro I2V pricing");
  return {
    cost: Math.ceil(base),
    pricingVersion: FAL_PRICING_VERSION,
    meta: { model: display, duration: `${dur}s`, resolution: res },
  };
}

// Sora 2 T2V pricing (same credits as I2V)
export async function computeFalSora2T2vSubmitCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const { duration } = req.body || {};
  const dur = String(duration ?? "8");
  let display = "Sora 2 T2V 8s";
  if (dur.startsWith("4")) display = "Sora 2 T2V 4s";
  else if (dur.startsWith("12")) display = "Sora 2 T2V 12s";
  const base = findCredits(display);
  if (base == null) throw new Error("Unsupported Sora 2 T2V pricing");
  return {
    cost: Math.ceil(base),
    pricingVersion: FAL_PRICING_VERSION,
    meta: { model: display, duration: `${dur}s` },
  };
}

export async function computeFalSora2ProT2vSubmitCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const { duration, resolution } = req.body || {};
  const dur = String(duration ?? "8");
  const res =
    String(resolution || "auto").toLowerCase() === "1080p" ? "1080p" : "720p";
  const display = `Sora 2 Pro T2V ${dur}s ${res}`;
  const base = findCredits(display);
  if (base == null) throw new Error("Unsupported Sora 2 Pro T2V pricing");
  return {
    cost: Math.ceil(base),
    pricingVersion: FAL_PRICING_VERSION,
    meta: { model: display, duration: `${dur}s`, resolution: res },
  };
}

// LTX V2 pricing (Image-to-Video)
function computeLtxCredits(
  req: Request,
  variant: "Pro" | "Fast",
): { cost: number; pricingVersion: string; meta: Record<string, any> } {
  const { duration, resolution } = (req as any).body || {};
  const dur = String(duration ?? "8");
  const resIn = String(resolution || "1080p").toLowerCase();
  const res = resIn.includes("2160")
    ? "2160p"
    : resIn.includes("1440")
      ? "1440p"
      : "1080p";
  const display = `LTX V2 ${variant} T2V/I2V ${dur}s ${res}`;
  const base = findCredits(display);
  if (base == null) throw new Error(`Unsupported LTX V2 ${variant} pricing`);
  return {
    cost: Math.ceil(base),
    pricingVersion: FAL_PRICING_VERSION,
    meta: { model: display, duration: `${dur}s`, resolution: res },
  };
}

export async function computeFalLtxV2ProI2vSubmitCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  return computeLtxCredits(req, "Pro");
}

export async function computeFalLtxV2FastI2vSubmitCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  return computeLtxCredits(req, "Fast");
}

// Kling o1 First/Last Frame to Video pricing
export async function computeFalKlingO1SubmitCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const { duration } = req.body || {};
  const dur =
    typeof duration === "number" ? String(duration) : String(duration || "5");
  const display = dur.startsWith("10") ? "Kling o1 10s" : "Kling o1 5s";
  const base = findCredits(display);
  if (base == null) throw new Error("Unsupported Kling o1 pricing");
  return {
    cost: Math.ceil(base),
    pricingVersion: FAL_PRICING_VERSION,
    meta: { model: display, duration: dur },
  };
}

const KLING_V3_CREDITS_PER_SECOND = {
  standard: {
    audioOff: 188,
    audioOn: 272,
    voiceControl: 328,
  },
  pro: {
    audioOff: 244,
    audioOn: 356,
    voiceControl: 412,
  },
} as const;

function getKlingV3VoiceControlFlag(
  payload: Record<string, any> = {},
): boolean {
  if (payload.voice_control === true) return true;
  if (
    typeof payload.voice_id === "string" &&
    payload.voice_id.trim().length > 0
  )
    return true;
  if (Array.isArray(payload.voice_ids) && payload.voice_ids.length > 0)
    return true;
  return false;
}

function buildKlingV3PricingRecord(
  tier: "standard" | "pro",
  durationInput: unknown,
  payload: Record<string, any> = {},
) {
  const parsedDuration =
    typeof durationInput === "number"
      ? durationInput
      : parseInt(String(durationInput ?? "5").replace(/s$/i, ""), 10);
  const duration = Number.isFinite(parsedDuration)
    ? Math.min(15, Math.max(3, parsedDuration))
    : 5;
  const hasVoiceControl = getKlingV3VoiceControlFlag(payload);
  const hasAudio = payload.generate_audio !== false;
  const rate = hasVoiceControl
    ? KLING_V3_CREDITS_PER_SECOND[tier].voiceControl
    : hasAudio
      ? KLING_V3_CREDITS_PER_SECOND[tier].audioOn
      : KLING_V3_CREDITS_PER_SECOND[tier].audioOff;
  const audioLabel = hasVoiceControl
    ? " Voice Control"
    : hasAudio
      ? " Audio On"
      : " Audio Off";
  const model = `Kling 3 ${tier === "pro" ? "Pro" : "Standard"} T2V/I2V ${duration}s${audioLabel}`;
  return {
    cost: Math.ceil(duration * rate),
    pricingVersion: FAL_PRICING_VERSION,
    meta: {
      model,
      duration: String(duration),
      generate_audio: hasAudio,
      voice_control: hasVoiceControl,
      creditsPerSecond: rate,
    },
  };
}

export async function computeFalKlingV3StandardT2vSubmitCost(
  req: Request,
): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  return buildKlingV3PricingRecord(
    "standard",
    req.body?.duration,
    req.body || {},
  );
}

export async function computeFalKlingV3StandardI2vSubmitCost(
  req: Request,
): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  return buildKlingV3PricingRecord(
    "standard",
    req.body?.duration,
    req.body || {},
  );
}

export async function computeFalKlingV3ProT2vSubmitCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  return buildKlingV3PricingRecord("pro", req.body?.duration, req.body || {});
}

export async function computeFalKlingV3ProI2vSubmitCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  return buildKlingV3PricingRecord("pro", req.body?.duration, req.body || {});
}

export async function computeFalKling26ProT2vSubmitCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const { duration, generate_audio } = req.body || {};
  const dur =
    typeof duration === "number"
      ? String(duration)
      : String(duration || "5").replace(/s$/i, "");
  const hasAudio = generate_audio !== false; // Default to true
  const audioSuffix = hasAudio ? " Audio On" : " Audio Off";
  const display = `Kling 2.6 Pro T2V/I2V ${dur}s${audioSuffix}`;
  const base = findCredits(display);
  if (base == null)
    throw new Error(`Unsupported Kling 2.6 Pro pricing: ${display}`);
  return {
    cost: Math.ceil(base),
    pricingVersion: FAL_PRICING_VERSION,
    meta: { model: display, duration: dur, generate_audio: hasAudio },
  };
}

export async function computeFalKling26ProI2vSubmitCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const { duration, generate_audio } = req.body || {};
  const dur =
    typeof duration === "number"
      ? String(duration)
      : String(duration || "5").replace(/s$/i, "");
  const hasAudio = generate_audio !== false; // Default to true
  const audioSuffix = hasAudio ? " Audio On" : " Audio Off";
  const display = `Kling 2.6 Pro T2V/I2V ${dur}s${audioSuffix}`;
  const base = findCredits(display);
  if (base == null)
    throw new Error(`Unsupported Kling 2.6 Pro pricing: ${display}`);
  return {
    cost: Math.ceil(base),
    pricingVersion: FAL_PRICING_VERSION,
    meta: { model: display, duration: dur, generate_audio: hasAudio },
  };
}

// LTX V2 pricing (Text-to-Video) mirrors I2V
export async function computeFalLtxV2ProT2vSubmitCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  return computeLtxCredits(req, "Pro");
}
export async function computeFalLtxV2FastT2vSubmitCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  return computeLtxCredits(req, "Fast");
}

// Sora 2 Video-to-Video Remix pricing: infer from source video history
export async function computeFalSora2RemixSubmitCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const uid = (req as any).uid as string;
  const { source_history_id, video_id } = req.body || {};
  let source: any = null;
  if (source_history_id) {
    source = await generationHistoryRepository.get(
      uid,
      String(source_history_id),
    );
  } else if (video_id) {
    const found = await generationHistoryRepository.findBySoraVideoId(
      uid,
      String(video_id),
    );
    source = found?.item;
  }
  if (!source)
    throw new Error("Cannot determine pricing: source Sora video not found");
  const dur = String((source as any)?.duration ?? "8");
  // Decide pro vs standard using model or resolution
  const srcModel = String((source as any)?.model || "").toLowerCase();
  const srcRes = String((source as any)?.resolution || "").toLowerCase();
  const isPro = srcModel.includes("/pro") || srcRes === "1080p";
  if (isPro) {
    const res = srcRes === "1080p" ? "1080p" : "720p";
    const display = `Sora 2 Pro ${dur}s ${res}`;
    const base = findCredits(display);
    if (base == null) throw new Error("Unsupported Sora 2 Pro remix pricing");
    return {
      cost: Math.ceil(base),
      pricingVersion: FAL_PRICING_VERSION,
      meta: {
        model: display,
        duration: `${dur}s`,
        resolution: res,
        remixOf: source.id,
      },
    };
  }
  const display = dur.startsWith("4")
    ? "Sora 2 4s"
    : dur.startsWith("12")
      ? "Sora 2 12s"
      : "Sora 2 8s";
  const base = findCredits(display);
  if (base == null) throw new Error("Unsupported Sora 2 remix pricing");
  return {
    cost: Math.ceil(base),
    pricingVersion: FAL_PRICING_VERSION,
    meta: { model: display, duration: `${dur}s`, remixOf: source.id },
  };
}

export function computeFalVeoCostFromModel(
  model: string,
  meta?: any,
): { cost: number; pricingVersion: string; meta: Record<string, any> } {
  // Default to 8s variants based on model path
  const normalized = model.toLowerCase();
  let display = "";
  if (normalized === "fal-ai/veo3") display = "veo3 t2v 8s";
  else if (normalized === "fal-ai/veo3/fast") display = "veo3 fast t2v 8s";
  else if (normalized === "fal-ai/veo3/image-to-video") display = "veo3 i2v 8s";
  else if (normalized === "fal-ai/veo3/fast/image-to-video")
    display = "veo3 fast i2v 8s";
  else if (normalized === "fal-ai/veo3.1") display = "Veo 3.1 T2V 8s";
  else if (normalized === "fal-ai/veo3.1/lite")
    display = resolveVeo31LiteDisplay("t2v", meta?.duration, meta?.resolution);
  else if (normalized === "fal-ai/veo3.1/lite/image-to-video")
    display = resolveVeo31LiteDisplay("i2v", meta?.duration, meta?.resolution);
  else if (normalized === "fal-ai/veo3.1/lite/first-last-frame-to-video")
    display = resolveVeo31LiteFirstLastDisplay(meta?.resolution);
  else if (normalized === "fal-ai/veo3.1/fast") display = "Veo 3.1 Fast T2V 8s";
  else if (normalized === "fal-ai/veo3.1/image-to-video") {
    // Handle duration and audio flag for Veo 3.1 I2V (image-to-video)
    const dur = String(meta?.duration ?? "8");
    const hasAudio = meta?.generate_audio !== false; // default ON
    if (dur.startsWith("4"))
      display = hasAudio
        ? "Veo 3.1 I2V 4s AUDIO ON"
        : "Veo 3.1 I2V 4s AUDIO OFF";
    else if (dur.startsWith("6"))
      display = hasAudio
        ? "Veo 3.1 I2V 6s AUDIO ON"
        : "Veo 3.1 I2V 6s AUDIO OFF";
    else
      display = hasAudio
        ? "Veo 3.1 I2V 8s AUDIO ON"
        : "Veo 3.1 I2V 8s AUDIO OFF";
  } else if (normalized === "fal-ai/veo3.1/fast/image-to-video") {
    // Handle duration and audio flag for Veo 3.1 Fast I2V (image-to-video)
    const dur = String(meta?.duration ?? "8");
    const hasAudio = meta?.generate_audio !== false; // default ON
    if (dur.startsWith("4"))
      display = hasAudio
        ? "Veo 3.1 Fast I2V 4s AUDIO ON"
        : "Veo 3.1 Fast I2V 4s AUDIO OFF";
    else if (dur.startsWith("6"))
      display = hasAudio
        ? "Veo 3.1 Fast I2V 6s AUDIO ON"
        : "Veo 3.1 Fast I2V 6s AUDIO OFF";
    else
      display = hasAudio
        ? "Veo 3.1 Fast I2V 8s AUDIO ON"
        : "Veo 3.1 Fast I2V 8s AUDIO OFF";
  } else if (normalized === "fal-ai/veo3.1/first-last-frame-to-video") {
    // Handle duration and audio flag for Veo 3.1 first-last-frame I2V
    const dur = String(meta?.duration ?? "8");
    const hasAudio = meta?.generate_audio !== false; // default ON
    if (dur.startsWith("4"))
      display = hasAudio
        ? "Veo 3.1 I2V 4s AUDIO ON"
        : "Veo 3.1 I2V 4s AUDIO OFF";
    else if (dur.startsWith("6"))
      display = hasAudio
        ? "Veo 3.1 I2V 6s AUDIO ON"
        : "Veo 3.1 I2V 6s AUDIO OFF";
    else
      display = hasAudio
        ? "Veo 3.1 I2V 8s AUDIO ON"
        : "Veo 3.1 I2V 8s AUDIO OFF";
  } else if (normalized === "fal-ai/veo3.1/fast/first-last-frame-to-video") {
    // Handle duration and audio flag for Veo 3.1 Fast first-last-frame I2V
    const dur = String(meta?.duration ?? "8");
    const hasAudio = meta?.generate_audio !== false; // default ON
    if (dur.startsWith("4"))
      display = hasAudio
        ? "Veo 3.1 Fast I2V 4s AUDIO ON"
        : "Veo 3.1 Fast I2V 4s AUDIO OFF";
    else if (dur.startsWith("6"))
      display = hasAudio
        ? "Veo 3.1 Fast I2V 6s AUDIO ON"
        : "Veo 3.1 Fast I2V 6s AUDIO OFF";
    else
      display = hasAudio
        ? "Veo 3.1 Fast I2V 8s AUDIO ON"
        : "Veo 3.1 Fast I2V 8s AUDIO OFF";
  } else if (normalized === "fal-ai/veo3.1/reference-to-video") {
    // Fix: Handle duration for Veo 3.1 I2V (reference-to-video)
    const dur = String(meta?.duration ?? "8");
    if (dur.startsWith("4")) display = "Veo 3.1 I2V 4s";
    else if (dur.startsWith("6")) display = "Veo 3.1 I2V 6s";
    else display = "Veo 3.1 I2V 8s";
  }
  // Sora 2 mapping using stored meta for duration/resolution
  else if (normalized === "fal-ai/sora-2/image-to-video") {
    const dur = String(meta?.duration ?? "8");
    if (dur.startsWith("4")) display = "Sora 2 I2V 4s";
    else if (dur.startsWith("12")) display = "Sora 2 I2V 12s";
    else display = "Sora 2 I2V 8s";
  } else if (normalized === "fal-ai/sora-2/image-to-video/pro") {
    const dur = String(meta?.duration ?? "8");
    const res =
      String(meta?.resolution ?? "720p").toLowerCase() === "1080p"
        ? "1080p"
        : "720p";
    display = `Sora 2 Pro I2V ${dur}s ${res}`;
  } else if (normalized === "fal-ai/sora-2/text-to-video") {
    const dur = String(meta?.duration ?? "8");
    if (dur.startsWith("4")) display = "Sora 2 T2V 4s";
    else if (dur.startsWith("12")) display = "Sora 2 T2V 12s";
    else display = "Sora 2 T2V 8s";
  } else if (normalized === "fal-ai/sora-2/text-to-video/pro") {
    const dur = String(meta?.duration ?? "8");
    const res =
      String(meta?.resolution ?? "720p").toLowerCase() === "1080p"
        ? "1080p"
        : "720p";
    display = `Sora 2 Pro T2V ${dur}s ${res}`;
  } else if (normalized === "fal-ai/sora-2/video-to-video/remix") {
    // Remix cost equals source Sora SKU; rely on stored source_* meta saved at submission time
    const dur = String(meta?.source_duration ?? meta?.duration ?? "8");
    const res = String(
      meta?.source_resolution ?? meta?.resolution ?? "720p",
    ).toLowerCase();
    const isPro =
      String(meta?.source_is_pro ?? "").toLowerCase() === "true" ||
      res === "1080p";
    if (isPro)
      display = `Sora 2 Pro T2V ${dur}s ${res === "1080p" ? "1080p" : "720p"}`;
    else
      display = dur.startsWith("4")
        ? "Sora 2 T2V 4s"
        : dur.startsWith("12")
          ? "Sora 2 T2V 12s"
          : "Sora 2 T2V 8s";
  } else if (normalized === "fal-ai/ltxv-2/image-to-video") {
    const dur = String(meta?.duration ?? "8");
    const resIn = String(meta?.resolution || "1080p").toLowerCase();
    const res = resIn.includes("2160")
      ? "2160p"
      : resIn.includes("1440")
        ? "1440p"
        : "1080p";
    display = `LTX V2 Pro T2V/I2V ${dur}s ${res}`;
  } else if (normalized === "fal-ai/ltxv-2/image-to-video/fast") {
    const dur = String(meta?.duration ?? "8");
    const resIn = String(meta?.resolution || "1080p").toLowerCase();
    const res = resIn.includes("2160")
      ? "2160p"
      : resIn.includes("1440")
        ? "1440p"
        : "1080p";
    display = `LTX V2 Fast T2V/I2V ${dur}s ${res}`;
  } else if (normalized === "fal-ai/ltxv-2/text-to-video") {
    const dur = String(meta?.duration ?? "8");
    const resIn = String(meta?.resolution || "1080p").toLowerCase();
    const res = resIn.includes("2160")
      ? "2160p"
      : resIn.includes("1440")
        ? "1440p"
        : "1080p";
    display = `LTX V2 Pro T2V/I2V ${dur}s ${res}`;
  } else if (normalized === "fal-ai/ltxv-2/text-to-video/fast") {
    const dur = String(meta?.duration ?? "8");
    const resIn = String(meta?.resolution || "1080p").toLowerCase();
    const res = resIn.includes("2160")
      ? "2160p"
      : resIn.includes("1440")
        ? "1440p"
        : "1080p";
    display = `LTX V2 Fast T2V/I2V ${dur}s ${res}`;
  } else if (
    normalized === "bytedance/seedance-2.0/text-to-video" ||
    normalized === "fal-ai/bytedance/seedance-2.0/text-to-video"
  ) {
    return computeFalSeedance2CostFromMeta(meta, "T2V");
  } else if (
    normalized === "bytedance/seedance-2.0/image-to-video" ||
    normalized === "fal-ai/bytedance/seedance-2.0/image-to-video"
  ) {
    return computeFalSeedance2CostFromMeta(meta, "I2V");
  } else if (
    normalized === "fal-ai/kling-video/o1/standard/image-to-video" ||
    normalized === "fal-ai/kling-video/o1/image-to-video" ||
    // reference-to-video and first-last endpoints should use the same Kling o1 SKUs
    normalized === "fal-ai/kling-video/o1/standard/reference-to-video" ||
    normalized === "fal-ai/kling-video/o1/reference-to-video" ||
    normalized === "fal-ai/kling-video/o1/standard/first-last-frame-to-video" ||
    normalized === "fal-ai/kling-video/o1/first-last-frame-to-video"
  ) {
    const dur = String(meta?.duration ?? "5");
    display = dur.startsWith("10") ? "Kling o1 10s" : "Kling o1 5s";
  } else if (
    normalized === "fal-ai/kling-video/v2.6/pro/text-to-video" ||
    normalized === "fal-ai/kling-video/v2.6/pro/image-to-video"
  ) {
    const dur = String(meta?.duration ?? "5");
    const hasAudio = meta?.generate_audio !== false; // Default to true
    const audioSuffix = hasAudio ? " Audio On" : " Audio Off";
    display = `Kling 2.6 Pro T2V/I2V ${dur}s${audioSuffix}`;
  } else if (
    normalized === "fal-ai/kling-video/v3/standard/text-to-video" ||
    normalized === "fal-ai/kling-video/v3/standard/image-to-video"
  ) {
    return buildKlingV3PricingRecord(
      "standard",
      meta?.duration ?? "5",
      meta || {},
    );
  } else if (
    normalized === "fal-ai/kling-video/v3/pro/text-to-video" ||
    normalized === "fal-ai/kling-video/v3/pro/image-to-video"
  ) {
    return buildKlingV3PricingRecord("pro", meta?.duration ?? "5", meta || {});
  }
  const base = display ? findCredits(display) : null;
  if (base == null) throw new Error("Unsupported FAL queue pricing model");
  return {
    cost: Math.ceil(base),
    pricingVersion: FAL_PRICING_VERSION,
    meta: { model: display },
  };
}

// Image utilities pricing
export async function computeFalImage2SvgCost(_req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const display = "fal-ai/image2svg";
  const base = findCredits(display);
  if (base == null) throw new Error("Unsupported FAL image2svg pricing");
  return {
    cost: Math.ceil(base),
    pricingVersion: FAL_PRICING_VERSION,
    meta: { model: display },
  };
}

export async function computeFalRecraftVectorizeCost(_req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const display = "fal-ai/recraft/vectorize";
  const base = findCredits(display);
  if (base == null)
    throw new Error("Unsupported FAL recraft/vectorize pricing");
  return {
    cost: Math.ceil(base),
    pricingVersion: FAL_PRICING_VERSION,
    meta: { model: display },
  };
}

export async function computeFalQwenMultipleAnglesCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  // Use similar pricing to image generation - can be adjusted based on actual FAL pricing
  const { num_images = 1 } = req.body || {};
  const count = Math.max(1, Math.min(10, Number(num_images)));
  // Use a base cost similar to image edit models (e.g., 100 credits per image)
  const baseCost = 100;
  const cost = Math.ceil(baseCost * count);
  return {
    cost,
    pricingVersion: FAL_PRICING_VERSION,
    meta: { model: "Qwen Multiple Angles", num_images: count },
  };
}

export async function computeFalBriaGenfillCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const display = "fal-ai/bria/genfill";
  const base = findCredits(display);
  if (base == null) throw new Error("Unsupported FAL bria/genfill pricing");
  const body: any = req.body || {};
  const numImages = Number(body?.num_images ?? 1);
  const count =
    Number.isFinite(numImages) && numImages >= 1 && numImages <= 4
      ? Math.round(numImages)
      : 1;
  return {
    cost: Math.ceil(base * count),
    pricingVersion: FAL_PRICING_VERSION,
    meta: { model: display, num_images: count },
  };
}

// SeedVR2 Video Upscaler dynamic pricing
// Rule: $0.001 per megapixel of upscaled video data (width x height x frames)
export async function computeFalSeedVrUpscaleCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const body: any = req.body || {};
  const url: string = body.video_url;
  if (!url) throw new Error("video_url is required");

  // Use validator-stashed probe if available; otherwise probe now
  let meta: any = (req as any).seedvrProbe;
  if (!meta) {
    try {
      meta = await probeVideoMeta(url);
    } catch (probeErr: any) {
      console.warn(
        "[computeFalSeedVrUpscaleCost] Video probe failed, using conservative defaults:",
        probeErr?.message || probeErr,
      );
      meta = {};
    }
  }

  const durationSec = Number(meta?.durationSec || 0);
  const inW = Number(meta?.width || 0);
  const inH = Number(meta?.height || 0);
  let frames = Number(meta?.frames || 0);
  const fps = Number(meta?.fps || 0);

  if (
    (!frames || !isFinite(frames)) &&
    isFinite(durationSec) &&
    isFinite(fps) &&
    fps > 0
  ) {
    frames = Math.round(durationSec * fps);
  }

  // If metadata is incomplete, use conservative defaults for pricing
  // Default: assume 1080p video, 30fps, 10 seconds (max allowed)
  const useDefaults =
    !isFinite(durationSec) ||
    durationSec <= 0 ||
    !isFinite(inW) ||
    !isFinite(inH) ||
    inW <= 0 ||
    inH <= 0 ||
    !isFinite(frames) ||
    frames <= 0;

  if (useDefaults) {
    console.warn(
      "[computeFalSeedVrUpscaleCost] Using conservative default estimates for pricing (metadata unavailable)",
    );
    // Use conservative defaults: 1080p (1920x1080), 30fps, 10 seconds
    const defaultW = 1920;
    const defaultH = 1080;
    const defaultFps = 30;
    const defaultDuration = 10; // Conservative: assume 10 seconds
    const defaultFrames = defaultDuration * defaultFps;

    // Use defaults for calculation
    const mode: "factor" | "target" =
      body.upscale_mode === "target" ? "target" : "factor";
    let outW = defaultW;
    let outH = defaultH;
    if (mode === "factor") {
      const factor = Number(body.upscale_factor ?? 2);
      const f = Math.max(0.1, Math.min(10, isFinite(factor) ? factor : 2));
      outW = Math.max(1, Math.round(defaultW * f));
      outH = Math.max(1, Math.round(defaultH * f));
    } else {
      const target = String(body.target_resolution || "1080p").toLowerCase();
      const map: Record<string, number> = {
        "720p": 720,
        "1080p": 1080,
        "1440p": 1440,
        "2160p": 2160,
      };
      const targetH = map[target] || 1080;
      outH = targetH;
      outW = Math.max(1, Math.round(defaultW * (targetH / defaultH)));
    }
    const totalPixels = outW * outH * defaultFrames;
    const megapixels = totalPixels / 1_000_000;
    const dollars = megapixels * 0.001;
    const credits = Math.max(1, Math.ceil(dollars * CREDITS_PER_USD));

    return {
      cost: credits,
      pricingVersion: FAL_PRICING_VERSION,
      meta: {
        model: "fal-ai/seedvr/upscale/video",
        input: {
          width: defaultW,
          height: defaultH,
          durationSec: defaultDuration,
          fps: defaultFps,
          frames: defaultFrames,
          estimated: true,
        },
        output: { width: outW, height: outH, frames: defaultFrames },
        pricing: { megapixels, dollars, credits },
        mode,
        upscale_factor:
          mode === "factor" ? Number(body.upscale_factor ?? 2) : undefined,
        target_resolution:
          mode === "target" ? body.target_resolution || "1080p" : undefined,
        note: "Pricing based on conservative estimates (video metadata unavailable)",
      },
    };
  }

  if (durationSec > 30.5)
    throw new Error(
      "Input video too long. Maximum allowed duration is 30 seconds.",
    );
  // Compute output dimensions based on requested mode
  const mode: "factor" | "target" =
    body.upscale_mode === "target" ? "target" : "factor";
  let outW = inW;
  let outH = inH;
  if (mode === "factor") {
    const factor = Number(body.upscale_factor ?? 2);
    const f = Math.max(0.1, Math.min(10, isFinite(factor) ? factor : 2));
    outW = Math.max(1, Math.round(inW * f));
    outH = Math.max(1, Math.round(inH * f));
  } else {
    const target = String(body.target_resolution || "1080p").toLowerCase();
    const map: Record<string, number> = {
      "720p": 720,
      "1080p": 1080,
      "1440p": 1440,
      "2160p": 2160,
    };
    const targetH = map[target] || 1080;
    outH = targetH;
    outW = Math.max(1, Math.round(inW * (targetH / inH)));
  }
  const totalPixels = outW * outH * frames;
  const megapixels = totalPixels / 1_000_000;
  const dollars = megapixels * 0.001;
  const credits = Math.max(1, Math.ceil(dollars * CREDITS_PER_USD));
  return {
    cost: credits,
    pricingVersion: FAL_PRICING_VERSION,
    meta: {
      model: "fal-ai/seedvr/upscale/video",
      input: { width: inW, height: inH, durationSec, fps, frames },
      output: { width: outW, height: outH, frames },
      pricing: { megapixels, dollars, credits },
      mode,
      upscale_factor:
        mode === "factor" ? Number(body.upscale_factor ?? 2) : undefined,
      target_resolution:
        mode === "target" ? body.target_resolution || "1080p" : undefined,
    },
  };
}

// BiRefNet v2 Background Removal pricing: similar to SeedVR (per output megapixel)
export async function computeFalBirefnetVideoCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const body: any = req.body || {};
  let url: string | undefined = body.video_url;
  // Handle data URI videos: upload to Zata to get a public URL for probing
  if (
    !url &&
    typeof body.video === "string" &&
    body.video.startsWith("data:")
  ) {
    try {
      const uid = (req as any)?.uid || "anon";
      const stored = await uploadDataUriToZata({
        dataUri: body.video,
        keyPrefix: `users/${uid}/pricing/birefnet/${Date.now()}`,
        fileName: "source",
      });
      url = stored.publicUrl;
    } catch {
      url = undefined;
    }
  }
  if (!url) throw new Error("video_url or video (data URI) is required");

  // Use validator-stashed probe if available; otherwise probe now
  let meta: any = (req as any).birefnetProbe;
  if (!meta) {
    try {
      meta = await probeVideoMeta(url);
    } catch (probeErr: any) {
      console.warn(
        "[computeFalBirefnetVideoCost] Video probe failed, using conservative defaults:",
        probeErr?.message || probeErr,
      );
      meta = {};
    }
  }

  const durationSec = Number(meta?.durationSec || 0);
  const inW = Number(meta?.width || 0);
  const inH = Number(meta?.height || 0);
  let frames = Number(meta?.frames || 0);
  const fps = Number(meta?.fps || 0);
  if (
    (!frames || !isFinite(frames)) &&
    isFinite(durationSec) &&
    isFinite(fps) &&
    fps > 0
  ) {
    frames = Math.round(durationSec * fps);
  }

  // If metadata is incomplete, use conservative defaults for pricing
  // Default: assume 1080p video, 30fps, 10 seconds (max allowed)
  const useDefaults =
    !isFinite(durationSec) ||
    durationSec <= 0 ||
    !isFinite(inW) ||
    !isFinite(inH) ||
    inW <= 0 ||
    inH <= 0 ||
    !isFinite(frames) ||
    frames <= 0;

  if (useDefaults) {
    console.warn(
      "[computeFalBirefnetVideoCost] Using conservative default estimates for pricing (metadata unavailable)",
    );
    // Use conservative defaults: 1080p (1920x1080), 30fps, 10 seconds
    const defaultW = 1920;
    const defaultH = 1080;
    const defaultFps = 30;
    const defaultDuration = 10; // Conservative: assume 10 seconds
    const defaultFrames = defaultDuration * defaultFps;

    // Assume output same resolution as input for pricing purposes
    const outW = defaultW;
    const outH = defaultH;
    const totalPixels = outW * outH * defaultFrames;
    const megapixels = totalPixels / 1_000_000;
    const dollars = megapixels * 0.001;
    const credits = Math.max(1, Math.ceil(dollars * CREDITS_PER_USD));

    return {
      cost: credits,
      pricingVersion: FAL_PRICING_VERSION,
      meta: {
        model: "fal-ai/birefnet/v2/video",
        input: {
          width: defaultW,
          height: defaultH,
          durationSec: defaultDuration,
          fps: defaultFps,
          frames: defaultFrames,
          estimated: true,
        },
        output: { width: outW, height: outH, frames: defaultFrames },
        pricing: { megapixels, dollars, credits },
        params: {
          model: body.model,
          operating_resolution: body.operating_resolution,
          output_mask: body.output_mask,
          refine_foreground: body.refine_foreground,
          video_output_type: body.video_output_type,
          video_quality: body.video_quality,
          video_write_mode: body.video_write_mode,
        },
        note: "Pricing based on conservative estimates (video metadata unavailable)",
      },
    };
  }

  // Assume output same resolution as input for pricing purposes
  const outW = inW;
  const outH = inH;
  const totalPixels = outW * outH * frames;
  const megapixels = totalPixels / 1_000_000;
  const dollars = megapixels * 0.001;
  const credits = Math.max(1, Math.ceil(dollars * CREDITS_PER_USD));
  return {
    cost: credits,
    pricingVersion: FAL_PRICING_VERSION,
    meta: {
      model: "fal-ai/birefnet/v2/video",
      input: { width: inW, height: inH, durationSec, fps, frames },
      output: { width: outW, height: outH, frames },
      pricing: { megapixels, dollars, credits },
      params: {
        model: body.model,
        operating_resolution: body.operating_resolution,
        output_mask: body.output_mask,
        refine_foreground: body.refine_foreground,
        video_output_type: body.video_output_type,
        video_quality: body.video_quality,
        video_write_mode: body.video_write_mode,
      },
    },
  };
}

// Topaz Image Upscaler tier pricing
// Rule: <=24MP => 64, <=48MP => 128, <=96MP => 256, <=512MP (and above) => 1087
export async function computeFalTopazUpscaleImageCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const body: any = req.body || {};
  let url: string | undefined = body.image_url;
  // Allow data URI input (image); upload to Zata to obtain a public URL for probing
  if (
    !url &&
    typeof body.image === "string" &&
    body.image.startsWith("data:")
  ) {
    try {
      const uid = (req as any)?.uid || "anon";
      const stored = await uploadDataUriToZata({
        dataUri: body.image,
        keyPrefix: `users/${uid}/pricing/topaz/${Date.now()}`,
        fileName: "source",
      });
      url = stored.publicUrl;
    } catch {
      url = undefined;
    }
  }
  if (!url) throw new Error("image_url is required");
  const meta = (req as any).topazImageProbe || (await probeImageMeta(url));
  const inW = Number(meta?.width || 0);
  const inH = Number(meta?.height || 0);
  if (!isFinite(inW) || !isFinite(inH) || inW <= 0 || inH <= 0)
    throw new Error("Unable to compute image dimensions for pricing");
  const factor = Math.max(0.1, Math.min(10, Number(body.upscale_factor ?? 2)));
  const outW = Math.max(1, Math.round(inW * factor));
  const outH = Math.max(1, Math.round(inH * factor));
  const megapixels = (outW * outH) / 1_000_000;
  const tier =
    megapixels <= 24
      ? "24MP"
      : megapixels <= 48
        ? "48MP"
        : megapixels <= 96
          ? "96MP"
          : "512MP";
  const credits =
    tier === "24MP" ? 64 : tier === "48MP" ? 128 : tier === "96MP" ? 256 : 1087;
  return {
    cost: credits,
    pricingVersion: FAL_PRICING_VERSION,
    meta: {
      model: "fal-ai/topaz/upscale/image",
      input: { width: inW, height: inH },
      output: { width: outW, height: outH },
      pricing: { megapixels, tier, credits },
      upscale_factor: factor,
      topaz_model: body.model,
    },
  };
}

// SeedVR Image Upscaler (factor-only pricing)
// Rule: 1 credit per output megapixel (width x height / 1e6), rounded up.
// NOTE: target_resolution-based upscaling is explicitly forbidden for this integration.
export async function computeFalSeedVrUpscaleImageCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const body: any = req.body || {};

  // Enforce factor-only mode
  const upscaleModeRaw = body.upscale_mode;
  if (
    upscaleModeRaw != null &&
    String(upscaleModeRaw).toLowerCase() !== "factor"
  ) {
    throw new Error('upscale_mode must be "factor"');
  }
  if (body.target_resolution != null) {
    throw new Error("target_resolution is not supported for this endpoint");
  }

  let url: string | undefined = body.image_url;
  // Allow data URI input (image); upload to Zata to obtain a public URL for probing
  if (
    !url &&
    typeof body.image === "string" &&
    body.image.startsWith("data:")
  ) {
    try {
      const uid = (req as any)?.uid || "anon";
      const stored = await uploadDataUriToZata({
        dataUri: body.image,
        keyPrefix: `users/${uid}/pricing/seedvr-image/${Date.now()}`,
        fileName: "source",
      });
      url = stored.publicUrl;
    } catch {
      url = undefined;
    }
  }
  if (!url) throw new Error("image_url is required");

  const meta = (req as any).seedvrImageProbe || (await probeImageMeta(url));
  const inW = Number(meta?.width || 0);
  const inH = Number(meta?.height || 0);
  if (!isFinite(inW) || !isFinite(inH) || inW <= 0 || inH <= 0) {
    throw new Error("Unable to compute image dimensions for pricing");
  }

  const factor = Math.max(1, Math.min(10, Number(body.upscale_factor ?? 2)));
  const outW = Math.max(1, Math.round(inW * factor));
  const outH = Math.max(1, Math.round(inH * factor));

  const megapixels = (outW * outH) / 1_000_000;
  const creditsPerMp = 1;
  const credits = Math.max(1, Math.ceil(megapixels * creditsPerMp));

  return {
    cost: credits,
    pricingVersion: FAL_PRICING_VERSION,
    meta: {
      model: "fal-ai/seedvr/upscale/image",
      input: { width: inW, height: inH },
      output: { width: outW, height: outH },
      pricing: { megapixels, creditsPerMp, credits },
      upscale_mode: "factor",
      upscale_factor: factor,
      noise_scale: body.noise_scale,
      output_format: body.output_format,
    },
  };
}

// ElevenLabs TTS pricing based on character count
export async function computeFalElevenTtsCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const { text } = req.body || {};
  if (!text || typeof text !== "string") {
    throw new Error("text is required for ElevenLabs TTS pricing");
  }

  const charCount = text.length;
  let display: string;
  let cost: number | null;

  if (charCount <= 1000) {
    display = "Elevenlabs Eleven v3 TTS 1000 Characters";
    cost = findCredits(display);
  } else if (charCount <= 2000) {
    display = "Elevenlabs Eleven v3 TTS 2000 Characters";
    cost = findCredits(display);
  } else {
    // For >2000 characters, use 2000 character pricing (shouldn't happen with validation, but handle gracefully)
    display = "Elevenlabs Eleven v3 TTS 2000 Characters";
    cost = findCredits(display);
  }

  if (cost == null) {
    throw new Error(
      `Unsupported ElevenLabs TTS pricing for ${charCount} characters`,
    );
  }

  return {
    cost,
    pricingVersion: FAL_PRICING_VERSION,
    meta: {
      model: display,
      characterCount: charCount,
    },
  };
}

// ElevenLabs Dialogue pricing based on total character count across all inputs
export async function computeFalElevenDialogueCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const { inputs } = req.body || {};
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error("inputs array is required for ElevenLabs Dialogue pricing");
  }

  // Calculate total character count across all inputs
  const totalCharCount = inputs.reduce((sum, input) => {
    const text = input?.text || "";
    return sum + (typeof text === "string" ? text.length : 0);
  }, 0);

  let display: string;
  let cost: number | null;

  if (totalCharCount <= 1000) {
    display = "Elevenlabs Eleven v3 TTD 1000 Characters";
    cost = findCredits(display);
  } else if (totalCharCount <= 2000) {
    display = "Elevenlabs Eleven v3 TTD 2000 Characters";
    cost = findCredits(display);
  } else {
    // For >2000 characters, use 2000 character pricing (shouldn't happen with validation, but handle gracefully)
    display = "Elevenlabs Eleven v3 TTD 2000 Characters";
    cost = findCredits(display);
  }

  if (cost == null) {
    throw new Error(
      `Unsupported ElevenLabs Dialogue pricing for ${totalCharCount} characters`,
    );
  }

  return {
    cost,
    pricingVersion: FAL_PRICING_VERSION,
    meta: {
      model: display,
      totalCharacterCount: totalCharCount,
      inputCount: inputs.length,
    },
  };
}

// Chatterbox Multilingual TTS pricing based on character count
export async function computeFalChatterboxMultilingualCost(
  req: Request,
): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const { text } = req.body || {};
  if (!text || typeof text !== "string") {
    throw new Error("text is required for Chatterbox Multilingual TTS pricing");
  }

  const charCount = text.length;
  let display: string;
  let cost: number | null;

  if (charCount <= 1000) {
    display = "Chatter Box Multilingual 1000 Characters";
    cost = findCredits(display);
  } else if (charCount <= 2000) {
    display = "Chatter Box Multilingual 2000 Characters";
    cost = findCredits(display);
  } else {
    // For >2000 characters, use 2000 character pricing (shouldn't happen with validation, but handle gracefully)
    display = "Chatter Box Multilingual 2000 Characters";
    cost = findCredits(display);
  }

  if (cost == null) {
    throw new Error(
      `Unsupported Chatterbox Multilingual TTS pricing for ${charCount} characters`,
    );
  }

  return {
    cost,
    pricingVersion: FAL_PRICING_VERSION,
    meta: {
      model: display,
      characterCount: charCount,
    },
  };
}

// Maya TTS pricing based on estimated duration (6 credits per second)
// We estimate duration based on text length: ~150 words per minute = ~2.5 words/second
// Average word length is ~5 characters, so ~12.5 characters per second
// Based on actual testing, Maya TTS generates audio at approximately 15 characters per second
// We use 15 characters per second for more accurate estimation
export async function computeFalMayaTtsCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const { text } = req.body || {};
  if (!text || typeof text !== "string") {
    throw new Error("text is required for Maya TTS pricing");
  }

  // Estimate duration: ~15 characters per second (more accurate based on actual audio generation)
  // Minimum 1 second
  const estimatedDuration = Math.max(1, Math.ceil(text.length / 15));
  const creditsPerSecond = 6;
  const cost = estimatedDuration * creditsPerSecond;

  return {
    cost,
    pricingVersion: FAL_PRICING_VERSION,
    meta: {
      model: "Maya TTS (per second)",
      estimatedDuration,
      creditsPerSecond,
      characterCount: text.length,
      note: "Cost calculated based on estimated duration from text length",
    },
  };
}

// ElevenLabs SFX pricing based on duration_seconds (6 credits per second)
export async function computeFalElevenSfxCost(req: Request): Promise<{
  cost: number;
  pricingVersion: string;
  meta: Record<string, any>;
}> {
  const { duration_seconds } = req.body || {};

  // Default to 5 seconds if not provided (matches frontend default)
  const duration = duration_seconds != null ? Number(duration_seconds) : 5.0;

  // Ensure minimum 0.5 seconds and maximum 22 seconds (FAL API limits)
  const clampedDuration = Math.max(0.5, Math.min(22, duration));

  // Round up to nearest second for pricing
  const durationSeconds = Math.ceil(clampedDuration);
  const creditsPerSecond = 6;
  const cost = durationSeconds * creditsPerSecond;

  return {
    cost,
    pricingVersion: FAL_PRICING_VERSION,
    meta: {
      model: "Elevenlabs Sound-Effects v2 (6 credits per second)",
      durationSeconds,
      creditsPerSecond,
      requestedDuration: duration,
      clampedDuration: clampedDuration,
    },
  };
}
