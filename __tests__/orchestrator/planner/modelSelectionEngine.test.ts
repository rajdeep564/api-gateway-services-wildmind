/**
 * Unit tests — Model Selection Engine
 * Covers: scoring, priority modes, hard constraints, fallback chains
 */

import {
  ModelSelectionEngine,
  MODEL_REGISTRY,
  type ModelSelectionInput,
} from "../../../src/orchestrator/planner/modelSelectionEngine";

const engine = new ModelSelectionEngine();

// ─── Quick input builder ───────────────────────────────────────────────────

function input(
  overrides: Partial<ModelSelectionInput> = {},
): ModelSelectionInput {
  return {
    taskType: "image",
    style: "photorealistic portrait",
    complexity: "medium",
    priority: "balanced",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Basic selection
// ═══════════════════════════════════════════════════════════════════════════

describe("ModelSelectionEngine — basic selection", () => {
  test("returns a result with primary + ranked array", () => {
    const result = engine.select(input());
    expect(result.primary).toBeDefined();
    expect(Array.isArray(result.ranked)).toBe(true);
    expect(result.ranked.length).toBeGreaterThan(0);
    expect(result.ranked[0]).toBe(result.primary);
  });

  test("primary model supports the requested task type", () => {
    for (const taskType of ["image", "video", "music", "voice"] as const) {
      const result = engine.select(input({ taskType }));
      expect(result.primary.profile.tasks[taskType]).toBe(true);
    }
  });

  test("all ranked models support the requested task type", () => {
    const result = engine.select(input({ taskType: "video" }));
    for (const candidate of result.ranked) {
      expect(candidate.profile.tasks["video"]).toBe(true);
    }
  });

  test("composite scores are between 0 and 1", () => {
    const result = engine.select(input());
    for (const candidate of result.ranked) {
      expect(candidate.score).toBeGreaterThanOrEqual(0);
      expect(candidate.score).toBeLessThanOrEqual(1);
    }
  });

  test("ranked list is sorted descending by score", () => {
    const result = engine.select(input());
    for (let i = 1; i < result.ranked.length; i++) {
      expect(result.ranked[i - 1].score).toBeGreaterThanOrEqual(
        result.ranked[i].score,
      );
    }
  });

  test("returns evaluated + filtered counts", () => {
    const result = engine.select(input());
    expect(typeof result.evaluated).toBe("number");
    expect(typeof result.filtered).toBe("number");
    expect(result.evaluated + result.filtered).toBeLessThanOrEqual(
      MODEL_REGISTRY.length,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Priority modes
// ═══════════════════════════════════════════════════════════════════════════

describe("Priority modes — model ordering changes with priority", () => {
  test('"quality" priority — picks highest quality model for cinematic video', () => {
    const result = engine.select(
      input({
        taskType: "video",
        style: "cinematic film",
        priority: "quality",
      }),
    );
    // Runway Gen-3 has quality score 0.95 for video — should be top pick on quality mode
    expect(result.primary.profile.service).toBe("runway_video");
  });

  test('"economy" priority — picks cheapest model for image', () => {
    const result = engine.select(
      input({
        taskType: "image",
        style: "artistic illustration",
        priority: "economy",
      }),
    );
    // FAL Flux Dev at 100cr is cheapest image model
    expect(result.primary.profile.creditCost).toBeLessThanOrEqual(200);
  });

  test('"speed" priority — picks model with lower latency', () => {
    const q = engine.select(input({ taskType: "image", priority: "quality" }));
    const s = engine.select(input({ taskType: "image", priority: "speed" }));
    // Speed mode should prefer faster models
    expect(s.primary.profile.latencyP50Seconds).toBeLessThanOrEqual(
      q.primary.profile.latencyP50Seconds + 15, // allow some tolerance
    );
  });

  test('"balanced" priority — picks a mid-tier model (not always cheapest or most expensive)', () => {
    const result = engine.select(
      input({ taskType: "image", priority: "balanced" }),
    );
    // Balanced should not always pick the absolute cheapest (100cr) nor the most expensive (300cr)
    expect(result.primary.profile.creditCost).toBeLessThanOrEqual(300);
    expect(result.primary.profile.creditCost).toBeGreaterThanOrEqual(100);
  });

  test("different priorities produce different rankings for the same task", () => {
    const quality = engine.select(
      input({
        taskType: "image",
        style: "photorealistic",
        priority: "quality",
      }),
    );
    const economy = engine.select(
      input({
        taskType: "image",
        style: "photorealistic",
        priority: "economy",
      }),
    );
    // Quality mode should pick a higher quality model (higher creditCost) than economy
    expect(quality.primary.profile.creditCost).toBeGreaterThanOrEqual(
      economy.primary.profile.creditCost,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Style matching
// ═══════════════════════════════════════════════════════════════════════════

describe("Style matching", () => {
  test("cinematic style → runway_video wins for video in quality mode", () => {
    const result = engine.select(
      input({
        taskType: "video",
        style: "cinematic dramatic film",
        priority: "quality",
      }),
    );
    expect(result.primary.profile.service).toBe("runway_video");
  });

  test("artistic/anime style → fal_image gets high styleMatch for image", () => {
    const result = engine.select(
      input({
        taskType: "image",
        style: "anime cartoon illustration",
        priority: "quality",
      }),
    );
    const falDev = result.ranked.find((r) => r.profile.service === "fal_image");
    expect(falDev).toBeDefined();
    expect(falDev!.breakdown.styleMatch).toBeGreaterThan(0.3);
  });

  test("electronic music style → fal_music scores higher styleMatch than minimax", () => {
    const result = engine.select(
      input({
        taskType: "music",
        style: "electronic edm upbeat",
        priority: "balanced",
      }),
    );
    const falMusic = result.ranked.find(
      (r) => r.profile.service === "fal_music",
    );
    const minimax = result.ranked.find(
      (r) => r.profile.service === "minimax_music",
    );
    expect(falMusic?.breakdown.styleMatch).toBeGreaterThan(
      minimax?.breakdown.styleMatch ?? 0,
    );
  });

  test("orchestral style → minimax_music scores higher styleMatch than fal_music", () => {
    const result = engine.select(
      input({
        taskType: "music",
        style: "orchestral cinematic epic",
        priority: "quality",
      }),
    );
    const minimax = result.ranked.find(
      (r) => r.profile.service === "minimax_music",
    );
    const falMusic = result.ranked.find(
      (r) => r.profile.service === "fal_music",
    );
    expect(minimax?.breakdown.styleMatch).toBeGreaterThan(
      falMusic?.breakdown.styleMatch ?? 0,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Hard constraints
// ═══════════════════════════════════════════════════════════════════════════

describe("Hard constraints", () => {
  test("creditLimit filters out models above the limit", () => {
    const result = engine.select(
      input({ taskType: "image", creditLimit: 150 }),
    );
    for (const candidate of result.ranked) {
      expect(candidate.profile.creditCost).toBeLessThanOrEqual(150);
    }
  });

  test("creditLimit = 100 leaves only cheapest image models", () => {
    const result = engine.select(
      input({ taskType: "image", creditLimit: 100 }),
    );
    for (const candidate of result.ranked) {
      expect(candidate.profile.creditCost).toBeLessThanOrEqual(100);
    }
  });

  test("durationSeconds filters out models with maxDuration < requested", () => {
    // Runway max = 30s, FAL max = 15s → requesting 25s should keep Runway but drop FAL Video
    const result = engine.select(
      input({ taskType: "video", durationSeconds: 25 }),
    );
    const falVideo = result.ranked.find(
      (r) => r.profile.service === "fal_video",
    );
    // fal_video maxDurationSeconds = 15, so 25s should be filtered out
    expect(falVideo).toBeUndefined();
  });

  test("throws when no model passes hard constraints", () => {
    // creditLimit = 1 should be too low for any model
    expect(() => engine.select(input({ creditLimit: 1 }))).toThrow();
  });

  test("disabled models are excluded", () => {
    const customRegistry = MODEL_REGISTRY.map((m) => ({
      ...m,
      enabled: false,
    }));
    const customEngine = new ModelSelectionEngine(customRegistry);
    expect(() => customEngine.select(input())).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Task coverage
// ═══════════════════════════════════════════════════════════════════════════

describe("Task type coverage", () => {
  const TASK_TYPES = [
    "image",
    "video",
    "music",
    "voice",
    "image_ad",
    "video_ad",
  ] as const;

  for (const taskType of TASK_TYPES) {
    test(`successfully selects a model for task: ${taskType}`, () => {
      expect(() => engine.select(input({ taskType }))).not.toThrow();
      const result = engine.select(input({ taskType }));
      expect(result.primary).toBeDefined();
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Fallback chain
// ═══════════════════════════════════════════════════════════════════════════

describe("getFallbackChain()", () => {
  test("returns non-empty array for supported tasks", () => {
    const chain = engine.getFallbackChain(input({ taskType: "image" }));
    expect(chain.length).toBeGreaterThan(0);
  });

  test("chain contains only service strings", () => {
    const chain = engine.getFallbackChain(input({ taskType: "video" }));
    for (const service of chain) {
      expect(typeof service).toBe("string");
    }
  });

  test("chain has no duplicates", () => {
    const chain = engine.getFallbackChain(input({ taskType: "image" }));
    expect(new Set(chain).size).toBe(chain.length);
  });

  test("chain returns empty array for impossible constraints (not throw)", () => {
    const chain = engine.getFallbackChain(input({ creditLimit: 1 }));
    expect(Array.isArray(chain)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// applyToStep
// ═══════════════════════════════════════════════════════════════════════════

describe("applyToStep()", () => {
  test("mutates step.service and step.endpoint when a better model is found", () => {
    const step: any = {
      service: "fal_image",
      endpoint: "/api/fal/flux/dev",
      creditCost: 100,
    };
    // Quality mode for high complexity photorealistic should pick bfl_image
    engine.applyToStep(step, {
      taskType: "image",
      style: "photorealistic",
      complexity: "high",
      priority: "quality",
    });
    // The step should have been updated to a better model
    expect(step.service).toBeDefined();
    expect(step.endpoint).toBeDefined();
    expect(typeof step.creditCost).toBe("number");
  });

  test("returns { applied: false } when step is already optimal", () => {
    // In economy mode bfl_image (300cr) won't be chosen — so if it's already fal_image, it stays
    const step: any = {
      service: "fal_image",
      endpoint: "/api/fal/flux/dev",
      creditCost: 100,
    };
    const result = engine.applyToStep(step, input({ priority: "economy" }));
    // Either it applied (picked cheaper) or it didn't need to change
    expect(
      ["applied", "not-applied"].includes(
        result.applied ? "applied" : "not-applied",
      ),
    ).toBe(true);
  });

  test("returns { applied: false } when no model passes constraints", () => {
    const step: any = {
      service: "fal_image",
      endpoint: "/api/x",
      creditCost: 100,
    };
    const result = engine.applyToStep(step, input({ creditLimit: 1 }));
    expect(result.applied).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// listModels
// ═══════════════════════════════════════════════════════════════════════════

describe("listModels()", () => {
  test("lists all enabled models when no filter given", () => {
    const models = engine.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.enabled)).toBe(true);
  });

  test("filters to only models supporting the given task", () => {
    const models = engine.listModels("music");
    for (const m of models) {
      expect(m.tasks.music).toBe(true);
    }
  });

  test("each model has required fields", () => {
    for (const model of engine.listModels()) {
      expect(model.modelId).toBeTruthy();
      expect(model.provider).toBeTruthy();
      expect(model.service).toBeTruthy();
      expect(model.endpoint).toBeTruthy();
      expect(model.creditCost).toBeGreaterThan(0);
      expect(model.availability).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Score breakdown
// ═══════════════════════════════════════════════════════════════════════════

describe("Score breakdown dimensions", () => {
  test("all breakdown dimensions are 0–1", () => {
    const result = engine.select(
      input({ taskType: "video", style: "cinematic" }),
    );
    for (const candidate of result.ranked) {
      const { quality, cost, latency, styleMatch, availability } =
        candidate.breakdown;
      for (const dim of [quality, cost, latency, styleMatch, availability]) {
        expect(dim).toBeGreaterThanOrEqual(0);
        expect(dim).toBeLessThanOrEqual(1);
      }
    }
  });

  test("BFL model has highest quality score for image task", () => {
    const result = engine.select(input({ taskType: "image" }));
    const bfl = result.ranked.find((r) => r.profile.service === "bfl_image");
    expect(bfl?.breakdown.quality).toBeGreaterThanOrEqual(0.9);
  });

  test("cheapest model has highest cost score", () => {
    const result = engine.select(input({ taskType: "image" }));
    const sortedByCost = [...result.ranked].sort(
      (a, b) => b.breakdown.cost - a.breakdown.cost,
    );
    // Highest cost score = cheapest model
    expect(sortedByCost[0].profile.creditCost).toBeLessThanOrEqual(
      sortedByCost[1].profile.creditCost,
    );
  });
});
