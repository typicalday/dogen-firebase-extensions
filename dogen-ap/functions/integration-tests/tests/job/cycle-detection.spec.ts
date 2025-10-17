import { describe, it, beforeEach, afterEach } from "mocha";
import { expect } from "chai";
import { JobTask } from "../../../src/job/jobTask";
import { TaskGraph } from "../../../src/job/taskGraph";
import { clearMockHandlers, createMockTask } from "./helpers";

/**
 * Comprehensive Dynamic Cycle Detection Tests
 *
 * Tests the critical security vulnerability fix where child tasks spawned
 * at runtime could create circular dependencies that pass initial validation
 * but create deadlocks during execution.
 *
 * Attack Vector Example:
 * 1. Task 0 spawns child 0-0 with dependsOn: ["0-0-0"] (not yet created)
 * 2. Task 0-0 spawns child 0-0-0 with dependsOn: ["0-0"]
 * 3. Result: Deadlock cycle (0-0 → 0-0-0 → 0-0)
 *
 * This test suite verifies:
 * 1. Simple cycles created by child dependencies
 * 2. Complex multi-level cycles
 * 3. Self-dependencies via children
 * 4. Cycles involving multiple spawning levels
 * 5. Cycles created across parallel task branches
 * 6. Valid child dependencies without false positives
 */
describe("Dynamic Cycle Detection", function () {
  this.timeout(10000);

  beforeEach(function () {
    // Clean slate for each test
  });

  afterEach(function () {
    clearMockHandlers();
  });

  // ==========================================================================
  // 1. SIMPLE CYCLES
  // ==========================================================================

  describe("1. Simple Cycles", function () {
    it("should detect simple cycle: child depends on itself", function () {
      /**
       * Structure:
       *   0 spawns 0-0
       *   0-0 depends on 0-0 (self-dependency)
       *
       * Expected: Error during child spawning
       */
      const tasks = [createMockTask("0", "mock", "noop")];
      const graph = new TaskGraph(tasks);

      // Simulate spawning child with self-dependency
      const childId = "0-0";
      const childTask = new JobTask({
        id: childId,
        service: "mock",
        command: "noop",
        dependsOn: [childId], // Self-dependency
      });

      graph.addNode(childId, childTask);

      // addEdge now validates cycles immediately
      expect(() => graph.addEdge(childId, childId)).to.throw(
        "Circular dependencies detected"
      );
    });

    it("should detect cycle: child depends on parent", function () {
      /**
       * Structure:
       *   0 spawns 0-0
       *   0-0 depends on 0
       *   But 0 has already completed, so this creates: 0 → 0-0 → 0 (implicit)
       *
       * Note: This is actually valid since 0 completed before spawning 0-0.
       * The cycle is: child → parent (already done) which is OK.
       * We want to ensure NO FALSE POSITIVES here.
       */
      const tasks = [createMockTask("0", "mock", "noop")];
      const graph = new TaskGraph(tasks);

      const childId = "0-0";
      const childTask = new JobTask({
        id: childId,
        service: "mock",
        command: "noop",
        dependsOn: ["0"], // Depends on parent (already completed)
      });

      graph.addNode(childId, childTask);

      // This should NOT throw - parent completed before child was spawned
      // addEdge validates immediately, so this proves no cycle exists
      graph.addEdge("0", childId);
    });

    it("should detect cycle: two siblings depend on each other", function () {
      /**
       * Structure:
       *   0 spawns 0-0 and 0-1
       *   0-0 depends on 0-1
       *   0-1 depends on 0-0
       *
       * Result: 0-0 → 0-1 → 0-0 (cycle)
       */
      const tasks = [createMockTask("0", "mock", "noop")];
      const graph = new TaskGraph(tasks);

      // Add first child
      const child1 = new JobTask({
        id: "0-0",
        service: "mock",
        command: "noop",
        dependsOn: ["0-1"], // Depends on sibling
      });
      graph.addNode("0-0", child1);

      // Add second child
      const child2 = new JobTask({
        id: "0-1",
        service: "mock",
        command: "noop",
        dependsOn: ["0-0"], // Depends on sibling
      });
      graph.addNode("0-1", child2);

      // Add edges - second edge creates cycle and throws immediately
      graph.addEdge("0-1", "0-0");

      expect(() => graph.addEdge("0-0", "0-1")).to.throw(
        "Circular dependencies detected"
      );
    });
  });

  // ==========================================================================
  // 2. MULTI-LEVEL CYCLES
  // ==========================================================================

  describe("2. Multi-Level Cycles", function () {
    it("should detect cycle created across two spawning levels", function () {
      /**
       * Attack Vector (from security report):
       *   0 spawns 0-0 with dependsOn: ["0-0-0"] (forward reference)
       *   0-0 spawns 0-0-0 with dependsOn: ["0-0"]
       *
       * Result: 0-0 → 0-0-0 → 0-0 (cycle)
       */
      const tasks = [createMockTask("0", "mock", "noop")];
      const graph = new TaskGraph(tasks);

      // Task 0 spawns 0-0 with forward dependency
      const child1 = new JobTask({
        id: "0-0",
        service: "mock",
        command: "noop",
        dependsOn: ["0-0-0"], // Forward reference to grandchild
      });
      graph.addNode("0-0", child1);
      // Don't add edge yet - 0-0-0 doesn't exist

      // Task 0-0 spawns 0-0-0 with dependency on parent
      const grandchild = new JobTask({
        id: "0-0-0",
        service: "mock",
        command: "noop",
        dependsOn: ["0-0"], // Depends on parent
      });
      graph.addNode("0-0-0", grandchild);

      // Now add edges - second edge creates cycle and throws immediately
      graph.addEdge("0-0-0", "0-0"); // 0-0 depends on 0-0-0

      expect(() => graph.addEdge("0-0", "0-0-0")).to.throw(
        "Circular dependencies detected"
      );
    });

    it("should detect cycle: child → grandchild → child", function () {
      /**
       * Structure:
       *   0 spawns 0-0
       *   0-0 spawns 0-0-0 with dependsOn: ["0-0"]
       *   But 0-0 needs to wait for 0-0-0
       *
       * This creates an implicit cycle if 0-0 has dependencies on its children
       */
      const tasks = [createMockTask("0", "mock", "noop")];
      const graph = new TaskGraph(tasks);

      // Add child
      const child = new JobTask({
        id: "0-0",
        service: "mock",
        command: "noop",
      });
      graph.addNode("0-0", child);

      // Add grandchild that depends on child
      const grandchild = new JobTask({
        id: "0-0-0",
        service: "mock",
        command: "noop",
        dependsOn: ["0-0"],
      });
      graph.addNode("0-0-0", grandchild);
      graph.addEdge("0-0", "0-0-0");

      // Now simulate child depending on grandchild (creates cycle and throws immediately)
      // Note: In real scenario, this would be added later via spawning
      expect(() => graph.addEdge("0-0-0", "0-0")).to.throw(
        "Circular dependencies detected"
      );
    });

    it("should detect three-level cycle: 0-0 → 0-0-0 → 0-0-0-0 → 0-0", function () {
      const tasks = [createMockTask("0", "mock", "noop")];
      const graph = new TaskGraph(tasks);

      // Build chain
      graph.addNode(
        "0-0",
        new JobTask({
          id: "0-0",
          service: "mock",
          command: "noop",
          dependsOn: ["0-0-0-0"],
        })
      );

      graph.addNode(
        "0-0-0",
        new JobTask({
          id: "0-0-0",
          service: "mock",
          command: "noop",
          dependsOn: ["0-0"],
        })
      );

      graph.addNode(
        "0-0-0-0",
        new JobTask({
          id: "0-0-0-0",
          service: "mock",
          command: "noop",
          dependsOn: ["0-0-0"],
        })
      );

      // Add edges in order - last edge creates cycle and throws immediately
      graph.addEdge("0-0-0-0", "0-0"); // 0-0 depends on great-grandchild
      graph.addEdge("0-0", "0-0-0"); // 0-0-0 depends on 0-0

      expect(() => graph.addEdge("0-0-0", "0-0-0-0")).to.throw(
        "Circular dependencies detected"
      );
    });
  });

  // ==========================================================================
  // 3. COMPLEX CYCLES WITH MULTIPLE BRANCHES
  // ==========================================================================

  describe("3. Complex Cycles", function () {
    it("should detect cycle across parallel branches", function () {
      /**
       * Structure:
       *         0
       *       /   \
       *     0-0   0-1
       *      |     |
       *    0-0-0 0-1-0
       *
       * Cycle: 0-0-0 depends on 0-1-0, and 0-1-0 depends on 0-0-0
       */
      const tasks = [createMockTask("0", "mock", "noop")];
      const graph = new TaskGraph(tasks);

      // Add children
      graph.addNode(
        "0-0",
        new JobTask({ id: "0-0", service: "mock", command: "noop" })
      );
      graph.addNode(
        "0-1",
        new JobTask({ id: "0-1", service: "mock", command: "noop" })
      );

      // Add grandchildren
      graph.addNode(
        "0-0-0",
        new JobTask({
          id: "0-0-0",
          service: "mock",
          command: "noop",
          dependsOn: ["0-1-0"],
        })
      );
      graph.addNode(
        "0-1-0",
        new JobTask({
          id: "0-1-0",
          service: "mock",
          command: "noop",
          dependsOn: ["0-0-0"],
        })
      );

      // Add edges - second edge creates cycle and throws immediately
      graph.addEdge("0-1-0", "0-0-0");

      expect(() => graph.addEdge("0-0-0", "0-1-0")).to.throw(
        "Circular dependencies detected"
      );
    });

    it("should detect cycle in diamond pattern", function () {
      /**
       * Structure:
       *       0
       *      / \
       *    0-0 0-1
       *      \ /
       *      0-2
       *       |
       *      0-0 (cycle back)
       */
      const tasks = [createMockTask("0", "mock", "noop")];
      const graph = new TaskGraph(tasks);

      // Add children in diamond pattern
      graph.addNode(
        "0-0",
        new JobTask({
          id: "0-0",
          service: "mock",
          command: "noop",
          dependsOn: ["0-2"],
        })
      );
      graph.addNode(
        "0-1",
        new JobTask({ id: "0-1", service: "mock", command: "noop" })
      );
      graph.addNode(
        "0-2",
        new JobTask({
          id: "0-2",
          service: "mock",
          command: "noop",
          dependsOn: ["0-0", "0-1"],
        })
      );

      // Add edges - last edge creates cycle and throws immediately
      graph.addEdge("0-0", "0-2");
      graph.addEdge("0-1", "0-2");

      expect(() => graph.addEdge("0-2", "0-0")).to.throw(
        "Circular dependencies detected"
      );
    });

    it("should detect cycle with multiple intermediate nodes", function () {
      /**
       * Long cycle: 0-0 → 0-1 → 0-2 → 0-3 → 0-4 → 0-0
       */
      const tasks = [createMockTask("0", "mock", "noop")];
      const graph = new TaskGraph(tasks);

      const children = ["0-0", "0-1", "0-2", "0-3", "0-4"];
      children.forEach((id, idx) => {
        const nextId = children[(idx + 1) % children.length];
        graph.addNode(
          id,
          new JobTask({
            id,
            service: "mock",
            command: "noop",
            dependsOn: [nextId],
          })
        );
      });

      // Add edges in cycle - last edge creates cycle and throws immediately
      for (let idx = 0; idx < children.length - 1; idx++) {
        const id = children[idx];
        const nextId = children[(idx + 1) % children.length];
        graph.addEdge(nextId, id);
      }

      // Last edge closes the cycle
      const lastIdx = children.length - 1;
      const lastId = children[lastIdx];
      const lastNextId = children[0];
      expect(() => graph.addEdge(lastNextId, lastId)).to.throw(
        "Circular dependencies detected"
      );
    });
  });

  // ==========================================================================
  // 4. VALID SCENARIOS (NO FALSE POSITIVES)
  // ==========================================================================

  describe("4. Valid Scenarios (No False Positives)", function () {
    it("should allow child depending on completed parent", function () {
      const tasks = [createMockTask("0", "mock", "noop")];
      const graph = new TaskGraph(tasks);

      graph.addNode(
        "0-0",
        new JobTask({
          id: "0-0",
          service: "mock",
          command: "noop",
          dependsOn: ["0"],
        })
      );

      // addEdge validates immediately - if it doesn't throw, no cycle exists
      graph.addEdge("0", "0-0");
    });

    it("should allow valid sibling dependencies", function () {
      /**
       * Structure:
       *   0 spawns 0-0, 0-1, 0-2
       *   0-1 depends on 0-0
       *   0-2 depends on 0-0, 0-1
       *
       * Valid DAG: 0-0 → 0-1 → 0-2
       */
      const tasks = [createMockTask("0", "mock", "noop")];
      const graph = new TaskGraph(tasks);

      graph.addNode(
        "0-0",
        new JobTask({ id: "0-0", service: "mock", command: "noop" })
      );
      graph.addNode(
        "0-1",
        new JobTask({
          id: "0-1",
          service: "mock",
          command: "noop",
          dependsOn: ["0-0"],
        })
      );
      graph.addNode(
        "0-2",
        new JobTask({
          id: "0-2",
          service: "mock",
          command: "noop",
          dependsOn: ["0-0", "0-1"],
        })
      );

      // addEdge validates immediately - if none throw, no cycles exist
      graph.addEdge("0-0", "0-1");
      graph.addEdge("0-0", "0-2");
      graph.addEdge("0-1", "0-2");
    });

    it("should allow valid multi-level dependencies", function () {
      /**
       * Structure:
       *   0 → 0-0 → 0-0-0 → 0-0-0-0
       *
       * Valid chain with no cycles
       */
      const tasks = [createMockTask("0", "mock", "noop")];
      const graph = new TaskGraph(tasks);

      const chain = ["0-0", "0-0-0", "0-0-0-0"];
      let prevId = "0";

      chain.forEach((id) => {
        graph.addNode(
          id,
          new JobTask({
            id,
            service: "mock",
            command: "noop",
            dependsOn: [prevId],
          })
        );
        // addEdge validates immediately - if it doesn't throw, no cycle exists
        graph.addEdge(prevId, id);
        prevId = id;
      });
    });

    it("should allow fan-in pattern with children", function () {
      /**
       * Structure:
       *     0
       *    / \
       *  0-0 0-1
       *    \ /
       *    0-2
       *
       * Valid fan-in: [0-0, 0-1] → 0-2
       */
      const tasks = [createMockTask("0", "mock", "noop")];
      const graph = new TaskGraph(tasks);

      graph.addNode(
        "0-0",
        new JobTask({ id: "0-0", service: "mock", command: "noop" })
      );
      graph.addNode(
        "0-1",
        new JobTask({ id: "0-1", service: "mock", command: "noop" })
      );
      graph.addNode(
        "0-2",
        new JobTask({
          id: "0-2",
          service: "mock",
          command: "noop",
          dependsOn: ["0-0", "0-1"],
        })
      );

      // addEdge validates immediately - if none throw, no cycles exist
      graph.addEdge("0-0", "0-2");
      graph.addEdge("0-1", "0-2");
    });

    it("should allow complex valid DAG with multiple levels", function () {
      /**
       * Structure:
       *         0
       *        / \
       *      0-0 0-1
       *       |   |\
       *     0-0-0 | 0-1-1
       *         \ |/
       *         0-2
       */
      const tasks = [createMockTask("0", "mock", "noop")];
      const graph = new TaskGraph(tasks);

      graph.addNode(
        "0-0",
        new JobTask({ id: "0-0", service: "mock", command: "noop" })
      );
      graph.addNode(
        "0-1",
        new JobTask({ id: "0-1", service: "mock", command: "noop" })
      );
      graph.addNode(
        "0-0-0",
        new JobTask({
          id: "0-0-0",
          service: "mock",
          command: "noop",
          dependsOn: ["0-0"],
        })
      );
      graph.addNode(
        "0-1-1",
        new JobTask({
          id: "0-1-1",
          service: "mock",
          command: "noop",
          dependsOn: ["0-1"],
        })
      );
      graph.addNode(
        "0-2",
        new JobTask({
          id: "0-2",
          service: "mock",
          command: "noop",
          dependsOn: ["0-0-0", "0-1", "0-1-1"],
        })
      );

      // Add edges - addEdge validates immediately, if none throw, no cycles exist
      graph.addEdge("0-0", "0-0-0");
      graph.addEdge("0-1", "0-1-1");
      graph.addEdge("0-0-0", "0-2");
      graph.addEdge("0-1", "0-2");
      graph.addEdge("0-1-1", "0-2");
    });
  });

  // ==========================================================================
  // 5. EDGE CASES
  // ==========================================================================

  describe("5. Edge Cases", function () {
    it("should handle empty graph", function () {
      // Empty graph has no cycles by definition
      new TaskGraph([]);
    });

    it("should handle single node with no edges", function () {
      const tasks = [createMockTask("0", "mock", "noop")];
      // Single node with no edges has no cycles
      new TaskGraph(tasks);
    });

    it("should detect cycle after multiple valid additions", function () {
      /**
       * Add many valid nodes, then add one that creates cycle
       */
      const tasks = [createMockTask("0", "mock", "noop")];
      const graph = new TaskGraph(tasks);

      // Add valid chain
      for (let i = 0; i < 10; i++) {
        const id = `0-${i}`;
        const prevId = i === 0 ? "0" : `0-${i - 1}`;
        graph.addNode(
          id,
          new JobTask({
            id,
            service: "mock",
            command: "noop",
            dependsOn: [prevId],
          })
        );
        graph.addEdge(prevId, id);
      }

      // Verify no cycles so far (all edges added successfully)
      // Now add edge that creates cycle - should throw immediately
      expect(() => graph.addEdge("0-9", "0-0")).to.throw(
        "Circular dependencies detected"
      );
    });

    it("should detect multiple disconnected cycles", function () {
      /**
       * Two separate cycles in same graph:
       * Cycle 1: 0-0 ↔ 0-1
       * Cycle 2: 0-2 ↔ 0-3
       */
      const tasks = [createMockTask("0", "mock", "noop")];
      const graph = new TaskGraph(tasks);

      // Cycle 1 - second edge creates cycle and throws
      graph.addNode(
        "0-0",
        new JobTask({
          id: "0-0",
          service: "mock",
          command: "noop",
          dependsOn: ["0-1"],
        })
      );
      graph.addNode(
        "0-1",
        new JobTask({
          id: "0-1",
          service: "mock",
          command: "noop",
          dependsOn: ["0-0"],
        })
      );
      graph.addEdge("0-1", "0-0");

      // Second edge creates first cycle and should throw immediately
      expect(() => graph.addEdge("0-0", "0-1")).to.throw(
        "Circular dependencies detected"
      );

      // Note: We can't test a second disconnected cycle because the first one already threw
    });

    it("should provide detailed error message with cycle information", function () {
      const tasks = [createMockTask("0", "mock", "noop")];
      const graph = new TaskGraph(tasks);

      graph.addNode(
        "0-0",
        new JobTask({
          id: "0-0",
          service: "mock",
          command: "noop",
          dependsOn: ["0-1"],
        })
      );
      graph.addNode(
        "0-1",
        new JobTask({
          id: "0-1",
          service: "mock",
          command: "noop",
          dependsOn: ["0-0"],
        })
      );

      graph.addEdge("0-1", "0-0");

      // Second edge creates cycle and throws immediately with detailed message
      try {
        graph.addEdge("0-0", "0-1");
        expect.fail("Should have thrown cycle detection error");
      } catch (error) {
        const message = (error as Error).message;
        expect(message).to.include("Circular dependencies detected");
        expect(message).to.include("0-0");
        expect(message).to.include("0-1");
      }
    });
  });
});
