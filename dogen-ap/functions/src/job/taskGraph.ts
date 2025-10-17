import { Graph, alg } from "graphlib";
import { JobTask } from "./jobTask";

/**
 * TaskGraph wraps graphlib.Graph to manage task dependencies and execution order.
 * Provides methods for adding tasks dynamically, checking dependencies, and
 * determining which tasks can execute in parallel.
 */
export class TaskGraph {
  private graph: Graph;

  /**
   * Creates a new TaskGraph from an initial set of tasks.
   * Validates the graph for cycles and ensures all dependencies exist.
   */
  constructor(tasks: JobTask[]) {
    this.graph = new Graph();

    // Add all tasks as nodes
    for (const task of tasks) {
      this.graph.setNode(task.id, task);
    }

    // Add dependency edges
    for (const task of tasks) {
      if (task.dependsOn) {
        for (const depId of task.dependsOn) {
          if (!this.graph.hasNode(depId)) {
            throw new Error(
              `Task ${task.id} depends on non-existent task ${depId}`
            );
          }
          this.graph.setEdge(depId, task.id);
        }
      }
    }

    // Validate no cycles
    const cycles = alg.findCycles(this.graph);
    if (cycles.length > 0) {
      throw new Error(
        `Circular dependencies detected: ${JSON.stringify(cycles)}`
      );
    }
  }

  /**
   * Adds a new task node to the graph.
   * Throws an error if a task with this ID already exists.
   * Note: Adding a node alone cannot create cycles (only edges can).
   */
  addNode(id: string, task: JobTask): void {
    if (this.graph.hasNode(id)) {
      throw new Error(
        `Task ${id} already exists in graph - cannot add duplicate task`
      );
    }
    this.graph.setNode(id, task);
  }

  /**
   * Adds a dependency edge between two tasks.
   * fromId must complete before toId can execute.
   * Validates that adding this edge does not create cycles.
   */
  addEdge(fromId: string, toId: string): void {
    if (!this.graph.hasNode(fromId)) {
      throw new Error(
        `Cannot add edge: source task ${fromId} does not exist`
      );
    }
    if (!this.graph.hasNode(toId)) {
      throw new Error(
        `Cannot add edge: target task ${toId} does not exist`
      );
    }
    this.graph.setEdge(fromId, toId);

    // Validate no cycles after adding edge
    this.validateNoCycles();
  }

  /**
   * Checks if a task exists in the graph.
   */
  hasNode(id: string): boolean {
    return this.graph.hasNode(id);
  }

  /**
   * Gets a task by its ID.
   */
  getNode(id: string): JobTask {
    return this.graph.node(id);
  }

  /**
   * Returns the total number of nodes in the graph.
   */
  size(): number {
    return this.graph.nodeCount();
  }

  /**
   * Returns all task IDs whose dependencies are satisfied and are ready to execute.
   * A task is executable if all its dependencies are in the completed set.
   */
  getExecutableTasks(completed: Set<string>): string[] {
    const executable: string[] = [];

    for (const nodeId of this.graph.nodes()) {
      // Skip if already completed
      if (completed.has(nodeId)) {
        continue;
      }

      // Get all dependencies (predecessors)
      const deps = this.graph.predecessors(nodeId) || [];

      // Task is executable if all dependencies are completed
      if (deps.every((depId) => completed.has(depId))) {
        executable.push(nodeId);
      }
    }

    return executable;
  }

  /**
   * Returns all task IDs in topological order (respecting dependencies).
   * Useful for debugging and understanding execution flow.
   */
  getTopologicalOrder(): string[] {
    return alg.topsort(this.graph);
  }

  /**
   * Validates that the graph contains no circular dependencies.
   * This method should be called after dynamically adding edges to ensure
   * that child tasks do not create cycles at runtime.
   *
   * @throws Error if any cycles are detected, with details about the cycle
   */
  validateNoCycles(): void {
    const cycles = alg.findCycles(this.graph);
    if (cycles.length > 0) {
      throw new Error(
        `Circular dependencies detected: ${JSON.stringify(cycles)}`
      );
    }
  }
}
