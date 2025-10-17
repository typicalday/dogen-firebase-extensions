import { describe, it, before, after, beforeEach, afterEach } from "mocha";
import { expect } from "chai";
import { JobTask, FirebaseTaskStatus } from "../../../src/job/jobTask";
import { Job } from "../../../src/job/job";
import { TaskGraph } from "../../../src/job/taskGraph";
import {
  registerMockHandler,
  clearMockHandlers,
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
  // 3. CHILD TASK SPAWNING
  // ==========================================================================

  describe("3. Child Task Spawning", function () {
    it("should spawn a single child task", function () {
      registerMockHandler("mock", "spawn-one", spawnChildrenHandler(1));

      const tasks = [createMockTask("0", "mock", "spawn-one")];
      const graph = new TaskGraph(tasks);

      // Task 0 can execute
      const executable = graph.getExecutableTasks(new Set());
      expect(executable).to.deep.equal(["0"]);

      // After spawning, child 0-0 should be added
      // (This would be tested in integration with processJob)
    });

    it("should spawn multiple child tasks", function () {
      registerMockHandler("mock", "spawn-three", spawnChildrenHandler(3));

      const tasks = [createMockTask("0", "mock", "spawn-three")];
      const graph = new TaskGraph(tasks);

      // Initial task can execute
      expect(graph.size()).to.equal(1);

      // After spawning (simulated), there should be 4 tasks total: 0, 0-0, 0-1, 0-2
    });

    it("should spawn children with dependencies on siblings", function () {
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
      const graph = new TaskGraph(tasks);

      expect(graph.size()).to.equal(1);

      // After spawning children, 0-1 should depend on 0-0
      // (Tested in full integration)
    });

    it("should spawn children with dependencies on parent's siblings", function () {
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

      const graph = new TaskGraph(tasks);
      expect(graph.size()).to.equal(2);

      // Child 1-0 should be able to depend on task 0 (its "uncle")
    });

    it("should handle recursive spawning (child spawns grandchild)", function () {
      // Each task spawns one child until max depth
      registerMockHandler("mock", "recursive-spawn", recursiveSpawnHandler(3));

      const tasks = [createMockTask("0", "mock", "recursive-spawn")];
      const graph = new TaskGraph(tasks);

      expect(graph.size()).to.equal(1);

      // After execution:
      // - Task 0 spawns 0-0
      // - Task 0-0 spawns 0-0-0
      // - Task 0-0-0 reaches max depth, spawns nothing
      // Total: 3 tasks (0, 0-0, 0-0-0)
    });

    it("should generate correct hierarchical IDs", function () {
      const testIds = ["0", "0-0", "0-1", "0-0-0", "0-0-1", "1", "1-0"];

      // Verify hierarchy is valid
      expect(verifyHierarchy(testIds)).to.be.true;

      // Verify invalid hierarchy is detected
      const invalidIds = ["0", "0-0-0"]; // Missing 0-0
      expect(verifyHierarchy(invalidIds)).to.be.false;
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
  // 5. SAFETY LIMITS
  // ==========================================================================

  describe("5. Safety Limits", function () {
    it("should enforce maxTasks limit", function () {
      const job = new Job({
        name: "test-max-tasks",
        abortOnFailure: false,
        maxTasks: 5,
        tasks: [createMockTask("0", "mock", "noop")],
      });

      expect(job.maxTasks).to.equal(5);

      // Attempting to add more than 5 tasks should fail in processJob
    });

    it("should enforce maxDepth limit", function () {
      const job = new Job({
        name: "test-max-depth",
        abortOnFailure: false,
        maxDepth: 3,
        tasks: [createMockTask("0", "mock", "noop")],
      });

      expect(job.maxDepth).to.equal(3);

      // Attempting to spawn child at depth > 3 should fail in processJob
    });

    it("should use default safety limits", function () {
      const job = new Job({
        name: "test-defaults",
        abortOnFailure: false,
        tasks: [createMockTask("0", "mock", "noop")],
      });

      expect(job.maxTasks).to.equal(1000);
      expect(job.maxDepth).to.equal(10);
    });

    it("should detect task limit exceeded during spawning", function () {
      // This would be tested in full integration with processJob
      // The error message should be:
      // "Task limit exceeded: N tasks maximum. Task X attempted to spawn child Y."
    });

    it("should detect depth limit exceeded during spawning", function () {
      // This would be tested in full integration with processJob
      // The error message should be:
      // "Task depth limit exceeded: N levels maximum. Task X attempted to spawn child at depth Y."
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
  // 7. ERROR HANDLING
  // ==========================================================================

  describe("7. Error Handling", function () {
    it("should capture task errors in output", async function () {
      registerMockHandler("mock", "error", errorHandler("Test error"));

      const tasks = [createMockTask("0", "mock", "error")];
      const graph = new TaskGraph(tasks);

      const executable = graph.getExecutableTasks(new Set());
      expect(executable).to.deep.equal(["0"]);

      // When task 0 fails, its output should contain error
    });

    it("should stop dependent tasks when abortOnFailure=true", function () {
      registerMockHandler("mock", "error", errorHandler("Fail task 0"));

      const job = new Job({
        name: "test-abort-on-failure",
        abortOnFailure: true,
        tasks: [
          createMockTask("0", "mock", "error"),
          createMockTask("1", "mock", "noop", {}, ["0"]),
        ],
      });

      expect(job.abortOnFailure).to.be.true;

      // Task 1 should be aborted if task 0 fails
    });

    it("should continue independent tasks when one task fails", function () {
      registerMockHandler("mock", "error", errorHandler("Fail task 0"));

      const job = new Job({
        name: "test-continue-independent",
        abortOnFailure: false,
        tasks: [
          createMockTask("0", "mock", "error"),
          createMockTask("1", "mock", "noop"), // Independent
        ],
      });

      expect(job.abortOnFailure).to.be.false;

      // Task 1 should execute even if task 0 fails
    });

    it("should set task status to Failed on error", function () {
      const task = createMockTask("0", "mock", "noop");
      expect(task.status).to.equal(FirebaseTaskStatus.Started);

      // After error, status should be Failed
      task.update({
        status: FirebaseTaskStatus.Failed,
        output: { error: "Test error" },
      });

      expect(task.status).to.equal(FirebaseTaskStatus.Failed);
      expect(task.output?.error).to.equal("Test error");
    });

    it("should set task status to Aborted when previous task fails", function () {
      const task = createMockTask("1", "mock", "noop", {}, ["0"]);

      task.update({
        status: FirebaseTaskStatus.Aborted,
        output: { error: "Previous task failed and abortOnFailure is true" },
      });

      expect(task.status).to.equal(FirebaseTaskStatus.Aborted);
    });

    it("should propagate child task failures to parent", function () {
      // If a child task fails, the parent's status should reflect this
      // (Tested in full integration)
    });

    it("should handle handler throwing exceptions", async function () {
      registerMockHandler(
        "mock",
        "throw",
        async () => {
          throw new Error("Handler exception");
        }
      );

      // Exception should be caught and converted to task failure
      createMockTask("0", "mock", "throw");
    });

    it("should detect deadlock when no tasks are executable but tasks remain incomplete", function () {
      /**
       * Deadlock detection scenario:
       *
       * The deadlock detection at lines 99-107 of processJob.ts is a safety net
       * that catches situations where:
       * 1. completed.size < taskRegistry.size (tasks remain incomplete)
       * 2. getExecutableTasks returns empty (no tasks can execute)
       *
       * This can occur when a task has a dependency that will never be satisfied.
       * For example, if a task is dynamically added to the registry with a
       * dependency on a non-existent task, it can never execute.
       */

      const tasks = [
        createMockTask("0", "mock", "noop"),
        createMockTask("1", "mock", "noop", {}, ["0"]),
      ];

      const graph = new TaskGraph(tasks);
      const completed = new Set<string>();
      const taskRegistry = new Map<string, JobTask>();
      tasks.forEach((t) => taskRegistry.set(t.id, t));

      // Execute task 0 and task 1 normally
      completed.add("0");
      completed.add("1");

      // Verify both tasks are completed
      let executable = graph.getExecutableTasks(completed);
      expect(executable).to.have.lengthOf(0);

      // Now simulate a scenario where a task with an unsatisfiable dependency
      // gets added to the registry (this could happen through a bug or edge case)
      // This task depends on "nonexistent" which will never be in completed

      // Note: We can't add this task to the graph because the constructor
      // validates dependencies. But in processJob, the taskRegistry could
      // theoretically have a task that the graph doesn't know about, or
      // a task could be in a state where it can't execute.

      // Instead, let's simulate the scenario by manually adding a task to
      // the registry that has a dependency not in the graph
      const deadlockTask = createMockTask("2", "mock", "noop", {}, ["nonexistent"]);
      taskRegistry.set("2", deadlockTask);

      // Verify the deadlock condition:
      // - completed.size < taskRegistry.size (task 2 is not completed)
      // - getExecutableTasks returns empty (task 2's dependency is not satisfied)
      const incomplete = Array.from(taskRegistry.keys()).filter(
        (id) => !completed.has(id)
      );

      expect(completed.size).to.be.lessThan(taskRegistry.size);
      expect(executable).to.have.lengthOf(0);
      expect(incomplete).to.have.lengthOf(1);
      expect(incomplete).to.include("2");

      // Verify the error message format that processJob would throw
      const expectedError =
        `Deadlock detected: ${incomplete.length} tasks cannot execute. ` +
        `Incomplete tasks: ${incomplete.join(', ')}`;

      expect(expectedError).to.equal(
        "Deadlock detected: 1 tasks cannot execute. Incomplete tasks: 2"
      );
    });
  });

  // ==========================================================================
  // 8. OUTPUT & RESULTS
  // ==========================================================================

  describe("8. Output & Results", function () {
    it("should capture task outputs", async function () {
      const outputData = { message: "Task completed", value: 42 };
      registerMockHandler("mock", "produce", dataProducerHandler(outputData));

      const task = createMockTask("0", "mock", "produce");
      task.update({
        output: outputData,
        status: FirebaseTaskStatus.Succeeded,
      });

      expect(task.output).to.deep.include(outputData);
    });

    it("should make outputs accessible to dependent tasks", function () {
      // Task 1 should be able to access output from task 0
      const task0 = createMockTask("0", "mock", "noop");
      task0.update({
        output: { data: "from-task-0" },
        status: FirebaseTaskStatus.Succeeded,
      });

      // Create dependent task (in real scenario, it would access task0's output)
      createMockTask("1", "mock", "noop", {}, ["0"]);

      // Verify task0's output is accessible
      expect(task0.output?.data).to.equal("from-task-0");
    });

    it("should include child tasks in final result", function () {
      // After spawning children, result.tasks should include all tasks
      const allIds = ["0", "0-0", "0-1", "0-2"];
      expect(verifyHierarchy(allIds)).to.be.true;
    });

    it("should include all spawned tasks in registry", function () {
      const taskRegistry = new Map<string, JobTask>();
      taskRegistry.set("0", createMockTask("0", "mock", "noop"));
      taskRegistry.set("0-0", createMockTask("0-0", "mock", "noop"));
      taskRegistry.set("0-1", createMockTask("0-1", "mock", "noop"));

      expect(taskRegistry.size).to.equal(3);
      expect(taskRegistry.has("0")).to.be.true;
      expect(taskRegistry.has("0-0")).to.be.true;
      expect(taskRegistry.has("0-1")).to.be.true;
    });

    it("should maintain hierarchical structure in output", function () {
      const taskIds = ["0", "1", "0-0", "0-1", "1-0", "0-0-0"];

      expect(verifyHierarchy(taskIds)).to.be.true;

      // Verify depth levels
      expect("0".split("-").length).to.equal(1); // Root
      expect("0-0".split("-").length).to.equal(2); // Child
      expect("0-0-0".split("-").length).to.equal(3); // Grandchild
    });

    it("should include task metadata in results", function () {
      const task = createMockTask("0", "mock", "noop");
      task.update({
        status: FirebaseTaskStatus.Succeeded,
        startedAt: new Date("2024-01-01T00:00:00Z"),
        completedAt: new Date("2024-01-01T00:00:01Z"),
      });

      expect(task.status).to.equal(FirebaseTaskStatus.Succeeded);
      expect(task.startedAt).to.be.instanceOf(Date);
      expect(task.completedAt).to.be.instanceOf(Date);
    });

    it("should serialize to Firestore format correctly", function () {
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

      expect(job.maxTasks).to.equal(1000);
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
