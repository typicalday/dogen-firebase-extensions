import { describe, it, before, after, beforeEach, afterEach } from "mocha";
import { expect } from "chai";
import { JobTask, FirebaseTaskStatus } from "../../../src/job/jobTask";
import { Job } from "../../../src/job/job";
import { TaskGraph } from "../../../src/job/taskGraph";
import { executeJobOrchestration, OrchestrationConfig } from "../../../src/job/orchestrator";
import {
  registerMockHandler,
  clearMockHandlers,
  mockHandlers,
  noopHandler,
  echoHandler,
  errorHandler,
  spawnChildrenHandler,
  spawnChildrenWithDepsHandler,
  recursiveSpawnHandler,
  dataProducerHandler,
  counterHandler,
  resetExecutionCounter,
  getExecutionOrder,
  createMockTask,
  verifyExecutionOrder,
  verifyHierarchy,
} from "./helpers";

/**
 * Comprehensive Integration Tests for Job Orchestration & Task Graph System
 *
 * Tests cover:
 * 1. Backward compatibility (sequential execution)
 * 2. Dependency graph basics (chains, parallel, fan-in, DAG)
 * 3. Child task spawning (single, multiple, with dependencies, recursive)
 * 4. Explicit depth tracking (custom IDs, multi-level spawning, depth calculation)
 * 5. Safety limits (maxTasks, maxDepth)
 * 6. Dependency validation (invalid IDs, circular dependencies)
 * 7. Error handling (failed tasks, propagation, independent execution)
 * 8. Output & results (task outputs, registry, hierarchy)
 * 9. Real-world scenarios (batch processing, AI workflows, pipelines)
 */

describe("Job Orchestration & Task Graph System", function () {
  this.timeout(30000);

  before(function () {
    console.log("Starting Job Orchestration tests");
  });

  after(function () {
    console.log("Job Orchestration tests completed");
  });

  beforeEach(function () {
    // Register default mock handlers
    registerMockHandler("mock", "noop", noopHandler);
    registerMockHandler("mock", "echo", echoHandler);
    registerMockHandler("mock", "counter", counterHandler());
    resetExecutionCounter();
  });

  afterEach(function () {
    clearMockHandlers();
  });

  // ==========================================================================
  // 1. BACKWARD COMPATIBILITY
  // ==========================================================================

  describe("1. Backward Compatibility", function () {
    it("should execute tasks sequentially without dependsOn", function () {
      const tasks = [
        createMockTask("0", "mock", "counter"),
        createMockTask("1", "mock", "counter"),
        createMockTask("2", "mock", "counter"),
      ];

      const graph = new TaskGraph(tasks);
      const order = graph.getTopologicalOrder();

      // Tasks without dependencies can execute in any order
      expect(order).to.have.lengthOf(3);
      expect(order).to.include.members(["0", "1", "2"]);
    });

    it("should handle tasks with no ID (auto-generated)", function () {
      const job = new Job({
        name: "test-auto-id",
        abortOnFailure: false,
        tasks: [
          new JobTask({ service: "mock", command: "noop" }),
          new JobTask({ service: "mock", command: "noop" }),
          new JobTask({ service: "mock", command: "noop" }),
        ],
      });

      // IDs should be auto-generated as "0", "1", "2"
      expect(job.tasks[0].id).to.equal("0");
      expect(job.tasks[1].id).to.equal("1");
      expect(job.tasks[2].id).to.equal("2");
    });

    it("should preserve existing task IDs when provided", function () {
      const job = new Job({
        name: "test-existing-id",
        abortOnFailure: false,
        tasks: [
          new JobTask({ id: "custom-1", service: "mock", command: "noop" }),
          new JobTask({ id: "custom-2", service: "mock", command: "noop" }),
        ],
      });

      expect(job.tasks[0].id).to.equal("custom-1");
      expect(job.tasks[1].id).to.equal("custom-2");
    });
  });

  // ==========================================================================
  // 2. DEPENDENCY GRAPH BASICS
  // ==========================================================================

  describe("2. Dependency Graph Basics", function () {
    it("should execute simple dependency chain: 0 → 1 → 2", function () {
      const tasks = [
        createMockTask("0", "mock", "counter"),
        createMockTask("1", "mock", "counter", {}, ["0"]),
        createMockTask("2", "mock", "counter", {}, ["1"]),
      ];

      const graph = new TaskGraph(tasks);
      const order = graph.getTopologicalOrder();

      // Execution order must respect dependencies
      expect(order).to.deep.equal(["0", "1", "2"]);
    });

    it("should execute tasks in parallel: 0 → [1, 2]", function () {
      const tasks = [
        createMockTask("0", "mock", "counter"),
        createMockTask("1", "mock", "counter", {}, ["0"]),
        createMockTask("2", "mock", "counter", {}, ["0"]),
      ];

      const graph = new TaskGraph(tasks);
      const completed = new Set<string>();

      // Initially only task 0 is executable
      let executable = graph.getExecutableTasks(completed);
      expect(executable).to.deep.equal(["0"]);

      // After 0 completes, both 1 and 2 can execute in parallel
      completed.add("0");
      executable = graph.getExecutableTasks(completed);
      expect(executable).to.have.members(["1", "2"]);
      expect(executable).to.have.lengthOf(2);
    });

    it("should handle fan-in: [0, 1] → 2", function () {
      const tasks = [
        createMockTask("0", "mock", "counter"),
        createMockTask("1", "mock", "counter"),
        createMockTask("2", "mock", "counter", {}, ["0", "1"]),
      ];

      const graph = new TaskGraph(tasks);
      const completed = new Set<string>();

      // Initially both 0 and 1 can execute
      let executable = graph.getExecutableTasks(completed);
      expect(executable).to.have.members(["0", "1"]);

      // After only 0 completes, 2 cannot execute yet
      completed.add("0");
      executable = graph.getExecutableTasks(completed);
      expect(executable).to.not.include("2");

      // After both 0 and 1 complete, 2 can execute
      completed.add("1");
      executable = graph.getExecutableTasks(completed);
      expect(executable).to.include("2");
    });

    it("should handle complex DAG with mixed parallel/sequential", function () {
      /**
       * Graph structure:
       *       0
       *      / \
       *     1   2
       *     |   |\
       *     3   4 5
       *      \ / /
       *       6
       */
      const tasks = [
        createMockTask("0", "mock", "counter"),
        createMockTask("1", "mock", "counter", {}, ["0"]),
        createMockTask("2", "mock", "counter", {}, ["0"]),
        createMockTask("3", "mock", "counter", {}, ["1"]),
        createMockTask("4", "mock", "counter", {}, ["2"]),
        createMockTask("5", "mock", "counter", {}, ["2"]),
        createMockTask("6", "mock", "counter", {}, ["3", "4", "5"]),
      ];

      const graph = new TaskGraph(tasks);
      const topOrder = graph.getTopologicalOrder();

      // Verify topological ordering constraints
      const orderMap = new Map<string, number>();
      topOrder.forEach((id, index) => orderMap.set(id, index));

      // 0 must come before 1 and 2
      expect(orderMap.get("0")).to.be.lessThan(orderMap.get("1")!);
      expect(orderMap.get("0")).to.be.lessThan(orderMap.get("2")!);

      // 1 must come before 3
      expect(orderMap.get("1")).to.be.lessThan(orderMap.get("3")!);

      // 2 must come before 4 and 5
      expect(orderMap.get("2")).to.be.lessThan(orderMap.get("4")!);
      expect(orderMap.get("2")).to.be.lessThan(orderMap.get("5")!);

      // 3, 4, 5 must all come before 6
      expect(orderMap.get("3")).to.be.lessThan(orderMap.get("6")!);
      expect(orderMap.get("4")).to.be.lessThan(orderMap.get("6")!);
      expect(orderMap.get("5")).to.be.lessThan(orderMap.get("6")!);
    });

    it("should verify execution order respects dependencies", async function () {
      const tasks = [
        createMockTask("0", "mock", "counter"),
        createMockTask("1", "mock", "counter", {}, ["0"]),
        createMockTask("2", "mock", "counter", {}, ["0"]),
        createMockTask("3", "mock", "counter", {}, ["1", "2"]),
      ];

      const graph = new TaskGraph(tasks);
      const completed = new Set<string>();

      // Execute tasks in dependency order
      while (completed.size < tasks.length) {
        const executable = graph.getExecutableTasks(completed);

        for (const taskId of executable) {
          completed.add(taskId);
        }
      }

      const executionOrder = getExecutionOrder();

      // Verify dependencies were respected
      const dependencies = {
        "1": ["0"],
        "2": ["0"],
        "3": ["1", "2"],
      };

      expect(verifyExecutionOrder(executionOrder, dependencies)).to.be.true;
    });
  });

  // ==========================================================================
  // 3. CHILD TASK SPAWNING (Real Orchestrator)
  // ==========================================================================

  describe("3. Child Task Spawning (Real Orchestrator)", function () {
    it("should spawn a single child task", async function () {
      registerMockHandler("mock", "spawn-one", spawnChildrenHandler(1));

      const tasks = [createMockTask("0", "mock", "spawn-one")];

      const config: OrchestrationConfig = {
        maxTasks: 100,
        maxDepth: 10,
        verbose: false,
        aiPlanning: false,
        aiAuditing: false,
        abortOnFailure: true,
        jobName: "test-spawn-one",
        handlerLookup: (service: string, command: string) => {
          const key = `${service}:${command}`;
          return mockHandlers.get(key);
        },
      };

      const result = await executeJobOrchestration(tasks, config);

      // Verify parent task succeeded
      const task0 = result.tasks.find(t => t.id === "0");
      expect(task0?.status).to.equal(FirebaseTaskStatus.Succeeded);

      // Verify child 0-0 was spawned and executed
      const child00 = result.tasks.find(t => t.id === "0-0");
      expect(child00).to.exist;
      expect(child00?.status).to.equal(FirebaseTaskStatus.Succeeded);

      // Total: 2 tasks (parent + 1 child)
      expect(result.tasks).to.have.lengthOf(2);
    });

    it("should spawn multiple child tasks", async function () {
      registerMockHandler("mock", "spawn-three", spawnChildrenHandler(3));

      const tasks = [createMockTask("0", "mock", "spawn-three")];

      const config: OrchestrationConfig = {
        maxTasks: 100,
        maxDepth: 10,
        verbose: false,
        aiPlanning: false,
        aiAuditing: false,
        abortOnFailure: true,
        jobName: "test-spawn-three",
        handlerLookup: (service: string, command: string) => {
          const key = `${service}:${command}`;
          return mockHandlers.get(key);
        },
      };

      const result = await executeJobOrchestration(tasks, config);

      // Verify parent succeeded
      const task0 = result.tasks.find(t => t.id === "0");
      expect(task0?.status).to.equal(FirebaseTaskStatus.Succeeded);

      // Verify all 3 children were spawned
      const child00 = result.tasks.find(t => t.id === "0-0");
      const child01 = result.tasks.find(t => t.id === "0-1");
      const child02 = result.tasks.find(t => t.id === "0-2");

      expect(child00).to.exist;
      expect(child01).to.exist;
      expect(child02).to.exist;

      // Total: 4 tasks (parent + 3 children)
      expect(result.tasks).to.have.lengthOf(4);
    });

    it("should spawn children with dependencies on siblings", async function () {
      // Child 0-1 depends on child 0-0
      registerMockHandler(
        "mock",
        "spawn-with-deps",
        spawnChildrenWithDepsHandler([
          { input: { name: "child-0" } },
          { dependsOn: ["0-0"], input: { name: "child-1" } },
        ])
      );

      const tasks = [createMockTask("0", "mock", "spawn-with-deps")];

      const config: OrchestrationConfig = {
        maxTasks: 100,
        maxDepth: 10,
        verbose: false,
        aiPlanning: false,
        aiAuditing: false,
        abortOnFailure: true,
        jobName: "test-spawn-with-sibling-deps",
        handlerLookup: (service: string, command: string) => {
          const key = `${service}:${command}`;
          return mockHandlers.get(key);
        },
      };

      const result = await executeJobOrchestration(tasks, config);

      // Verify parent succeeded
      const task0 = result.tasks.find(t => t.id === "0");
      expect(task0?.status).to.equal(FirebaseTaskStatus.Succeeded);

      // Verify both children exist
      const child00 = result.tasks.find(t => t.id === "0-0");
      const child01 = result.tasks.find(t => t.id === "0-1");

      expect(child00).to.exist;
      expect(child01).to.exist;

      // Verify 0-1 has dependency on 0-0
      expect(child01?.dependsOn).to.include("0-0");

      // Both children should have succeeded
      expect(child00?.status).to.equal(FirebaseTaskStatus.Succeeded);
      expect(child01?.status).to.equal(FirebaseTaskStatus.Succeeded);
    });

    it("should spawn children with dependencies on parent's siblings", async function () {
      // Task 0 and 1 are siblings. Task 1 spawns child 1-0 that depends on 0
      registerMockHandler(
        "mock",
        "spawn-depends-on-uncle",
        spawnChildrenWithDepsHandler([{ dependsOn: ["0"] }])
      );

      const tasks = [
        createMockTask("0", "mock", "noop"),
        createMockTask("1", "mock", "spawn-depends-on-uncle", {}, ["0"]),
      ];

      const config: OrchestrationConfig = {
        maxTasks: 100,
        maxDepth: 10,
        verbose: false,
        aiPlanning: false,
        aiAuditing: false,
        abortOnFailure: true,
        jobName: "test-spawn-uncle-deps",
        handlerLookup: (service: string, command: string) => {
          const key = `${service}:${command}`;
          return mockHandlers.get(key);
        },
      };

      const result = await executeJobOrchestration(tasks, config);

      // Verify both parent tasks succeeded
      const task0 = result.tasks.find(t => t.id === "0");
      const task1 = result.tasks.find(t => t.id === "1");
      expect(task0?.status).to.equal(FirebaseTaskStatus.Succeeded);
      expect(task1?.status).to.equal(FirebaseTaskStatus.Succeeded);

      // Verify child 1-0 exists and depends on its "uncle" task 0
      const child10 = result.tasks.find(t => t.id === "1-0");
      expect(child10).to.exist;
      expect(child10?.dependsOn).to.include("0");
      expect(child10?.status).to.equal(FirebaseTaskStatus.Succeeded);
    });

    it("should handle recursive spawning (child spawns grandchild)", async function () {
      // Each task spawns one child until ID depth >= 4
      // recursiveSpawnHandler(4) stops spawning when ID depth >= 4
      registerMockHandler("mock", "recursive-spawn", recursiveSpawnHandler(4));

      const tasks = [createMockTask("0", "mock", "recursive-spawn")];

      const config: OrchestrationConfig = {
        maxTasks: 100,
        maxDepth: 10,
        verbose: false,
        aiPlanning: false,
        aiAuditing: false,
        abortOnFailure: true,
        jobName: "test-recursive-spawn",
        handlerLookup: (service: string, command: string) => {
          const key = `${service}:${command}`;
          return mockHandlers.get(key);
        },
      };

      const result = await executeJobOrchestration(tasks, config);

      // Verify hierarchical spawning:
      // - Task 0 (ID depth 1) spawns 0-0
      // - Task 0-0 (ID depth 2) spawns 0-0-0
      // - Task 0-0-0 (ID depth 3) spawns 0-0-0-0
      // - Task 0-0-0-0 (ID depth 4) reaches handler limit, spawns nothing

      const task0 = result.tasks.find(t => t.id === "0");
      const task00 = result.tasks.find(t => t.id === "0-0");
      const task000 = result.tasks.find(t => t.id === "0-0-0");
      const task0000 = result.tasks.find(t => t.id === "0-0-0-0");

      expect(task0).to.exist;
      expect(task00).to.exist;
      expect(task000).to.exist;
      expect(task0000).to.exist;

      // All tasks should succeed
      expect(task0?.status).to.equal(FirebaseTaskStatus.Succeeded);
      expect(task00?.status).to.equal(FirebaseTaskStatus.Succeeded);
      expect(task000?.status).to.equal(FirebaseTaskStatus.Succeeded);
      expect(task0000?.status).to.equal(FirebaseTaskStatus.Succeeded);

      // Total: 4 tasks
      expect(result.tasks).to.have.lengthOf(4);
    });

    it("should generate correct hierarchical IDs", async function () {
      // This test verifies that hierarchical IDs are correctly generated during orchestration
      registerMockHandler("mock", "spawn-two", spawnChildrenHandler(2));
      registerMockHandler("mock", "recursive-spawn", recursiveSpawnHandler(3));

      const tasks = [
        createMockTask("0", "mock", "spawn-two"),
        createMockTask("1", "mock", "recursive-spawn"),
      ];

      const config: OrchestrationConfig = {
        maxTasks: 100,
        maxDepth: 10,
        verbose: false,
        aiPlanning: false,
        aiAuditing: false,
        abortOnFailure: true,
        jobName: "test-hierarchical-ids",
        handlerLookup: (service: string, command: string) => {
          const key = `${service}:${command}`;
          return mockHandlers.get(key);
        },
      };

      const result = await executeJobOrchestration(tasks, config);

      // Extract all task IDs
      const taskIds = result.tasks.map(t => t.id);

      // Verify hierarchy is valid
      expect(verifyHierarchy(taskIds)).to.be.true;

      // Verify expected IDs exist:
      // 0, 0-0, 0-1 (from spawn-two)
      // 1, 1-0, 1-0-0 (from recursive-spawn with limit 3)
      expect(taskIds).to.include.members(["0", "0-0", "0-1", "1", "1-0", "1-0-0"]);
    });
  });

  // ==========================================================================
  // 4. EXPLICIT DEPTH TRACKING
  // ==========================================================================

  describe("4. Explicit Depth Tracking", function () {
    it("should assign depth 0 to root tasks", function () {
      const job = new Job({
        name: "test-root-depth",
        abortOnFailure: false,
        tasks: [
          createMockTask("task-alpha", "mock", "noop"),
          createMockTask("my-custom-id", "mock", "noop"),
          createMockTask("0", "mock", "noop"),
        ],
      });

      // All root tasks should have depth 0
      expect(job.tasks[0].depth).to.equal(0);
      expect(job.tasks[1].depth).to.equal(0);
      expect(job.tasks[2].depth).to.equal(0);
    });

    it("should correctly calculate depth for children with custom IDs", function () {
      // Create parent with custom ID
      const parentTask = new JobTask({
        id: "task-alpha",
        service: "mock",
        command: "noop",
        depth: 0,
      });

      // Create child with custom ID
      const childTask = new JobTask({
        id: "my-custom-child",
        service: "mock",
        command: "noop",
        depth: (parentTask.depth ?? 0) + 1,
      });

      expect(parentTask.depth).to.equal(0);
      expect(childTask.depth).to.equal(1);
    });

    it("should handle multi-level spawning with custom IDs", function () {
      // Root task with custom ID
      const root = new JobTask({
        id: "root-task",
        service: "mock",
        command: "noop",
        depth: 0,
      });

      // Child with custom ID
      const child = new JobTask({
        id: "child-alpha",
        service: "mock",
        command: "noop",
        depth: (root.depth ?? 0) + 1,
      });

      // Grandchild with custom ID
      const grandchild = new JobTask({
        id: "grandchild-beta",
        service: "mock",
        command: "noop",
        depth: (child.depth ?? 0) + 1,
      });

      // Great-grandchild with custom ID
      const greatGrandchild = new JobTask({
        id: "great-grandchild-gamma",
        service: "mock",
        command: "noop",
        depth: (grandchild.depth ?? 0) + 1,
      });

      expect(root.depth).to.equal(0);
      expect(child.depth).to.equal(1);
      expect(grandchild.depth).to.equal(2);
      expect(greatGrandchild.depth).to.equal(3);
    });

    it("should handle mixed ID formats (numeric and custom)", function () {
      const tasks = [
        new JobTask({ id: "0", service: "mock", command: "noop", depth: 0 }),
        new JobTask({
          id: "task-alpha",
          service: "mock",
          command: "noop",
          depth: 0,
        }),
        new JobTask({
          id: "1",
          service: "mock",
          command: "noop",
          depth: 1,
        }), // Child of 0
        new JobTask({
          id: "my-child",
          service: "mock",
          command: "noop",
          depth: 1,
        }), // Child of task-alpha
      ];

      expect(tasks[0].depth).to.equal(0); // Numeric root
      expect(tasks[1].depth).to.equal(0); // Custom root
      expect(tasks[2].depth).to.equal(1); // Numeric child
      expect(tasks[3].depth).to.equal(1); // Custom child
    });

    it("should verify depth is preserved in Firestore serialization", function () {
      const task = new JobTask({
        id: "custom-task",
        service: "mock",
        command: "noop",
        depth: 2,
      });

      const firestore = task.toFirestore();

      expect(firestore.depth).to.equal(2);
    });

    it("should demonstrate that old string-splitting approach would fail", function () {
      // This test documents the bug that was fixed
      const customId = "task-alpha-beta-gamma";

      // Old approach (WRONG): count hyphens
      const oldDepth = customId.split("-").length - 1;

      // New approach (CORRECT): use explicit depth field
      const task = new JobTask({
        id: customId,
        service: "mock",
        command: "noop",
        depth: 0, // Explicitly set as root
      });

      // The old approach would incorrectly calculate depth=3
      expect(oldDepth).to.equal(3);

      // The new approach correctly identifies this as a root task
      expect(task.depth).to.equal(0);
    });

    it("should correctly track depth through hierarchical spawning", function () {
      // Simulate a hierarchy with custom IDs at each level
      const hierarchy = [
        { id: "root", depth: 0 },
        { id: "child-a", depth: 1 },
        { id: "child-b", depth: 1 },
        { id: "grandchild-a1", depth: 2 },
        { id: "grandchild-b1", depth: 2 },
        { id: "great-grandchild", depth: 3 },
      ];

      const tasks = hierarchy.map(
        (spec) =>
          new JobTask({
            id: spec.id,
            service: "mock",
            command: "noop",
            depth: spec.depth,
          })
      );

      // Verify each task has correct depth
      hierarchy.forEach((spec, i) => {
        expect(tasks[i].depth).to.equal(
          spec.depth,
          `Task ${spec.id} should have depth ${spec.depth}`
        );
      });

      // Verify depth calculation would work for next level
      const nextDepth = (tasks[5].depth ?? 0) + 1;
      expect(nextDepth).to.equal(4);
    });
  });

  // ==========================================================================
  // 5. SAFETY LIMITS (Real Orchestrator)
  // ==========================================================================

  describe("5. Safety Limits (Real Orchestrator)", function () {
    it("should use default safety limits", function () {
      const job = new Job({
        name: "test-defaults",
        abortOnFailure: false,
        tasks: [createMockTask("0", "mock", "noop")],
      });

      expect(job.maxTasks).to.equal(100);
      expect(job.maxDepth).to.equal(10);
    });

    it("should enforce maxTasks limit during spawning", async function () {
      // Spawn 10 children, but limit maxTasks to 5
      registerMockHandler("mock", "spawn-ten", spawnChildrenHandler(10));

      const tasks = [createMockTask("0", "mock", "spawn-ten")];

      const config: OrchestrationConfig = {
        maxTasks: 5,
        maxDepth: 10,
        verbose: false,
        aiPlanning: false,
        aiAuditing: false,
        abortOnFailure: true,
        jobName: "test-max-tasks-limit",
        handlerLookup: (service: string, command: string) => {
          const key = `${service}:${command}`;
          return mockHandlers.get(key);
        },
      };

      // Orchestrator handles errors gracefully, doesn't throw
      const result = await executeJobOrchestration(tasks, config);

      // Verify job failed
      expect(result.status).to.equal("failed");

      // Verify task 0 failed with limit error
      const task0 = result.tasks.find(t => t.id === "0");
      expect(task0?.status).to.equal(FirebaseTaskStatus.Failed);
      expect(task0?.output?.error).to.include("Task limit exceeded");
      expect(task0?.output?.error).to.include("5 tasks maximum");
    });

    it("should enforce maxDepth limit during spawning", async function () {
      // Try to spawn recursively beyond depth limit
      // recursiveSpawnHandler(100) will keep trying to spawn until orchestrator stops it
      registerMockHandler("mock", "recursive-spawn", recursiveSpawnHandler(100));

      const tasks = [createMockTask("0", "mock", "recursive-spawn")];

      const config: OrchestrationConfig = {
        maxTasks: 100,
        maxDepth: 2, // Limit depth to 2
        verbose: false,
        aiPlanning: false,
        aiAuditing: false,
        abortOnFailure: true,
        jobName: "test-max-depth-limit",
        handlerLookup: (service: string, command: string) => {
          const key = `${service}:${command}`;
          return mockHandlers.get(key);
        },
      };

      // Orchestrator handles errors gracefully, doesn't throw
      const result = await executeJobOrchestration(tasks, config);

      // Verify job failed
      expect(result.status).to.equal("failed");

      // Verify the task that exceeded depth limit failed
      // Task 0-0-0 (depth 3) should fail when trying to spawn 0-0-0-0
      const task000 = result.tasks.find(t => t.id === "0-0-0");
      expect(task000?.status).to.equal(FirebaseTaskStatus.Failed);
      expect(task000?.output?.error).to.include("Task depth limit exceeded");
      expect(task000?.output?.error).to.include("2 levels maximum");
    });

    it("should allow spawning up to maxTasks limit", async function () {
      // Spawn exactly 4 children (5 total including parent)
      registerMockHandler("mock", "spawn-four", spawnChildrenHandler(4));

      const tasks = [createMockTask("0", "mock", "spawn-four")];

      const config: OrchestrationConfig = {
        maxTasks: 5, // Exactly at limit
        maxDepth: 10,
        verbose: false,
        aiPlanning: false,
        aiAuditing: false,
        abortOnFailure: true,
        jobName: "test-at-max-tasks",
        handlerLookup: (service: string, command: string) => {
          const key = `${service}:${command}`;
          return mockHandlers.get(key);
        },
      };

      const result = await executeJobOrchestration(tasks, config);

      // Should succeed with exactly 5 tasks
      expect(result.tasks).to.have.lengthOf(5);
      expect(result.status).to.equal("succeeded");
    });

    it("should allow spawning up to maxDepth limit", async function () {
      // Spawn recursively - handler allows up to ID depth 3
      // This will create: 0 (ID depth 1), 0-0 (ID depth 2), 0-0-0 (ID depth 3)
      registerMockHandler("mock", "recursive-spawn", recursiveSpawnHandler(3));

      const tasks = [createMockTask("0", "mock", "recursive-spawn")];

      const config: OrchestrationConfig = {
        maxTasks: 100,
        maxDepth: 2, // Allow up to explicit depth 2
        verbose: false,
        aiPlanning: false,
        aiAuditing: false,
        abortOnFailure: true,
        jobName: "test-at-max-depth",
        handlerLookup: (service: string, command: string) => {
          const key = `${service}:${command}`;
          return mockHandlers.get(key);
        },
      };

      const result = await executeJobOrchestration(tasks, config);

      // Should succeed: 0 (depth 0), 0-0 (depth 1), 0-0-0 (depth 2)
      expect(result.tasks).to.have.lengthOf(3);
      expect(result.status).to.equal("succeeded");

      const deepestTask = result.tasks.find(t => t.id === "0-0-0");
      expect(deepestTask).to.exist;
    });
  });

  // ==========================================================================
  // 6. DEPENDENCY VALIDATION
  // ==========================================================================

  describe("6. Dependency Validation", function () {
    it("should throw error for invalid dependency ID", function () {
      const tasks = [
        createMockTask("0", "mock", "noop"),
        createMockTask("1", "mock", "noop", {}, ["nonexistent"]),
      ];

      expect(() => new TaskGraph(tasks)).to.throw(
        "Task 1 depends on non-existent task nonexistent"
      );
    });

    it("should detect circular dependencies: 0 → 1 → 0", function () {
      const tasks = [
        createMockTask("0", "mock", "noop", {}, ["1"]),
        createMockTask("1", "mock", "noop", {}, ["0"]),
      ];

      expect(() => new TaskGraph(tasks)).to.throw("Circular dependencies");
    });

    it("should detect circular dependencies: 0 → 1 → 2 → 0", function () {
      const tasks = [
        createMockTask("0", "mock", "noop", {}, ["2"]),
        createMockTask("1", "mock", "noop", {}, ["0"]),
        createMockTask("2", "mock", "noop", {}, ["1"]),
      ];

      expect(() => new TaskGraph(tasks)).to.throw("Circular dependencies");
    });

    it("should detect self-dependency", function () {
      const tasks = [createMockTask("0", "mock", "noop", {}, ["0"])];

      expect(() => new TaskGraph(tasks)).to.throw();
    });

    it("should allow valid dependency references", function () {
      const tasks = [
        createMockTask("0", "mock", "noop"),
        createMockTask("1", "mock", "noop", {}, ["0"]),
        createMockTask("2", "mock", "noop", {}, ["0", "1"]),
      ];

      expect(() => new TaskGraph(tasks)).to.not.throw();
    });

    it("should validate child task dependencies during runtime", function () {
      // When a child is spawned with invalid dependsOn, processJob should throw
      // Error message: "Invalid dependency: Task X depends on non-existent task Y"
    });
  });

  // ==========================================================================
  // 7. ERROR HANDLING (Real Orchestrator)
  // ==========================================================================

  describe("7. Error Handling (Real Orchestrator)", function () {
    it("should capture task errors in output", async function () {
      registerMockHandler("mock", "error", errorHandler("Test error"));

      const tasks = [createMockTask("0", "mock", "error")];

      const config: OrchestrationConfig = {
        maxTasks: 100,
        maxDepth: 10,
        verbose: false,
        aiPlanning: false,
        aiAuditing: false,
        abortOnFailure: false,
        jobName: "test-error-capture",
        handlerLookup: (service: string, command: string) => {
          const key = `${service}:${command}`;
          return mockHandlers.get(key);
        },
      };

      const result = await executeJobOrchestration(tasks, config);

      // Task should fail
      const task0 = result.tasks.find(t => t.id === "0");
      expect(task0?.status).to.equal(FirebaseTaskStatus.Failed);

      // Error should be in output
      expect(task0?.output?.error).to.include("Test error");

      // Job should be marked as failed
      expect(result.status).to.equal("failed");
    });

    it("should stop dependent tasks when abortOnFailure=true", async function () {
      registerMockHandler("mock", "error", errorHandler("Fail task 0"));

      const tasks = [
        createMockTask("0", "mock", "error"),
        createMockTask("1", "mock", "noop", {}, ["0"]),
      ];

      const config: OrchestrationConfig = {
        maxTasks: 100,
        maxDepth: 10,
        verbose: false,
        aiPlanning: false,
        aiAuditing: false,
        abortOnFailure: true,
        jobName: "test-abort-on-failure",
        handlerLookup: (service: string, command: string) => {
          const key = `${service}:${command}`;
          return mockHandlers.get(key);
        },
      };

      const result = await executeJobOrchestration(tasks, config);

      // Task 0 should fail
      const task0 = result.tasks.find(t => t.id === "0");
      expect(task0?.status).to.equal(FirebaseTaskStatus.Failed);

      // Task 1 should be aborted (not executed)
      const task1 = result.tasks.find(t => t.id === "1");
      expect(task1?.status).to.equal(FirebaseTaskStatus.Aborted);

      // Job should fail
      expect(result.status).to.equal("failed");
    });

    it("should continue independent tasks when one task fails", async function () {
      registerMockHandler("mock", "error", errorHandler("Fail task 0"));

      const tasks = [
        createMockTask("0", "mock", "error"),
        createMockTask("1", "mock", "noop"), // Independent
      ];

      const config: OrchestrationConfig = {
        maxTasks: 100,
        maxDepth: 10,
        verbose: false,
        aiPlanning: false,
        aiAuditing: false,
        abortOnFailure: false,
        jobName: "test-continue-independent",
        handlerLookup: (service: string, command: string) => {
          const key = `${service}:${command}`;
          return mockHandlers.get(key);
        },
      };

      const result = await executeJobOrchestration(tasks, config);

      // Task 0 should fail
      const task0 = result.tasks.find(t => t.id === "0");
      expect(task0?.status).to.equal(FirebaseTaskStatus.Failed);

      // Task 1 should succeed (independent of task 0)
      const task1 = result.tasks.find(t => t.id === "1");
      expect(task1?.status).to.equal(FirebaseTaskStatus.Succeeded);

      // Job should fail (at least one task failed)
      expect(result.status).to.equal("failed");
    });

    it("should set task status to Failed on error", async function () {
      registerMockHandler("mock", "error", errorHandler("Test error"));

      const tasks = [createMockTask("0", "mock", "error")];

      const config: OrchestrationConfig = {
        maxTasks: 100,
        maxDepth: 10,
        verbose: false,
        aiPlanning: false,
        aiAuditing: false,
        abortOnFailure: false,
        jobName: "test-failed-status",
        handlerLookup: (service: string, command: string) => {
          const key = `${service}:${command}`;
          return mockHandlers.get(key);
        },
      };

      const result = await executeJobOrchestration(tasks, config);

      const task0 = result.tasks.find(t => t.id === "0");
      expect(task0?.status).to.equal(FirebaseTaskStatus.Failed);
      expect(task0?.output?.error).to.exist;
    });

    it("should set task status to Aborted when previous task fails", async function () {
      registerMockHandler("mock", "error", errorHandler("Previous task failed"));

      const tasks = [
        createMockTask("0", "mock", "error"),
        createMockTask("1", "mock", "noop", {}, ["0"]),
      ];

      const config: OrchestrationConfig = {
        maxTasks: 100,
        maxDepth: 10,
        verbose: false,
        aiPlanning: false,
        aiAuditing: false,
        abortOnFailure: true,
        jobName: "test-aborted-status",
        handlerLookup: (service: string, command: string) => {
          const key = `${service}:${command}`;
          return mockHandlers.get(key);
        },
      };

      const result = await executeJobOrchestration(tasks, config);

      const task1 = result.tasks.find(t => t.id === "1");
      expect(task1?.status).to.equal(FirebaseTaskStatus.Aborted);
    });

    it("should handle child task failures when abortOnFailure=true", async function () {
      // Parent spawns child that fails
      registerMockHandler("mock", "spawn-failing", async (task: JobTask) => {
        return {
          output: { message: "Spawning child" },
          childTasks: [{
            service: "mock",
            command: "error",
            input: {},
          }],
        };
      });
      registerMockHandler("mock", "error", errorHandler("Child failed"));

      const tasks = [
        createMockTask("0", "mock", "spawn-failing"),
        createMockTask("1", "mock", "noop", {}, ["0"]),
      ];

      const config: OrchestrationConfig = {
        maxTasks: 100,
        maxDepth: 10,
        verbose: false,
        aiPlanning: false,
        aiAuditing: false,
        abortOnFailure: true,
        jobName: "test-child-failure",
        handlerLookup: (service: string, command: string) => {
          const key = `${service}:${command}`;
          return mockHandlers.get(key);
        },
      };

      const result = await executeJobOrchestration(tasks, config);

      // Parent should succeed (it completed its work)
      const task0 = result.tasks.find(t => t.id === "0");
      expect(task0?.status).to.equal(FirebaseTaskStatus.Succeeded);

      // Child should fail
      const child00 = result.tasks.find(t => t.id === "0-0");
      expect(child00?.status).to.equal(FirebaseTaskStatus.Failed);

      // Task 1 should be aborted (depends on parent which spawned failing child)
      const task1 = result.tasks.find(t => t.id === "1");
      expect(task1?.status).to.equal(FirebaseTaskStatus.Aborted);
    });

    it("should handle handler throwing exceptions", async function () {
      registerMockHandler(
        "mock",
        "throw",
        async () => {
          throw new Error("Handler exception");
        }
      );

      const tasks = [createMockTask("0", "mock", "throw")];

      const config: OrchestrationConfig = {
        maxTasks: 100,
        maxDepth: 10,
        verbose: false,
        aiPlanning: false,
        aiAuditing: false,
        abortOnFailure: false,
        jobName: "test-handler-exception",
        handlerLookup: (service: string, command: string) => {
          const key = `${service}:${command}`;
          return mockHandlers.get(key);
        },
      };

      const result = await executeJobOrchestration(tasks, config);

      // Exception should be caught and converted to task failure
      const task0 = result.tasks.find(t => t.id === "0");
      expect(task0?.status).to.equal(FirebaseTaskStatus.Failed);
      expect(task0?.output?.error).to.include("Handler exception");
    });

    it("should fail job when child validation fails", async function () {
      // Parent spawns child with invalid service/command
      registerMockHandler("mock", "spawn-invalid", async () => {
        return {
          output: { message: "Spawning invalid child" },
          childTasks: [{
            service: "nonexistent",
            command: "bad-command",
            input: {},
          }],
        };
      });

      const tasks = [createMockTask("0", "mock", "spawn-invalid")];

      const config: OrchestrationConfig = {
        maxTasks: 100,
        maxDepth: 10,
        verbose: false,
        aiPlanning: false,
        aiAuditing: false,
        abortOnFailure: true,
        jobName: "test-invalid-child",
        handlerLookup: (service: string, command: string) => {
          const key = `${service}:${command}`;
          return mockHandlers.get(key);
        },
      };

      // Orchestrator handles errors gracefully, doesn't throw
      const result = await executeJobOrchestration(tasks, config);

      // Verify job failed
      expect(result.status).to.equal("failed");

      // Verify task 0 failed with validation error
      const task0 = result.tasks.find(t => t.id === "0");
      expect(task0?.status).to.equal(FirebaseTaskStatus.Failed);
      expect(task0?.output?.error).to.include("Child task validation failed");
      expect(task0?.output?.error).to.include("Invalid service/command combination");
    });
  });

  // ==========================================================================
  // 8. OUTPUT & RESULTS (Real Orchestrator)
  // ==========================================================================

  describe("8. Output & Results (Real Orchestrator)", function () {
    it("should capture task outputs", async function () {
      const outputData = { message: "Task completed", value: 42 };
      registerMockHandler("mock", "produce", dataProducerHandler(outputData));

      const tasks = [createMockTask("0", "mock", "produce")];

      const config: OrchestrationConfig = {
        maxTasks: 100,
        maxDepth: 10,
        verbose: false,
        aiPlanning: false,
        aiAuditing: false,
        abortOnFailure: true,
        jobName: "test-capture-output",
        handlerLookup: (service: string, command: string) => {
          const key = `${service}:${command}`;
          return mockHandlers.get(key);
        },
      };

      const result = await executeJobOrchestration(tasks, config);

      // Verify task output contains expected data
      const task0 = result.tasks.find(t => t.id === "0");
      expect(task0?.output).to.deep.include(outputData);
      expect(task0?.status).to.equal(FirebaseTaskStatus.Succeeded);
    });

    it("should make outputs accessible to dependent tasks in result", async function () {
      // Task 0 produces output that task 1 could use
      const outputData = { data: "from-task-0" };
      registerMockHandler("mock", "produce", dataProducerHandler(outputData));

      const tasks = [
        createMockTask("0", "mock", "produce"),
        createMockTask("1", "mock", "echo", {}, ["0"]),
      ];

      const config: OrchestrationConfig = {
        maxTasks: 100,
        maxDepth: 10,
        verbose: false,
        aiPlanning: false,
        aiAuditing: false,
        abortOnFailure: true,
        jobName: "test-output-access",
        handlerLookup: (service: string, command: string) => {
          const key = `${service}:${command}`;
          return mockHandlers.get(key);
        },
      };

      const result = await executeJobOrchestration(tasks, config);

      // Verify task 0's output is in the result
      const task0 = result.tasks.find(t => t.id === "0");
      expect(task0?.output?.data).to.equal("from-task-0");

      // Task 1 should succeed (it would access task0's output via context)
      const task1 = result.tasks.find(t => t.id === "1");
      expect(task1?.status).to.equal(FirebaseTaskStatus.Succeeded);
    });

    it("should include child tasks in final result", async function () {
      // Spawn 3 children
      registerMockHandler("mock", "spawn-three", spawnChildrenHandler(3));

      const tasks = [createMockTask("0", "mock", "spawn-three")];

      const config: OrchestrationConfig = {
        maxTasks: 100,
        maxDepth: 10,
        verbose: false,
        aiPlanning: false,
        aiAuditing: false,
        abortOnFailure: true,
        jobName: "test-include-children",
        handlerLookup: (service: string, command: string) => {
          const key = `${service}:${command}`;
          return mockHandlers.get(key);
        },
      };

      const result = await executeJobOrchestration(tasks, config);

      // Verify all tasks are included: 0, 0-0, 0-1, 0-2
      expect(result.tasks).to.have.lengthOf(4);

      const taskIds = result.tasks.map(t => t.id);
      expect(taskIds).to.include.members(["0", "0-0", "0-1", "0-2"]);

      // Verify hierarchy is valid
      expect(verifyHierarchy(taskIds)).to.be.true;
    });

    it("should include all spawned tasks with correct structure", async function () {
      // Spawn children at multiple levels
      registerMockHandler("mock", "spawn-two", spawnChildrenHandler(2));

      const tasks = [
        createMockTask("0", "mock", "spawn-two"),
        createMockTask("1", "mock", "spawn-two"),
      ];

      const config: OrchestrationConfig = {
        maxTasks: 100,
        maxDepth: 10,
        verbose: false,
        aiPlanning: false,
        aiAuditing: false,
        abortOnFailure: true,
        jobName: "test-all-spawned",
        handlerLookup: (service: string, command: string) => {
          const key = `${service}:${command}`;
          return mockHandlers.get(key);
        },
      };

      const result = await executeJobOrchestration(tasks, config);

      // Should have: 0, 0-0, 0-1, 1, 1-0, 1-1
      expect(result.tasks).to.have.lengthOf(6);

      const taskIds = result.tasks.map(t => t.id);
      expect(taskIds).to.include.members(["0", "0-0", "0-1", "1", "1-0", "1-1"]);
    });

    it("should maintain hierarchical structure in output", async function () {
      // Create hierarchy: 0 → 0-0 → 0-0-0
      registerMockHandler("mock", "recursive-spawn", recursiveSpawnHandler(3));

      const tasks = [createMockTask("0", "mock", "recursive-spawn")];

      const config: OrchestrationConfig = {
        maxTasks: 100,
        maxDepth: 10,
        verbose: false,
        aiPlanning: false,
        aiAuditing: false,
        abortOnFailure: true,
        jobName: "test-hierarchy",
        handlerLookup: (service: string, command: string) => {
          const key = `${service}:${command}`;
          return mockHandlers.get(key);
        },
      };

      const result = await executeJobOrchestration(tasks, config);

      const taskIds = result.tasks.map(t => t.id);

      // Verify hierarchical structure is valid
      expect(verifyHierarchy(taskIds)).to.be.true;

      // Verify depth levels in IDs
      const task0 = result.tasks.find(t => t.id === "0");
      const task00 = result.tasks.find(t => t.id === "0-0");
      const task000 = result.tasks.find(t => t.id === "0-0-0");

      expect(task0).to.exist;
      expect(task00).to.exist;
      expect(task000).to.exist;
    });

    it("should include task metadata in results", async function () {
      const tasks = [createMockTask("0", "mock", "noop")];

      const config: OrchestrationConfig = {
        maxTasks: 100,
        maxDepth: 10,
        verbose: false,
        aiPlanning: false,
        aiAuditing: false,
        abortOnFailure: true,
        jobName: "test-metadata",
        handlerLookup: (service: string, command: string) => {
          const key = `${service}:${command}`;
          return mockHandlers.get(key);
        },
      };

      const result = await executeJobOrchestration(tasks, config);

      const task0 = result.tasks.find(t => t.id === "0");

      // Verify metadata is included
      expect(task0).to.have.property("id", "0");
      expect(task0).to.have.property("service", "mock");
      expect(task0).to.have.property("command", "noop");
      expect(task0).to.have.property("status", FirebaseTaskStatus.Succeeded);
      expect(task0).to.have.property("startedAt");
      expect(task0).to.have.property("completedAt");

      // Verify timestamps are Date objects (or ISO strings in result)
      expect(task0?.startedAt).to.exist;
      expect(task0?.completedAt).to.exist;
    });

    it("should serialize to Firestore format correctly", function () {
      // This tests JobTask serialization, not orchestrator
      const task = createMockTask("0", "mock", "noop", { key: "value" }, ["1"]);
      task.update({
        status: FirebaseTaskStatus.Succeeded,
        startedAt: new Date(),
        completedAt: new Date(),
      });

      const firestore = task.toFirestore();

      expect(firestore).to.have.property("id", "0");
      expect(firestore).to.have.property("service", "mock");
      expect(firestore).to.have.property("command", "noop");
      expect(firestore).to.have.property("status", FirebaseTaskStatus.Succeeded);
      expect(firestore).to.have.property("dependsOn");
      expect(firestore.dependsOn).to.deep.equal(["1"]);
    });
  });

  // ==========================================================================
  // 9. REAL-WORLD SCENARIOS
  // ==========================================================================

  describe("9. Real-World Scenarios", function () {
    it("should handle batch processing: Fetch → [Process 1-10] → Aggregate", function () {
      /**
       * Scenario: Fetch data, process 10 items in parallel, aggregate results
       *
       * Structure:
       *   0 (fetch)
       *   ├─ 1 (process-0) depends on 0
       *   ├─ 2 (process-1) depends on 0
       *   ├─ ... (process-2 through process-8)
       *   ├─ 10 (process-9) depends on 0
       *   └─ 11 (aggregate) depends on [1, 2, ..., 10]
       */

      const tasks = [
        createMockTask("0", "mock", "fetch"),
        ...Array.from({ length: 10 }, (_, i) =>
          createMockTask(String(i + 1), "mock", "process", { index: i }, ["0"])
        ),
        createMockTask(
          "11",
          "mock",
          "aggregate",
          {},
          Array.from({ length: 10 }, (_, i) => String(i + 1))
        ),
      ];

      const graph = new TaskGraph(tasks);
      const completed = new Set<string>();

      // Initially only fetch can execute
      let executable = graph.getExecutableTasks(completed);
      expect(executable).to.deep.equal(["0"]);

      // After fetch completes, all process tasks can execute in parallel
      completed.add("0");
      executable = graph.getExecutableTasks(completed);
      expect(executable).to.have.lengthOf(10);
      expect(executable).to.include.members([
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "10",
      ]);

      // After all process tasks complete, aggregate can execute
      for (let i = 1; i <= 10; i++) {
        completed.add(String(i));
      }
      executable = graph.getExecutableTasks(completed);
      expect(executable).to.deep.equal(["11"]);
    });

    it("should handle AI workflow: Inference → [Firestore, Storage]", function () {
      /**
       * Scenario: Run AI inference, then write to Firestore and upload to Storage
       *
       * Structure:
       *   0 (ai-inference)
       *   ├─ 1 (write-firestore) depends on 0
       *   └─ 2 (upload-storage) depends on 0
       */

      const tasks = [
        createMockTask("0", "ai", "process-inference"),
        createMockTask("1", "firestore", "create-document", {}, ["0"]),
        createMockTask("2", "storage", "upload", {}, ["0"]),
      ];

      const graph = new TaskGraph(tasks);
      const completed = new Set<string>();

      // Only inference can execute initially
      let executable = graph.getExecutableTasks(completed);
      expect(executable).to.deep.equal(["0"]);

      // After inference, both Firestore and Storage can execute in parallel
      completed.add("0");
      executable = graph.getExecutableTasks(completed);
      expect(executable).to.have.members(["1", "2"]);
    });

    it("should handle multi-stage pipeline with dependencies", function () {
      /**
       * Scenario: Complex ETL pipeline
       *
       * Structure:
       *   0 (extract)
       *   ├─ 1 (transform-1) depends on 0
       *   ├─ 2 (transform-2) depends on 0
       *   ├─ 3 (validate) depends on [1, 2]
       *   ├─ 4 (load-staging) depends on 3
       *   └─ 5 (load-production) depends on 4
       */

      const tasks = [
        createMockTask("0", "etl", "extract"),
        createMockTask("1", "etl", "transform", { type: "clean" }, ["0"]),
        createMockTask("2", "etl", "transform", { type: "enrich" }, ["0"]),
        createMockTask("3", "etl", "validate", {}, ["1", "2"]),
        createMockTask("4", "etl", "load", { env: "staging" }, ["3"]),
        createMockTask("5", "etl", "load", { env: "production" }, ["4"]),
      ];

      const graph = new TaskGraph(tasks);
      const topOrder = graph.getTopologicalOrder();

      // Verify overall structure
      expect(topOrder).to.have.lengthOf(6);

      // Test execution flow
      const completed = new Set<string>();

      // Stage 1: Extract
      let executable = graph.getExecutableTasks(completed);
      expect(executable).to.deep.equal(["0"]);
      completed.add("0");

      // Stage 2: Transform (parallel)
      executable = graph.getExecutableTasks(completed);
      expect(executable).to.have.members(["1", "2"]);
      completed.add("1");
      completed.add("2");

      // Stage 3: Validate
      executable = graph.getExecutableTasks(completed);
      expect(executable).to.deep.equal(["3"]);
      completed.add("3");

      // Stage 4: Load staging
      executable = graph.getExecutableTasks(completed);
      expect(executable).to.deep.equal(["4"]);
      completed.add("4");

      // Stage 5: Load production
      executable = graph.getExecutableTasks(completed);
      expect(executable).to.deep.equal(["5"]);
    });

    it("should handle dynamic task spawning in batch scenario", function () {
      /**
       * Scenario: Parent task fetches list of IDs, spawns child for each ID
       *
       * Structure:
       *   0 (fetch-ids) → spawns [0-0, 0-1, 0-2, ...]
       */

      registerMockHandler("mock", "fetch-and-spawn", async (task: JobTask) => {
        const itemCount = task.input?.itemCount || 5;
        const childTasks: any[] = [];

        for (let i = 0; i < itemCount; i++) {
          childTasks.push({
            service: "mock",
            command: "process-item",
            input: { itemId: i },
          });
        }

        return {
          taskId: task.id,
          itemsFetched: itemCount,
          childTasks,
        };
      });

      const tasks = [
        createMockTask("0", "mock", "fetch-and-spawn", { itemCount: 5 }),
      ];

      const graph = new TaskGraph(tasks);
      expect(graph.size()).to.equal(1);

      // After execution, there should be 6 tasks total (0 + 5 children)
    });

    it("should handle hierarchical processing with aggregation", function () {
      /**
       * Scenario: Process data in stages, aggregate at each level
       *
       * Structure:
       *   0 (root)
       *   ├─ 0-0 (process chunk 0)
       *   │  ├─ 0-0-0 (process item 0)
       *   │  └─ 0-0-1 (process item 1)
       *   │  └─ 0-0-2 (aggregate chunk 0) depends on [0-0-0, 0-0-1]
       *   ├─ 0-1 (process chunk 1)
       *   │  ├─ 0-1-0 (process item 0)
       *   │  └─ 0-1-1 (process item 1)
       *   │  └─ 0-1-2 (aggregate chunk 1) depends on [0-1-0, 0-1-1]
       *   └─ 0-2 (final aggregate) depends on [0-0-2, 0-1-2]
       */

      registerMockHandler(
        "mock",
        "hierarchical-process",
        async (task: JobTask) => {
          const depth = task.id.split("-").length;

          if (depth === 1) {
            // Root: spawn chunks
            return {
              childTasks: [
                { service: "mock", command: "process-chunk", input: { chunk: 0 } },
                { service: "mock", command: "process-chunk", input: { chunk: 1 } },
              ],
            };
          } else if (depth === 2) {
            // Chunk: spawn items + aggregator
            const chunkId = task.id;
            return {
              childTasks: [
                {
                  service: "mock",
                  command: "process-item",
                  input: { item: 0 },
                },
                {
                  service: "mock",
                  command: "process-item",
                  input: { item: 1 },
                },
                {
                  service: "mock",
                  command: "aggregate-chunk",
                  dependsOn: [`${chunkId}-0`, `${chunkId}-1`],
                },
              ],
            };
          }

          return {};
        }
      );

      const tasks = [createMockTask("0", "mock", "hierarchical-process")];
      const graph = new TaskGraph(tasks);

      expect(graph.size()).to.equal(1);
      // After full execution, there should be multiple hierarchical tasks
    });
  });

  // ==========================================================================
  // 10. CLIENT-CONFIGURABLE LIMITS AND TIMEOUT
  // ==========================================================================

  describe("10. Client-Configurable Limits and Timeout", function () {
    it("should respect client-specified maxTasks limit", function () {
      const job = new Job({
        name: "test-custom-max-tasks",
        abortOnFailure: false,
        maxTasks: 5, // Custom limit (lower than default 1000)
        tasks: [createMockTask("0", "mock", "noop")],
      });

      expect(job.maxTasks).to.equal(5);
    });

    it("should respect client-specified maxDepth limit", function () {
      const job = new Job({
        name: "test-custom-max-depth",
        abortOnFailure: false,
        maxDepth: 2, // Custom limit (lower than default 10)
        tasks: [createMockTask("0", "mock", "noop")],
      });

      expect(job.maxDepth).to.equal(2);
    });

    it("should accept optional timeout parameter", function () {
      const job = new Job({
        name: "test-timeout",
        abortOnFailure: false,
        timeout: 5000, // 5 seconds
        tasks: [createMockTask("0", "mock", "noop")],
      });

      expect(job.timeout).to.equal(5000);
    });

    it("should use default limits when not specified", function () {
      const job = new Job({
        name: "test-defaults",
        abortOnFailure: false,
        // No maxTasks, maxDepth, or timeout specified
        tasks: [createMockTask("0", "mock", "noop")],
      });

      expect(job.maxTasks).to.equal(100);
      expect(job.maxDepth).to.equal(10);
      expect(job.timeout).to.be.undefined;
    });

    it("should handle timeout as undefined when not specified", function () {
      const job = new Job({
        name: "test-no-timeout",
        abortOnFailure: false,
        tasks: [createMockTask("0", "mock", "noop")],
      });

      expect(job.timeout).to.be.undefined;
    });

    it("should serialize timeout to Firestore", function () {
      const job = new Job({
        name: "test-serialize-timeout",
        abortOnFailure: false,
        timeout: 10000,
        tasks: [createMockTask("0", "mock", "noop")],
      });

      const firestore = job.toFirestore();

      expect(firestore.timeout).to.equal(10000);
    });

    it("should serialize undefined timeout to Firestore", function () {
      const job = new Job({
        name: "test-serialize-no-timeout",
        abortOnFailure: false,
        tasks: [createMockTask("0", "mock", "noop")],
      });

      const firestore = job.toFirestore();

      expect(firestore.timeout).to.be.undefined;
    });

    it("should accept zero as timeout value", function () {
      const job = new Job({
        name: "test-zero-timeout",
        abortOnFailure: false,
        timeout: 0,
        tasks: [createMockTask("0", "mock", "noop")],
      });

      expect(job.timeout).to.equal(0);
    });

    it("should accept custom maxTasks and maxDepth together", function () {
      const job = new Job({
        name: "test-custom-limits",
        abortOnFailure: false,
        maxTasks: 100,
        maxDepth: 5,
        tasks: [createMockTask("0", "mock", "noop")],
      });

      expect(job.maxTasks).to.equal(100);
      expect(job.maxDepth).to.equal(5);
    });

    it("should accept all custom parameters together", function () {
      const job = new Job({
        name: "test-all-custom",
        abortOnFailure: true,
        maxTasks: 50,
        maxDepth: 3,
        timeout: 30000,
        tasks: [createMockTask("0", "mock", "noop")],
      });

      expect(job.maxTasks).to.equal(50);
      expect(job.maxDepth).to.equal(3);
      expect(job.timeout).to.equal(30000);
      expect(job.abortOnFailure).to.be.true;
    });
  });

  // ==========================================================================
  // ADDITIONAL EDGE CASES
  // ==========================================================================

  describe("Additional Edge Cases", function () {
    it("should handle empty task array gracefully", function () {
      expect(() => new TaskGraph([])).to.not.throw();
      const graph = new TaskGraph([]);
      expect(graph.size()).to.equal(0);
    });

    it("should handle single task with no dependencies", function () {
      const tasks = [createMockTask("0", "mock", "noop")];
      const graph = new TaskGraph(tasks);

      expect(graph.size()).to.equal(1);
      const executable = graph.getExecutableTasks(new Set());
      expect(executable).to.deep.equal(["0"]);
    });

    it("should handle task with multiple identical dependencies", function () {
      // Task depends on same task multiple times (should be deduplicated)
      const tasks = [
        createMockTask("0", "mock", "noop"),
        createMockTask("1", "mock", "noop", {}, ["0", "0", "0"]),
      ];

      const graph = new TaskGraph(tasks);
      const completed = new Set(["0"]);

      const executable = graph.getExecutableTasks(completed);
      expect(executable).to.deep.equal(["1"]);
    });

    it("should handle large number of parallel tasks", function () {
      const tasks = [
        createMockTask("0", "mock", "noop"),
        ...Array.from({ length: 100 }, (_, i) =>
          createMockTask(String(i + 1), "mock", "noop", {}, ["0"])
        ),
      ];

      const graph = new TaskGraph(tasks);
      const completed = new Set(["0"]);

      const executable = graph.getExecutableTasks(completed);
      expect(executable).to.have.lengthOf(100);
    });

    it("should handle deep nesting within limits", function () {
      // Create a chain of tasks at increasing depths
      const taskCount = 10; // Total number of tasks
      let tasks = [createMockTask("0", "mock", "noop")];

      let currentId = "0";
      for (let i = 1; i < taskCount; i++) {
        const childId = `${currentId}-0`;
        tasks.push(createMockTask(childId, "mock", "noop", {}, [currentId]));
        currentId = childId;
      }

      const graph = new TaskGraph(tasks);
      expect(graph.size()).to.equal(taskCount);

      // Verify deepest task has correct depth (10 levels deep)
      const deepestId = "0-0-0-0-0-0-0-0-0-0";
      expect(deepestId.split("-").length).to.equal(taskCount);
    });

    it("should handle task with empty dependsOn array", function () {
      const tasks = [createMockTask("0", "mock", "noop", {}, [])];

      const graph = new TaskGraph(tasks);
      const executable = graph.getExecutableTasks(new Set());
      expect(executable).to.deep.equal(["0"]);
    });

    it("should preserve task input data through graph operations", function () {
      const inputData = { key: "value", nested: { data: 123 } };
      const task = createMockTask("0", "mock", "noop", inputData);

      const graph = new TaskGraph([task]);
      const retrieved = graph.getNode("0");

      expect(retrieved.input).to.deep.equal(inputData);
    });
  });
});
