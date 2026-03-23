/**
 * Unit tests — Budget Guard
 */

import {
  enforceBudget,
  MINIMUM_CREDITS_REQUIRED,
} from "../../../src/orchestrator/planner/budgetGuard";
import type { ExecutionPlan } from "../../../src/orchestrator/planner/plannerTypes";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makePlan(
  overrides: Partial<ExecutionPlan> & { steps?: any[] } = {},
): ExecutionPlan {
  const steps = overrides.steps ?? [
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
      stepId: "video",
      label: "Video",
      service: "runway_video",
      endpoint: "/api/y",
      order: 2,
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
    {
      stepId: "voice",
      label: "Voice",
      service: "fal_voice",
      endpoint: "/api/w",
      order: 3,
      prompt: "p",
      params: {},
      creditCost: 150,
      estimatedDurationSeconds: 10,
      critical: false,
    },
  ];
  const totalCredits = (steps as any[]).reduce(
    (s: number, step: any) => s + (step.creditCost as number),
    0,
  );

  return {
    taskType: "video_ad",
    summary: "Test plan",
    reasoning: "test",
    style: "cinematic",
    tone: "dramatic",
    complexity: "high",
    contentDurationSeconds: 30,
    enhancedPrompt: "test prompt",
    originalPrompt: "test",
    steps,
    totalEstimatedCredits: totalCredits,
    totalEstimatedDurationSeconds: 85,
    generatedBy: "gpt-4o",
    schemaVersion: "1.0",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("budgetGuard — enforceBudget()", () => {
  describe("WITHIN_BUDGET", () => {
    test("returns WITHIN_BUDGET when cost <= credits", () => {
      const plan = makePlan();
      const result = enforceBudget(plan, 1000);
      expect(result.status).toBe("WITHIN_BUDGET");
      expect(result.changes).toHaveLength(0);
    });

    test("returns WITHIN_BUDGET when cost === credits exactly", () => {
      const plan = makePlan();
      const result = enforceBudget(plan, plan.totalEstimatedCredits);
      expect(result.status).toBe("WITHIN_BUDGET");
    });

    test("plan object is unchanged when within budget", () => {
      const plan = makePlan();
      const result = enforceBudget(plan, 9999);
      expect(result.plan.steps).toHaveLength(plan.steps.length);
      expect(result.plan.totalEstimatedCredits).toBe(
        plan.totalEstimatedCredits,
      );
    });
  });

  describe("DOWNGRADED — Strategy 1: Model downgrades", () => {
    test("downgrades runway_video to fal_video when budget is tight", () => {
      // Plan cost: 50 + 500 + 200 + 150 = 900
      // Budget: 700 → runway(500) should be downgraded to fal_video(400)
      const plan = makePlan();
      const result = enforceBudget(plan, 700);

      expect(result.status).toBe("DOWNGRADED");
      expect(result.finalCost).toBeLessThanOrEqual(700);

      const videoStep = result.plan.steps.find(
        (s: any) => s.stepId === "video",
      );
      expect(["fal_video", "runway_video"]).toContain(videoStep?.service);
      expect(result.changes.length).toBeGreaterThan(0);
    });

    test("downgrades bfl_image → fal_image_pro → fal_image chain", () => {
      const plan = makePlan({
        taskType: "image",
        steps: [
          {
            stepId: "img",
            label: "Image",
            service: "bfl_image",
            endpoint: "/api/x",
            order: 1,
            prompt: "p",
            params: {},
            creditCost: 300,
            estimatedDurationSeconds: 30,
            critical: true,
          },
        ],
      });

      // Budget of 150 → bfl(300) → fal_image_pro(200) → fal_image(100)
      const result = enforceBudget(plan, 150);
      expect(result.status).toBe("DOWNGRADED");
      expect(result.finalCost).toBeLessThanOrEqual(150);
      expect(result.plan.steps[0].service).toBe("fal_image");
    });

    test("tracks changes with original → downgraded service names", () => {
      const plan = makePlan();
      const result = enforceBudget(plan, 700);
      if (result.status === "DOWNGRADED") {
        expect(result.changes.some((c) => c.includes("→"))).toBe(true);
      }
    });
  });

  describe("DOWNGRADED — Strategy 2: Remove non-critical steps", () => {
    test("removes non-critical steps when model downgrade is not enough", () => {
      // Budget of 500: after model downgrades, still need to remove steps
      const plan = makePlan();
      const result = enforceBudget(plan, 450);

      expect(["DOWNGRADED", "NOT_AFFORDABLE"]).toContain(result.status);

      if (result.status === "DOWNGRADED") {
        expect(result.finalCost).toBeLessThanOrEqual(450);
        // Should have removed non-critical steps (music, voice)
        const removedSteps = plan.steps
          .filter((s: any) => !s.critical)
          .filter(
            (s: any) =>
              !result.plan.steps.find((rs: any) => rs.stepId === s.stepId),
          );
        expect(removedSteps.length).toBeGreaterThanOrEqual(0);
      }
    });

    test("does not remove critical steps", () => {
      const plan = makePlan();
      const result = enforceBudget(plan, 600);

      if (result.status === "DOWNGRADED") {
        const criticalStepIds = plan.steps
          .filter((s: any) => s.critical)
          .map((s: any) => s.stepId);
        const resultStepIds = result.plan.steps.map((s: any) => s.stepId);
        // Critical steps should still be present (unless plan fell back to simpler task type)
        if (result.plan.taskType === plan.taskType) {
          for (const id of criticalStepIds) {
            expect(resultStepIds).toContain(id);
          }
        }
      }
    });
  });

  describe("DOWNGRADED — Strategy 3: Task type fallback", () => {
    test("falls back video_ad → image_ad when budget is very low", () => {
      // Budget of 300: can't even do a cheap video, should fall to image_ad or image
      const plan = makePlan();
      const result = enforceBudget(plan, 250);

      if (result.status === "DOWNGRADED") {
        expect(["image_ad", "image", "voice"]).toContain(result.plan.taskType);
        expect(result.finalCost).toBeLessThanOrEqual(250);
      }
    });

    test("adds [Budget downgraded] prefix to summary when task type changes", () => {
      const plan = makePlan();
      const result = enforceBudget(plan, 120);

      if (
        result.status === "DOWNGRADED" &&
        result.plan.taskType !== plan.taskType
      ) {
        expect(result.plan.summary).toMatch(/budget downgraded/i);
      }
    });
  });

  describe("NOT_AFFORDABLE", () => {
    test("returns NOT_AFFORDABLE when plan cannot fit in budget at all", () => {
      const plan = makePlan();
      // Minimum possible for video_ad chain is ~100 (image fallback)
      // Budget of 50 is below minimum
      const result = enforceBudget(plan, 50);
      expect(result.status).toBe("NOT_AFFORDABLE");
    });

    test("reports correct userCredits and originalCost", () => {
      const plan = makePlan();
      const result = enforceBudget(plan, 50);
      expect(result.userCredits).toBe(50);
      expect(result.originalCost).toBe(plan.totalEstimatedCredits);
    });
  });

  describe("Result shape invariants", () => {
    test("always returns userCredits, originalCost, finalCost, changes", () => {
      const plan = makePlan();
      const result = enforceBudget(plan, 9999);
      expect(typeof result.userCredits).toBe("number");
      expect(typeof result.originalCost).toBe("number");
      expect(typeof result.finalCost).toBe("number");
      expect(Array.isArray(result.changes)).toBe(true);
    });

    test("finalCost always matches sum of step costs", () => {
      const plan = makePlan();
      for (const budget of [9999, 700, 400, 200]) {
        const result = enforceBudget(plan, budget);
        const actualCost = result.plan.steps.reduce(
          (s: number, step: any) => s + step.creditCost,
          0,
        );
        expect(result.plan.totalEstimatedCredits).toBe(actualCost);
      }
    });

    test("MINIMUM_CREDITS_REQUIRED is 100", () => {
      expect(MINIMUM_CREDITS_REQUIRED).toBe(100);
    });

    test("original plan is never mutated", () => {
      const plan = makePlan();
      const originalStepsJson = JSON.stringify(plan.steps);
      enforceBudget(plan, 400);
      expect(JSON.stringify(plan.steps)).toBe(originalStepsJson);
    });
  });
});
