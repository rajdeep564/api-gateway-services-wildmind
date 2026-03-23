/**
 * Unit tests — TaskRouter
 *
 * Verifies the routing map returns correct services for each task type
 * and that unknown types fall back gracefully.
 */

import {
  routeTask,
  getSupportedTaskTypes,
  estimateCredits,
} from "../../src/orchestrator/taskRouter";

describe("TaskRouter", () => {
  describe("routeTask()", () => {
    test("image: routes to a single fal_image service", () => {
      const decision = routeTask("image");
      expect(decision.taskType).toBe("image");
      expect(decision.services).toHaveLength(1);
      expect(decision.services[0].name).toBe("fal_image");
      expect(decision.services[0].order).toBe(1);
    });

    test("video: routes to runway_video", () => {
      const decision = routeTask("video");
      expect(decision.services[0].name).toBe("runway_video");
    });

    test("music: routes to minimax_music", () => {
      const decision = routeTask("music");
      expect(decision.services[0].name).toBe("minimax_music");
    });

    test("voice: routes to fal_voice", () => {
      const decision = routeTask("voice");
      expect(decision.services[0].name).toBe("fal_voice");
    });

    test("video_ad: has 4 services across 3 execution orders", () => {
      const decision = routeTask("video_ad");
      expect(decision.services).toHaveLength(4);

      const orders = [...new Set(decision.services.map((s) => s.order))].sort();
      expect(orders).toEqual([1, 2, 3]); // 3 distinct execution stages

      const order1 = decision.services.filter((s) => s.order === 1);
      const order2 = decision.services.filter((s) => s.order === 2);
      const order3 = decision.services.filter((s) => s.order === 3);

      expect(order1).toHaveLength(1); // script_gen only
      expect(order1[0].name).toBe("script_gen");
      expect(order2).toHaveLength(2); // video + music in parallel
      expect(order2.map((s) => s.name).sort()).toEqual([
        "minimax_music",
        "runway_video",
      ]);
      expect(order3).toHaveLength(1); // voice after script
      expect(order3[0].name).toBe("fal_voice");
      expect(order3[0].dependsOn).toBe("script_gen");
    });

    test("video_ad: runway_video depends on script_gen", () => {
      const decision = routeTask("video_ad");
      const videoStep = decision.services.find(
        (s) => s.name === "runway_video",
      );
      expect(videoStep?.dependsOn).toBe("script_gen");
    });

    test("multimodal: 3 services across 2 orders", () => {
      const decision = routeTask("multimodal");
      const orders = [...new Set(decision.services.map((s) => s.order))].sort();
      expect(orders).toEqual([1, 2]);
    });

    test("unknown task type falls back to image", () => {
      const decision = routeTask("unknown" as any);
      expect(decision.services[0].name).toBe("fal_image");
    });

    test("completely invalid task type falls back gracefully", () => {
      const decision = routeTask("invalid_xyz" as any);
      expect(decision).toBeDefined();
      expect(decision.services.length).toBeGreaterThan(0);
    });
  });

  describe("getSupportedTaskTypes()", () => {
    test("returns array including all expected task types", () => {
      const types = getSupportedTaskTypes();
      expect(types).toContain("image");
      expect(types).toContain("video");
      expect(types).toContain("music");
      expect(types).toContain("voice");
      expect(types).toContain("video_ad");
      expect(types).toContain("image_ad");
      expect(types).toContain("multimodal");
    });
  });

  describe("estimateCredits()", () => {
    test("video_ad costs more than image", () => {
      expect(estimateCredits("video_ad")).toBeGreaterThan(
        estimateCredits("image"),
      );
    });

    test("all task types have a positive credit estimate", () => {
      for (const type of getSupportedTaskTypes()) {
        expect(estimateCredits(type as any)).toBeGreaterThan(0);
      }
    });
  });
});
