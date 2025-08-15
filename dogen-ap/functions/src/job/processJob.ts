import * as functions from "firebase-functions/v1";
import { DecodedIdToken } from "firebase-admin/auth";
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
    tasks: tasksData.map((taskData: any) => {
      const { service, command, input } = taskData;
      return new JobTask({ service, command, input });
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

  try {
    for (let task of job.tasks) {
      try {
        if (task.status === FirebaseTaskStatus.Failed) {
          failedTask = true;
          task.update({
            startedAt: new Date(),
            completedAt: new Date(),
          });
          continue;
        } else if (failedTask && abortOnFailure) {
          task.update({
            status: FirebaseTaskStatus.Aborted,
            output: {
              error: "Previous task failed and abortOnFailure is true",
            },
            startedAt: new Date(),
            completedAt: new Date(),
          });
          continue;
        }

        task.update({
          output: {},
          status: FirebaseTaskStatus.Succeeded,
          startedAt: new Date(),
        });

        const output = await processTask(task);

        task.update({
          output,
          completedAt: new Date(),
        });
      } catch (error: any) {
        console.error("Error processing task:", error);

        task.update({
          status: FirebaseTaskStatus.Failed,
          output: { error: error.message },
          completedAt: new Date(),
        });

        failedTask = true;
      }
    }

    job.update({
      status: failedTask ? JobStatus.Failed : JobStatus.Succeeded,
      updatedAt: new Date(),
    });

    return {
      id: persistMode ? job.ref.id : null,
      name: job.name,
      status: job.status,
      tasks: job.tasks.map((task) => ({
        service: task.service,
        command: task.command,
        status: task.status,
        output: task.output,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
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
