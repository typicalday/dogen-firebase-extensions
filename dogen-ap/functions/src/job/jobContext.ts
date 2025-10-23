/**
 * Job Context for Task Handlers
 *
 * Provides read-only access to job state and other tasks for inter-task communication.
 * Passed as the second parameter to all task handlers.
 */

import { JobTask } from "./jobTask";
import { Job } from "./job";

/**
 * Context object passed to task handlers providing access to job metadata
 * and other tasks for inter-task communication.
 */
export interface JobContext {
  /** Verbose logging flag from job configuration */
  readonly verbose: boolean;

  /** Maximum total tasks allowed in this job */
  readonly maxTasks: number;

  /** Maximum task hierarchy depth allowed */
  readonly maxDepth: number;

  /** Optional execution timeout in milliseconds */
  readonly timeout?: number;

  /** Plan mode flag - when true, AI tasks can spawn children but final commands are marked as "planned" and don't execute */
  readonly aiPlanning: boolean;

  /** AI auditing flag - when true, AI tasks include full request/response details in their output for debugging and transparency */
  readonly aiAuditing: boolean;

  /**
   * Get a task by ID
   * @param taskId - The task ID to retrieve
   * @returns The task if found, undefined otherwise
   */
  getTask(taskId: string): Readonly<JobTask> | undefined;

  /**
   * Get the output of a completed task
   * @param taskId - The task ID whose output to retrieve
   * @returns The task output if found, undefined otherwise
   */
  getTaskOutput(taskId: string): Readonly<Record<string, any>> | undefined;

  /**
   * Get the audit metadata of a task
   * @param taskId - The task ID whose audit to retrieve
   * @returns The task audit if found, undefined otherwise
   */
  getTaskAudit(taskId: string): Readonly<Record<string, any>> | undefined;

  /**
   * Get all tasks in the job
   * @returns Array of all tasks (read-only)
   */
  getAllTasks(): ReadonlyArray<Readonly<JobTask>>;

  /**
   * Check if a task exists in the registry
   * @param taskId - The task ID to check
   * @returns true if task exists, false otherwise
   */
  hasTask(taskId: string): boolean;

  /**
   * Check if a task has completed (succeeded, failed, or aborted)
   * @param taskId - The task ID to check
   * @returns true if task is completed, false otherwise
   */
  isTaskCompleted(taskId: string): boolean;
}

/**
 * Creates a JobContext instance from job state
 *
 * @param taskRegistry - The registry containing all tasks
 * @param job - The job configuration
 * @returns A JobContext with read-only access to job state
 */
export function createJobContext(
  taskRegistry: Map<string, JobTask>,
  job: Job
): JobContext {
  return {
    // Job-level flags
    verbose: job.verbose,
    maxTasks: job.maxTasks,
    maxDepth: job.maxDepth,
    timeout: job.timeout,
    aiPlanning: job.aiPlanning,
    aiAuditing: job.aiAuditing ?? false,

    // Task access methods
    getTask(taskId: string): Readonly<JobTask> | undefined {
      return taskRegistry.get(taskId);
    },

    getTaskOutput(taskId: string): Readonly<Record<string, any>> | undefined {
      const task = taskRegistry.get(taskId);
      return task?.output;
    },

    getTaskAudit(taskId: string): Readonly<Record<string, any>> | undefined {
      const task = taskRegistry.get(taskId);
      return task?.audit;
    },

    getAllTasks(): ReadonlyArray<Readonly<JobTask>> {
      return Array.from(taskRegistry.values());
    },

    hasTask(taskId: string): boolean {
      return taskRegistry.has(taskId);
    },

    isTaskCompleted(taskId: string): boolean {
      const task = taskRegistry.get(taskId);
      if (!task) return false;

      // Task is completed if it has one of these terminal statuses
      return task.status === "succeeded" ||
             task.status === "failed" ||
             task.status === "aborted";
    }
  };
}
