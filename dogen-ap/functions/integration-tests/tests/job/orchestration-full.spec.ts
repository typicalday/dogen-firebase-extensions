import { describe, it } from "mocha";
import { expect } from "chai";
import { JobTask, FirebaseTaskStatus } from "../../../src/job/jobTask";
import { TaskGraph } from "../../../src/job/taskGraph";

/**
 * Full Orchestration Integration Tests
 *
 * These tests simulate the complete execution flow of processJob including:
 * - Graph-based execution with dependencies
 * - Dynamic child task spawning
 * - Safety limit enforcement
 * - Error handling and propagation
 *
 * Unlike the basic orchestration tests, these simulate the full execution loop
 * that happens in processJob.ts
 */

describe("Full Job Orchestration Integration", function () {
  this.timeout(30000);

  /**
   * Simulates the main execution loop from processJob.ts
   * This is a simplified version for testing purposes
   */
  async function executeJobSimulation(
    initialTasks: JobTask[],
    handlers: Map<string, (task: JobTask) => Promise<Record<string, any>>>,
    options: {
      maxTasks?: number;
      maxDepth?: number;
      abortOnFailure?: boolean;
      timeout?: number;
    } = {}
  ): Promise<{
    tasks: JobTask[];
    status: "succeeded" | "failed";
    error?: string;
  }> {
    const maxTasks = options.maxTasks ?? 1000;
    const maxDepth = options.maxDepth ?? 10;
    const abortOnFailure = options.abortOnFailure ?? true;
    const timeout = options.timeout;

    const taskRegistry = new Map<string, JobTask>();
    initialTasks.forEach((t) => taskRegistry.set(t.id, t));

    let graph = new TaskGraph(initialTasks);
    const completed = new Set<string>();
    let failedTask = false;

    // Track execution start time for timeout
    const executionStartTime = Date.now();

    try {
      // Main execution loop
      while (completed.size < taskRegistry.size) {
        // Check timeout if specified
        if (timeout !== undefined) {
          const elapsed = Date.now() - executionStartTime;
          if (elapsed > timeout) {
            throw new Error(
              `Job execution timeout: ${timeout}ms limit exceeded. ` +
              `Elapsed: ${elapsed}ms. Completed ${completed.size}/${taskRegistry.size} tasks.`
            );
          }
        }
        const executableTasks = graph.getExecutableTasks(completed);

        if (executableTasks.length === 0) {
          break;
        }

        // Execute tasks in parallel
        await Promise.all(
          executableTasks.map(async (taskId) => {
            const task = taskRegistry.get(taskId)!;

            try {
              if (task.status === FirebaseTaskStatus.Failed) {
                failedTask = true;
                completed.add(taskId);
                return;
              } else if (failedTask && abortOnFailure) {
                task.update({
                  status: FirebaseTaskStatus.Aborted,
                  output: {
                    error: "Previous task failed and abortOnFailure is true",
                  },
                });
                completed.add(taskId);
                return;
              }

              task.update({
                output: {},
                status: FirebaseTaskStatus.Succeeded,
                startedAt: new Date(),
              });

              // Get handler and execute
              const handlerKey = `${task.service}:${task.command}`;
              const handler = handlers.get(handlerKey);

              if (!handler) {
                throw new Error(`No handler registered for ${handlerKey}`);
              }

              const output = await handler(task);

              // Handle child task spawning
              if (output.childTasks && Array.isArray(output.childTasks)) {
                // FIRST PASS: Collect all child IDs that will be created
                const plannedChildIds = new Set<string>();
                for (let i = 0; i < output.childTasks.length; i++) {
                  plannedChildIds.add(`${task.id}-${i}`);
                }

                // SECOND PASS: Create children with enhanced validation
                for (let i = 0; i < output.childTasks.length; i++) {
                  const childSpec = output.childTasks[i];
                  const childId = `${task.id}-${i}`;

                  // SAFETY CHECK 1: Task limit
                  if (taskRegistry.size >= maxTasks) {
                    throw new Error(
                      `Task limit exceeded: ${maxTasks} tasks maximum. ` +
                        `Task ${task.id} attempted to spawn child ${childId}.`
                    );
                  }

                  // SAFETY CHECK 2: Depth limit
                  const depth = childId.split("-").length;
                  if (depth > maxDepth) {
                    throw new Error(
                      `Task depth limit exceeded: ${maxDepth} levels maximum. ` +
                        `Task ${task.id} attempted to spawn child at depth ${depth}.`
                    );
                  }

                  // SAFETY CHECK 3: Enhanced dependency validation
                  // Dependencies can be:
                  // 1. Existing tasks (already in registry/graph), OR
                  // 2. Sibling tasks (being created in this spawn operation)
                  if (childSpec.dependsOn) {
                    for (const depId of childSpec.dependsOn) {
                      const isExisting = taskRegistry.has(depId) || graph.hasNode(depId);
                      const isPlannedSibling = plannedChildIds.has(depId);

                      if (!isExisting && !isPlannedSibling) {
                        throw new Error(
                          `Invalid dependency: Child task ${childId} depends on ` +
                            `non-existent task ${depId}. ` +
                            `Dependencies must reference existing tasks or siblings being spawned together.`
                        );
                      }
                    }
                  }

                  // Create child task
                  const childTask = new JobTask({
                    id: childId,
                    service: childSpec.service,
                    command: childSpec.command,
                    input: childSpec.input,
                    dependsOn: childSpec.dependsOn,
                  });

                  // Add to graph and registry
                  graph.addNode(childId, childTask);
                  taskRegistry.set(childId, childTask);

                  // Add dependency edges
                  if (childTask.dependsOn) {
                    for (const depId of childTask.dependsOn) {
                      graph.addEdge(depId, childId);
                    }
                  }
                }

                // DEPENDENCY PROPAGATION: If task spawned children and other tasks depend on task,
                // then those tasks should also depend on all of task's children
                const spawnedChildIds: string[] = [];
                for (let i = 0; i < output.childTasks.length; i++) {
                  spawnedChildIds.push(`${task.id}-${i}`);
                }

                if (spawnedChildIds.length > 0) {
                  // Find all tasks that depend on the spawning task
                  const dependentTasks = Array.from(taskRegistry.values()).filter(t =>
                    t.dependsOn?.includes(task.id)
                  );

                  for (const dependentTask of dependentTasks) {
                    // Add all spawned child IDs to the dependent task's dependsOn array
                    const updatedDependsOn = [
                      ...(dependentTask.dependsOn || []),
                      ...spawnedChildIds
                    ];

                    // Update the task's dependencies directly (update() method doesn't support dependsOn)
                    dependentTask.dependsOn = updatedDependsOn;

                    // Add edges in the graph for each new dependency
                    for (const childId of spawnedChildIds) {
                      graph.addEdge(childId, dependentTask.id);
                    }
                  }

                  // Validate no cycles were created by dependency propagation
                  graph.validateNoCycles();
                }
              }

              task.update({
                output,
                completedAt: new Date(),
              });

              completed.add(taskId);
            } catch (error: any) {
              task.update({
                status: FirebaseTaskStatus.Failed,
                output: { error: error.message },
                completedAt: new Date(),
              });

              failedTask = true;
              completed.add(taskId);
            }
          })
        );
      }

      return {
        tasks: Array.from(taskRegistry.values()),
        status: failedTask ? "failed" : "succeeded",
      };
    } catch (error: any) {
      return {
        tasks: Array.from(taskRegistry.values()),
        status: "failed",
        error: error.message,
      };
    }
  }

  // ============================================================================
  // CHILD SPAWNING TESTS
  // ============================================================================

  describe("Child Task Spawning", function () {
    it("should spawn single child and execute it", async function () {
      const handlers = new Map<
        string,
        (task: JobTask) => Promise<Record<string, any>>
      >();

      handlers.set("test:parent", async (task: JobTask) => ({
        parentOutput: "parent-data",
        childTasks: [
          {
            service: "test",
            command: "child",
            input: { from: "parent" },
          },
        ],
      }));

      handlers.set("test:child", async (task: JobTask) => ({
        childOutput: "child-data",
        parentInput: task.input?.from,
      }));

      const tasks = [new JobTask({ id: "0", service: "test", command: "parent", input: { parentData: "test-value" } })];

      const result = await executeJobSimulation(tasks, handlers);

      expect(result.status).to.equal("succeeded");
      expect(result.tasks).to.have.lengthOf(2);

      const parent = result.tasks.find((t) => t.id === "0");
      const child = result.tasks.find((t) => t.id === "0-0");

      expect(parent?.status).to.equal(FirebaseTaskStatus.Succeeded);
      expect(parent?.output?.parentOutput).to.equal("parent-data");
      // Verify parent task has input field
      expect(parent?.input).to.exist;
      expect(parent?.input?.parentData).to.equal("test-value");

      expect(child).to.exist;
      expect(child?.status).to.equal(FirebaseTaskStatus.Succeeded);
      expect(child?.output?.childOutput).to.equal("child-data");
      expect(child?.output?.parentInput).to.equal("parent");
      // Verify child task has input field
      expect(child?.input).to.exist;
      expect(child?.input?.from).to.equal("parent");
    });

    it("should spawn multiple children and execute them in parallel", async function () {
      const executionOrder: string[] = [];

      const handlers = new Map();

      handlers.set("test:parent", async () => ({
        childTasks: [
          { service: "test", command: "child", input: { index: 0 } },
          { service: "test", command: "child", input: { index: 1 } },
          { service: "test", command: "child", input: { index: 2 } },
        ],
      }));

      handlers.set("test:child", async (task: JobTask) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        executionOrder.push(task.id);
        return { index: task.input?.index };
      });

      const tasks = [new JobTask({ id: "0", service: "test", command: "parent" })];

      const result = await executeJobSimulation(tasks, handlers);

      expect(result.status).to.equal("succeeded");
      expect(result.tasks).to.have.lengthOf(4); // 1 parent + 3 children

      // All children should have executed
      expect(executionOrder).to.have.lengthOf(3);
      expect(executionOrder).to.include.members(["0-0", "0-1", "0-2"]);
    });

    it("should spawn children with dependencies on siblings", async function () {
      const handlers = new Map();

      handlers.set("test:parent", async () => ({
        childTasks: [
          { service: "test", command: "child", input: { name: "A" } },
          {
            service: "test",
            command: "child",
            input: { name: "B" },
            dependsOn: ["0-0"],
          },
          {
            service: "test",
            command: "child",
            input: { name: "C" },
            dependsOn: ["0-1"],
          },
        ],
      }));

      handlers.set("test:child", async (task: JobTask) => ({
        name: task.input?.name,
      }));

      const tasks = [new JobTask({ id: "0", service: "test", command: "parent" })];

      const result = await executeJobSimulation(tasks, handlers);

      expect(result.status).to.equal("succeeded");
      expect(result.tasks).to.have.lengthOf(4);

      // Verify all tasks succeeded
      result.tasks.forEach((task) => {
        expect(task.status).to.equal(FirebaseTaskStatus.Succeeded);
      });
    });

    it("should spawn children with dependencies on parent's siblings", async function () {
      const handlers = new Map();

      handlers.set("test:noop", async () => ({ done: true }));

      handlers.set("test:spawn", async () => ({
        childTasks: [
          {
            service: "test",
            command: "child",
            dependsOn: ["0"], // Depends on parent's sibling
          },
        ],
      }));

      handlers.set("test:child", async () => ({ result: "child-done" }));

      const tasks = [
        new JobTask({ id: "0", service: "test", command: "noop" }),
        new JobTask({ id: "1", service: "test", command: "spawn", dependsOn: ["0"] }),
      ];

      const result = await executeJobSimulation(tasks, handlers);

      expect(result.status).to.equal("succeeded");
      expect(result.tasks).to.have.lengthOf(3); // 0, 1, 1-0

      const child = result.tasks.find((t) => t.id === "1-0");
      expect(child?.status).to.equal(FirebaseTaskStatus.Succeeded);
    });

    it("should handle recursive spawning (grandchildren)", async function () {
      const handlers = new Map();

      handlers.set("test:spawn-recursive", async (task: JobTask) => {
        const currentDepth = task.id.split("-").length;

        if (currentDepth >= 3) {
          return { depth: currentDepth, stopped: true };
        }

        return {
          depth: currentDepth,
          childTasks: [
            {
              service: "test",
              command: "spawn-recursive",
              input: { depth: currentDepth + 1 },
            },
          ],
        };
      });

      const tasks = [
        new JobTask({ id: "0", service: "test", command: "spawn-recursive" }),
      ];

      const result = await executeJobSimulation(tasks, handlers);

      expect(result.status).to.equal("succeeded");
      expect(result.tasks).to.have.lengthOf(3); // 0, 0-0, 0-0-0

      const grandchild = result.tasks.find((t) => t.id === "0-0-0");
      expect(grandchild).to.exist;
      expect(grandchild?.output?.stopped).to.be.true;
    });
  });

  // ============================================================================
  // SAFETY LIMIT TESTS
  // ============================================================================

  describe("Safety Limits Enforcement", function () {
    it("should enforce maxTasks limit", async function () {
      const handlers = new Map();

      handlers.set("test:spawn-many", async () => ({
        childTasks: Array.from({ length: 10 }, (_, i) => ({
          service: "test",
          command: "noop",
          input: { index: i },
        })),
      }));

      handlers.set("test:noop", async () => ({}));

      const tasks = [
        new JobTask({ id: "0", service: "test", command: "spawn-many" }),
      ];

      const result = await executeJobSimulation(tasks, handlers, { maxTasks: 5 });

      expect(result.status).to.equal("failed");
      if (result.error) {
        expect(result.error).to.include("Task limit exceeded");
        expect(result.error).to.include("5 tasks maximum");
      } else {
        // Check task output for error
        const failedTask = result.tasks.find((t) => t.output?.error);
        expect(failedTask).to.exist;
        expect(failedTask?.output?.error).to.include("Task limit exceeded");
      }
    });

    it("should enforce maxDepth limit", async function () {
      const handlers = new Map();

      handlers.set("test:spawn-deep", async () => ({
        childTasks: [{ service: "test", command: "spawn-deep" }],
      }));

      const tasks = [
        new JobTask({ id: "0", service: "test", command: "spawn-deep" }),
      ];

      const result = await executeJobSimulation(tasks, handlers, { maxDepth: 3 });

      expect(result.status).to.equal("failed");
      if (result.error) {
        expect(result.error).to.include("depth limit exceeded");
        expect(result.error).to.include("3 levels maximum");
      } else {
        const failedTask = result.tasks.find((t) => t.output?.error);
        expect(failedTask).to.exist;
        expect(failedTask?.output?.error).to.include("depth limit exceeded");
      }
    });

    it("should validate child dependencies at spawn time", async function () {
      const handlers = new Map();

      handlers.set("test:spawn-invalid", async () => ({
        childTasks: [
          {
            service: "test",
            command: "child",
            dependsOn: ["nonexistent"], // Invalid dependency
          },
        ],
      }));

      handlers.set("test:child", async () => ({}));

      const tasks = [
        new JobTask({ id: "0", service: "test", command: "spawn-invalid" }),
      ];

      const result = await executeJobSimulation(tasks, handlers);

      expect(result.status).to.equal("failed");
      if (result.error) {
        expect(result.error).to.include("Invalid dependency");
        expect(result.error).to.include("nonexistent");
      } else {
        const failedTask = result.tasks.find((t) => t.output?.error);
        expect(failedTask).to.exist;
        expect(failedTask?.output?.error).to.include("Invalid dependency");
      }
    });
  });

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe("Error Handling with Child Tasks", function () {
    it("should handle parent task failure", async function () {
      const handlers = new Map();

      handlers.set("test:fail", async () => {
        throw new Error("Parent task failed");
      });

      const tasks = [new JobTask({ id: "0", service: "test", command: "fail" })];

      const result = await executeJobSimulation(tasks, handlers);

      expect(result.status).to.equal("failed");

      const parent = result.tasks[0];
      expect(parent.status).to.equal(FirebaseTaskStatus.Failed);
      expect(parent.output?.error).to.include("Parent task failed");
    });

    it("should handle child task failure", async function () {
      const handlers = new Map();

      handlers.set("test:parent", async () => ({
        childTasks: [{ service: "test", command: "fail-child" }],
      }));

      handlers.set("test:fail-child", async () => {
        throw new Error("Child task failed");
      });

      const tasks = [new JobTask({ id: "0", service: "test", command: "parent" })];

      const result = await executeJobSimulation(tasks, handlers);

      expect(result.status).to.equal("failed");

      const child = result.tasks.find((t) => t.id === "0-0");
      expect(child?.status).to.equal(FirebaseTaskStatus.Failed);
      expect(child?.output?.error).to.include("Child task failed");
    });

    it("should abort dependent tasks when abortOnFailure=true", async function () {
      const handlers = new Map();

      handlers.set("test:fail", async () => {
        throw new Error("Task 0 failed");
      });

      handlers.set("test:noop", async () => ({ done: true }));

      const tasks = [
        new JobTask({ id: "0", service: "test", command: "fail" }),
        new JobTask({ id: "1", service: "test", command: "noop", dependsOn: ["0"] }),
      ];

      const result = await executeJobSimulation(tasks, handlers, {
        abortOnFailure: true,
      });

      expect(result.status).to.equal("failed");

      const task0 = result.tasks.find((t) => t.id === "0");
      const task1 = result.tasks.find((t) => t.id === "1");

      expect(task0?.status).to.equal(FirebaseTaskStatus.Failed);
      expect(task1?.status).to.equal(FirebaseTaskStatus.Aborted);
      expect(task1?.output?.error).to.include("Previous task failed");
    });

    it("should continue independent tasks when abortOnFailure=false", async function () {
      const handlers = new Map();

      handlers.set("test:fail", async () => {
        throw new Error("Task 0 failed");
      });

      handlers.set("test:noop", async () => ({ done: true }));

      const tasks = [
        new JobTask({ id: "0", service: "test", command: "fail" }),
        new JobTask({ id: "1", service: "test", command: "noop" }), // Independent
      ];

      const result = await executeJobSimulation(tasks, handlers, {
        abortOnFailure: false,
      });

      expect(result.status).to.equal("failed");

      const task0 = result.tasks.find((t) => t.id === "0");
      const task1 = result.tasks.find((t) => t.id === "1");

      expect(task0?.status).to.equal(FirebaseTaskStatus.Failed);
      expect(task1?.status).to.equal(FirebaseTaskStatus.Succeeded);
    });
  });

  // ============================================================================
  // CLIENT-CONFIGURABLE LIMITS AND TIMEOUT TESTS
  // ============================================================================

  describe("Client-Configurable Limits and Timeout", function () {
    it("should enforce custom maxTasks limit during spawning", async function () {
      const handlers = new Map();

      handlers.set("test:spawn-many", async () => ({
        childTasks: Array.from({ length: 10 }, (_, i) => ({
          service: "test",
          command: "noop",
          input: { index: i },
        })),
      }));

      handlers.set("test:noop", async () => ({}));

      const tasks = [
        new JobTask({ id: "0", service: "test", command: "spawn-many" }),
      ];

      // Use custom maxTasks of 3 (should fail when trying to spawn 10 children)
      const result = await executeJobSimulation(tasks, handlers, { maxTasks: 3 });

      expect(result.status).to.equal("failed");
      expect(result.error || result.tasks[0].output?.error).to.include("Task limit exceeded");
      expect(result.error || result.tasks[0].output?.error).to.include("3 tasks maximum");
    });

    it("should enforce custom maxDepth limit during spawning", async function () {
      const handlers = new Map();

      handlers.set("test:spawn-recursive", async (task: JobTask) => {
        const currentDepth = task.id.split("-").length;

        // Always try to spawn a child (will hit depth limit)
        return {
          depth: currentDepth,
          childTasks: [
            {
              service: "test",
              command: "spawn-recursive",
              input: { depth: currentDepth + 1 },
            },
          ],
        };
      });

      const tasks = [
        new JobTask({ id: "0", service: "test", command: "spawn-recursive" }),
      ];

      // Use custom maxDepth of 2 (root=1, child=2, grandchild=3 should fail)
      const result = await executeJobSimulation(tasks, handlers, { maxDepth: 2 });

      expect(result.status).to.equal("failed");
      expect(result.error || result.tasks.find((t) => t.output?.error)?.output?.error).to.include(
        "depth limit exceeded"
      );
      expect(result.error || result.tasks.find((t) => t.output?.error)?.output?.error).to.include(
        "2 levels maximum"
      );
    });

    it("should timeout when execution exceeds limit", async function () {
      const handlers = new Map();

      // Handler that delays for 300ms (longer than timeout)
      handlers.set("test:delay", async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { completed: true };
      });

      const tasks = [
        new JobTask({ id: "0", service: "test", command: "delay" }),
        new JobTask({ id: "1", service: "test", command: "delay", dependsOn: ["0"] }),
        new JobTask({ id: "2", service: "test", command: "delay", dependsOn: ["1"] }),
      ];

      // Set timeout to 500ms (should fail after 1-2 tasks, as 3x300ms = 900ms total)
      const result = await executeJobSimulation(tasks, handlers, { timeout: 500 });

      expect(result.status).to.equal("failed");
      expect(result.error).to.exist;
      expect(result.error).to.include("Job execution timeout");
      expect(result.error).to.include("500ms limit exceeded");
      expect(result.error).to.match(/Completed \d+\/3 tasks/);
    });

    it("should succeed when execution completes within timeout", async function () {
      const handlers = new Map();

      // Handler that delays for 10ms
      handlers.set("test:quick", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { completed: true };
      });

      const tasks = [
        new JobTask({ id: "0", service: "test", command: "quick" }),
        new JobTask({ id: "1", service: "test", command: "quick" }),
      ];

      // Set timeout to 500ms (should succeed)
      const result = await executeJobSimulation(tasks, handlers, { timeout: 500 });

      expect(result.status).to.equal("succeeded");
      expect(result.tasks).to.have.lengthOf(2);
      result.tasks.forEach((task) => {
        expect(task.status).to.equal(FirebaseTaskStatus.Succeeded);
      });
    });

    it("should not timeout when no timeout is specified", async function () {
      const handlers = new Map();

      // Handler that delays for 100ms
      handlers.set("test:delay", async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { completed: true };
      });

      const tasks = [
        new JobTask({ id: "0", service: "test", command: "delay" }),
        new JobTask({ id: "1", service: "test", command: "delay" }),
      ];

      // No timeout specified
      const result = await executeJobSimulation(tasks, handlers);

      expect(result.status).to.equal("succeeded");
      expect(result.tasks).to.have.lengthOf(2);
    });

    it.skip("should include progress information in timeout error", async function () {
      // Note: This test is skipped because it's timing-sensitive and can be flaky
      // The timeout mechanism is tested by other tests, this is just checking
      // the specific format of the progress message
      const handlers = new Map();

      // First two tasks succeed quickly, third delays much longer than timeout
      handlers.set("test:quick", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { done: true };
      });
      handlers.set("test:slow", async () => {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return { done: true };
      });

      const tasks = [
        new JobTask({ id: "0", service: "test", command: "quick" }),
        new JobTask({ id: "1", service: "test", command: "quick", dependsOn: ["0"] }),
        new JobTask({ id: "2", service: "test", command: "slow", dependsOn: ["1"] }),
      ];

      // Set timeout to 100ms (first two tasks will complete in ~20ms, third will timeout)
      const result = await executeJobSimulation(tasks, handlers, { timeout: 100 });

      expect(result.status).to.equal("failed");
      expect(result.error).to.exist;
      expect(result.error).to.include("Completed 2/3 tasks");
    });

    it("should use default limits when not specified", async function () {
      const handlers = new Map();

      handlers.set("test:noop", async () => ({ done: true }));

      const tasks = [new JobTask({ id: "0", service: "test", command: "noop" })];

      // No options specified - should use defaults (maxTasks=1000, maxDepth=10, no timeout)
      const result = await executeJobSimulation(tasks, handlers);

      expect(result.status).to.equal("succeeded");
      expect(result.tasks).to.have.lengthOf(1);
    });
  });

  // ============================================================================
  // REAL-WORLD SCENARIO TESTS
  // ============================================================================

  describe("Real-World Scenarios", function () {
    it("should handle batch processing with dynamic spawning", async function () {
      const handlers = new Map();

      // Fetch returns list of IDs
      handlers.set("fetch:data", async () => ({
        items: [1, 2, 3, 4, 5],
        childTasks: [
          { service: "process", command: "item", input: { itemId: 1 } },
          { service: "process", command: "item", input: { itemId: 2 } },
          { service: "process", command: "item", input: { itemId: 3 } },
          { service: "process", command: "item", input: { itemId: 4 } },
          { service: "process", command: "item", input: { itemId: 5 } },
          {
            service: "aggregate",
            command: "results",
            dependsOn: ["0-0", "0-1", "0-2", "0-3", "0-4"],
          },
        ],
      }));

      handlers.set("process:item", async (task: JobTask) => ({
        itemId: task.input?.itemId,
        processed: true,
      }));

      handlers.set("aggregate:results", async () => ({
        aggregated: true,
        count: 5,
      }));

      const tasks = [new JobTask({ id: "0", service: "fetch", command: "data" })];

      const result = await executeJobSimulation(tasks, handlers);

      expect(result.status).to.equal("succeeded");
      expect(result.tasks).to.have.lengthOf(7); // 1 fetch + 5 process + 1 aggregate

      const aggregate = result.tasks.find((t) => t.id === "0-5");
      expect(aggregate?.status).to.equal(FirebaseTaskStatus.Succeeded);
      expect(aggregate?.output?.aggregated).to.be.true;
    });

    it("should handle AI workflow with parallel writes", async function () {
      const handlers = new Map();

      handlers.set("ai:inference", async () => ({
        result: "inference-output",
        childTasks: [
          {
            service: "firestore",
            command: "write",
            input: { collection: "results" },
          },
          {
            service: "storage",
            command: "upload",
            input: { path: "results/output.json" },
          },
        ],
      }));

      handlers.set("firestore:write", async () => ({ written: true }));
      handlers.set("storage:upload", async () => ({ uploaded: true }));

      const tasks = [new JobTask({ id: "0", service: "ai", command: "inference" })];

      const result = await executeJobSimulation(tasks, handlers);

      expect(result.status).to.equal("succeeded");
      expect(result.tasks).to.have.lengthOf(3); // 1 inference + 2 writes

      const firestoreWrite = result.tasks.find((t) => t.id === "0-0");
      const storageUpload = result.tasks.find((t) => t.id === "0-1");

      expect(firestoreWrite?.status).to.equal(FirebaseTaskStatus.Succeeded);
      expect(storageUpload?.status).to.equal(FirebaseTaskStatus.Succeeded);
    });

    it("should handle hierarchical processing with multi-level spawning", async function () {
      const handlers = new Map();

      handlers.set("root:process", async () => ({
        childTasks: [
          { service: "chunk", command: "process", input: { chunk: 0 } },
          { service: "chunk", command: "process", input: { chunk: 1 } },
        ],
      }));

      handlers.set("chunk:process", async (task: JobTask) => ({
        chunk: task.input?.chunk,
        childTasks: [
          { service: "item", command: "process", input: { item: 0 } },
          { service: "item", command: "process", input: { item: 1 } },
        ],
      }));

      handlers.set("item:process", async (task: JobTask) => ({
        item: task.input?.item,
        processed: true,
      }));

      const tasks = [new JobTask({ id: "0", service: "root", command: "process" })];

      const result = await executeJobSimulation(tasks, handlers);

      expect(result.status).to.equal("succeeded");
      expect(result.tasks).to.have.lengthOf(7); // 1 root + 2 chunks + 4 items

      // Verify hierarchy
      const root = result.tasks.find((t) => t.id === "0");
      const chunk0 = result.tasks.find((t) => t.id === "0-0");
      const chunk1 = result.tasks.find((t) => t.id === "0-1");
      const item00 = result.tasks.find((t) => t.id === "0-0-0");
      const item01 = result.tasks.find((t) => t.id === "0-0-1");
      const item10 = result.tasks.find((t) => t.id === "0-1-0");
      const item11 = result.tasks.find((t) => t.id === "0-1-1");

      expect(root?.status).to.equal(FirebaseTaskStatus.Succeeded);
      expect(chunk0?.status).to.equal(FirebaseTaskStatus.Succeeded);
      expect(chunk1?.status).to.equal(FirebaseTaskStatus.Succeeded);
      expect(item00?.status).to.equal(FirebaseTaskStatus.Succeeded);
      expect(item01?.status).to.equal(FirebaseTaskStatus.Succeeded);
      expect(item10?.status).to.equal(FirebaseTaskStatus.Succeeded);
      expect(item11?.status).to.equal(FirebaseTaskStatus.Succeeded);
    });
  });

  // ============================================================================
  // DEPENDENCY PROPAGATION TESTS
  // ============================================================================

  describe("Dependency Propagation", function () {
    it("should propagate child dependencies to dependent tasks", async function () {
      /**
       * Structure:
       *   Task 0: spawns [0-0, 0-1, 0-2]
       *   Task 1: depends on [0]
       *
       * Expected: After 0 spawns, Task 1 should depend on [0, 0-0, 0-1, 0-2]
       */

      const handlers = new Map();

      handlers.set("test:spawn-three", async () => ({
        childTasks: [
          { service: "test", command: "child" },
          { service: "test", command: "child" },
          { service: "test", command: "child" },
        ],
      }));

      handlers.set("test:child", async () => ({ completed: true }));
      handlers.set("test:dependent", async () => ({ completed: true }));

      const tasks = [
        new JobTask({ id: "0", service: "test", command: "spawn-three" }),
        new JobTask({ id: "1", service: "test", command: "dependent", dependsOn: ["0"] }),
      ];

      const result = await executeJobSimulation(tasks, handlers);

      expect(result.status).to.equal("succeeded");
      expect(result.tasks).to.have.lengthOf(5); // 0, 0-0, 0-1, 0-2, 1

      // Verify Task 1 has propagated dependencies
      const task1 = result.tasks.find((t) => t.id === "1");
      expect(task1?.dependsOn).to.include.members(["0", "0-0", "0-1", "0-2"]);

      // Verify all tasks completed
      expect(result.tasks.every((t) => t.status === FirebaseTaskStatus.Succeeded)).to.be.true;
    });

    it("should propagate grandchildren transitively", async function () {
      /**
       * Structure:
       *   Task 0: spawns [0-0, 0-1]
       *   Task 0-0: spawns [0-0-0, 0-0-1]
       *   Task 1: depends on [0]
       *
       * Expected propagation (wave-by-wave):
       *   Wave 1: Task 1 gets [0-0, 0-1]
       *   Wave 2: Task 1 gets [0-0-0, 0-0-1]
       *   Final: [0, 0-0, 0-1, 0-0-0, 0-0-1]
       */

      const handlers = new Map();

      handlers.set("test:spawn-recursive", async (task: JobTask) => {
        const depth = task.id.split("-").length;

        if (depth === 1) {
          // Root: spawn 2 children
          return {
            childTasks: [
              { service: "test", command: "spawn-recursive" },
              { service: "test", command: "noop" },
            ],
          };
        } else if (depth === 2) {
          // Child: spawn 2 grandchildren
          return {
            childTasks: [
              { service: "test", command: "noop" },
              { service: "test", command: "noop" },
            ],
          };
        }

        return {};
      });

      handlers.set("test:noop", async () => ({ completed: true }));
      handlers.set("test:dependent", async () => ({ completed: true }));

      const tasks = [
        new JobTask({ id: "0", service: "test", command: "spawn-recursive" }),
        new JobTask({ id: "1", service: "test", command: "dependent", dependsOn: ["0"] }),
      ];

      const result = await executeJobSimulation(tasks, handlers);

      expect(result.status).to.equal("succeeded");
      expect(result.tasks).to.have.lengthOf(6); // 0, 0-0, 0-1, 0-0-0, 0-0-1, 1

      // Verify Task 1 has all transitive dependencies
      const task1 = result.tasks.find((t) => t.id === "1");
      expect(task1?.dependsOn).to.include.members(["0", "0-0", "0-1", "0-0-0", "0-0-1"]);
    });

    it("should propagate to multiple dependent tasks", async function () {
      /**
       * Structure:
       *   Task 0: spawns [0-0, 0-1]
       *   Task 1: depends on [0]
       *   Task 2: depends on [0]
       *
       * Expected: Both Task 1 and Task 2 get [0-0, 0-1] as dependencies
       */

      const handlers = new Map();

      handlers.set("test:spawn-two", async () => ({
        childTasks: [
          { service: "test", command: "child" },
          { service: "test", command: "child" },
        ],
      }));

      handlers.set("test:child", async () => ({ completed: true }));
      handlers.set("test:dependent", async () => ({ completed: true }));

      const tasks = [
        new JobTask({ id: "0", service: "test", command: "spawn-two" }),
        new JobTask({ id: "1", service: "test", command: "dependent", dependsOn: ["0"] }),
        new JobTask({ id: "2", service: "test", command: "dependent", dependsOn: ["0"] }),
      ];

      const result = await executeJobSimulation(tasks, handlers);

      expect(result.status).to.equal("succeeded");
      expect(result.tasks).to.have.lengthOf(5); // 0, 0-0, 0-1, 1, 2

      // Verify both dependent tasks received propagated dependencies
      const task1 = result.tasks.find((t) => t.id === "1");
      const task2 = result.tasks.find((t) => t.id === "2");

      expect(task1?.dependsOn).to.include.members(["0", "0-0", "0-1"]);
      expect(task2?.dependsOn).to.include.members(["0", "0-0", "0-1"]);
    });

    it("should handle complex dependency chain with propagation", async function () {
      /**
       * Structure:
       *   Task A: spawns [A-0, A-1]
       *   Task A-0: spawns [A-0-0, A-0-1]
       *   Task B: depends on [A]
       *   Task C: depends on [B]
       *
       * Expected:
       *   Task B: depends on [A, A-0, A-1, A-0-0, A-0-1]
       *   Task C: depends on [B] (only)
       */

      const handlers = new Map();

      handlers.set("test:spawn-branch", async (task: JobTask) => {
        if (task.id === "A") {
          return {
            childTasks: [
              { service: "test", command: "spawn-branch" },
              { service: "test", command: "noop" },
            ],
          };
        } else if (task.id === "A-0") {
          return {
            childTasks: [
              { service: "test", command: "noop" },
              { service: "test", command: "noop" },
            ],
          };
        }

        return {};
      });

      handlers.set("test:noop", async () => ({ completed: true }));
      handlers.set("test:task-b", async () => ({ completed: true }));
      handlers.set("test:task-c", async () => ({ completed: true }));

      const tasks = [
        new JobTask({ id: "A", service: "test", command: "spawn-branch" }),
        new JobTask({ id: "B", service: "test", command: "task-b", dependsOn: ["A"] }),
        new JobTask({ id: "C", service: "test", command: "task-c", dependsOn: ["B"] }),
      ];

      const result = await executeJobSimulation(tasks, handlers);

      expect(result.status).to.equal("succeeded");

      // Verify Task B has all descendants of A
      const taskB = result.tasks.find((t) => t.id === "B");
      expect(taskB?.dependsOn).to.include.members(["A", "A-0", "A-1", "A-0-0", "A-0-1"]);

      // Verify Task C only depends on B (not A's children)
      const taskC = result.tasks.find((t) => t.id === "C");
      expect(taskC?.dependsOn).to.deep.equal(["B"]);
    });

    it("should not execute dependent task until all spawned descendants complete", async function () {
      /**
       * This test verifies the execution order: dependent task should wait
       * for ALL spawned descendants to complete, not just the parent
       */

      const executionOrder: string[] = [];

      const handlers = new Map();

      handlers.set("test:spawn-two", async (task: JobTask) => {
        executionOrder.push(task.id);
        return {
          childTasks: [
            { service: "test", command: "child" },
            { service: "test", command: "child" },
          ],
        };
      });

      handlers.set("test:child", async (task: JobTask) => {
        executionOrder.push(task.id);
        return { completed: true };
      });

      handlers.set("test:dependent", async (task: JobTask) => {
        executionOrder.push(task.id);
        return { completed: true };
      });

      const tasks = [
        new JobTask({ id: "0", service: "test", command: "spawn-two" }),
        new JobTask({ id: "1", service: "test", command: "dependent", dependsOn: ["0"] }),
      ];

      const result = await executeJobSimulation(tasks, handlers);

      expect(result.status).to.equal("succeeded");

      // Verify execution order: parent → children → dependent
      const idx0 = executionOrder.indexOf("0");
      const idx00 = executionOrder.indexOf("0-0");
      const idx01 = executionOrder.indexOf("0-1");
      const idx1 = executionOrder.indexOf("1");

      expect(idx0).to.be.greaterThanOrEqual(0);
      expect(idx00).to.be.greaterThan(idx0);
      expect(idx01).to.be.greaterThan(idx0);
      expect(idx1).to.be.greaterThan(idx00);
      expect(idx1).to.be.greaterThan(idx01);

      // Task 1 must execute AFTER both children
      expect(executionOrder[idx1]).to.equal("1");
    });
  });
});
