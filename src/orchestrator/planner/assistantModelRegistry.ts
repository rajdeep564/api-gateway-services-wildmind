import type { PlanTaskType, PlanStep, ExecutionPlan } from "./plannerTypes";

export interface AssistantModelConfig {
  aspectRatios?: string[];
  resolutions?: string[];
  durations?: number[];
  styles?: string[];
  quality?: string[];
  supportsReferenceImage?: boolean;
  supportsNegativePrompt?: boolean;
}

export interface AssistantModel {
  /** What user/assistant refers to it as */
  id: string;
  /** Display name shown to user */
  label: string;
  /** FAL | Replicate | Runway | MiniMax | BFL (string to avoid tight coupling) */
  provider: string;
  /** Planner task types this model can serve */
  taskTypes: PlanTaskType[];
  /** WorkflowEngine step service */
  service: PlanStep["service"];
  /** Internal route called by WorkflowEngine */
  endpoint: string;
  /** Exact value passed as params.model */
  modelParam: string;
  /** Base credit cost (per generation) */
  creditCost: number;
  /** UI-configurable options */
  configOptions: AssistantModelConfig;
  enabled: boolean;
}

export const ASSISTANT_MODEL_REGISTRY: AssistantModel[] = [
  // ── IMAGE (FAL) ────────────────────────────────────────────────────────────
  {
    id: "google/nano-banana-pro",
    label: "Nano Banana Pro",
    provider: "FAL",
    taskTypes: ["image"],
    service: "fal_image",
    endpoint: "/api/fal/generate",
    modelParam: "google/nano-banana-pro",
    creditCost: 100,
    enabled: true,
    configOptions: {
      aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
      resolutions: ["1K", "2K"],
      supportsReferenceImage: true,
      supportsNegativePrompt: false,
    },
  },
  {
    id: "gemini-25-flash-image",
    label: "Gemini 2.5 Flash Image",
    provider: "FAL",
    taskTypes: ["image"],
    service: "fal_image",
    endpoint: "/api/fal/generate",
    modelParam: "gemini-25-flash-image",
    creditCost: 80,
    enabled: true,
    configOptions: {
      aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
      supportsReferenceImage: true,
      supportsNegativePrompt: false,
    },
  },
  {
    id: "flux-2-pro",
    label: "Flux 2 Pro",
    provider: "FAL",
    taskTypes: ["image"],
    service: "fal_image",
    endpoint: "/api/fal/generate",
    modelParam: "fal-ai/flux-2-pro",
    creditCost: 150,
    enabled: true,
    configOptions: {
      aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
      resolutions: ["1K", "2K"],
      supportsReferenceImage: true,
      supportsNegativePrompt: false,
    },
  },
  {
    id: "imagen-4",
    label: "Imagen 4",
    provider: "FAL",
    taskTypes: ["image"],
    service: "fal_image",
    endpoint: "/api/fal/generate",
    modelParam: "imagen-4",
    creditCost: 120,
    enabled: true,
    configOptions: {
      resolutions: ["1K", "2K"],
      supportsReferenceImage: false,
      supportsNegativePrompt: true,
    },
  },
  {
    id: "imagen-4-fast",
    label: "Imagen 4 Fast",
    provider: "FAL",
    taskTypes: ["image"],
    service: "fal_image",
    endpoint: "/api/fal/generate",
    modelParam: "imagen-4-fast",
    creditCost: 100,
    enabled: true,
    configOptions: {
      resolutions: ["1K", "2K"],
      supportsReferenceImage: false,
      supportsNegativePrompt: true,
    },
  },
  {
    id: "imagen-4-ultra",
    label: "Imagen 4 Ultra",
    provider: "FAL",
    taskTypes: ["image"],
    service: "fal_image",
    endpoint: "/api/fal/generate",
    modelParam: "imagen-4-ultra",
    creditCost: 160,
    enabled: true,
    configOptions: {
      resolutions: ["1K", "2K"],
      supportsReferenceImage: false,
      supportsNegativePrompt: true,
    },
  },
  {
    id: "seedream-4.5",
    label: "Seedream v4.5",
    provider: "FAL",
    taskTypes: ["image"],
    service: "fal_image",
    endpoint: "/api/fal/generate",
    modelParam: "seedream-4.5",
    creditCost: 80,
    enabled: true,
    configOptions: {
      aspectRatios: ["1:1", "16:9", "9:16"],
      supportsReferenceImage: true,
      supportsNegativePrompt: true,
    },
  },
  {
    id: "seedream-v4",
    label: "Seedream v4",
    provider: "FAL",
    taskTypes: ["image"],
    service: "fal_image",
    endpoint: "/api/fal/generate",
    modelParam: "seedream-v4",
    creditCost: 70,
    enabled: true,
    configOptions: {
      aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
      supportsReferenceImage: false,
      supportsNegativePrompt: true,
    },
  },
  {
    id: "flux-pro-v1.1",
    label: "Flux Pro v1.1",
    provider: "FAL",
    taskTypes: ["image"],
    service: "fal_image_pro",
    endpoint: "/api/fal/generate",
    modelParam: "fal-ai/flux-pro/v1.1",
    creditCost: 200,
    enabled: false,
    configOptions: {
      aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
      supportsReferenceImage: false,
      supportsNegativePrompt: false,
    },
  },
  {
    id: "flux-pro-v1.1-ultra",
    label: "Flux Pro v1.1 Ultra",
    provider: "FAL",
    taskTypes: ["image"],
    service: "fal_image_pro",
    endpoint: "/api/fal/generate",
    modelParam: "fal-ai/flux-pro/v1.1-ultra",
    creditCost: 220,
    enabled: false,
    configOptions: {
      aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
      supportsReferenceImage: false,
      supportsNegativePrompt: false,
    },
  },

  // ── IMAGE (Replicate) ─────────────────────────────────────────────────────
  {
    id: "openai/gpt-image-1.5",
    label: "GPT Image 1.5",
    provider: "Replicate",
    taskTypes: ["image"],
    service: "replicate_image",
    endpoint: "/api/replicate/generate",
    modelParam: "openai/gpt-image-1.5",
    creditCost: 200,
    enabled: true,
    configOptions: {
      quality: ["auto", "low", "medium", "high"],
      supportsReferenceImage: false,
      supportsNegativePrompt: false,
    },
  },
  {
    id: "new-turbo-model",
    label: "z-image-turbo",
    provider: "Replicate",
    taskTypes: ["image"],
    service: "replicate_image",
    endpoint: "/api/replicate/generate",
    modelParam: "z-image-turbo",
    creditCost: 50,
    enabled: true,
    configOptions: {
      aspectRatios: ["1:1", "16:9", "9:16"],
      supportsReferenceImage: false,
      supportsNegativePrompt: false,
    },
  },
  {
    id: "prunaai/p-image",
    label: "P-Image",
    provider: "Replicate",
    taskTypes: ["image"],
    service: "replicate_image",
    endpoint: "/api/replicate/generate",
    modelParam: "prunaai/p-image",
    creditCost: 120,
    enabled: true,
    configOptions: {
      aspectRatios: ["1:1", "16:9", "9:16"],
      supportsReferenceImage: false,
      supportsNegativePrompt: true,
    },
  },

  // ── IMAGE (BFL) ───────────────────────────────────────────────────────────
  {
    id: "bfl/flux-dev",
    label: "BFL Flux Dev",
    provider: "BFL",
    taskTypes: ["image"],
    service: "bfl_image",
    endpoint: "/api/bfl/generate",
    modelParam: "flux-dev",
    creditCost: 100,
    enabled: true,
    configOptions: {
      aspectRatios: ["1:1", "3:4", "4:3", "16:9", "9:16", "3:2", "2:3", "21:9", "9:21", "16:10", "10:16"],
      supportsReferenceImage: true,
      supportsNegativePrompt: false,
    },
  },
  {
    id: "bfl/flux-pro",
    label: "BFL Flux Pro",
    provider: "BFL",
    taskTypes: ["image"],
    service: "bfl_image",
    endpoint: "/api/bfl/generate",
    modelParam: "flux-pro",
    creditCost: 150,
    enabled: true,
    configOptions: {
      aspectRatios: ["1:1", "3:4", "4:3", "16:9", "9:16", "3:2", "2:3", "21:9", "9:21", "16:10", "10:16"],
      supportsReferenceImage: true,
      supportsNegativePrompt: false,
    },
  },
  {
    id: "bfl/flux-pro-1.1",
    label: "BFL Flux Pro 1.1",
    provider: "BFL",
    taskTypes: ["image"],
    service: "bfl_image",
    endpoint: "/api/bfl/generate",
    modelParam: "flux-pro-1.1",
    creditCost: 180,
    enabled: true,
    configOptions: {
      aspectRatios: ["1:1", "3:4", "4:3", "16:9", "9:16", "3:2", "2:3", "21:9", "9:21", "16:10", "10:16"],
      supportsReferenceImage: true,
      supportsNegativePrompt: false,
    },
  },
  {
    id: "bfl/flux-pro-1.1-ultra",
    label: "BFL Flux Pro 1.1 Ultra",
    provider: "BFL",
    taskTypes: ["image"],
    service: "bfl_image",
    endpoint: "/api/bfl/generate",
    modelParam: "flux-pro-1.1-ultra",
    creditCost: 220,
    enabled: true,
    configOptions: {
      aspectRatios: ["1:1", "3:4", "4:3", "16:9", "9:16", "3:2", "2:3", "21:9", "9:21", "16:10", "10:16"],
      supportsReferenceImage: true,
      supportsNegativePrompt: false,
    },
  },
  {
    id: "bfl/flux-kontext-pro",
    label: "BFL Flux Kontext Pro",
    provider: "BFL",
    taskTypes: ["image"],
    service: "bfl_image",
    endpoint: "/api/bfl/generate",
    modelParam: "flux-kontext-pro",
    creditCost: 150,
    enabled: true,
    configOptions: {
      aspectRatios: ["1:1", "3:4", "4:3", "16:9", "9:16", "3:2", "2:3", "21:9", "9:21", "16:10", "10:16"],
      supportsReferenceImage: true,
      supportsNegativePrompt: false,
    },
  },
  {
    id: "bfl/flux-kontext-max",
    label: "BFL Flux Kontext Max",
    provider: "BFL",
    taskTypes: ["image"],
    service: "bfl_image",
    endpoint: "/api/bfl/generate",
    modelParam: "flux-kontext-max",
    creditCost: 200,
    enabled: true,
    configOptions: {
      aspectRatios: ["1:1", "3:4", "4:3", "16:9", "9:16", "3:2", "2:3", "21:9", "9:21", "16:10", "10:16"],
      supportsReferenceImage: true,
      supportsNegativePrompt: false,
    },
  },

  // ── VIDEO (FAL queue submit routes) ────────────────────────────────────────
  {
    id: "veo3-t2v",
    label: "Veo 3 (T2V)",
    provider: "FAL",
    taskTypes: ["video"],
    service: "fal_video",
    endpoint: "/api/fal/veo3/text-to-video/submit",
    modelParam: "fal-ai/veo3",
    creditCost: 400,
    enabled: true,
    configOptions: {
      aspectRatios: ["16:9", "9:16", "1:1"],
      durations: [4, 6, 8],
      supportsNegativePrompt: true,
    },
  },
  {
    id: "veo3-t2v-fast",
    label: "Veo 3 Fast (T2V)",
    provider: "FAL",
    taskTypes: ["video"],
    service: "fal_video",
    endpoint: "/api/fal/veo3/text-to-video/fast/submit",
    modelParam: "fal-ai/veo3/fast",
    creditCost: 400,
    enabled: true,
    configOptions: {
      aspectRatios: ["16:9", "9:16", "1:1"],
      durations: [4, 6, 8],
      supportsNegativePrompt: true,
    },
  },
  {
    id: "veo3-i2v",
    label: "Veo 3 (I2V)",
    provider: "FAL",
    taskTypes: ["video"],
    service: "fal_video",
    endpoint: "/api/fal/veo3/image-to-video/submit",
    modelParam: "fal-ai/veo3/image-to-video",
    creditCost: 400,
    enabled: true,
    configOptions: {
      aspectRatios: ["auto", "16:9", "9:16"],
      durations: [4, 6, 8],
      supportsReferenceImage: true,
    },
  },
  {
    id: "veo3-i2v-fast",
    label: "Veo 3 Fast (I2V)",
    provider: "FAL",
    taskTypes: ["video"],
    service: "fal_video",
    endpoint: "/api/fal/veo3/image-to-video/fast/submit",
    modelParam: "fal-ai/veo3/fast/image-to-video",
    creditCost: 400,
    enabled: true,
    configOptions: {
      aspectRatios: ["auto", "16:9", "9:16"],
      durations: [4, 6, 8],
      supportsReferenceImage: true,
    },
  },
  {
    id: "veo3.1-t2v-8s",
    label: "Veo 3.1 (T2V)",
    provider: "FAL",
    taskTypes: ["video"],
    service: "fal_video",
    endpoint: "/api/fal/veo3_1/text-to-video/submit",
    modelParam: "fal-ai/veo3.1",
    creditCost: 450,
    enabled: true,
    configOptions: {
      aspectRatios: ["16:9", "9:16", "1:1"],
      durations: [4, 6, 8],
    },
  },
  {
    id: "veo3.1-t2v-fast",
    label: "Veo 3.1 Fast (T2V)",
    provider: "FAL",
    taskTypes: ["video"],
    service: "fal_video",
    endpoint: "/api/fal/veo3_1/text-to-video/fast/submit",
    modelParam: "fal-ai/veo3.1/fast",
    creditCost: 450,
    enabled: true,
    configOptions: {
      aspectRatios: ["16:9", "9:16", "1:1"],
      durations: [4, 6, 8],
    },
  },
  {
    id: "veo3.1-i2v",
    label: "Veo 3.1 (I2V)",
    provider: "FAL",
    taskTypes: ["video"],
    service: "fal_video",
    endpoint: "/api/fal/veo3_1/image-to-video/submit",
    modelParam: "fal-ai/veo3.1/image-to-video",
    creditCost: 450,
    enabled: true,
    configOptions: {
      aspectRatios: ["auto", "16:9", "9:16"],
      durations: [4, 6, 8],
      supportsReferenceImage: true,
    },
  },
  {
    id: "veo3.1-i2v-fast",
    label: "Veo 3.1 Fast (I2V)",
    provider: "FAL",
    taskTypes: ["video"],
    service: "fal_video",
    endpoint: "/api/fal/veo3_1/image-to-video/fast/submit",
    modelParam: "fal-ai/veo3.1/fast/image-to-video",
    creditCost: 450,
    enabled: true,
    configOptions: {
      aspectRatios: ["auto", "16:9", "9:16"],
      durations: [4, 6, 8],
      supportsReferenceImage: true,
    },
  },
  {
    id: "veo3.1-first-last-fast",
    label: "Veo 3.1 Fast (First/Last)",
    provider: "FAL",
    taskTypes: ["video"],
    service: "fal_video",
    endpoint: "/api/fal/veo3_1/first-last/fast/submit",
    modelParam: "fal-ai/veo3.1/fast/first-last-frame-to-video",
    creditCost: 450,
    enabled: true,
    configOptions: { durations: [4, 6, 8], supportsReferenceImage: true },
  },
  {
    id: "veo3.1-first-last",
    label: "Veo 3.1 (First/Last)",
    provider: "FAL",
    taskTypes: ["video"],
    service: "fal_video",
    endpoint: "/api/fal/veo3_1/first-last/submit",
    modelParam: "fal-ai/veo3.1/first-last-frame-to-video",
    creditCost: 450,
    enabled: true,
    configOptions: { durations: [4, 6, 8], supportsReferenceImage: true },
  },
  {
    id: "veo3.1-reference-to-video",
    label: "Veo 3.1 (Reference-to-Video)",
    provider: "FAL",
    taskTypes: ["video"],
    service: "fal_video",
    endpoint: "/api/fal/veo3_1/reference-to-video/submit",
    modelParam: "fal-ai/veo3.1/reference-to-video",
    creditCost: 450,
    enabled: true,
    configOptions: { durations: [4, 6, 8], supportsReferenceImage: true },
  },
  {
    id: "sora2-pro-t2v",
    label: "Sora 2 Pro (T2V)",
    provider: "FAL",
    taskTypes: ["video"],
    service: "fal_video",
    endpoint: "/api/fal/sora2/text-to-video/pro/submit",
    modelParam: "fal-ai/sora-2/text-to-video/pro",
    creditCost: 600,
    enabled: true,
    configOptions: { durations: [4, 8, 12] },
  },
  {
    id: "sora2-t2v",
    label: "Sora 2 (T2V)",
    provider: "FAL",
    taskTypes: ["video"],
    service: "fal_video",
    endpoint: "/api/fal/sora2/text-to-video/submit",
    modelParam: "fal-ai/sora-2/text-to-video",
    creditCost: 500,
    enabled: true,
    configOptions: { durations: [4, 8, 12] },
  },
  {
    id: "sora2-i2v",
    label: "Sora 2 (I2V)",
    provider: "FAL",
    taskTypes: ["video"],
    service: "fal_video",
    endpoint: "/api/fal/sora2/image-to-video/submit",
    modelParam: "fal-ai/sora-2/image-to-video",
    creditCost: 500,
    enabled: true,
    configOptions: { durations: [4, 8, 12], supportsReferenceImage: true },
  },
  {
    id: "sora2-pro-i2v",
    label: "Sora 2 Pro (I2V)",
    provider: "FAL",
    taskTypes: ["video"],
    service: "fal_video",
    endpoint: "/api/fal/sora2/image-to-video/pro/submit",
    modelParam: "fal-ai/sora-2/image-to-video/pro",
    creditCost: 600,
    enabled: true,
    configOptions: { durations: [4, 8, 12], supportsReferenceImage: true },
  },
  {
    id: "sora2-remix-v2v",
    label: "Sora 2 Remix (V2V)",
    provider: "FAL",
    taskTypes: ["video"],
    service: "fal_video",
    endpoint: "/api/fal/sora2/video-to-video/remix/submit",
    modelParam: "fal-ai/sora-2/video-to-video/remix",
    creditCost: 500,
    enabled: true,
    configOptions: {},
  },
  {
    id: "ltx2-pro-i2v",
    label: "LTX V2 Pro (I2V)",
    provider: "FAL",
    taskTypes: ["video"],
    service: "fal_video",
    endpoint: "/api/fal/ltx2/image-to-video/pro/submit",
    modelParam: "fal-ai/ltxv-2/image-to-video",
    creditCost: 450,
    enabled: true,
    configOptions: { durations: [8], supportsReferenceImage: true },
  },
  {
    id: "ltx2-fast-i2v",
    label: "LTX V2 Fast (I2V)",
    provider: "FAL",
    taskTypes: ["video"],
    service: "fal_video",
    endpoint: "/api/fal/ltx2/image-to-video/fast/submit",
    modelParam: "fal-ai/ltxv-2/image-to-video/fast",
    creditCost: 400,
    enabled: true,
    configOptions: { durations: [8], supportsReferenceImage: true },
  },
  {
    id: "ltx2-pro-t2v",
    label: "LTX V2 Pro (T2V)",
    provider: "FAL",
    taskTypes: ["video"],
    service: "fal_video",
    endpoint: "/api/fal/ltx2/text-to-video/pro/submit",
    modelParam: "fal-ai/ltxv-2/text-to-video",
    creditCost: 450,
    enabled: true,
    configOptions: { durations: [8] },
  },
  {
    id: "ltx2-fast-t2v",
    label: "LTX V2 Fast (T2V)",
    provider: "FAL",
    taskTypes: ["video"],
    service: "fal_video",
    endpoint: "/api/fal/ltx2/text-to-video/fast/submit",
    modelParam: "fal-ai/ltxv-2/text-to-video/fast",
    creditCost: 400,
    enabled: true,
    configOptions: { durations: [8] },
  },
  {
    id: "kling-o1-first-last",
    label: "Kling o1 (First/Last)",
    provider: "FAL",
    taskTypes: ["video"],
    service: "fal_video",
    endpoint: "/api/fal/kling-o1/first-last-frame-to-video/submit",
    modelParam: "fal-ai/kling-video/o1/first-last-frame-to-video",
    creditCost: 350,
    enabled: true,
    configOptions: { durations: [5, 10], supportsReferenceImage: true },
  },
  {
    id: "kling-o1-reference",
    label: "Kling o1 (Reference)",
    provider: "FAL",
    taskTypes: ["video"],
    service: "fal_video",
    endpoint: "/api/fal/kling-o1/reference-to-video/submit",
    modelParam: "fal-ai/kling-video/o1/reference-to-video",
    creditCost: 350,
    enabled: true,
    configOptions: { durations: [5, 10], supportsReferenceImage: true },
  },
  {
    id: "kling-2.6-pro-i2v",
    label: "Kling 2.6 Pro (I2V)",
    provider: "FAL",
    taskTypes: ["video"],
    service: "fal_video",
    endpoint: "/api/fal/kling-2.6-pro/image-to-video/submit",
    modelParam: "fal-ai/kling-video/v2.6/pro/image-to-video",
    creditCost: 500,
    enabled: true,
    configOptions: { durations: [5, 10], supportsReferenceImage: true },
  },
  {
    id: "kling-2.6-pro-t2v",
    label: "Kling 2.6 Pro (T2V)",
    provider: "FAL",
    taskTypes: ["video"],
    service: "fal_video",
    endpoint: "/api/fal/kling-2.6-pro/text-to-video/submit",
    modelParam: "fal-ai/kling-video/v2.6/pro/text-to-video",
    creditCost: 500,
    enabled: true,
    configOptions: { durations: [5, 10] },
  },

  // ── VIDEO (Replicate queue submit routes) ──────────────────────────────────
  {
    id: "wan-2.5-t2v",
    label: "WAN 2.5 (T2V)",
    provider: "Replicate",
    taskTypes: ["video"],
    service: "replicate_video",
    endpoint: "/api/replicate/wan-2-5-t2v/submit",
    modelParam: "wan-video/wan-2.5-t2v",
    creditCost: 300,
    enabled: true,
    configOptions: { durations: [5, 10], supportsNegativePrompt: true },
  },
  {
    id: "wan-2.5-t2v-fast",
    label: "WAN 2.5 Fast (T2V)",
    provider: "Replicate",
    taskTypes: ["video"],
    service: "replicate_video",
    endpoint: "/api/replicate/wan-2-5-t2v/fast/submit",
    modelParam: "wan-video/wan-2.5-t2v-fast",
    creditCost: 300,
    enabled: true,
    configOptions: { durations: [5, 10], supportsNegativePrompt: true },
  },
  {
    id: "wan-2.5-i2v",
    label: "WAN 2.5 (I2V)",
    provider: "Replicate",
    taskTypes: ["video"],
    service: "replicate_video",
    endpoint: "/api/replicate/wan-2-5-i2v/submit",
    modelParam: "wan-video/wan-2.5-i2v",
    creditCost: 300,
    enabled: true,
    configOptions: { durations: [5, 10], supportsReferenceImage: true, supportsNegativePrompt: true },
  },
  {
    id: "wan-2.5-i2v-fast",
    label: "WAN 2.5 Fast (I2V)",
    provider: "Replicate",
    taskTypes: ["video"],
    service: "replicate_video",
    endpoint: "/api/replicate/wan-2-5-i2v/fast/submit",
    modelParam: "wan-video/wan-2.5-i2v-fast",
    creditCost: 300,
    enabled: true,
    configOptions: { durations: [5, 10], supportsReferenceImage: true, supportsNegativePrompt: true },
  },
  {
    id: "seedance-1.0-pro-fast-t2v",
    label: "Seedance Pro Fast (T2V)",
    provider: "Replicate",
    taskTypes: ["video"],
    service: "replicate_video",
    endpoint: "/api/replicate/seedance-pro-fast-t2v/submit",
    modelParam: "bytedance/seedance-1-pro-fast",
    creditCost: 350,
    enabled: true,
    configOptions: {
      aspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "9:21"],
      durations: [2, 5, 10, 12],
      supportsReferenceImage: true,
      supportsNegativePrompt: true,
    },
  },
  {
    id: "seedance-1.0-pro-fast-i2v",
    label: "Seedance Pro Fast (I2V)",
    provider: "Replicate",
    taskTypes: ["video"],
    service: "replicate_video",
    endpoint: "/api/replicate/seedance-pro-fast-i2v/submit",
    modelParam: "bytedance/seedance-1-pro-fast",
    creditCost: 350,
    enabled: true,
    configOptions: {
      durations: [2, 5, 10, 12],
      supportsReferenceImage: true,
      supportsNegativePrompt: true,
    },
  },
  {
    id: "seedance-1.0-lite-t2v",
    label: "Seedance Lite (T2V)",
    provider: "Replicate",
    taskTypes: ["video"],
    service: "replicate_video",
    endpoint: "/api/replicate/seedance-t2v/submit",
    modelParam: "bytedance/seedance-1-lite",
    creditCost: 200,
    enabled: true,
    configOptions: {
      aspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "9:21"],
      durations: [2, 5, 10, 12],
      supportsReferenceImage: true,
      supportsNegativePrompt: true,
    },
  },
  {
    id: "seedance-1.0-lite-i2v",
    label: "Seedance Lite (I2V)",
    provider: "Replicate",
    taskTypes: ["video"],
    service: "replicate_video",
    endpoint: "/api/replicate/seedance-i2v/submit",
    modelParam: "bytedance/seedance-1-lite",
    creditCost: 200,
    enabled: true,
    configOptions: { durations: [2, 5, 10, 12], supportsReferenceImage: true, supportsNegativePrompt: true },
  },
  {
    id: "pixverse-v5-t2v",
    label: "PixVerse v5 (T2V)",
    provider: "Replicate",
    taskTypes: ["video"],
    service: "replicate_video",
    endpoint: "/api/replicate/pixverse-v5-t2v/submit",
    modelParam: "pixverse/pixverse-v5",
    creditCost: 250,
    enabled: true,
    configOptions: { aspectRatios: ["16:9", "9:16", "1:1"], durations: [5, 8], supportsNegativePrompt: true },
  },
  {
    id: "pixverse-v5-i2v",
    label: "PixVerse v5 (I2V)",
    provider: "Replicate",
    taskTypes: ["video"],
    service: "replicate_video",
    endpoint: "/api/replicate/pixverse-v5-i2v/submit",
    modelParam: "pixverse/pixverse-v5",
    creditCost: 250,
    enabled: true,
    configOptions: { aspectRatios: ["16:9", "9:16", "1:1"], durations: [5, 8], supportsReferenceImage: true, supportsNegativePrompt: true },
  },
  {
    id: "kling-v2.5-turbo-pro-t2v",
    label: "Kling v2.5 Turbo Pro (T2V)",
    provider: "Replicate",
    taskTypes: ["video"],
    service: "replicate_video",
    endpoint: "/api/replicate/kling-t2v/submit",
    modelParam: "kwaivgi/kling-v2.5-turbo-pro",
    creditCost: 350,
    enabled: true,
    configOptions: { aspectRatios: ["16:9", "9:16", "1:1"], supportsNegativePrompt: true },
  },
  {
    id: "kling-v2.5-turbo-pro-i2v",
    label: "Kling v2.5 Turbo Pro (I2V)",
    provider: "Replicate",
    taskTypes: ["video"],
    service: "replicate_video",
    endpoint: "/api/replicate/kling-i2v/submit",
    modelParam: "kwaivgi/kling-v2.5-turbo-pro",
    creditCost: 350,
    enabled: true,
    configOptions: { aspectRatios: ["16:9", "9:16", "1:1"], supportsReferenceImage: true, supportsNegativePrompt: true },
  },
  {
    id: "kling-lipsync",
    label: "Kling Lip Sync",
    provider: "Replicate",
    taskTypes: ["video"],
    service: "replicate_video",
    endpoint: "/api/replicate/kling-lipsync/submit",
    modelParam: "kwaivgi/kling-lip-sync",
    creditCost: 200,
    enabled: true,
    configOptions: { supportsReferenceImage: true },
  },

  // ── MUSIC (MiniMax) ───────────────────────────────────────────────────────
  {
    id: "music-2.0",
    label: "MiniMax Music 2.0",
    provider: "MiniMax",
    taskTypes: ["music"],
    service: "minimax_music",
    endpoint: "/api/minimax/music",
    modelParam: "music-2.0",
    creditCost: 60,
    enabled: true,
    configOptions: { durations: [15, 30, 60, 90] },
  },
];

export function getModelsForTask(taskType: PlanTaskType): AssistantModel[] {
  return ASSISTANT_MODEL_REGISTRY.filter(
    (m) => m.enabled && m.taskTypes.includes(taskType),
  );
}

export function getModelById(id: string): AssistantModel | undefined {
  return ASSISTANT_MODEL_REGISTRY.find((m) => m.id === id);
}

export function getDefaultModelForTask(taskType: PlanTaskType): AssistantModel | undefined {
  const models = getModelsForTask(taskType);
  if (models.length === 0) return undefined;
  // Default: pick a mid-cost model (avoid always picking cheapest/most expensive).
  const sorted = [...models].sort((a, b) => a.creditCost - b.creditCost);
  return sorted[Math.floor(sorted.length / 2)];
}

export function buildAssistantExecutionPlan(args: {
  taskType: PlanTaskType;
  prompt: string;
  requirements: Record<string, any>;
  modelId?: string | null;
}): ExecutionPlan {
  const { taskType, prompt, requirements, modelId } = args;
  const chosen =
    (modelId ? getModelById(modelId) : undefined) ??
    getDefaultModelForTask(taskType) ??
    getModelById("google/nano-banana-pro");

  const safeAspect = (value: any, fallback: string, allowed: string[]): string => {
    const v = String(value || "").trim();
    if (allowed.includes(v)) return v;
    return fallback;
  };
  const safeDuration = (value: any, fallback: any, allowed: Array<string | number>): any => {
    if (value == null || value === "") return fallback;
    const raw = typeof value === "number" ? value : String(value).trim();
    // match numbers (e.g. 5, 10) or strings (e.g. "8s")
    for (const a of allowed) {
      if (a === raw) return raw;
      if (typeof a === "number" && Number(raw) === a) return a;
      if (typeof a === "string" && String(raw).toLowerCase() === a.toLowerCase()) return a;
    }
    return fallback;
  };

  const endpoint = chosen?.endpoint ?? "/api/fal/generate";
  const baseParams: Record<string, any> = {
    model: chosen?.modelParam ?? "google/nano-banana-pro",
  };

  // Endpoint-specific safe defaults based on validators in:
  // - fal/validateFalGenerate.ts
  // - replicate/validateWan25*.ts, validateSeedance*.ts, validatePixverse*.ts, validateKling*.ts
  const params: Record<string, any> = { ...baseParams };

  // Common convenience aliases from requirement schema
  const refImage =
    (requirements as any)?.reference_image_url ||
    (requirements as any)?.image_url ||
    (requirements as any)?.image ||
    (requirements as any)?.uploadedImage ||
    null;

  if (endpoint.startsWith("/api/fal/")) {
    // FAL image/video/tts share the same router; /generate uses validateFalGenerate.
    if (endpoint === "/api/fal/generate") {
      // validateFalGenerate allows aspect_ratio, resolution, output_format, negative_prompt
      if (requirements?.aspect_ratio) params.aspect_ratio = requirements.aspect_ratio;
      if (requirements?.resolution) params.resolution = requirements.resolution;
      if (requirements?.output_format) params.output_format = requirements.output_format;
      if ((requirements as any)?.negative_prompt) params.negative_prompt = (requirements as any).negative_prompt;
      if (refImage) params.uploadedImages = [refImage];
      // Default n/num_images
      if ((requirements as any)?.num_images != null) params.num_images = (requirements as any).num_images;
      else if ((requirements as any)?.n != null) params.n = (requirements as any).n;
    } else if (endpoint.includes("/veo3") || endpoint.includes("/veo3_1")) {
      // Veo routes validate aspect_ratio and duration as strings like "8s"
      params.aspect_ratio = safeAspect(
        requirements?.aspect_ratio,
        "16:9",
        ["16:9", "9:16", "1:1", "auto"],
      );
      params.duration = safeDuration(requirements?.duration, "8s", ["4s", "6s", "8s"]);
      if ((requirements as any)?.resolution) params.resolution = (requirements as any).resolution; // 720p|1080p (validators)
      if ((requirements as any)?.negative_prompt) params.negative_prompt = (requirements as any).negative_prompt;
      if (refImage) {
        // Veo I2V uses image_url; keep harmless extra for T2V
        params.image_url = refImage;
      }
      if ((requirements as any)?.generate_audio != null) params.generate_audio = Boolean((requirements as any).generate_audio);
    } else if (endpoint.includes("/sora2/")) {
      // Sora submit routes vary; keep minimal common fields
      if (requirements?.aspect_ratio) params.aspect_ratio = requirements.aspect_ratio;
      if (requirements?.duration) params.duration = requirements.duration;
      if (refImage) params.image_url = refImage;
    } else if (endpoint.includes("/ltx2/")) {
      if (requirements?.duration) params.duration = requirements.duration;
      if ((requirements as any)?.resolution) params.resolution = (requirements as any).resolution;
      if (refImage) params.image_url = refImage;
    } else if (endpoint.includes("/kling-")) {
      if (requirements?.duration) params.duration = requirements.duration;
      if ((requirements as any)?.generate_audio != null) params.generate_audio = Boolean((requirements as any).generate_audio);
      if (refImage) params.image_url = refImage;
    }
  } else if (endpoint.startsWith("/api/replicate/")) {
    if (endpoint.includes("/wan-2-5-t2v/")) {
      params.duration = safeDuration(requirements?.duration, 5, [5, 10]);
      params.size = (requirements as any)?.size || "1280*720";
      if ((requirements as any)?.negative_prompt) params.negative_prompt = (requirements as any).negative_prompt;
      if ((requirements as any)?.enable_prompt_expansion != null) params.enable_prompt_expansion = Boolean((requirements as any).enable_prompt_expansion);
      if ((requirements as any)?.seed != null) params.seed = (requirements as any).seed;
    } else if (endpoint.includes("/wan-2-5-i2v/")) {
      params.duration = safeDuration(requirements?.duration, 5, [5, 10]);
      params.resolution = (requirements as any)?.resolution || "720p";
      if (refImage) params.image = refImage;
      if ((requirements as any)?.negative_prompt) params.negative_prompt = (requirements as any).negative_prompt;
      if ((requirements as any)?.seed != null) params.seed = (requirements as any).seed;
    } else if (endpoint.includes("/seedance-")) {
      params.duration = (requirements as any)?.duration ?? 5;
      if ((requirements as any)?.resolution) params.resolution = (requirements as any).resolution;
      if ((requirements as any)?.aspect_ratio) params.aspect_ratio = (requirements as any).aspect_ratio;
      if (refImage) params.image = refImage;
      if ((requirements as any)?.negative_prompt) params.negative_prompt = (requirements as any).negative_prompt;
      if ((requirements as any)?.generate_audio != null) params.generate_audio = Boolean((requirements as any).generate_audio);
    } else if (endpoint.includes("/pixverse-v5-")) {
      params.duration = safeDuration(requirements?.duration, 5, [5, 8]);
      params.quality = (requirements as any)?.quality || (requirements as any)?.resolution || "720p";
      params.aspect_ratio = safeAspect(requirements?.aspect_ratio, "16:9", ["16:9", "9:16", "1:1"]);
      if ((requirements as any)?.negative_prompt) params.negative_prompt = (requirements as any).negative_prompt;
      if (refImage) params.image = refImage;
    } else if (endpoint.includes("/kling-")) {
      if ((requirements as any)?.aspect_ratio) params.aspect_ratio = (requirements as any).aspect_ratio;
      if ((requirements as any)?.mode) params.mode = (requirements as any).mode;
      if (refImage) params.start_image = refImage;
    }
  } else if (endpoint.startsWith("/api/minimax/")) {
    // minimax/music requires prompt + optional genre/mood/duration per your minimaxService
    if (endpoint.endsWith("/music")) {
      params.model = chosen?.modelParam ?? "music-2.0";
      params.prompt = (requirements as any)?.prompt || (requirements as any)?.lyrics || prompt;
      if ((requirements as any)?.duration != null) params.duration = (requirements as any).duration;
      if ((requirements as any)?.genre) params.genre = (requirements as any).genre;
      if ((requirements as any)?.mood) params.mood = (requirements as any).mood;
    }
  } else if (endpoint.startsWith("/api/bfl/")) {
    // bfl/generate requires model + prompt (prompt comes from step.prompt)
    if ((requirements as any)?.frameSize) params.frameSize = (requirements as any).frameSize;
    if ((requirements as any)?.output_format) params.output_format = (requirements as any).output_format;
    if (refImage) params.uploadedImages = [refImage];
  }

  const step: any = {
    stepId: `${taskType}_generation`,
    label: `Generate ${taskType}`,
    service: chosen?.service ?? "fal_image",
    endpoint,
    order: 1,
    prompt,
    creditCost: chosen?.creditCost ?? 100,
    estimatedDurationSeconds: 30,
    critical: true,
    params,
    selectedModel: chosen
      ? {
          modelId: chosen.id,
          label: chosen.label,
          provider: chosen.provider,
          creditCost: chosen.creditCost,
        }
      : undefined,
    alternatives: getModelsForTask(taskType)
      .filter((m) => !chosen || m.id !== chosen.id)
      .slice(0, 3)
      .map((m) => ({
        modelId: m.id,
        label: m.label,
        provider: m.provider,
        creditCost: m.creditCost,
      })),
  };

  const totalEstimatedCredits = Number(step.creditCost) || 0;
  return {
    taskType,
    summary: prompt,
    reasoning: "Assistant v2 plan (registry-driven).",
    style: String(requirements?.style || requirements?.visual_style || "default"),
    tone: String(requirements?.tone || "neutral"),
    complexity: "low",
    contentDurationSeconds:
      taskType === "video" || taskType === "music"
        ? (typeof (requirements as any)?.duration === "number"
            ? (requirements as any).duration
            : null)
        : null,
    enhancedPrompt: prompt,
    originalPrompt: prompt,
    steps: [step],
    totalEstimatedCredits,
    totalEstimatedDurationSeconds: Number(step.estimatedDurationSeconds) || 30,
    generatedBy: "assistant-v2",
    schemaVersion: "1.0",
  };
}

