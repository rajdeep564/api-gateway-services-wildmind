import { Router } from "express";
import { falController } from "../controllers/falController";
import { requireAuth } from "../middlewares/authMiddleware";
import { makeCreditCost } from "../middlewares/creditCostFactory";
import {
  computeFalImageCost,
  computeFalOutpaintCost,
  computeFalVeoI2vSubmitCost,
  computeFalVeoTtvSubmitCost,
  computeFalVeo31I2vSubmitCost,
  computeFalVeo31TtvSubmitCost,
  computeFalSora2I2vSubmitCost,
  computeFalSora2ProI2vSubmitCost,
  computeFalLtxV2ProI2vSubmitCost,
  computeFalLtxV2FastI2vSubmitCost,
  computeFalSora2T2vSubmitCost,
  computeFalSora2ProT2vSubmitCost,
  computeFalSora2RemixSubmitCost,
  computeFalLtxV2ProT2vSubmitCost,
  computeFalLtxV2FastT2vSubmitCost,
  computeFalImage2SvgCost,
  computeFalRecraftVectorizeCost,
  computeFalBriaGenfillCost,
  computeFalSeedVrUpscaleCost,
  computeFalTopazUpscaleImageCost,
  computeFalBirefnetVideoCost,
  computeFalMiniMaxMusic2Cost,
} from "../utils/pricing/falPricing";
import {
  validateFalGenerate,
  validateFalElevenDialogue,
  validateFalElevenTts,
  validateFalMayaTts,
  validateFalChatterboxMultilingual,
  validateFalChatterboxSts,
  validateFalQueueStatus,
  validateFalVeoTextToVideoSubmit,
  validateFalVeoTextToVideoFastSubmit,
  validateFalVeoImageToVideoSubmit,
  validateFalVeoImageToVideoFastSubmit,
  validateFalVeo31FirstLastFast,
  validateFalVeo31FirstLast,
  validateFalVeo31ReferenceToVideo,
  validateFalSora2I2v,
  validateFalSora2ProI2v,
  validateFalLtx2ProI2v,
  validateFalLtx2FastI2v,
  validateFalSora2T2v,
  validateFalSora2ProT2v,
  validateFalSora2Remix,
  validateFalSora2RemixByHistory,
  validateFalLtx2ProT2v,
  validateFalLtx2FastT2v,
  validateFalImage2Svg,
  validateFalOutpaint,
  validateFalBriaExpand,
  validateFalRecraftVectorize,
  validateFalBriaGenfill,
  validateFalSeedvrUpscale,
  validateFalTopazUpscaleImage,
  validateFalBirefnetVideo,
  validateFalMiniMaxMusic2,
} from "../middlewares/validators/fal/validateFalGenerate";

const router = Router();

router.post(
  "/generate",
  requireAuth,
  validateFalGenerate,
  makeCreditCost("fal", "generate", computeFalImageCost),
  falController.generate
);

// ElevenLabs Text-to-Dialogue (explicit route)
router.post(
  "/eleven/dialogue",
  requireAuth,
  validateFalElevenDialogue as any,
  makeCreditCost("fal", "generate", computeFalImageCost) as any,
  falController.generate as any
);

// ElevenLabs Text-to-Speech (TTS)
router.post(
  "/eleven/tts",
  requireAuth,
  validateFalElevenTts as any,
  makeCreditCost("fal", "generate", computeFalImageCost) as any,
  falController.generate as any
);

// Maya Text-to-Speech (Maya-1-Voice)
router.post(
  "/maya/tts",
  requireAuth,
  validateFalMayaTts as any,
  makeCreditCost("fal", "generate", computeFalImageCost) as any,
  falController.generate as any
);

// Chatterbox Multilingual Text-to-Speech
router.post(
  "/chatterbox/multilingual",
  requireAuth,
  validateFalChatterboxMultilingual as any,
  makeCreditCost("fal", "generate", computeFalImageCost) as any,
  falController.generate as any
);

// Chatterbox Speech-to-Speech (resemble-ai/chatterboxhd)
router.post(
  "/chatterbox/sts",
  requireAuth,
  validateFalChatterboxSts as any,
  makeCreditCost("fal", "generate", computeFalImageCost) as any,
  falController.generate as any
);

// Upload voice file for custom voice (Chatterbox TTS)
router.post(
  "/upload-voice",
  requireAuth,
  (falController as any).uploadVoice
);

// List user's uploaded audio files
router.get(
  "/audio-files",
  requireAuth,
  (falController as any).listUserAudioFiles
);

// MiniMax Music 2
router.post(
  "/minimax/music-2",
  requireAuth,
  validateFalMiniMaxMusic2 as any,
  makeCreditCost("fal", "generate", computeFalMiniMaxMusic2Cost) as any,
  falController.generate as any
);

// Image utilities
router.post(
  "/image2svg",
  requireAuth as any,
  validateFalImage2Svg as any,
  makeCreditCost("fal", "image2svg", computeFalImage2SvgCost) as any,
  (falController as any).image2svg
);
router.post(
  "/outpaint",
  requireAuth as any,
  validateFalOutpaint as any,
  makeCreditCost("fal", "outpaint", (req) => computeFalOutpaintCost(req)) as any,
  (falController as any).outpaintImage
);
// Bria Expand (image outpaint with resizing)
router.post(
  "/bria/expand",
  requireAuth as any,
  validateFalBriaExpand as any,
  makeCreditCost("fal", "bria_expand", (req) => computeFalOutpaintCost(req)) as any,
  (falController as any).briaExpandImage
);
router.post(
  "/recraft/vectorize",
  requireAuth as any,
  validateFalRecraftVectorize as any,
  makeCreditCost(
    "fal",
    "recraft_vectorize",
    computeFalRecraftVectorizeCost
  ) as any,
  (falController as any).recraftVectorize
);
// Bria GenFill (image inpainting/replace)
router.post(
  "/bria/genfill",
  requireAuth as any,
  validateFalBriaGenfill as any,
  makeCreditCost("fal", "bria_genfill", (req) => computeFalBriaGenfillCost(req)) as any,
  (falController as any).briaGenfill
);
// Topaz Image Upscaler (per-megapixel dynamic pricing)
router.post(
  "/topaz/upscale/image",
  requireAuth as any,
  validateFalTopazUpscaleImage as any,
  makeCreditCost("fal", "topaz_upscale_image", (req) =>
    computeFalTopazUpscaleImageCost(req)
  ) as any,
  (falController as any).topazUpscaleImage
);
// SeedVR2 Video Upscaler
router.post(
  "/seedvr/upscale/video",
  requireAuth as any,
  validateFalSeedvrUpscale as any,
  makeCreditCost("fal", "seedvr_upscale", (req) =>
    computeFalSeedVrUpscaleCost(req)
  ) as any,
  (falController as any).seedvrUpscale
);

// BiRefNet v2 Video Background Removal
router.post(
  "/birefnet/v2/video/remove-bg",
  requireAuth as any,
  validateFalBirefnetVideo as any,
  makeCreditCost("fal", "birefnet_video", (req) => computeFalBirefnetVideoCost(req)) as any,
  (falController as any).birefnetVideo
);
// Queue style endpoints
router.post(
  "/veo3/text-to-video/submit",
  requireAuth as any,
  validateFalVeoTextToVideoSubmit as any,
  makeCreditCost("fal", "veo_t2v_submit", (req) =>
    computeFalVeoTtvSubmitCost(req, false)
  ) as any,
  falController.veoTtvSubmit as any
);
router.post(
  "/veo3/text-to-video/fast/submit",
  requireAuth as any,
  validateFalVeoTextToVideoFastSubmit as any,
  makeCreditCost("fal", "veo_t2v_fast_submit", (req) =>
    computeFalVeoTtvSubmitCost(req, true)
  ) as any,
  falController.veoTtvFastSubmit as any
);
router.post(
  "/veo3/image-to-video/submit",
  requireAuth as any,
  validateFalVeoImageToVideoSubmit as any,
  makeCreditCost("fal", "veo_i2v_submit", (req) =>
    computeFalVeoI2vSubmitCost(req, false)
  ) as any,
  falController.veoI2vSubmit as any
);
router.post(
  "/veo3/image-to-video/fast/submit",
  requireAuth as any,
  validateFalVeoImageToVideoFastSubmit as any,
  makeCreditCost("fal", "veo_i2v_fast_submit", (req) =>
    computeFalVeoI2vSubmitCost(req, true)
  ) as any,
  falController.veoI2vFastSubmit as any
);
router.get(
  "/queue/status",
  requireAuth as any,
  validateFalQueueStatus as any,
  falController.queueStatus as any
);
router.get(
  "/queue/result",
  requireAuth as any,
  validateFalQueueStatus as any,
  falController.queueResult as any
);

// NanoBanana queue submit
// Note: NanoBanana uses the unified /fal/generate route; no separate routes needed

export default router;

// Veo 3.1 endpoints
router.post(
  "/veo3_1/text-to-video/submit",
  requireAuth as any,
  validateFalVeoTextToVideoSubmit as any,
  makeCreditCost("fal", "veo31_t2v_submit", (req) =>
    computeFalVeo31TtvSubmitCost(req, false)
  ) as any,
  (falController as any).veo31TtvSubmit
);
router.post(
  "/veo3_1/text-to-video/fast/submit",
  requireAuth as any,
  validateFalVeoTextToVideoFastSubmit as any,
  makeCreditCost("fal", "veo31_t2v_fast_submit", (req) =>
    computeFalVeo31TtvSubmitCost(req, true)
  ) as any,
  (falController as any).veo31TtvFastSubmit
);
router.post(
  "/veo3_1/image-to-video/submit",
  requireAuth as any,
  validateFalVeoImageToVideoSubmit as any,
  makeCreditCost("fal", "veo31_i2v_submit", (req) =>
    computeFalVeo31I2vSubmitCost(req, false)
  ) as any,
  (falController as any).veo31I2vSubmit
);
router.post(
  "/veo3_1/image-to-video/fast/submit",
  requireAuth as any,
  validateFalVeoImageToVideoFastSubmit as any,
  makeCreditCost("fal", "veo31_i2v_fast_submit", (req) =>
    computeFalVeo31I2vSubmitCost(req, true)
  ) as any,
  (falController as any).veo31I2vFastSubmit
);

// Veo 3.1 First/Last Frame to Video (Fast)
router.post(
  "/veo3_1/first-last/fast/submit",
  requireAuth as any,
  validateFalVeo31FirstLastFast as any,
  makeCreditCost("fal", "veo31_first_last_fast_submit", (req) =>
    computeFalVeo31I2vSubmitCost(req, true)
  ) as any,
  (falController as any).veo31FirstLastFastSubmit
);

// Veo 3.1 First/Last Frame to Video (Standard)
router.post(
  "/veo3_1/first-last/submit",
  requireAuth as any,
  validateFalVeo31FirstLast as any,
  makeCreditCost("fal", "veo31_first_last_submit", (req) =>
    computeFalVeo31I2vSubmitCost(req, false)
  ) as any,
  (falController as any).veo31FirstLastSubmit
);

// Veo 3.1 Reference-to-Video (Standard)
router.post(
  "/veo3_1/reference-to-video/submit",
  requireAuth as any,
  validateFalVeo31ReferenceToVideo as any,
  makeCreditCost("fal", "veo31_r2v_submit", (req) =>
    computeFalVeo31I2vSubmitCost(req, false)
  ) as any,
  (falController as any).veo31ReferenceToVideoSubmit
);

// Sora 2 Image-to-Video (Standard)
router.post(
  "/sora2/image-to-video/submit",
  requireAuth as any,
  validateFalSora2I2v as any,
  makeCreditCost("fal", "sora2_i2v_submit", (req) =>
    computeFalSora2I2vSubmitCost(req)
  ) as any,
  (falController as any).sora2I2vSubmit
);

// Sora 2 Image-to-Video (Pro)
router.post(
  "/sora2/image-to-video/pro/submit",
  requireAuth as any,
  validateFalSora2ProI2v as any,
  makeCreditCost("fal", "sora2_pro_i2v_submit", (req) =>
    computeFalSora2ProI2vSubmitCost(req)
  ) as any,
  (falController as any).sora2ProI2vSubmit
);

// Sora 2 Text-to-Video (Standard)
router.post(
  "/sora2/text-to-video/submit",
  requireAuth as any,
  validateFalSora2T2v as any,
  makeCreditCost("fal", "sora2_t2v_submit", (req) =>
    computeFalSora2T2vSubmitCost(req)
  ) as any,
  (falController as any).sora2T2vSubmit
);

// Sora 2 Text-to-Video (Pro)
router.post(
  "/sora2/text-to-video/pro/submit",
  requireAuth as any,
  validateFalSora2ProT2v as any,
  makeCreditCost("fal", "sora2_pro_t2v_submit", (req) =>
    computeFalSora2ProT2vSubmitCost(req)
  ) as any,
  (falController as any).sora2ProT2vSubmit
);

// Sora 2 Video-to-Video Remix
router.post(
  "/sora2/video-to-video/remix/submit",
  requireAuth as any,
  validateFalSora2Remix as any,
  makeCreditCost("fal", "sora2_v2v_remix_submit", (req) =>
    computeFalSora2RemixSubmitCost(req)
  ) as any,
  (falController as any).sora2RemixV2vSubmit
);

// Sora 2 Video-to-Video Remix (history-only convenience)
router.post(
  "/sora2/video-to-video/remix/by-history/submit",
  requireAuth as any,
  validateFalSora2RemixByHistory as any,
  makeCreditCost("fal", "sora2_v2v_remix_submit", (req) =>
    computeFalSora2RemixSubmitCost(req)
  ) as any,
  (falController as any).sora2RemixV2vSubmit
);

// LTX V2 Image-to-Video (Pro)
router.post(
  "/ltx2/image-to-video/pro/submit",
  requireAuth as any,
  validateFalLtx2ProI2v as any,
  makeCreditCost("fal", "ltx2_pro_i2v_submit", (req) =>
    computeFalLtxV2ProI2vSubmitCost(req)
  ) as any,
  (falController as any).ltx2ProI2vSubmit
);

// LTX V2 Image-to-Video (Fast)
router.post(
  "/ltx2/image-to-video/fast/submit",
  requireAuth as any,
  validateFalLtx2FastI2v as any,
  makeCreditCost("fal", "ltx2_fast_i2v_submit", (req) =>
    computeFalLtxV2FastI2vSubmitCost(req)
  ) as any,
  (falController as any).ltx2FastI2vSubmit
);

// LTX V2 Text-to-Video (Pro)
router.post(
  "/ltx2/text-to-video/pro/submit",
  requireAuth as any,
  validateFalLtx2ProT2v as any,
  makeCreditCost("fal", "ltx2_pro_t2v_submit", (req) =>
    computeFalLtxV2ProT2vSubmitCost(req)
  ) as any,
  (falController as any).ltx2ProT2vSubmit
);

// LTX V2 Text-to-Video (Fast)
router.post(
  "/ltx2/text-to-video/fast/submit",
  requireAuth as any,
  validateFalLtx2FastT2v as any,
  makeCreditCost("fal", "ltx2_fast_t2v_submit", (req) =>
    computeFalLtxV2FastT2vSubmitCost(req)
  ) as any,
  (falController as any).ltx2FastT2vSubmit
);
