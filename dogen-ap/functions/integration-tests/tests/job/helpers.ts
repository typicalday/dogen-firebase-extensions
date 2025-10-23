import { JobTask } from "../../../src/job/jobTask";
import { ChildTaskSpec } from "../../../src/job/types";

/**
 * Test Helpers for Job Orchestration Tests
 *
 * This file provides mock handlers and utilities for testing the dynamic
 * task graph orchestration system without relying on actual Firebase services.
 */

// ============================================================================
// Mock Handler Registry
// ============================================================================

/**
 * Registry of mock handlers for testing.
 * Maps service:command to handler functions.
 * Exported for use in test execution simulations.
 */
export const mockHandlers = new Map<
  string,
  (task: JobTask) => Promise<Record<string, any>>
>();

/**
 * Registers a mock handler for testing.
 */
export function registerMockHandler(
  service: string,
  command: string,
  handler: (task: JobTask) => Promise<Record<string, any>>
): void {
  mockHandlers.set(`${service}:${command}`, handler);
}

/**
 * Clears all registered mock handlers.
 */
export function clearMockHandlers(): void {
  mockHandlers.clear();
}

/**
 * Executes a mock handler for a task.
 * Throws error if handler not found.
 */
export async function executeMockHandler(
  task: JobTask
): Promise<Record<string, any>> {
  const key = `${task.service}:${task.command}`;
  const handler = mockHandlers.get(key);

  if (!handler) {
    throw new Error(`No mock handler registered for ${key}`);
  }

  return await handler(task);
}

// ============================================================================
// Common Mock Handlers
// ============================================================================

/**
 * Simple no-op handler that succeeds immediately.
 */
export async function noopHandler(task: JobTask): Promise<Record<string, any>> {
  return {
    taskId: task.id,
    message: "Task completed successfully",
  };
}

/**
 * Handler that adds a delay (simulates async work).
 */
export function delayHandler(ms: number) {
  return async (task: JobTask): Promise<Record<string, any>> => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return {
      taskId: task.id,
      message: `Task completed after ${ms}ms delay`,
      delayMs: ms,
    };
  };
}

/**
 * Handler that echoes input to output.
 */
export async function echoHandler(task: JobTask): Promise<Record<string, any>> {
  return {
    taskId: task.id,
    input: task.input,
  };
}

/**
 * Handler that throws an error.
 */
export function errorHandler(errorMessage: string) {
  return async (task: JobTask): Promise<Record<string, any>> => {
    throw new Error(errorMessage);
  };
}

/**
 * Handler that spawns a fixed number of child tasks.
 */
export function spawnChildrenHandler(count: number) {
  return async (task: JobTask): Promise<Record<string, any>> => {
    const childTasks: ChildTaskSpec[] = [];

    for (let i = 0; i < count; i++) {
      childTasks.push({
        service: "mock",
        command: "noop",
        input: {
          message: `Child ${i} of parent ${task.id}`,
        },
      });
    }

    return {
      taskId: task.id,
      childrenSpawned: count,
      childTasks,
    };
  };
}

/**
 * Handler that spawns children with dependencies.
 */
export function spawnChildrenWithDepsHandler(specs: Array<{
  dependsOn?: string[];
  input?: Record<string, any>;
}>) {
  return async (task: JobTask): Promise<Record<string, any>> => {
    const childTasks: ChildTaskSpec[] = specs.map((spec, index) => ({
      service: "mock",
      command: "noop",
      input: spec.input || { index },
      dependsOn: spec.dependsOn,
    }));

    return {
      taskId: task.id,
      childrenSpawned: specs.length,
      childTasks,
    };
  };
}

/**
 * Handler that spawns children recursively (for depth testing).
 */
export function recursiveSpawnHandler(maxDepth: number) {
  return async (task: JobTask): Promise<Record<string, any>> => {
    const currentDepth = task.id.split("-").length;

    if (currentDepth >= maxDepth) {
      return {
        taskId: task.id,
        depth: currentDepth,
        message: "Max depth reached",
      };
    }

    return {
      taskId: task.id,
      depth: currentDepth,
      childTasks: [
        {
          service: "mock",
          command: "recursive-spawn",
          input: { depth: currentDepth + 1 },
        },
      ],
    };
  };
}

/**
 * Handler that spawns children with custom IDs for depth tracking tests.
 * Tests the explicit depth tracking feature.
 */
export function customIdSpawnHandler(options: {
  childIds?: string[];
  shouldRecurse?: boolean;
  maxRecursionDepth?: number;
}) {
  return async (task: JobTask): Promise<Record<string, any>> => {
    const { childIds, shouldRecurse, maxRecursionDepth } = options;

    // Check if we should stop recursion
    if (shouldRecurse && maxRecursionDepth !== undefined) {
      const currentDepth = task.depth ?? 0;
      if (currentDepth >= maxRecursionDepth) {
        return {
          taskId: task.id,
          depth: currentDepth,
          message: "Max recursion depth reached",
        };
      }
    }

    // Use custom IDs if provided, otherwise generate default
    const childTaskSpecs = childIds || ["child-alpha"];

    return {
      taskId: task.id,
      depth: task.depth,
      childTasks: childTaskSpecs.map((childId) => ({
        id: childId,
        service: "mock",
        command: shouldRecurse ? "custom-id-spawn" : "noop",
        input: {
          parentId: task.id,
          parentDepth: task.depth,
        },
      })),
    };
  };
}

/**
 * Handler that outputs data for dependent tasks to consume.
 */
export function dataProducerHandler(outputData: Record<string, any>) {
  return async (task: JobTask): Promise<Record<string, any>> => {
    return {
      taskId: task.id,
      ...outputData,
    };
  };
}

/**
 * Counter handler - tracks execution order.
 */
let executionCounter = 0;
const executionOrder: Array<{ taskId: string; order: number }> = [];

export function counterHandler() {
  return async (task: JobTask): Promise<Record<string, any>> => {
    const order = executionCounter++;
    executionOrder.push({ taskId: task.id, order });

    return {
      taskId: task.id,
      executionOrder: order,
    };
  };
}

export function resetExecutionCounter(): void {
  executionCounter = 0;
  executionOrder.length = 0;
}

export function getExecutionOrder(): Array<{ taskId: string; order: number }> {
  return [...executionOrder];
}

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Creates a simple task for testing.
 */
export function createMockTask(
  id: string,
  service: string = "mock",
  command: string = "noop",
  input?: Record<string, any>,
  dependsOn?: string[]
): JobTask {
  return new JobTask({
    id,
    service,
    command,
    input: input || {},
    dependsOn,
  });
}

/**
 * Verifies that tasks executed in the expected order based on dependencies.
 */
export function verifyExecutionOrder(
  order: Array<{ taskId: string; order: number }>,
  dependencies: Record<string, string[]>
): boolean {
  const orderMap = new Map<string, number>();
  order.forEach((item) => orderMap.set(item.taskId, item.order));

  // Check each dependency constraint
  for (const [taskId, deps] of Object.entries(dependencies)) {
    const taskOrder = orderMap.get(taskId);
    if (taskOrder === undefined) continue;

    for (const depId of deps) {
      const depOrder = orderMap.get(depId);
      if (depOrder === undefined) continue;

      // Dependency must execute before the task
      if (depOrder >= taskOrder) {
        console.error(
          `Dependency violation: ${depId} (order ${depOrder}) should execute before ${taskId} (order ${taskOrder})`
        );
        return false;
      }
    }
  }

  return true;
}

/**
 * Checks if tasks executed in parallel (within a time window).
 */
export function verifyParallelExecution(
  startTimes: Record<string, number>,
  taskIds: string[],
  maxDeltaMs: number = 100
): boolean {
  const times = taskIds.map((id) => startTimes[id]).filter((t) => t !== undefined);

  if (times.length < 2) return true;

  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);

  return maxTime - minTime <= maxDeltaMs;
}

/**
 * Creates a task execution tracker for timing analysis.
 */
export class ExecutionTracker {
  private startTimes = new Map<string, number>();
  private endTimes = new Map<string, number>();

  recordStart(taskId: string): void {
    this.startTimes.set(taskId, Date.now());
  }

  recordEnd(taskId: string): void {
    this.endTimes.set(taskId, Date.now());
  }

  getStartTime(taskId: string): number | undefined {
    return this.startTimes.get(taskId);
  }

  getEndTime(taskId: string): number | undefined {
    return this.endTimes.get(taskId);
  }

  getDuration(taskId: string): number | undefined {
    const start = this.startTimes.get(taskId);
    const end = this.endTimes.get(taskId);

    if (start === undefined || end === undefined) return undefined;

    return end - start;
  }

  getAllStartTimes(): Record<string, number> {
    return Object.fromEntries(this.startTimes);
  }

  reset(): void {
    this.startTimes.clear();
    this.endTimes.clear();
  }
}

/**
 * Helper to extract all task IDs from a result (including children).
 */
export function extractAllTaskIds(
  result: { tasks: Array<{ id: string }> }
): string[] {
  return result.tasks.map((t) => t.id);
}

/**
 * Helper to find a task in the result by ID.
 */
export function findTaskInResult(
  result: { tasks: Array<{ id: string; output?: any }> },
  taskId: string
): any | undefined {
  return result.tasks.find((t) => t.id === taskId);
}

/**
 * Helper to verify hierarchical structure of task IDs.
 */
export function verifyHierarchy(taskIds: string[]): boolean {
  for (const id of taskIds) {
    const parts = id.split("-");

    // Root tasks (e.g., "0", "1", "2") are valid
    if (parts.length === 1) continue;

    // Check that parent exists
    const parentId = parts.slice(0, -1).join("-");
    if (!taskIds.includes(parentId)) {
      console.error(
        `Hierarchy violation: Parent ${parentId} not found for child ${id}`
      );
      return false;
    }
  }

  return true;
}

// ============================================================================
// Status Propagation Test Helpers
// ============================================================================

/**
 * Handler that spawns a child task that will be marked as Planned in plan mode.
 * Simulates a resource-modifying command (allowInPlanMode: false).
 */
export function spawnPlannedChildHandler() {
  return async (task: JobTask): Promise<Record<string, any>> => {
    return {
      output: {
        taskId: task.id,
        message: "Parent task spawning child for plan mode",
      },
      childTasks: [
        {
          id: `${task.id}-0`,
          service: "mock",
          command: "resource-modify", // Command that requires planning
          input: { action: "modify-resource" },
        },
      ],
    };
  };
}

/**
 * Handler that spawns a child task that will fail.
 */
export function spawnFailingChildHandler() {
  return async (task: JobTask): Promise<Record<string, any>> => {
    return {
      output: {
        taskId: task.id,
        message: "Parent task spawning child that will fail",
      },
      childTasks: [
        {
          id: `${task.id}-0`,
          service: "mock",
          command: "error", // Command that will fail
          input: {},
        },
      ],
    };
  };
}

/**
 * Handler that spawns multiple children with different characteristics.
 */
export function spawnMixedChildrenHandler() {
  return async (task: JobTask): Promise<Record<string, any>> => {
    return {
      output: {
        taskId: task.id,
        message: "Parent task spawning mixed children",
      },
      childTasks: [
        {
          id: `${task.id}-0`,
          service: "mock",
          command: "noop", // Safe command (will execute)
          input: {},
        },
        {
          id: `${task.id}-1`,
          service: "mock",
          command: "error", // Will fail
          input: {},
        },
      ],
    };
  };
}

/**
 * Resource-modifying handler (blocks in plan mode).
 */
export async function resourceModifyHandler(task: JobTask): Promise<Record<string, any>> {
  return {
    taskId: task.id,
    message: "Resource modified",
    action: task.input?.action || "default-action",
  };
}
