import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { DecodedIdToken } from "firebase-admin/auth";

import {
  FIREBASE_TASK_STATUS_ABORTED,
  FIREBASE_TASK_STATUS_FAILED,
  FIREBASE_TASK_STATUS_FINISHED,
  FIREBASE_TASK_STATUS_STARTED,
  FirebaseTask,
} from "./firebaseTask";
import { handleCopyCollection } from "./handlers/copyCollection";
import { handleDeletePath } from "./handlers/deletePath";
import { handleDeleteDocuments } from "./handlers/deleteDocuments";

const db = admin.firestore();

export const processTasks = functions.https.onCall(async (data, context) => {
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

  const tasks: FirebaseTask[] = tasksData.map((taskData: any) => {
    const { service, command, input } = taskData;
    return createTask(service, command, input);
  });

  let failedTask = false;

  try {
    for (const task of tasks) {
      try {
        if (task.status === FIREBASE_TASK_STATUS_FAILED) {
          failedTask = true;
          await task.persist();
          continue;
        } else if (failedTask && abortOnFailure) {
          await task
            .update({
              status: FIREBASE_TASK_STATUS_ABORTED,
              output: {
                error: "Previous task failed and abortOnFailure is true",
              },
            })
            .persist();
          continue;
        }

        await task.persist();

        task
          .update({
            output: await processTask(task),
            status: FIREBASE_TASK_STATUS_FINISHED,
          })
          .persist();
      } catch (error: any) {
        console.error("Error processing task:", error);

        await task
          .update({
            status: FIREBASE_TASK_STATUS_FAILED,
            output: { error: error.message },
          })
          .persist();

        failedTask = true;
      }
    }

    return {
      tasks: tasks.map((task) => ({
        id: task.ref.id,
        status: task.status,
        output: task.output,
      })),
    };
  } catch (error: any) {
    console.error("Error processing tasks:", error);

    throw new functions.https.HttpsError(
      "internal",
      error?.message ?? "An error occurred during task processing!"
    );
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

function createTask(service: string, command: string, input: any): FirebaseTask {
  let error: string | null = null;

  if (typeof service !== "string" || service.trim() === "") {
    error = "Invalid input: service must be a non-empty string";
  }

  if (typeof command !== "string" || command.trim() === "") {
    error = "Invalid input: command must be a non-empty string";
  }

  const taskRef = db.collection("dogen_application_tasks").doc();

  return new FirebaseTask({
    ref: taskRef,
    service,
    command,
    input,
    output: error ? { error } : {},
    status: error
      ? FIREBASE_TASK_STATUS_FAILED
      : FIREBASE_TASK_STATUS_STARTED,
  });
}

async function processTask(task: FirebaseTask): Promise<Record<string, any>> {
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