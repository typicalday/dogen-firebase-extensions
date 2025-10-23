import * as functions from "firebase-functions/v1";
import { DecodedIdToken } from "firebase-admin/auth";
import { JobTask } from "./jobTask";
import { Job, JobStatus } from "./job";
import { validateTaskInput } from "./validator";
import { executeJobOrchestration, OrchestrationConfig } from "./orchestrator";

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

  // Audit log: User information and job request
  const auditLog = {
    user: {
      uid: context.auth.uid,
      email: authToken.email ?? null,
      displayName: authToken.name ?? null,
    },
    request: data,
  };
  console.log("Job audit:", JSON.stringify(auditLog));

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

  let errorMessage: string | undefined = undefined;

  try {
    // Execute job orchestration using the orchestrator module
    const orchestrationConfig: OrchestrationConfig = {
      maxTasks: job.maxTasks,
      maxDepth: job.maxDepth,
      timeout: job.timeout,
      verbose: job.verbose,
      aiPlanning: job.aiPlanning,
      aiAuditing: job.aiAuditing,
      abortOnFailure: job.abortOnFailure,
      jobName: String(job.name), // Convert to string primitive
    };

    const orchestrationResult = await executeJobOrchestration(job.tasks, orchestrationConfig);

    // Update job status based on orchestration result
    const jobStatus = orchestrationResult.status === "failed" ? JobStatus.Failed : JobStatus.Succeeded;
    job.update({
      status: jobStatus,
      updatedAt: new Date(),
    });

    return {
      id: persistMode ? job.ref.id : null,
      name: job.name,
      status: job.status,
      tasks: orchestrationResult.tasks, // Tasks are already sorted by orchestrator
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
      // In case of error, job status may not have been set yet
      if (errorMessage) {
        job.update({
          status: JobStatus.Failed,
          outputMessage: errorMessage,
          updatedAt: new Date(),
        });
      }

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
