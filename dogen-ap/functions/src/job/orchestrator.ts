/**
 * Job Orchestrator - Extracted orchestration logic for testability
 *
 * This module contains the core orchestration logic extracted from processJob.
 * It handles:
 * - Task graph execution
 * - Child task spawning
 * - Dependency propagation
 * - Status propagation
 * - Error handling
 *
 * IMPORTANT: This file is extracted from processJob.ts for testability.
 * Any changes here must maintain 100% compatibility with processJob behavior.
 */

import { Mutex } from "async-mutex";
import { FirebaseTaskStatus, JobTask } from "./jobTask";
import { Job } from "./job";
import { TaskGraph } from "./taskGraph";
import { createJobContext } from "./jobContext";
import { getHandler, getUnsupportedTaskError } from "./handlers/registry";
import { validateChildTasks } from "./validator";

/**
 * Handler lookup function type for dependency injection
 */
export type HandlerLookupFn = (service: string, command: string) => ((task: JobTask, context: any) => Promise<Record<string, any>>) | undefined;

/**
 * Configuration for job orchestration
 */
export interface OrchestrationConfig {
  /** Maximum number of tasks allowed (default: 100) */
  maxTasks: number;
  /** Maximum depth of task nesting (default: 10) */
  maxDepth: number;
  /** Timeout in milliseconds (optional) */
  timeout?: number;
  /** Enable verbose logging */
  verbose: boolean;
  /** Enable AI planning mode (tasks require approval) */
  aiPlanning: boolean;
  /** Enable AI auditing (capture AI outputs) */
  aiAuditing: boolean;
  /** Abort all tasks when one fails */
  abortOnFailure: boolean;
  /** Job name for logging */
  jobName: string;
  /** Handler lookup function (for testing, optional - defaults to production registry) */
  handlerLookup?: HandlerLookupFn;
  /** Function to check if command is allowed in plan mode (for testing, optional - defaults to production registry) */
  allowInPlanModeLookup?: (service: string, command: string) => boolean;
}

/**
 * Result of job orchestration
 */
export interface OrchestrationResult {
  /** All tasks that were executed (sorted by start time) */
  tasks: Array<{
    id: string;
    service: string;
    command: string;
    status: FirebaseTaskStatus;
    input?: Record<string, any>;
    output?: Record<string, any>;
    audit?: Record<string, any>;
    startedAt?: Date;
    completedAt?: Date;
    dependsOn?: string[];
    childTasks?: any[];
  }>;
  /** Overall job status */
  status: "succeeded" | "failed";
  /** Error message if failed */
  errorMessage?: string;
}

/**
 * Execute job orchestration logic
 *
 * This function contains the core orchestration logic extracted from processJob.
 * It is pure and testable without Firebase Functions dependencies.
 *
 * @param initialTasks - Initial tasks to execute
 * @param config - Orchestration configuration
 * @returns Orchestration result with all executed tasks
 */
export async function executeJobOrchestration(
  initialTasks: JobTask[],
  config: OrchestrationConfig
): Promise<OrchestrationResult> {
  let failedTask = false;
  let errorMessage: string | undefined = undefined;

  // Initialize task registry and graph
  const taskRegistry = new Map<string, JobTask>();
  initialTasks.forEach((t) => taskRegistry.set(t.id, t));

  try {
    const graph = new TaskGraph(initialTasks);
    const completed = new Set<string>();
    // Mutex to prevent race conditions when multiple parallel tasks spawn children simultaneously
    const graphMutex = new Mutex();

    // Track execution start time for timeout
    const executionStartTime = Date.now();

    // Main execution loop: process tasks in dependency order
    while (completed.size < taskRegistry.size) {
      // Check timeout if specified
      if (config.timeout) {
        const elapsed = Date.now() - executionStartTime;
        if (elapsed > config.timeout) {
          throw new Error(
            `Job execution timeout: ${config.timeout}ms limit exceeded. ` +
            `Elapsed: ${elapsed}ms. Completed ${completed.size}/${taskRegistry.size} tasks.`
          );
        }
      }

      // Get tasks that are ready to execute (dependencies met)
      const executableTasks = graph.getExecutableTasks(completed);

      if (executableTasks.length === 0) {
        const incomplete = Array.from(taskRegistry.keys()).filter(
          id => !completed.has(id)
        );
        throw new Error(
          `Deadlock detected: ${incomplete.length} tasks cannot execute. ` +
          `Incomplete tasks: ${incomplete.join(', ')}`
        );
      }

      // Execute all ready tasks in parallel
      await Promise.all(
        executableTasks.map(async (taskId) => {
          const task = taskRegistry.get(taskId)!;

          try {
            // Skip tasks with status "Planned" - they are awaiting user approval
            if (task.status === FirebaseTaskStatus.Planned) {
              if (config.verbose) {
                console.log(`Skipping task ${task.id} with status "Planned" - awaiting user approval`);
              }
              task.update({
                startedAt: new Date(),
                completedAt: new Date(),
              });
              completed.add(taskId);
              return;
            }

            if (task.status === FirebaseTaskStatus.Failed) {
              failedTask = true;
              task.update({
                startedAt: new Date(),
                completedAt: new Date(),
              });
              completed.add(taskId);
              return;
            } else if (failedTask && config.abortOnFailure) {
              task.update({
                status: FirebaseTaskStatus.Aborted,
                output: {
                  error: "Previous task failed and abortOnFailure is true",
                },
                startedAt: new Date(),
                completedAt: new Date(),
              });
              completed.add(taskId);
              return;
            }

            // Mark task as started
            task.update({
              output: {},
              status: FirebaseTaskStatus.Started,
              startedAt: new Date(),
            });

            if (config.verbose) {
              console.log(`Executing task ${task.id}: ${task.service}/${task.command}`);
            }

            // Execute task and get handler result
            const handlerResult = await processTask(task, taskRegistry, config, config.handlerLookup);

            // Extract childTasks from handler return value (if present)
            const childTasksToSpawn = (handlerResult as any).childTasks;

            // Check for child tasks to spawn
            if (childTasksToSpawn && Array.isArray(childTasksToSpawn)) {
              // VALIDATION: Validate all child tasks before spawning
              const validationReport = validateChildTasks(childTasksToSpawn, task.id, config.handlerLookup);

              if (!validationReport.isValid) {
                throw new Error(
                  `Child task validation failed for parent ${task.id}:\n` +
                  validationReport.errors.join('\n')
                );
              }

              // Log warnings if any
              if (config.verbose && validationReport.warnings.length > 0) {
                console.log(`Child task validation warnings for ${task.id}:`);
                validationReport.warnings.forEach(warning => console.log(`  - ${warning}`));
              }

              // FIRST PASS: Collect all child IDs and validate no collisions
              // IDs are already scoped by handlers using scopeChildTasks helper
              const plannedChildIds = new Set<string>();
              const duplicateIds = new Set<string>();

              for (let i = 0; i < childTasksToSpawn.length; i++) {
                const childSpec = childTasksToSpawn[i];
                // Handlers have already applied scoping, so use ID as-is
                const childId = childSpec.id ?? `${task.id}-${i}`; // Fallback for legacy handlers

                // Check for duplicate IDs within this batch
                if (plannedChildIds.has(childId)) {
                  duplicateIds.add(childId);
                }

                // Check if task already exists in graph from previous operations
                if (taskRegistry.has(childId) || graph.hasNode(childId)) {
                  duplicateIds.add(childId);
                }

                plannedChildIds.add(childId);
              }

              // Fail fast if duplicate IDs detected
              if (duplicateIds.size > 0) {
                // Provide detailed error about where duplicates come from
                const duplicateDetails = Array.from(duplicateIds).map(dupId => {
                  const inBatch = Array.from(plannedChildIds).filter(id => id === dupId).length > 1;
                  const inGraph = taskRegistry.has(dupId) || graph.hasNode(dupId);

                  if (inBatch && inGraph) {
                    return `${dupId} (duplicate in batch AND already in graph)`;
                  } else if (inBatch) {
                    return `${dupId} (duplicate in current batch)`;
                  } else if (inGraph) {
                    return `${dupId} (already exists in graph)`;
                  }
                  return dupId;
                });

                throw new Error(
                  `Duplicate child task IDs detected: ${duplicateDetails.join(', ')}. ` +
                  `Parent task: ${task.id}. ` +
                  `Each child task must have a unique ID.`
                );
              }

              // Track all spawned child IDs for dependency propagation
              const spawnedChildIds: string[] = [];

              // SECOND PASS: Create children with enhanced validation
              // IDs and dependencies are already scoped by handlers
              for (let i = 0; i < childTasksToSpawn.length; i++) {
                const childSpec = childTasksToSpawn[i];
                // Handlers have already applied scoping, so use ID as-is
                const childId = childSpec.id ?? `${task.id}-${i}`; // Fallback for legacy handlers

                // SAFETY CHECK 1: Total task limit
                if (taskRegistry.size >= config.maxTasks) {
                  throw new Error(
                    `Task limit exceeded: ${config.maxTasks} tasks maximum. ` +
                      `Task ${task.id} attempted to spawn child ${childId}. ` +
                      `This may indicate a runaway AI or infinite loop.`
                  );
                }

                // SAFETY CHECK 2: Depth limit
                const depth = (task.depth ?? 0) + 1;
                if (depth > config.maxDepth) {
                  throw new Error(
                    `Task depth limit exceeded: ${config.maxDepth} levels maximum. ` +
                      `Task ${task.id} attempted to spawn child at depth ${depth}. ` +
                      `Child ID: ${childId}`
                  );
                }

                // SAFETY CHECK 3: Dependency validation
                // Dependencies are already resolved by handlers using scopeChildTasks
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

                // Determine initial status for child task
                // - In aiPlanning mode, resource-modifying commands get "Planned" status
                // - Read-only commands and AI agents get "Pending" status (will execute)
                // - Outside aiPlanning mode, all tasks get "Pending" status
                let initialStatus = FirebaseTaskStatus.Pending;
                if (config.aiPlanning) {
                  // Use injected lookup for testing, or production registry
                  let allowInPlanMode = false;
                  if (config.allowInPlanModeLookup) {
                    allowInPlanMode = config.allowInPlanModeLookup(childSpec.service, childSpec.command);
                  } else {
                    const childHandler = getHandler(childSpec.service, childSpec.command);
                    if (childHandler) {
                      const handlerRegistry = require('./handlers/registry');
                      const handlerDefinition = handlerRegistry.getHandlerDefinition(childSpec.service, childSpec.command);
                      allowInPlanMode = handlerDefinition?.allowInPlanMode ?? false;
                      if (config.verbose) {
                        console.log(
                          `[Orchestrator] Child task ${childId} (${childSpec.service}/${childSpec.command}): ` +
                          `allowInPlanMode=${allowInPlanMode}, will be ${allowInPlanMode ? 'Pending' : 'Planned'}`
                        );
                      }
                    } else if (config.verbose) {
                      console.log(
                        `[Orchestrator] WARNING: Handler not found for ${childSpec.service}/${childSpec.command}, ` +
                        `defaulting to Planned status`
                      );
                    }
                  }

                  if (!allowInPlanMode) {
                    initialStatus = FirebaseTaskStatus.Planned;
                  }
                }

                // Create child task with explicit depth and status
                // Input already has resolved dependencies from handlers
                const childTask = new JobTask({
                  id: childId,
                  service: childSpec.service,
                  command: childSpec.command,
                  input: childSpec.input,
                  dependsOn: childSpec.dependsOn,
                  depth: depth,
                  status: initialStatus,
                });

                if (config.verbose) {
                  console.log(
                    `[Orchestrator] Created child task ${childId}: ` +
                    `requested status=${initialStatus}, actual status=${childTask.status}`
                  );
                }

                // CRITICAL SECTION: Wrap graph/registry modifications in mutex to prevent
                // race conditions when multiple parallel tasks spawn children simultaneously
                await graphMutex.runExclusive(async () => {
                  // Add to graph and registry
                  graph.addNode(childId, childTask);
                  taskRegistry.set(childId, childTask);

                  // Add dependency edges
                  if (childTask.dependsOn) {
                    for (const depId of childTask.dependsOn) {
                      graph.addEdge(depId, childId);
                    }

                    // CRITICAL: Validate no cycles were created by child task dependencies
                    // This prevents runtime deadlocks from dynamically spawned tasks
                    graph.validateNoCycles();
                  }
                });

                spawnedChildIds.push(childId);

                if (config.verbose) {
                  console.log(`Task ${task.id} spawned child task ${childId} (${childSpec.service}/${childSpec.command})`);
                }
              }

              // DEPENDENCY PROPAGATION: If task A spawned children and task B depends on A,
              // then B should also depend on all of A's children
              if (spawnedChildIds.length > 0) {
                await graphMutex.runExclusive(async () => {
                  // Find all tasks that depend on the parent task
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

                    // STATUS PROPAGATION: Check ALL dependencies (not just newly spawned) for blocking statuses
                    // - If any dependency is "Planned", dependent becomes "Planned"
                    // - If any dependency is "Failed" or "Aborted", dependent becomes "Aborted"
                    // Priority: Failed/Aborted > Planned > Pending
                    const hasPlannedDependency = updatedDependsOn.some(depId => {
                      const depTask = taskRegistry.get(depId);
                      return depTask?.status === FirebaseTaskStatus.Planned;
                    });

                    const hasFailedOrAbortedDependency = updatedDependsOn.some(depId => {
                      const depTask = taskRegistry.get(depId);
                      return depTask?.status === FirebaseTaskStatus.Failed ||
                             depTask?.status === FirebaseTaskStatus.Aborted;
                    });

                    if (hasFailedOrAbortedDependency && dependentTask.status === FirebaseTaskStatus.Pending) {
                      dependentTask.status = FirebaseTaskStatus.Aborted;
                      if (config.verbose) {
                        console.log(
                          `Task ${dependentTask.id} status changed to Aborted ` +
                          `(depends on failed/aborted task(s))`
                        );
                      }
                    } else if (hasPlannedDependency && dependentTask.status === FirebaseTaskStatus.Pending) {
                      dependentTask.status = FirebaseTaskStatus.Planned;
                      if (config.verbose) {
                        console.log(
                          `Task ${dependentTask.id} status changed to Planned ` +
                          `(depends on planned task(s))`
                        );
                      }
                    }

                    if (config.verbose) {
                      console.log(
                        `Task ${dependentTask.id} now depends on spawned children: ${spawnedChildIds.join(', ')} ` +
                        `(because it depends on parent ${task.id})`
                      );
                    }
                  }

                  // CASCADE STATUS PROPAGATION: Propagate Planned/Aborted status through dependency chains
                  // After marking direct dependents, check if any other tasks depend on newly-Planned tasks
                  let statusChanged = true;
                  while (statusChanged) {
                    statusChanged = false;

                    for (const task of Array.from(taskRegistry.values())) {
                      // Only propagate to Pending tasks
                      if (task.status !== FirebaseTaskStatus.Pending) {
                        continue;
                      }

                      if (!task.dependsOn || task.dependsOn.length === 0) {
                        continue;
                      }

                      // Check if any dependency has Planned/Failed/Aborted status
                      const hasPlannedDep = task.dependsOn.some(depId => {
                        const depTask = taskRegistry.get(depId);
                        return depTask?.status === FirebaseTaskStatus.Planned;
                      });

                      const hasFailedOrAbortedDep = task.dependsOn.some(depId => {
                        const depTask = taskRegistry.get(depId);
                        return depTask?.status === FirebaseTaskStatus.Failed ||
                               depTask?.status === FirebaseTaskStatus.Aborted;
                      });

                      // Propagate status
                      if (hasFailedOrAbortedDep) {
                        task.status = FirebaseTaskStatus.Aborted;
                        statusChanged = true;
                        if (config.verbose) {
                          console.log(`Task ${task.id} cascaded to Aborted`);
                        }
                      } else if (hasPlannedDep) {
                        task.status = FirebaseTaskStatus.Planned;
                        statusChanged = true;
                        if (config.verbose) {
                          console.log(`Task ${task.id} cascaded to Planned`);
                        }
                      }
                    }
                  }

                  // Validate no cycles were created by dependency propagation
                  graph.validateNoCycles();
                });
              }
            }

            // If handlerResult has a nested 'output' property (from agent handlers that return {output, childTasks, audit}),
            // unwrap it to avoid storing the childTasks array in task.output
            const taskOutput = (handlerResult as any).output !== undefined ? (handlerResult as any).output : handlerResult;

            // Extract audit from handler return value if present (separate from output)
            const taskAudit = (handlerResult as any).audit;

            // Store childTasks on the task for record-keeping (extracted from handler return value)
            const taskChildTasks = childTasksToSpawn;

            // Mark task as succeeded
            task.update({
              output: taskOutput,
              audit: taskAudit,
              childTasks: taskChildTasks,
              status: FirebaseTaskStatus.Succeeded,
              completedAt: new Date(),
            });

            completed.add(taskId);
          } catch (error: any) {
            console.error(`Error processing task ${taskId}:`, error);

            task.update({
              status: FirebaseTaskStatus.Failed,
              output: { error: error.message },
              completedAt: new Date(),
            });

            failedTask = true;
            completed.add(taskId);

            // STATUS PROPAGATION: Mark all tasks that depend on this failed task as Aborted
            await graphMutex.runExclusive(async () => {
              const dependentTasks = Array.from(taskRegistry.values()).filter(t =>
                t.dependsOn?.includes(taskId) && t.status === FirebaseTaskStatus.Pending
              );

              for (const dependentTask of dependentTasks) {
                dependentTask.status = FirebaseTaskStatus.Aborted;
                if (config.verbose) {
                  console.log(
                    `Task ${dependentTask.id} status changed to Aborted ` +
                    `(depends on failed task ${taskId})`
                  );
                }
              }
            });
          }
        })
      );
    }

    return {
      tasks: Array.from(taskRegistry.values())
        .sort((a, b) => {
          // Sort by startedAt time (earliest first)
          // Handle cases where startedAt might be undefined
          if (!a.startedAt && !b.startedAt) return 0;
          if (!a.startedAt) return 1;
          if (!b.startedAt) return -1;
          return a.startedAt.getTime() - b.startedAt.getTime();
        })
        .map((task) => ({
          id: task.id,
          service: task.service,
          command: task.command,
          status: task.status ?? FirebaseTaskStatus.Pending,
          input: task.input,
          output: task.output,
          audit: task.audit,
          childTasks: task.childTasks,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          dependsOn: task.dependsOn,
        })),
      status: failedTask ? "failed" : "succeeded",
    };
  } catch (e: any) {
    console.error("Error processing tasks:", e);
    errorMessage = e.message;

    return {
      tasks: Array.from(taskRegistry.values())
        .sort((a, b) => {
          if (!a.startedAt && !b.startedAt) return 0;
          if (!a.startedAt) return 1;
          if (!b.startedAt) return -1;
          return a.startedAt.getTime() - b.startedAt.getTime();
        })
        .map((task) => ({
          id: task.id,
          service: task.service,
          command: task.command,
          status: task.status ?? FirebaseTaskStatus.Pending,
          input: task.input,
          output: task.output,
          audit: task.audit,
          childTasks: task.childTasks,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          dependsOn: task.dependsOn,
        })),
      status: "failed",
      errorMessage,
    };
  }
}

/**
 * Process a single task (extracted from processJob for reuse in orchestration)
 *
 * @param task - Task to process
 * @param taskRegistry - Registry of all tasks for context
 * @param config - Job configuration for context
 * @param handlerLookup - Optional handler lookup function (for testing)
 * @returns Handler result
 */
async function processTask(
  task: JobTask,
  taskRegistry: Map<string, JobTask>,
  config: OrchestrationConfig,
  handlerLookup?: HandlerLookupFn
): Promise<Record<string, any>> {
  // Look up handler - use injected lookup function or default to production registry
  const handler = handlerLookup
    ? handlerLookup(task.service, task.command)
    : getHandler(task.service, task.command);

  if (!handler) {
    // Generate descriptive error message with available options
    throw new Error(getUnsupportedTaskError(task.service, task.command));
  }

  // Create job context - pass taskRegistry and partial config
  // createJobContext only needs taskRegistry and aiAuditing from the job
  const partialJob = {
    aiAuditing: config.aiAuditing,
  } as Job;

  const context = createJobContext(taskRegistry, partialJob);

  // Execute the handler with task and context
  return await handler(task, context);
}
