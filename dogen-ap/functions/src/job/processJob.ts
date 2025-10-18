import * as functions from "firebase-functions/v1";
import { DecodedIdToken } from "firebase-admin/auth";
import { Mutex } from "async-mutex";
import { FirebaseTaskStatus, JobTask } from "./jobTask";
import { Job, JobStatus } from "./job";
import { TaskGraph } from "./taskGraph";
import { createJobContext } from "./jobContext";
import { getHandler, getUnsupportedTaskError } from "./handlers/registry";
import { validateTaskInput } from "./handlers/ai/orchestrate/validator";

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

  let job = new Job({
    name: jobName,
    abortOnFailure: abortOnFailure,
    maxTasks: maxTasks,
    maxDepth: maxDepth,
    timeout: timeout,
    verbose: verbose,
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
              // FIRST PASS: Collect all child IDs that will be created
              // This allows us to validate dependencies against planned siblings
              const plannedChildIds = new Set<string>();
              for (let i = 0; i < output.childTasks.length; i++) {
                plannedChildIds.add(`${task.id}-${i}`);
              }

              // SECOND PASS: Create children with enhanced validation
              for (let i = 0; i < output.childTasks.length; i++) {
                const childSpec = output.childTasks[i];
                const childId = `${task.id}-${i}`;

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

                // Create child task with explicit depth
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

                if (verbose) {
                  console.log(`Task ${task.id} spawned child task ${childId} (${childSpec.service}/${childSpec.command})`);
                }
              }
            }

            task.update({
              output,
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
      tasks: Array.from(taskRegistry.values()).map((task) => ({
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

  // Validate task input before execution
  const validationErrors = validateTaskInput(
    task.service,
    task.command,
    task.input || {}
  );

  if (validationErrors.length > 0) {
    throw new Error(
      `Task validation failed for ${task.service}/${task.command}:\n` +
      validationErrors.map(e => `  - ${e}`).join('\n')
    );
  }

  // Create job context for this task execution
  const context = createJobContext(taskRegistry, job);

  // Execute the handler with task and context
  return await handler(task, context);
}
