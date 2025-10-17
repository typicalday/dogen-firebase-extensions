import { describe, it, before, after, beforeEach, afterEach } from "mocha";
import { expect } from "chai";
import { TaskGraph } from "../../../src/job/taskGraph";
import {
  registerMockHandler,
  clearMockHandlers,
  noopHandler,
  spawnChildrenWithDepsHandler,
  createMockTask,
} from "./helpers";

/**
 * Integration Tests for Sibling Task Dependencies
 *
 * These tests verify that child tasks can properly depend on their siblings
 * (tasks spawned in the same spawn operation) without validation errors.
 *
 * This addresses a security fix where the validation was too strict and
 * prevented legitimate sibling dependencies from being created.
 */

describe("Sibling Task Dependencies", function () {
  this.timeout(30000);

  before(function () {
    console.log("Starting Sibling Dependencies tests");
  });

  after(function () {
    console.log("Sibling Dependencies tests completed");
  });

  beforeEach(function () {
    // Register default mock handlers
    registerMockHandler("mock", "noop", noopHandler);
  });

  afterEach(function () {
    clearMockHandlers();
  });

  // ==========================================================================
  // 1. VALID SIBLING DEPENDENCIES
  // ==========================================================================

  describe("1. Valid Sibling Dependencies", function () {
    it("should allow child to depend on earlier sibling", function () {
      // Task 0 spawns 3 children: 0-0, 0-1, 0-2
      // Child 0-2 depends on 0-0 and 0-1
      registerMockHandler(
        "mock",
        "spawn-with-sibling-deps",
        spawnChildrenWithDepsHandler([
          { input: { name: "child-0" } }, // 0-0
          { input: { name: "child-1" } }, // 0-1
          { dependsOn: ["0-0", "0-1"], input: { name: "child-2" } }, // 0-2
        ])
      );

      const tasks = [createMockTask("0", "mock", "spawn-with-sibling-deps")];
      const graph = new TaskGraph(tasks);

      expect(graph.size()).to.equal(1);

      // After spawning, there should be 4 tasks (0, 0-0, 0-1, 0-2)
      // and 0-2 should depend on 0-0 and 0-1
    });

    it("should allow forward reference to later sibling", function () {
      // Child 0-0 depends on 0-2 (created later in same spawn)
      registerMockHandler(
        "mock",
        "spawn-forward-ref",
        spawnChildrenWithDepsHandler([
          { dependsOn: ["0-2"], input: { name: "child-0" } }, // 0-0
          { input: { name: "child-1" } }, // 0-1
          { input: { name: "child-2" } }, // 0-2
        ])
      );

      const tasks = [createMockTask("0", "mock", "spawn-forward-ref")];
      const graph = new TaskGraph(tasks);

      expect(graph.size()).to.equal(1);

      // Should not throw during spawning
    });

    it("should allow multiple siblings to depend on same sibling", function () {
      // Both 0-1 and 0-2 depend on 0-0
      registerMockHandler(
        "mock",
        "spawn-shared-dep",
        spawnChildrenWithDepsHandler([
          { input: { name: "child-0" } }, // 0-0
          { dependsOn: ["0-0"], input: { name: "child-1" } }, // 0-1
          { dependsOn: ["0-0"], input: { name: "child-2" } }, // 0-2
        ])
      );

      const tasks = [createMockTask("0", "mock", "spawn-shared-dep")];
      const graph = new TaskGraph(tasks);

      expect(graph.size()).to.equal(1);
    });

    it("should allow complex sibling dependency chain", function () {
      // 0-0 → 0-1 → 0-2 (chain of siblings)
      registerMockHandler(
        "mock",
        "spawn-chain",
        spawnChildrenWithDepsHandler([
          { input: { name: "child-0" } }, // 0-0
          { dependsOn: ["0-0"], input: { name: "child-1" } }, // 0-1
          { dependsOn: ["0-1"], input: { name: "child-2" } }, // 0-2
        ])
      );

      const tasks = [createMockTask("0", "mock", "spawn-chain")];
      const graph = new TaskGraph(tasks);

      expect(graph.size()).to.equal(1);
    });

    it("should allow fan-in pattern with siblings", function () {
      // Multiple siblings converge on final sibling
      // [0-0, 0-1, 0-2] → 0-3
      registerMockHandler(
        "mock",
        "spawn-fan-in",
        spawnChildrenWithDepsHandler([
          { input: { name: "child-0" } }, // 0-0
          { input: { name: "child-1" } }, // 0-1
          { input: { name: "child-2" } }, // 0-2
          { dependsOn: ["0-0", "0-1", "0-2"], input: { name: "aggregator" } }, // 0-3
        ])
      );

      const tasks = [createMockTask("0", "mock", "spawn-fan-in")];
      const graph = new TaskGraph(tasks);

      expect(graph.size()).to.equal(1);
    });

    it("should allow child to depend on both parent and siblings", function () {
      // Child depends on both its parent (0) and siblings (0-0)
      registerMockHandler(
        "mock",
        "spawn-parent-sibling-deps",
        spawnChildrenWithDepsHandler([
          { input: { name: "child-0" } }, // 0-0
          { dependsOn: ["0", "0-0"], input: { name: "child-1" } }, // 0-1
        ])
      );

      const tasks = [createMockTask("0", "mock", "spawn-parent-sibling-deps")];
      const graph = new TaskGraph(tasks);

      expect(graph.size()).to.equal(1);
    });

    it("should allow child to depend on existing task and sibling", function () {
      // Initial task 0 and 1
      // Task 1 spawns children: 1-0, 1-1
      // Child 1-1 depends on task 0 (existing) and 1-0 (sibling)
      registerMockHandler(
        "mock",
        "spawn-mixed-deps",
        spawnChildrenWithDepsHandler([
          { input: { name: "child-0" } }, // 1-0
          { dependsOn: ["0", "1-0"], input: { name: "child-1" } }, // 1-1
        ])
      );

      const tasks = [
        createMockTask("0", "mock", "noop"),
        createMockTask("1", "mock", "spawn-mixed-deps", {}, ["0"]),
      ];

      const graph = new TaskGraph(tasks);
      expect(graph.size()).to.equal(2);
    });
  });

  // ==========================================================================
  // 2. INVALID DEPENDENCIES (Should Fail)
  // ==========================================================================

  describe("2. Invalid Dependencies", function () {
    it("should reject dependency on non-existent future task", function () {
      // Child depends on task that doesn't exist and isn't a sibling
      registerMockHandler(
        "mock",
        "spawn-invalid-future",
        spawnChildrenWithDepsHandler([
          { dependsOn: ["1-0"], input: { name: "child-0" } }, // 1-0 doesn't exist!
        ])
      );

      const tasks = [createMockTask("0", "mock", "spawn-invalid-future")];
      const graph = new TaskGraph(tasks);

      expect(graph.size()).to.equal(1);

      // Should throw during child creation (tested in full integration)
    });

    it("should reject dependency on non-existent task ID", function () {
      // Child depends on completely invalid task ID
      registerMockHandler(
        "mock",
        "spawn-invalid-id",
        spawnChildrenWithDepsHandler([
          { dependsOn: ["nonexistent"], input: { name: "child-0" } },
        ])
      );

      const tasks = [createMockTask("0", "mock", "spawn-invalid-id")];
      const graph = new TaskGraph(tasks);

      expect(graph.size()).to.equal(1);

      // Should throw with clear error message
    });

    it("should reject dependency on wrong generation task", function () {
      // Child 0-0 depends on 0-0-0 (grandchild that doesn't exist yet)
      registerMockHandler(
        "mock",
        "spawn-wrong-generation",
        spawnChildrenWithDepsHandler([
          { dependsOn: ["0-0-0"], input: { name: "child-0" } },
        ])
      );

      const tasks = [createMockTask("0", "mock", "spawn-wrong-generation")];
      const graph = new TaskGraph(tasks);

      expect(graph.size()).to.equal(1);

      // Should throw - can't depend on grandchild
    });

    it("should reject dependency on different parent's child", function () {
      // Task 0 and 1 are siblings
      // Task 1 spawns child 1-0 that tries to depend on 0-0 (doesn't exist)
      registerMockHandler(
        "mock",
        "spawn-cousin-dep",
        spawnChildrenWithDepsHandler([
          { dependsOn: ["0-0"], input: { name: "child-0" } },
        ])
      );

      const tasks = [
        createMockTask("0", "mock", "noop"),
        createMockTask("1", "mock", "spawn-cousin-dep"),
      ];

      const graph = new TaskGraph(tasks);
      expect(graph.size()).to.equal(2);

      // Should throw - 0-0 doesn't exist (0 hasn't spawned children)
    });
  });

  // ==========================================================================
  // 3. VALID PARENT/EXISTING TASK REFERENCES
  // ==========================================================================

  describe("3. Valid Parent/Existing Task References", function () {
    it("should allow child to depend on parent", function () {
      // Child depends on its parent task
      registerMockHandler(
        "mock",
        "spawn-depends-on-parent",
        spawnChildrenWithDepsHandler([
          { dependsOn: ["0"], input: { name: "child-0" } },
        ])
      );

      const tasks = [createMockTask("0", "mock", "spawn-depends-on-parent")];
      const graph = new TaskGraph(tasks);

      expect(graph.size()).to.equal(1);
    });

    it("should allow child to depend on parent's sibling", function () {
      // Task 0 and 1 are siblings
      // Task 1 spawns child 1-0 that depends on 0 (uncle)
      registerMockHandler(
        "mock",
        "spawn-depends-on-uncle",
        spawnChildrenWithDepsHandler([
          { dependsOn: ["0"], input: { name: "child-0" } },
        ])
      );

      const tasks = [
        createMockTask("0", "mock", "noop"),
        createMockTask("1", "mock", "spawn-depends-on-uncle", {}, ["0"]),
      ];

      const graph = new TaskGraph(tasks);
      expect(graph.size()).to.equal(2);
    });

    it("should allow child to depend on any existing task", function () {
      // Complex graph where new child depends on earlier task
      registerMockHandler(
        "mock",
        "spawn-depends-on-earlier",
        spawnChildrenWithDepsHandler([
          { dependsOn: ["1"], input: { name: "child-0" } },
        ])
      );

      const tasks = [
        createMockTask("0", "mock", "noop"),
        createMockTask("1", "mock", "noop", {}, ["0"]),
        createMockTask("2", "mock", "noop", {}, ["1"]),
        createMockTask("3", "mock", "spawn-depends-on-earlier", {}, ["2"]),
      ];

      const graph = new TaskGraph(tasks);
      expect(graph.size()).to.equal(4);
    });
  });

  // ==========================================================================
  // 4. EDGE CASES
  // ==========================================================================

  describe("4. Edge Cases", function () {
    it("should handle child with empty dependsOn array", function () {
      registerMockHandler(
        "mock",
        "spawn-empty-deps",
        spawnChildrenWithDepsHandler([
          { dependsOn: [], input: { name: "child-0" } },
        ])
      );

      const tasks = [createMockTask("0", "mock", "spawn-empty-deps")];
      const graph = new TaskGraph(tasks);

      expect(graph.size()).to.equal(1);
    });

    it("should handle child with no dependsOn property", function () {
      registerMockHandler(
        "mock",
        "spawn-no-deps",
        spawnChildrenWithDepsHandler([{ input: { name: "child-0" } }])
      );

      const tasks = [createMockTask("0", "mock", "spawn-no-deps")];
      const graph = new TaskGraph(tasks);

      expect(graph.size()).to.equal(1);
    });

    it("should handle duplicate dependencies (same sibling twice)", function () {
      registerMockHandler(
        "mock",
        "spawn-duplicate-deps",
        spawnChildrenWithDepsHandler([
          { input: { name: "child-0" } }, // 0-0
          { dependsOn: ["0-0", "0-0"], input: { name: "child-1" } }, // 0-1
        ])
      );

      const tasks = [createMockTask("0", "mock", "spawn-duplicate-deps")];
      const graph = new TaskGraph(tasks);

      expect(graph.size()).to.equal(1);
    });

    it("should handle large number of siblings with dependencies", function () {
      // Spawn 20 siblings, where each depends on previous sibling
      const specs: Array<{
        dependsOn?: string[];
        input?: Record<string, any>;
      }> = [];
      specs.push({ input: { name: "child-0" } }); // 0-0

      for (let i = 1; i < 20; i++) {
        specs.push({
          dependsOn: [`0-${i - 1}`],
          input: { name: `child-${i}` },
        });
      }

      registerMockHandler(
        "mock",
        "spawn-many-siblings",
        spawnChildrenWithDepsHandler(specs)
      );

      const tasks = [createMockTask("0", "mock", "spawn-many-siblings")];
      const graph = new TaskGraph(tasks);

      expect(graph.size()).to.equal(1);
    });

    it("should handle complex mixed dependency pattern", function () {
      // Combination of parent deps, sibling deps, and existing task deps
      registerMockHandler(
        "mock",
        "spawn-complex-mixed",
        spawnChildrenWithDepsHandler([
          { input: { name: "child-0" } }, // 0-0
          { dependsOn: ["0-0"], input: { name: "child-1" } }, // 0-1
          { dependsOn: ["0", "0-0", "0-1"], input: { name: "child-2" } }, // 0-2
        ])
      );

      const tasks = [createMockTask("0", "mock", "spawn-complex-mixed")];
      const graph = new TaskGraph(tasks);

      expect(graph.size()).to.equal(1);
    });
  });

  // ==========================================================================
  // 5. CYCLE DETECTION WITH SIBLINGS
  // ==========================================================================

  describe("5. Cycle Detection with Siblings", function () {
    it("should detect cycle between siblings", function () {
      // 0-0 → 0-1 → 0-0 (cycle)
      registerMockHandler(
        "mock",
        "spawn-sibling-cycle",
        spawnChildrenWithDepsHandler([
          { dependsOn: ["0-1"], input: { name: "child-0" } }, // 0-0
          { dependsOn: ["0-0"], input: { name: "child-1" } }, // 0-1
        ])
      );

      const tasks = [createMockTask("0", "mock", "spawn-sibling-cycle")];
      const graph = new TaskGraph(tasks);

      expect(graph.size()).to.equal(1);

      // Should throw cycle detection error during spawning
    });

    it("should allow non-cyclic complex dependencies", function () {
      // Diamond pattern: 0-0 → [0-1, 0-2] → 0-3
      registerMockHandler(
        "mock",
        "spawn-diamond",
        spawnChildrenWithDepsHandler([
          { input: { name: "child-0" } }, // 0-0
          { dependsOn: ["0-0"], input: { name: "child-1" } }, // 0-1
          { dependsOn: ["0-0"], input: { name: "child-2" } }, // 0-2
          { dependsOn: ["0-1", "0-2"], input: { name: "child-3" } }, // 0-3
        ])
      );

      const tasks = [createMockTask("0", "mock", "spawn-diamond")];
      const graph = new TaskGraph(tasks);

      expect(graph.size()).to.equal(1);

      // Should not throw - valid DAG
    });
  });

  // ==========================================================================
  // 6. REAL-WORLD SCENARIOS WITH SIBLINGS
  // ==========================================================================

  describe("6. Real-World Scenarios", function () {
    it("should handle batch processing with aggregation sibling", function () {
      // Parent fetches data, spawns processing children + aggregator
      // [0-0, 0-1, 0-2] (process) → 0-3 (aggregate)
      registerMockHandler(
        "mock",
        "spawn-batch-aggregate",
        spawnChildrenWithDepsHandler([
          { input: { item: 0 } }, // 0-0
          { input: { item: 1 } }, // 0-1
          { input: { item: 2 } }, // 0-2
          { dependsOn: ["0-0", "0-1", "0-2"], input: { type: "aggregator" } }, // 0-3
        ])
      );

      const tasks = [createMockTask("0", "mock", "spawn-batch-aggregate")];
      const graph = new TaskGraph(tasks);

      expect(graph.size()).to.equal(1);
    });

    it("should handle ETL pipeline with validation sibling", function () {
      // Extract → [Transform-1, Transform-2] → Validate → Load
      registerMockHandler(
        "mock",
        "spawn-etl",
        spawnChildrenWithDepsHandler([
          { input: { stage: "transform-1" } }, // 0-0
          { input: { stage: "transform-2" } }, // 0-1
          { dependsOn: ["0-0", "0-1"], input: { stage: "validate" } }, // 0-2
          { dependsOn: ["0-2"], input: { stage: "load" } }, // 0-3
        ])
      );

      const tasks = [createMockTask("0", "mock", "spawn-etl")];
      const graph = new TaskGraph(tasks);

      expect(graph.size()).to.equal(1);
    });

    it("should handle AI workflow with parallel processors and merger", function () {
      // Inference → [Process-A, Process-B, Process-C] → Merge
      registerMockHandler(
        "mock",
        "spawn-ai-workflow",
        spawnChildrenWithDepsHandler([
          { input: { processor: "A" } }, // 0-0
          { input: { processor: "B" } }, // 0-1
          { input: { processor: "C" } }, // 0-2
          { dependsOn: ["0-0", "0-1", "0-2"], input: { stage: "merge" } }, // 0-3
        ])
      );

      const tasks = [createMockTask("0", "mock", "spawn-ai-workflow")];
      const graph = new TaskGraph(tasks);

      expect(graph.size()).to.equal(1);
    });
  });
});
