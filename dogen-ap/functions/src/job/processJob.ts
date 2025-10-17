import * as functions from "firebase-functions/v1";
import { DecodedIdToken } from "firebase-admin/auth";
import { Mutex } from "async-mutex";
import { FirebaseTaskStatus, JobTask } from "./jobTask";
import { handleCopyCollection } from "./handlers/firestore/copyCollection";
import { handleDeletePath } from "./handlers/firestore/deletePath";
import { handleDeleteDocuments } from "./handlers/firestore/deleteDocuments";
import { Job, JobStatus } from "./job";
import { handleListCollections } from "./handlers/firestore/listCollections";
import { handleCreateDocument } from "./handlers/firestore/createDocument";
import { handleCopyDocument } from "./handlers/firestore/copyDocument";
import { handleExportCollectionCSV } from "./handlers/firestore/exportCollectionCSV";
import { handleImportCollectionCSV } from "./handlers/firestore/importCollectionCSV";
import { handleExportCollectionJSON } from "./handlers/firestore/exportCollectionJSON";
import { handleImportCollectionJSON } from "./handlers/firestore/importCollectionJSON";
import { handleDeleteStoragePath } from "./handlers/storage/deletePath";
import { handleProcessInference } from "./handlers/ai/processInference";
import { handleCreateUser } from "./handlers/authentication/createUser";
import { handleGetUser } from "./handlers/authentication/getUser";
import { handleUpdateUser } from "./handlers/authentication/updateUser";
import { handleDeleteUser } from "./handlers/authentication/deleteUser";
import { handleListUsers } from "./handlers/authentication/listUsers";
import { handleGetUserClaims } from "./handlers/authentication/getUserClaims";
import { handleSetUserClaims } from "./handlers/authentication/setUserClaims";
import { TaskGraph } from "./taskGraph";

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
    tasks: tasksData.map((taskData: any) => {
      const { service, command, input } = taskData;
      return new JobTask({ service, command, input, depth: 0 });
    }),
  });

  const persistJobState = async () => {
    console.log("Persisting job progress to database...");
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

            // Execute task and get output
            const output = await processTask(task);

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

                console.log(`Task ${task.id} spawned child task ${childId}`);
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

async function processTask(task: JobTask): Promise<Record<string, any>> {
  switch (task.service) {
    case "firestore":
      switch (task.command) {
        case "copy-collection":
          return await handleCopyCollection(task);
        case "copy-document":
          return await handleCopyDocument(task);
        case "create-document":
          return await handleCreateDocument(task);
        case "delete-path":
          return await handleDeletePath(task);
        case "delete-documents":
          return await handleDeleteDocuments(task);
        case "export-collection-csv":
          return await handleExportCollectionCSV(task);
        case "export-collection-json":
          return await handleExportCollectionJSON(task);
        case "import-collection-csv":
          return await handleImportCollectionCSV(task);
        case "import-collection-json":
          return await handleImportCollectionJSON(task);
        case "list-collections":
          return await handleListCollections(task);
        default:
          throw new Error(`Unsupported Firestore command: ${task.command}`);
      }
    case "storage":
      switch (task.command) {
        case "delete-path":
          return await handleDeleteStoragePath(task);
        default:
          throw new Error(`Unsupported Storage command: ${task.command}`);
      }
    case "ai":
      switch (task.command) {
        case "process-inference":
          return await handleProcessInference(task);
        default:
          throw new Error(`Unsupported AI command: ${task.command}`);
      }
    case "authentication":
      switch (task.command) {
        case "create-user":
          return await handleCreateUser(task);
        case "get-user":
          return await handleGetUser(task);
        case "update-user":
          return await handleUpdateUser(task);
        case "delete-user":
          return await handleDeleteUser(task);
        case "list-users":
          return await handleListUsers(task);
        case "get-user-claims":
          return await handleGetUserClaims(task);
        case "set-user-claims":
          return await handleSetUserClaims(task);
        default:
          throw new Error(`Unsupported Authentication command: ${task.command}`);
      }
    default:
      throw new Error(`Unsupported service: ${task.service}`);
  }
}
