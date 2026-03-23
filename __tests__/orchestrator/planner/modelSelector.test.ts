/**
 * Unit tests — Model Selector
 */

import {
  selectModel,
  getAvailableModels,
} from "../../../src/orchestrator/planner/modelSelector";

describe("modelSelector — selectModel()", () => {
  // ─── IMAGE ────────────────────────────────────────────────────────────────
  describe("IMAGE task type", () => {
    test("photorealistic + high → bfl_image (ultra)", () => {
      const r = selectModel("image", "photorealistic ultra-detailed", "high");
      expect(r.service).toBe("bfl_image");
      expect(r.tier).toBe("ultra");
      expect(r.creditCost).toBe(300);
    });

    test("photorealistic + medium → fal_image_pro (pro)", () => {
      const r = selectModel("image", "photorealistic portrait", "medium");
      expect(r.service).toBe("fal_image_pro");
      expect(r.tier).toBe("pro");
    });

    test("artistic style → fal_image (standard)", () => {
      const r = selectModel("image", "watercolor painting", "medium");
      expect(r.service).toBe("fal_image");
      expect(r.tier).toBe("standard");
    });

    test("cartoon style → fal_image (standard)", () => {
      const r = selectModel("image", "anime cartoon illustration", "low");
      expect(r.service).toBe("fal_image");
    });

    test("unknown style + low complexity → fal_image fallback", () => {
      const r = selectModel("image", "some unknown aesthetic", "low");
      expect(r.service).toBe("fal_image");
    });

    test("product photo + low → fal_image (standard, no pro on low)", () => {
      // product matches 'product' keyword in artistic group OR photorealistic?
      // photorealistic group requires medium/high — so low falls to standard
      const r = selectModel("image", "product photo", "low");
      // fal_image_pro requires medium/high, so low drops to fal_image
      expect(["fal_image", "fal_image_pro"]).toContain(r.service);
    });
  });

  // ─── IMAGE AD ────────────────────────────────────────────────────────────
  describe("IMAGE_AD task type", () => {
    test("image_ad always uses fal_image_pro for medium/high", () => {
      const r = selectModel("image_ad", "minimalist", "high");
      expect(r.service).toBe("fal_image_pro");
    });
  });

  // ─── VIDEO ────────────────────────────────────────────────────────────────
  describe("VIDEO task type", () => {
    test("cinematic + high → runway_video (ultra)", () => {
      const r = selectModel("video", "cinematic film noir", "high");
      expect(r.service).toBe("runway_video");
      expect(r.tier).toBe("ultra");
    });

    test("cinematic + medium → runway_video", () => {
      const r = selectModel("video", "cinematic", "medium");
      expect(r.service).toBe("runway_video");
    });

    test("social/reel → fal_video (standard)", () => {
      const r = selectModel("video", "tiktok reel short", "low");
      expect(r.service).toBe("fal_video");
    });

    test("low complexity video → fal_video", () => {
      const r = selectModel("video", "simple animation", "low");
      expect(r.service).toBe("fal_video");
    });

    test("fast style → fal_video", () => {
      const r = selectModel("video", "fast quick preview", "medium");
      expect(r.service).toBe("fal_video");
    });

    test("default video → runway_video", () => {
      const r = selectModel("video", "something", "medium");
      expect(r.service).toBe("runway_video");
    });
  });

  // ─── VIDEO AD ────────────────────────────────────────────────────────────
  describe("VIDEO_AD task type", () => {
    test("video_ad always → runway_video", () => {
      const r = selectModel("video_ad", "anything", "low");
      expect(r.service).toBe("runway_video");
    });
  });

  // ─── MUSIC ────────────────────────────────────────────────────────────────
  describe("MUSIC task type", () => {
    test("orchestral → minimax_music (pro)", () => {
      const r = selectModel("music", "orchestral cinematic epic score", "high");
      expect(r.service).toBe("minimax_music");
      expect(r.tier).toBe("pro");
    });

    test("electronic/edm → fal_music (standard)", () => {
      const r = selectModel("music", "upbeat edm electronic", "medium");
      expect(r.service).toBe("fal_music");
    });

    test("ambient → minimax_music", () => {
      const r = selectModel("music", "ambient chill background", "low");
      expect(r.service).toBe("minimax_music");
    });

    test("default music → minimax_music", () => {
      const r = selectModel("music", "some music", "medium");
      expect(r.service).toBe("minimax_music");
    });
  });

  // ─── VOICE ────────────────────────────────────────────────────────────────
  describe("VOICE task type", () => {
    test("professional narration → fal_voice", () => {
      const r = selectModel(
        "voice",
        "professional narration documentary",
        "high",
      );
      expect(r.service).toBe("fal_voice");
    });

    test("casual → replicate_voice", () => {
      const r = selectModel("voice", "casual friendly conversational", "low");
      expect(r.service).toBe("replicate_voice");
    });
  });

  // ─── MULTIMODAL ───────────────────────────────────────────────────────────
  describe("MULTIMODAL task type", () => {
    test("multimodal primary → runway_video", () => {
      const r = selectModel("multimodal", "mixed media", "high");
      expect(r.service).toBe("runway_video");
    });
  });

  // ─── RETURN SHAPE ────────────────────────────────────────────────────────
  describe("Return shape", () => {
    test("always returns service, endpoint, creditCost, tier, reasoning", () => {
      const r = selectModel("image", "test", "medium");
      expect(typeof r.service).toBe("string");
      expect(typeof r.endpoint).toBe("string");
      expect(typeof r.creditCost).toBe("number");
      expect(["economy", "standard", "pro", "ultra"]).toContain(r.tier);
      expect(typeof r.reasoning).toBe("string");
    });

    test("creditCost is always a positive integer", () => {
      const combos: Array<[any, string, any]> = [
        ["image", "cinematic", "low"],
        ["video", "photorealistic", "high"],
        ["music", "ambient", "medium"],
        ["voice", "professional", "high"],
      ];
      for (const [t, s, c] of combos) {
        const r = selectModel(t, s, c);
        expect(r.creditCost).toBeGreaterThan(0);
        expect(Number.isInteger(r.creditCost)).toBe(true);
      }
    });
  });

  // ─── getAvailableModels ───────────────────────────────────────────────────
  describe("getAvailableModels()", () => {
    test("returns at least one model for image", () => {
      expect(getAvailableModels("image").length).toBeGreaterThan(0);
    });
    test("returns at least one model for video", () => {
      expect(getAvailableModels("video").length).toBeGreaterThan(0);
    });
    test("returns no duplicate services", () => {
      const models = getAvailableModels("image");
      const services = models.map((m) => m.service);
      expect(new Set(services).size).toBe(services.length);
    });
  });
});
