import * as functions from "firebase-functions/v1";
import { DecodedIdToken } from "firebase-admin/auth";
import { Mutex } from "async-mutex";
import { FirebaseTaskStatus, JobTask } from "./jobTask";
import { Job, JobStatus } from "./job";
import { TaskGraph } from "./taskGraph";
import { createJobContext } from "./jobContext";
import { getHandler, getUnsupportedTaskError } from "./handlers/registry";
import { validateChildTasks, validateTaskInput } from "./validator";

const persistIntervalDuration = 10000;

export const processJob = functions.https.onCall(async (data, context) => {
  if (!context?.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Function must be called while authenticated"
    );
  }

  const authToken = context.auth?.token;

  if (!authToken || !(await verifyAdmin(authToken))) {
    throw new functions.https.HttpsError("permission-denied", "Unauthorized");
  }

  const persistMode = data.persist ?? false;
  const abortOnFailure = data.abortOnFailure ?? true;
  const verbose = data.verbose ?? false;
  const aiPlanning = data.aiPlanning ?? true; // Default to true for safety (human-in-the-loop)
  const aiAuditing = data.aiAuditing ?? false; // Default to false for performance
  const tasksData = data.tasks;
  const maxTasks = data.maxTasks;
  const maxDepth = data.maxDepth;
  const timeout = data.timeout;

  if (!Array.isArray(tasksData) || tasksData.length === 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Invalid input: No tasks provided"
    );
  }

  const jobName = data.name;

  if (typeof jobName !== "string" || jobName.length === 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Invalid input: Job name is required"
    );
  }

  // Validate initial tasks before creating job
  const initialTaskErrors: string[] = [];
  for (let i = 0; i < tasksData.length; i++) {
    const taskData = tasksData[i];
    const { service, command, input } = taskData;

    // Validate task structure
    if (!service || typeof service !== 'string') {
      initialTaskErrors.push(`Task ${i}: Missing or invalid 'service' field`);
      continue;
    }

    if (!command || typeof command !== 'string') {
      initialTaskErrors.push(`Task ${i}: Missing or invalid 'command' field`);
      continue;
    }

    // Validate input against handler definition
    const validationErrors = validateTaskInput(service, command, input || {});
    if (validationErrors.length > 0) {
      initialTaskErrors.push(`Task ${i} (${service}/${command}): ${validationErrors.join(', ')}`);
    }
  }

  // Throw error if validation failed
  if (initialTaskErrors.length > 0) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `Task validation failed:\n${initialTaskErrors.join('\n')}`
    );
  }

  let job = new Job({
    name: jobName,
    abortOnFailure: abortOnFailure,
    maxTasks: maxTasks,
    maxDepth: maxDepth,
    timeout: timeout,
    verbose: verbose,
    aiPlanning: aiPlanning,
    aiAuditing: aiAuditing,
    tasks: tasksData.map((taskData: any) => {
      const { service, command, input } = taskData;
      return new JobTask({ service, command, input, depth: 0 });
    }),
  });

  const persistJobState = async () => {
    if (verbose) {
      console.log("Persisting job progress to database...");
    }
    await job.persist();
  };

  const persistInterval = persistMode
    ? setInterval(persistJobState, persistIntervalDuration)
    : undefined;

  let failedTask = false;
  let errorMessage: string | undefined = undefined;

  // Initialize task registry and graph
  const taskRegistry = new Map<string, JobTask>();
  job.tasks.forEach((t) => taskRegistry.set(t.id, t));

  try {
    const graph = new TaskGraph(job.tasks);
    const completed = new Set<string>();
    // Mutex to prevent race conditions when multiple parallel tasks spawn children simultaneously
    const graphMutex = new Mutex();

    // Track execution start time for timeout
    const executionStartTime = Date.now();

    // Main execution loop: process tasks in dependency order
    while (completed.size < taskRegistry.size) {
      // Check timeout if specified
      if (job.timeout) {
        const elapsed = Date.now() - executionStartTime;
        if (elapsed > job.timeout) {
          throw new functions.https.HttpsError(
            "deadline-exceeded",
            `Job execution timeout: ${job.timeout}ms limit exceeded. ` +
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
            if (task.status === FirebaseTaskStatus.Failed) {
              failedTask = true;
              task.update({
                startedAt: new Date(),
                completedAt: new Date(),
              });
              completed.add(taskId);
              return;
            } else if (failedTask && abortOnFailure) {
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

            task.update({
              output: {},
              status: FirebaseTaskStatus.Succeeded,
              startedAt: new Date(),
            });

            if (verbose) {
              console.log(`Executing task ${task.id}: ${task.service}/${task.command}`);
            }

            // Execute task and get output
            const output = await processTask(task, taskRegistry, job);

            // Check for child tasks to spawn
            if (output.childTasks && Array.isArray(output.childTasks)) {
              // VALIDATION: Validate all child tasks before spawning
              const validationReport = validateChildTasks(output.childTasks, task.id);

              if (!validationReport.isValid) {
                throw new Error(
                  `Child task validation failed for parent ${task.id}:\n` +
                  validationReport.errors.join('\n')
                );
              }

              // Log warnings if any
              if (verbose && validationReport.warnings.length > 0) {
                console.log(`Child task validation warnings for ${task.id}:`);
                validationReport.warnings.forEach(warning => console.log(`  - ${warning}`));
              }

              // FIRST PASS: Collect all child IDs and validate no collisions
              // IDs are already scoped by handlers using scopeChildTasks helper
              const plannedChildIds = new Set<string>();
              const duplicateIds = new Set<string>();

              for (let i = 0; i < output.childTasks.length; i++) {
                const childSpec = output.childTasks[i];
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
              for (let i = 0; i < output.childTasks.length; i++) {
                const childSpec = output.childTasks[i];
                // Handlers have already applied scoping, so use ID as-is
                const childId = childSpec.id ?? `${task.id}-${i}`; // Fallback for legacy handlers

                // SAFETY CHECK 1: Total task limit
                if (taskRegistry.size >= job.maxTasks) {
                  throw new Error(
                    `Task limit exceeded: ${job.maxTasks} tasks maximum. ` +
                      `Task ${task.id} attempted to spawn child ${childId}. ` +
                      `This may indicate a runaway AI or infinite loop.`
                  );
                }

                // SAFETY CHECK 2: Depth limit
                const depth = (task.depth ?? 0) + 1;
                if (depth > job.maxDepth) {
                  throw new Error(
                    `Task depth limit exceeded: ${job.maxDepth} levels maximum. ` +
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

                // Create child task with explicit depth
                // Input already has resolved dependencies from handlers
                const childTask = new JobTask({
                  id: childId,
                  service: childSpec.service,
                  command: childSpec.command,
                  input: childSpec.input,
                  dependsOn: childSpec.dependsOn,
                  depth: depth,
                });

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

                if (verbose) {
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

                    if (verbose) {
                      console.log(
                        `Task ${dependentTask.id} now depends on spawned children: ${spawnedChildIds.join(', ')} ` +
                        `(because it depends on parent ${task.id})`
                      );
                    }
                  }

                  // Validate no cycles were created by dependency propagation
                  graph.validateNoCycles();
                });
              }
            }

            // If output has a nested 'output' property (from agent handlers that return {output, childTasks}),
            // unwrap it to avoid storing the childTasks array in task.output
            const taskOutput = (output as any).output !== undefined ? (output as any).output : output;

            task.update({
              output: taskOutput,
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
          }
        })
      );
    }

    job.update({
      status: failedTask ? JobStatus.Failed : JobStatus.Succeeded,
      updatedAt: new Date(),
    });

    return {
      id: persistMode ? job.ref.id : null,
      name: job.name,
      status: job.status,
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
          status: task.status,
          output: task.output,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          dependsOn: task.dependsOn,
        })),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  } catch (e: any) {
    console.error("Error processing tasks:", e);
    errorMessage = e.message;

    throw new functions.https.HttpsError(
      "internal",
      e?.message ?? "An error occurred during task processing!"
    );
  } finally {
    if (persistMode) {
      job.update({
        status:
          failedTask || errorMessage ? JobStatus.Failed : JobStatus.Succeeded,
        outputMessage: errorMessage,
        updatedAt: new Date(),
      });

      clearInterval(persistInterval);
      await persistJobState();
    }
  }
});

const verifyAdmin = async (authToken: DecodedIdToken) => {
  try {
    if (!Array.isArray(authToken.dogenRoles)) {
      return false;
    }

    return authToken.dogenRoles.includes("admin");
  } catch (error) {
    console.error("Error verifying auth token:", error);
    return false;
  }
};

async function processTask(
  task: JobTask,
  taskRegistry: Map<string, JobTask>,
  job: Job
): Promise<Record<string, any>> {
  // Look up handler in centralized registry
  const handler = getHandler(task.service, task.command);

  if (!handler) {
    // Generate descriptive error message with available options
    throw new Error(getUnsupportedTaskError(task.service, task.command));
  }

  // NOTE: Task input validation happens at entry points:
  // 1. Initial tasks: validated at job submission (lines 53-83)
  // 2. Child tasks: validated when spawned (lines 163-177)
  // 3. AI-generated tasks: validated at orchestrator/service/command agent level
  // By this point, the task has already been validated, so we can safely execute.

  // Create job context for this task execution
  const context = createJobContext(taskRegistry, job);

  // Execute the handler with task and context
  return await handler(task, context);
}
