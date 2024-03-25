import * as functions from "firebase-functions";
import { DecodedIdToken } from "firebase-admin/auth";
import { FirebaseTaskStatus, JobTask } from "./jobTask";
import { handleCopyCollection } from "./handlers/copyCollection";
import { handleDeletePath } from "./handlers/deletePath";
import { handleDeleteDocuments } from "./handlers/deleteDocuments";
import { Job } from "./job";

const persistIntervalDuration = 10000;

export const processJob = functions.https.onCall(async (data, context) => {
  const authToken = context.auth?.token;
  if (!authToken || !(await verifyAdmin(authToken))) {
    throw new functions.https.HttpsError("permission-denied", "Unauthorized");
  }

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

  const persistInterval = setInterval(persistJobState, persistIntervalDuration);

  let failedTask = false;

  try {
    for (const task of job.tasks) {
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

    return {
      id: job.ref.id,
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
  } catch (error: any) {
    console.error("Error processing tasks:", error);

    throw new functions.https.HttpsError(
      "internal",
      error?.message ?? "An error occurred during task processing!"
    );
  } finally {
    clearInterval(persistInterval);
    await persistJobState();
  }
});

const verifyAdmin = async (authToken: DecodedIdToken) => {
  try {
    return authToken.role === "admin";
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
        case "delete-path":
          return await handleDeletePath(task);
        case "delete-documents":
          return await handleDeleteDocuments(task);
        default:
          throw new Error(`Unsupported Firestore command: ${task.command}`);
      }
      break;
    default:
      throw new Error(`Unsupported service: ${task.service}`);
  }
}
