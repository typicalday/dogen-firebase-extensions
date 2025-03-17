/* eslint-disable max-len */
import * as admin from "firebase-admin";
import * as utils from "../utils/utils";
import { Storage } from "@google-cloud/storage";
import { getExtensions } from "firebase-admin/extensions";
import { logger, tasks } from "firebase-functions/v1";
import config, { IConfig } from "../config";
import axios from "axios";
import { FieldValue } from "firebase-admin/firestore";
import { getUserData } from "../user/userManagement";

const auth = admin.auth();
const db = admin.firestore();

export const runInstall = tasks
  .taskQueue({
    retryConfig: {
      maxAttempts: 5,
      minBackoffSeconds: 60,
    },
    rateLimits: {
      maxConcurrentDispatches: 1,
    },
  })
  .onDispatch(async (_) => {
    const accountsCollection = db.collection(utils.accountsCollectionPath);
    const runtime = getExtensions().runtime();

    logger.info("Starting installation process.");

    try {
      await processAdminUser(accountsCollection, auth, config);
    } catch (e) {
      logger.error("Admin user creation failed with error:", e);
      return runtime.setProcessingState(
        "PROCESSING_FAILED",
        `Admin user creation failed, try again by reconfiguring or reinstalling the extension.`
      );
    }

    try {
      if (process.env.DOGEN_API_KEY && process.env.DOGEN_API_KEY.trim() !== '') {
        await registerProjectConfig(config);
      }
    } catch (e) {
      logger.error("Registration process failed with error:", e);
      return runtime.setProcessingState(
        "PROCESSING_FAILED",
        `Registration failed, try again by reconfiguring or reinstalling the extension.`
      );
    }

    return runtime.setProcessingState(
      "PROCESSING_COMPLETE",
      "Installation process completed successfully."
    );
  });

async function processAdminUser(
  accountsCollection: FirebaseFirestore.CollectionReference,
  auth: admin.auth.Auth,
  config: IConfig
) {
  logger.info("Creating admin user", config.adminUserEmail);

  // Find an auth user matching the config.adminUserEmail email address
  const adminUser = await auth.getUserByEmail(config.adminUserEmail);

  // If the admin user is not found, the entire process should be stopped.
  if (!adminUser) {
    throw new Error(
      `Authentication user with email ${config.adminUserEmail} not found.  Reinstall the extension to try again.`
    );
  }

  // Create an application account document reference for the admin user.
  const adminUserDocumentRef = accountsCollection.doc(adminUser.uid);

  // Check if the admin user already exists in the accounts collection
  const adminUserSnapshot = await adminUserDocumentRef.get();

  if (!adminUserSnapshot.exists) {
    // Create the admin user in the accounts collection
    await adminUserDocumentRef.set(getUserData(adminUser, ["admin"]), {
      merge: true,
    });
    logger.info("Admin user created in the accounts collection.");
  } else {
    logger.info("Admin user already exists in the accounts collection.");
  }
}

async function registerProjectConfig(
  config: IConfig,
) {
  const serviceUrl = utils.getDogenRegisterServiceUrl();

  const applicationDoc = admin
    .firestore()
    .doc(utils.applicationDocumentPath);

  try {
    const body = {
      firebaseConfigRegion: config.location,
      firebaseExtensionInstanceId: config.firebaseExtensionInstanceId,
    };

    const response = await axios.patch(serviceUrl, body, {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": await utils.getApiKey(),
      },
      validateStatus: (_) => true,
    });

    if (response.status !== 200) {
      throw new Error(
        `
          Status Code: ${response.status}
          Body: ${response.data}
          
          Please uninstall the extension and try again later.
          `
      );
    }

    const projectAlias = response.data.alias;

    if (!projectAlias) {
      throw new Error(
        `
          Status Code: ${response.status}
          Body: ${response.data}
          
          No alias received from registration service.  Please uninstall the extension and try again later.
          `
      );
    }

    await updateStorageCors(projectAlias);

    await applicationDoc.set(
      {
        alias: response.data.alias,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    logger.info(
      "Project registration response received successfully:",
      response.data
    );
  } catch (error) {
    const errorMessage = (error as Error).message;
    logger.error("Project registration error:\n", errorMessage);

    await applicationDoc.set(
      {
        status: utils.GenerationStatus.FAILED,
        message: errorMessage,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    throw Error('Project registration failed: ' + errorMessage);
  } finally {
    logger.info("Project registration process completed.");
  }
}

async function updateStorageCors(projectAlias: string) {
  try {
    const storage = new Storage();
    const bucket = storage.bucket(config.firebaseConfigStorageBucket);

    // Get existing metadata to check current CORS
    const [metadata] = await bucket.getMetadata();
    const newDomain = `https://${projectAlias}.dogen.io`;

    // Check if domain already exists in any CORS rule
    const domainExists = metadata.cors?.some((rule) =>
      rule.origin?.includes(newDomain)
    );

    if (domainExists) {
      logger.info(`Domain ${newDomain} already exists in CORS configuration`);
      return;
    }

    // Create new CORS entry
    const newCorsRule = {
      maxAgeSeconds: 3600,
      method: ["GET", "POST", "PUT", "DELETE", "HEAD"],
      origin: [newDomain],
      responseHeader: [
        "Content-Type",
        "Authorization",
        "Content-Length",
        "User-Agent",
        "x-requested-with",
      ],
    };

    // Combine existing rules with new rule
    const corsConfig = [...(metadata.cors || []), newCorsRule];

    // Set the updated CORS configuration
    await bucket.setCorsConfiguration(corsConfig);
    logger.info(`Added new CORS rule for domain: ${newDomain}`);
  } catch (error) {
    logger.error("Error updating CORS configuration:", error);
    throw error;
  }
}
