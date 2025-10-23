/**
 * Test Helper for creating mock JobContext instances
 */

import { JobContext } from "../../src/job/jobContext";
import { JobTask } from "../../src/job/jobTask";

/**
 * Creates a mock JobContext for testing purposes
 *
 * @param options - Partial JobContext to override defaults
 * @returns A complete JobContext with sensible defaults
 */
export function createMockJobContext(options?: Partial<JobContext>): JobContext {
  const defaultContext: JobContext = {
    verbose: false,
    maxTasks: 1000,
    maxDepth: 10,
    timeout: undefined,
    aiPlanning: false,
    aiAuditing: false,

    getTask: () => undefined,
    getTaskOutput: () => undefined,
    getTaskAudit: () => undefined,
    getAllTasks: () => [],
    hasTask: () => false,
    isTaskCompleted: () => false,
  };

  // If options provided, merge them with defaults
  if (!options) {
    return defaultContext;
  }

  return {
    ...defaultContext,
    ...options,
  };
}

/**
 * Creates a mock JobContext with task registry for more complex testing
 *
 * @param tasks - Array of tasks to include in the mock registry
 * @param options - Additional JobContext options
 * @returns A JobContext with task access methods connected to the provided tasks
 */
export function createMockJobContextWithTasks(
  tasks: JobTask[],
  options?: Partial<Omit<JobContext, 'getTask' | 'getTaskOutput' | 'getTaskAudit' | 'getAllTasks' | 'hasTask' | 'isTaskCompleted'>>
): JobContext {
  const taskMap = new Map<string, JobTask>();
  tasks.forEach(task => {
    if (task.id) {
      taskMap.set(task.id, task);
    }
  });

  return {
    verbose: options?.verbose ?? false,
    maxTasks: options?.maxTasks ?? 1000,
    maxDepth: options?.maxDepth ?? 10,
    timeout: options?.timeout,
    aiPlanning: options?.aiPlanning ?? false,
    aiAuditing: options?.aiAuditing ?? false,

    getTask: (taskId: string) => taskMap.get(taskId),
    getTaskOutput: (taskId: string) => taskMap.get(taskId)?.output,
    getTaskAudit: (taskId: string) => taskMap.get(taskId)?.audit,
    getAllTasks: () => Array.from(taskMap.values()),
    hasTask: (taskId: string) => taskMap.has(taskId),
    isTaskCompleted: (taskId: string) => {
      const task = taskMap.get(taskId);
      if (!task) return false;
      return task.status === "succeeded" ||
             task.status === "failed" ||
             task.status === "aborted";
    },
  };
}
