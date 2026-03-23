/**
 * Unit tests — Agent Planner (planValidator)
 *
 * Tests the plan validation and repair logic without any LLM calls.
 */

import { validateAndRepairPlan } from "../../../src/orchestrator/planner/planValidator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validPlan(overrides: Record<string, any> = {}): any {
  return {
    taskType: "image",
    summary: "Generate a landscape image",
    reasoning: "User asked for image generation",
    style: "photorealistic",
    tone: "calm",
    complexity: "low",
    contentDurationSeconds: null,
    enhancedPrompt: "A stunning mountain landscape at sunset",
    originalPrompt: "mountain landscape",
    steps: [
      {
        stepId: "fal_image",
        label: "Generate Image",
        service: "fal_image",
        endpoint: "/api/fal/flux/dev",
        order: 1,
        prompt: "A stunning mountain landscape at sunset",
        params: {},
        creditCost: 100,
        estimatedDurationSeconds: 20,
        critical: true,
      },
    ],
    totalEstimatedCredits: 100,
    totalEstimatedDurationSeconds: 20,
    generatedBy: "gpt-4o",
    schemaVersion: "1.0",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("planValidator — validateAndRepairPlan()", () => {
  describe("Valid plans", () => {
    test("accepts a well-formed plan without errors", () => {
      const result = validateAndRepairPlan(validPlan());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.repairedPlan).toBeDefined();
    });

    test("accepts plans with multiple steps and dependencies", () => {
      const plan = validPlan({
        taskType: "video_ad",
        steps: [
          {
            stepId: "script",
            label: "Script",
            service: "script_gen",
            endpoint: "/api/x",
            order: 1,
            prompt: "p",
            params: {},
            creditCost: 50,
            estimatedDurationSeconds: 15,
            critical: true,
          },
          {
            stepId: "vid",
            label: "Video",
            service: "runway_video",
            endpoint: "/api/y",
            order: 2,
            dependsOn: "script",
            prompt: "p",
            params: {},
            creditCost: 500,
            estimatedDurationSeconds: 60,
            critical: true,
          },
          {
            stepId: "music",
            label: "Music",
            service: "minimax_music",
            endpoint: "/api/z",
            order: 2,
            prompt: "p",
            params: {},
            creditCost: 200,
            estimatedDurationSeconds: 30,
            critical: false,
          },
        ],
        totalEstimatedCredits: 750,
        totalEstimatedDurationSeconds: 75,
      });
      const result = validateAndRepairPlan(plan);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("Null/invalid input", () => {
    test("returns error for null input", () => {
      const result = validateAndRepairPlan(null);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/null/i);
    });

    test("returns error for string input", () => {
      const result = validateAndRepairPlan("not-an-object");
      expect(result.valid).toBe(false);
    });

    test("returns error for empty object", () => {
      const result = validateAndRepairPlan({});
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("taskType"))).toBe(true);
    });
  });

  describe("Auto-repair: invalid task type", () => {
    test('repairs invalid taskType to "image"', () => {
      const result = validateAndRepairPlan(
        validPlan({ taskType: "teleportation" }),
      );
      expect(result.warnings.some((w) => w.includes("taskType"))).toBe(true);
      expect(result.repairedPlan?.taskType).toBe("image");
    });
  });

  describe("Auto-repair: invalid complexity", () => {
    test('repairs invalid complexity to "medium"', () => {
      const result = validateAndRepairPlan(validPlan({ complexity: "turbo" }));
      expect(result.warnings.some((w) => w.includes("complexity"))).toBe(true);
      expect(result.repairedPlan?.complexity).toBe("medium");
    });
  });

  describe("Auto-repair: credit total mismatch", () => {
    test("recalculates totalEstimatedCredits from step costs", () => {
      // Steps sum to 100, but plan says 999
      const result = validateAndRepairPlan(
        validPlan({ totalEstimatedCredits: 999 }),
      );
      expect(
        result.warnings.some((w) => w.includes("totalEstimatedCredits")),
      ).toBe(true);
      expect(result.repairedPlan?.totalEstimatedCredits).toBe(100);
    });
  });

  describe("Auto-repair: missing step fields", () => {
    test("defaults missing prompt to enhancedPrompt", () => {
      const plan = validPlan();
      delete plan.steps[0].prompt;
      const result = validateAndRepairPlan(plan);
      expect(result.repairedPlan?.steps[0].prompt).toBe(plan.enhancedPrompt);
    });

    test("defaults missing params to {}", () => {
      const plan = validPlan();
      delete plan.steps[0].params;
      const result = validateAndRepairPlan(plan);
      expect(result.repairedPlan?.steps[0].params).toEqual({});
    });

    test("defaults missing critical to true", () => {
      const plan = validPlan();
      delete plan.steps[0].critical;
      const result = validateAndRepairPlan(plan);
      expect(result.repairedPlan?.steps[0].critical).toBe(true);
    });

    test("defaults missing estimatedDurationSeconds to 30", () => {
      const plan = validPlan();
      delete plan.steps[0].estimatedDurationSeconds;
      const result = validateAndRepairPlan(plan);
      expect(result.repairedPlan?.steps[0].estimatedDurationSeconds).toBe(30);
    });
  });

  describe("Errors: structural violations", () => {
    test("errors on empty steps array", () => {
      const result = validateAndRepairPlan(validPlan({ steps: [] }));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("at least one step"))).toBe(
        true,
      );
    });

    test("errors on dependsOn referencing non-existent step", () => {
      const plan = validPlan();
      plan.steps[0].dependsOn = "ghost_step";
      const result = validateAndRepairPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("ghost_step"))).toBe(true);
    });

    test("errors on dependsOn with same/higher order (circular dependency)", () => {
      const plan = validPlan({
        steps: [
          {
            stepId: "a",
            label: "A",
            service: "fal_image",
            endpoint: "/x",
            order: 2,
            dependsOn: "b",
            prompt: "p",
            params: {},
            creditCost: 100,
            estimatedDurationSeconds: 10,
            critical: true,
          },
          {
            stepId: "b",
            label: "B",
            service: "fal_image",
            endpoint: "/y",
            order: 2,
            prompt: "p",
            params: {},
            creditCost: 100,
            estimatedDurationSeconds: 10,
            critical: true,
          },
        ],
        totalEstimatedCredits: 200,
        totalEstimatedDurationSeconds: 10,
      });
      const result = validateAndRepairPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("order"))).toBe(true);
    });

    test("errors on step missing service", () => {
      const plan = validPlan();
      delete plan.steps[0].service;
      const result = validateAndRepairPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('"service"'))).toBe(true);
    });

    test("auto-renames duplicate step IDs with warning", () => {
      const plan = validPlan({
        steps: [
          {
            stepId: "dup",
            label: "A",
            service: "fal_image",
            endpoint: "/x",
            order: 1,
            prompt: "p",
            params: {},
            creditCost: 50,
            estimatedDurationSeconds: 10,
            critical: true,
          },
          {
            stepId: "dup",
            label: "B",
            service: "fal_image",
            endpoint: "/y",
            order: 2,
            prompt: "p",
            params: {},
            creditCost: 50,
            estimatedDurationSeconds: 10,
            critical: true,
          },
        ],
        totalEstimatedCredits: 100,
        totalEstimatedDurationSeconds: 20,
      });
      const result = validateAndRepairPlan(plan);
      // Duplicate ID should produce a warning and the id should be renamed
      expect(result.warnings.some((w) => w.includes("Duplicate"))).toBe(true);
      const ids = result.repairedPlan?.steps.map((s) => s.stepId) ?? [];
      expect(new Set(ids).size).toBe(ids.length); // all IDs unique after repair
    });
  });
});
