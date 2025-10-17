/**
 * Specification for a child task to be spawned during task execution.
 * Handlers can return an array of ChildTaskSpec in their output to dynamically
 * create child tasks that will be added to the execution graph.
 */
export interface ChildTaskSpec {
  /** The service this task belongs to (e.g., "firestore", "ai", "storage") */
  service: string;

  /** The command to execute within the service */
  command: string;

  /** Input parameters for the task */
  input?: Record<string, any>;

  /**
   * Array of task IDs this child depends on.
   * Can reference:
   * - Parent's siblings (e.g., "0", "1", "2")
   * - Other children of the same parent (e.g., "0-0", "0-1")
   * - Any task ID in the graph
   */
  dependsOn?: string[];
}

/**
 * Extended output type for task handlers that support child spawning.
 * Handlers should return their normal output plus an optional childTasks array.
 */
export interface TaskOutput extends Record<string, any> {
  /** Optional array of child tasks to spawn */
  childTasks?: ChildTaskSpec[];
}
