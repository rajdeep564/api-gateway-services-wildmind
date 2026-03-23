/**
 * Unit tests — IntentClassifier
 *
 * Tests the classification fallback chain and heuristic logic
 * without making real LLM API calls.
 */

// Mock LLM services so tests don't need API keys
jest.mock("../../src/services/genai/geminiTextService", () => ({
  generateGeminiTextResponse: jest.fn(),
}));

jest.mock("../../src/services/genai/gpt5NanoService", () => ({
  generateGpt5NanoResponse: jest.fn(),
}));

import { classifyIntent } from "../../src/orchestrator/intentClassifier";
import { generateGeminiTextResponse } from "../../src/services/genai/geminiTextService";
import { generateGpt5NanoResponse } from "../../src/services/genai/gpt5NanoService";

const mockGemini = generateGeminiTextResponse as jest.Mock;
const mockGpt5 = generateGpt5NanoResponse as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGeminiResponse(obj: object): string {
  return JSON.stringify(obj);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IntentClassifier", () => {
  describe("Gemini primary path", () => {
    test("correctly parses a video_ad classification from Gemini", async () => {
      mockGemini.mockResolvedValueOnce(
        makeGeminiResponse({
          taskType: "video_ad",
          assetsNeeded: ["video", "music", "voice"],
          style: "cinematic",
          tone: "energetic",
          complexity: "high",
          subject: "fitness app",
          duration: 30,
          confidence: 0.95,
        }),
      );

      const result = await classifyIntent(
        "Create a video ad for a fitness app",
      );

      expect(result.taskType).toBe("video_ad");
      expect(result.category).toBe("advertisement");
      expect(result.assetsNeeded).toContain("video");
      expect(result.assetsNeeded).toContain("music");
      expect(result.classifiedBy).toBe("gemini-1.5-pro");
      expect(result.confidence).toBeCloseTo(0.95);
    });

    test("returns image classification for image prompts", async () => {
      mockGemini.mockResolvedValueOnce(
        makeGeminiResponse({
          taskType: "image",
          assetsNeeded: ["image"],
          style: "realistic",
          tone: "neutral",
          complexity: "low",
          subject: "mountain landscape",
          duration: null,
          confidence: 0.99,
        }),
      );

      const result = await classifyIntent(
        "A beautiful mountain landscape at sunset",
      );
      expect(result.taskType).toBe("image");
      expect(result.category).toBe("image");
    });
  });

  describe("GPT-5 Nano fallback", () => {
    test("falls back to GPT-5 Nano when Gemini throws", async () => {
      mockGemini.mockRejectedValueOnce(new Error("Gemini API error"));
      mockGpt5.mockResolvedValueOnce(
        makeGeminiResponse({
          taskType: "music",
          assetsNeeded: ["music"],
          style: "ambient",
          tone: "calm",
          complexity: "low",
          subject: "meditation",
          duration: 60,
          confidence: 0.87,
        }),
      );

      const result = await classifyIntent(
        "Generate calm ambient music for meditation",
      );

      expect(mockGemini).toHaveBeenCalledTimes(1);
      expect(mockGpt5).toHaveBeenCalledTimes(1);
      expect(result.taskType).toBe("music");
      expect(result.classifiedBy).toBe("openai/gpt-5-nano");
    });
  });

  describe("Heuristic fallback", () => {
    test("uses heuristic when both LLMs fail", async () => {
      mockGemini.mockRejectedValueOnce(new Error("Gemini down"));
      mockGpt5.mockRejectedValueOnce(new Error("Replicate down"));

      const result = await classifyIntent("make a video for my brand");

      expect(result.taskType).toBe("video");
      expect(result.classifiedBy).toBe("heuristic");
    });

    test("defaults to image when no keywords match", async () => {
      mockGemini.mockRejectedValueOnce(new Error("fail"));
      mockGpt5.mockRejectedValueOnce(new Error("fail"));

      const result = await classifyIntent(
        "something completely ambiguous xyz123",
      );
      // Falls to ultimate default
      expect(result.taskType).toBe("image");
      expect(result.classifiedBy).toBe("default");
    });

    test("never throws even with empty prompt", async () => {
      const result = await classifyIntent("");
      expect(result).toBeDefined();
      expect(result.taskType).toBeDefined();
    });
  });

  describe("LLM output sanitization", () => {
    test("strips markdown code fences from LLM response", async () => {
      mockGemini.mockResolvedValueOnce(
        "```json\n" +
          JSON.stringify({
            taskType: "voice",
            assetsNeeded: ["voice"],
            style: "clear",
            tone: "professional",
            complexity: "low",
            subject: "narration",
            duration: null,
            confidence: 0.9,
          }) +
          "\n```",
      );

      const result = await classifyIntent("narrate this text for me");
      expect(result.taskType).toBe("voice");
    });

    test("falls back to default for invalid JSON from LLM", async () => {
      mockGemini.mockResolvedValueOnce("not-valid-json {{{}");
      mockGpt5.mockRejectedValueOnce(new Error("also failed"));

      const result = await classifyIntent("some prompt");
      expect(result).toBeDefined();
      expect(result.classifiedBy).toBe("default");
    });

    test("clamps invalid task type to image", async () => {
      mockGemini.mockResolvedValueOnce(
        JSON.stringify({
          taskType: "unknown_type_xyz",
          assetsNeeded: ["image"],
          style: "realistic",
          tone: "neutral",
          complexity: "low",
          subject: "test",
          duration: null,
          confidence: 0.5,
        }),
      );

      const result = await classifyIntent("some prompt");
      // Invalid taskType gets clamped to 'image'
      expect(result.taskType).toBe("image");
    });
  });
});
