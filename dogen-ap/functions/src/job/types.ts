/**
 * Specification for a child task to be spawned during task execution.
 * Handlers can return an array of ChildTaskSpec in their output to dynamically
 * create child tasks that will be added to the execution graph.
 */
export interface ChildTaskSpec {
  /**
   * Optional custom ID for this child task.
   * If provided, must be unique across all tasks in the job.
   * If omitted, will be auto-generated as ${parentId}-${index}.
   *
   * Use custom IDs when:
   * - You need readable, descriptive task names
   * - You're orchestrating complex workflows with dependencies
   * - You want meaningful task graph visualization
   *
   * Use auto-generated IDs when:
   * - You're spawning simple parallel tasks
   * - You don't need to reference tasks by name
   */
  id?: string;

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
   * - Custom IDs from sibling tasks (if using custom IDs)
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
