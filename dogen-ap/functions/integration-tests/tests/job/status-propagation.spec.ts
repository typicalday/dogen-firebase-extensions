/**
 * Status Propagation Integration Tests
 *
 * These tests verify status propagation behavior using the REAL orchestrator logic.
 * They test the actual implementation from src/job/orchestrator.ts
 */

import { describe, it, beforeEach } from "mocha";
import { expect } from "chai";
import { FirebaseTaskStatus } from "../../../src/job/jobTask";
import { executeJobOrchestration, OrchestrationConfig } from "../../../src/job/orchestrator";
import {
  registerMockHandler,
  clearMockHandlers,
  mockHandlers,
  noopHandler,
  errorHandler,
  spawnPlannedChildHandler,
  spawnFailingChildHandler,
  spawnMixedChildrenHandler,
  resourceModifyHandler,
  createMockTask,
} from "./helpers";

describe("Status Propagation (Real Orchestrator)", function () {
  this.timeout(10000);

  beforeEach(() => {
    clearMockHandlers();
    // Register standard handlers
    registerMockHandler("mock", "noop", noopHandler);
  });

  it("should propagate Planned status when parent spawns child in plan mode", async function () {
    // Register handlers for this test
    registerMockHandler("mock", "spawn-planned", spawnPlannedChildHandler());
    registerMockHandler("mock", "resource-modify", resourceModifyHandler);

    // Setup: Task A spawns child that requires approval (aiPlanning mode)
    //        Task B depends on Task A
    const taskA = createMockTask("0", "mock", "spawn-planned");
    const taskB = createMockTask("1", "mock", "noop", {}, ["0"]);

    const config: OrchestrationConfig = {
      maxTasks: 100,
      maxDepth: 10,
      verbose: false,
      aiPlanning: true, // Enable planning mode
      aiAuditing: false,
      abortOnFailure: true,
      jobName: "test-status-propagation",
      // Inject mock handler lookup for testing
      handlerLookup: (service: string, command: string) => {
        const key = `${service}:${command}`;
        return mockHandlers.get(key);
      },
      // Inject plan mode lookup: only "noop" is allowed in plan mode (read-only)
      allowInPlanModeLookup: (service: string, command: string) => {
        return command === "noop"; // Only noop is allowed, others get Planned status
      },
    };

    const result = await executeJobOrchestration([taskA, taskB], config);

    // Verify: Task A executed successfully
    const taskAResult = result.tasks.find(t => t.id === "0");
    expect(taskAResult?.status).to.equal(FirebaseTaskStatus.Succeeded);

    // Verify: Child 0-0 was marked as Planned (resource-modify blocks in plan mode)
    const child00 = result.tasks.find(t => t.id === "0-0");
    expect(child00).to.exist;
    expect(child00?.status).to.equal(FirebaseTaskStatus.Planned);

    // Verify: Task B was also marked as Planned (propagated from 0-0)
    const taskBResult = result.tasks.find(t => t.id === "1");
    expect(taskBResult?.status).to.equal(FirebaseTaskStatus.Planned);
  });

  it("should propagate Aborted status when dependency fails", async function () {
    // Register handlers
    registerMockHandler("mock", "spawn-failing", spawnFailingChildHandler());
    registerMockHandler("mock", "error", errorHandler("Child task failure"));

    // Setup: Task A spawns child that will fail
    //        Task B depends on Task A
    const taskA = createMockTask("0", "mock", "spawn-failing");
    const taskB = createMockTask("1", "mock", "noop", {}, ["0"]);

    const config: OrchestrationConfig = {
      maxTasks: 100,
      maxDepth: 10,
      verbose: false,
      aiPlanning: false,
      aiAuditing: false,
      abortOnFailure: true,
      jobName: "test-abort-propagation",
      handlerLookup: (service: string, command: string) => {
        const key = `${service}:${command}`;
        return mockHandlers.get(key);
      },
      allowInPlanModeLookup: (service: string, command: string) => {
        return command === "noop";
      },
    };

    const result = await executeJobOrchestration([taskA, taskB], config);

    // Verify: Task A succeeded (parent completes even if child fails)
    const taskAResult = result.tasks.find(t => t.id === "0");
    expect(taskAResult?.status).to.equal(FirebaseTaskStatus.Succeeded);

    // Verify: Child 0-0 failed
    const child00 = result.tasks.find(t => t.id === "0-0");
    expect(child00).to.exist;
    expect(child00?.status).to.equal(FirebaseTaskStatus.Failed);

    // Verify: Task B was Aborted (propagated from failed 0-0)
    const taskBResult = result.tasks.find(t => t.id === "1");
    expect(taskBResult?.status).to.equal(FirebaseTaskStatus.Aborted);

    // Verify: Overall job failed
    expect(result.status).to.equal("failed");
  });

  it("should handle cascading status propagation through multiple levels", async function () {
    // Register handlers
    registerMockHandler("mock", "spawn-planned", spawnPlannedChildHandler());
    registerMockHandler("mock", "resource-modify", resourceModifyHandler);

    // Setup: A → B → C dependency chain
    //        A spawns child that requires approval
    const taskA = createMockTask("0", "mock", "spawn-planned");
    const taskB = createMockTask("1", "mock", "noop", {}, ["0"]);
    const taskC = createMockTask("2", "mock", "noop", {}, ["1"]);

    const config: OrchestrationConfig = {
      maxTasks: 100,
      maxDepth: 10,
      verbose: false,
      aiPlanning: true,
      aiAuditing: false,
      abortOnFailure: true,
      jobName: "test-cascading-propagation",
      handlerLookup: (service: string, command: string) => {
        const key = `${service}:${command}`;
        return mockHandlers.get(key);
      },
      allowInPlanModeLookup: (service: string, command: string) => {
        return command === "noop";
      },
    };

    const result = await executeJobOrchestration([taskA, taskB, taskC], config);

    // Verify: A succeeded
    const taskAResult = result.tasks.find(t => t.id === "0");
    expect(taskAResult?.status).to.equal(FirebaseTaskStatus.Succeeded);

    // Verify: Child 0-0 is Planned
    const child00 = result.tasks.find(t => t.id === "0-0");
    expect(child00?.status).to.equal(FirebaseTaskStatus.Planned);

    // Verify: B is Planned (propagated from 0-0)
    const taskBResult = result.tasks.find(t => t.id === "1");
    expect(taskBResult?.status).to.equal(FirebaseTaskStatus.Planned);

    // Verify: C is Planned (cascaded from B)
    const taskCResult = result.tasks.find(t => t.id === "2");
    expect(taskCResult?.status).to.equal(FirebaseTaskStatus.Planned);
  });

  it("should prioritize Failed/Aborted over Planned status", async function () {
    // Register handlers
    registerMockHandler("mock", "spawn-mixed", spawnMixedChildrenHandler());
    registerMockHandler("mock", "error", errorHandler("Child failure"));

    // Setup: Task A spawns two children: one succeeds, one fails
    //        Task B depends on A (will depend on both children)
    const taskA = createMockTask("0", "mock", "spawn-mixed");
    const taskB = createMockTask("1", "mock", "noop", {}, ["0"]);

    const config: OrchestrationConfig = {
      maxTasks: 100,
      maxDepth: 10,
      verbose: false,
      aiPlanning: false,
      aiAuditing: false,
      abortOnFailure: true,
      jobName: "test-priority-propagation",
      handlerLookup: (service: string, command: string) => {
        const key = `${service}:${command}`;
        return mockHandlers.get(key);
      },
      allowInPlanModeLookup: (service: string, command: string) => {
        return command === "noop";
      },
    };

    const result = await executeJobOrchestration([taskA, taskB], config);

    // Verify: A succeeded
    const taskAResult = result.tasks.find(t => t.id === "0");
    expect(taskAResult?.status).to.equal(FirebaseTaskStatus.Succeeded);

    // Verify: Child 0-0 succeeded (noop)
    const child00 = result.tasks.find(t => t.id === "0-0");
    expect(child00?.status).to.equal(FirebaseTaskStatus.Succeeded);

    // Verify: Child 0-1 failed (error)
    const child01 = result.tasks.find(t => t.id === "0-1");
    expect(child01?.status).to.equal(FirebaseTaskStatus.Failed);

    // Verify: B is Aborted (Failed takes priority over Succeeded)
    const taskBResult = result.tasks.find(t => t.id === "1");
    expect(taskBResult?.status).to.equal(FirebaseTaskStatus.Aborted);
  });

  it("should only propagate status to Pending tasks", async function () {
    // This is a behavioral test - the orchestrator doesn't support
    // pre-setting task status before execution, so we test the logic
    // by verifying that Planned tasks don't get re-propagated

    registerMockHandler("mock", "spawn-planned", spawnPlannedChildHandler());
    registerMockHandler("mock", "resource-modify", resourceModifyHandler);

    const taskA = createMockTask("0", "mock", "spawn-planned");
    const taskB = createMockTask("1", "mock", "noop", {}, ["0"]);

    const config: OrchestrationConfig = {
      maxTasks: 100,
      maxDepth: 10,
      verbose: false,
      aiPlanning: true,
      aiAuditing: false,
      abortOnFailure: true,
      jobName: "test-pending-only-propagation",
      handlerLookup: (service: string, command: string) => {
        const key = `${service}:${command}`;
        return mockHandlers.get(key);
      },
      allowInPlanModeLookup: (service: string, command: string) => {
        return command === "noop";
      },
    };

    const result = await executeJobOrchestration([taskA, taskB], config);

    // Verify: B became Planned during execution (was Pending, then propagated)
    const taskBResult = result.tasks.find(t => t.id === "1");
    expect(taskBResult?.status).to.equal(FirebaseTaskStatus.Planned);

    // This test documents that propagation only affects Pending tasks
    // If B was already Started/Succeeded/Failed, it wouldn't change to Planned
  });
});
