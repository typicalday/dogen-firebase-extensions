/* eslint-disable max-len */
import * as admin from "firebase-admin";
import * as utils from "../utils/utils";
import { Storage } from "@google-cloud/storage";
import { getExtensions } from "firebase-admin/extensions";
import { logger, tasks } from "firebase-functions";
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
    const accountsCollection = db.collection(utils.accountsCollectionId);
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
      await processRegistration(config);
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

async function processRegistration(config: IConfig) {
  const applicationMetadataCollection = admin
    .firestore()
    .collection(utils.applicationCollectionId);

  const registrationDoc = await applicationMetadataCollection
    .doc(utils.registrationDocId)
    .get();

  if (
    config.dogenApiKey !== undefined ||
    (registrationDoc.exists && registrationDoc.data()?.temporaryApiKey != null)
  ) {
    return await processRegistrationUpdate(
      config,
      applicationMetadataCollection
    );
  }

  await processNewRegistration(config, applicationMetadataCollection);
}

async function processRegistrationUpdate(
  config: IConfig,
  applicationMetadataCollection: FirebaseFirestore.CollectionReference
) {
  const serviceUrl = utils.getDogenRegisterServiceUrl();

  try {
    const body = {
      firebaseConfigApiKey: config.firebaseConfigApiKey,
      firebaseConfigAppId: config.firebaseConfigAppId,
      firebaseConfigMessagingSenderId: config.firebaseConfigMessagingSenderId,
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

    await applicationMetadataCollection.doc(utils.registrationDocId).set(
      {
        alias: response.data.alias,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    logger.info(
      "Registration update response received successfully:",
      response.data
    );
  } catch (error) {
    const errorMessage = (error as Error).message;
    logger.error("Error:\n", errorMessage);
    throw error;
  } finally {
    logger.info("Registration update process completed.");
  }
}

async function processNewRegistration(
  config: IConfig,
  applicationMetadataCollection: FirebaseFirestore.CollectionReference
) {
  const serviceUrl = utils.getDogenRegisterServiceUrl();
  let registrationTemporaryApiKey;
  let registrationStatus;
  let registrationMessage;
  let registrationAlias;

  try {
    const body = {
      accountEmail: config.dogenAccountEmail,
      invitationCode: config.dogenInvitationCode,
      firebaseConfigApiKey: config.firebaseConfigApiKey,
      firebaseConfigAppId: config.firebaseConfigAppId,
      firebaseConfigMessagingSenderId: config.firebaseConfigMessagingSenderId,
      firebaseConfigStorageBucket: config.firebaseConfigStorageBucket,
      firebaseConfigProjectId: config.firebaseConfigProjectId,
      firebaseConfigAuthDomain: config.firebaseConfigAuthDomain,
      firebaseConfigRegion: config.location,
      firebaseExtensionInstanceId: config.firebaseExtensionInstanceId,
    };

    const identityToken = await utils.getIdentityToken();

    const response = await axios.post(serviceUrl, body, {
      headers: {
        "X-Original-Auth": `Bearer ${identityToken}`,
        "Content-Type": "application/json",
      },
      validateStatus: (_) => true,
    });

    logger.info("Registration response received:", response.data);

    if (response.status !== 200) {
      throw new Error(
        `
          Status Code: ${response.status}
          Body: ${response.data}
          
          Please uninstall the extension and try again later.
          `
      );
    }

    const temporaryApiKey = response.data.temporaryApiKey;
    const alias = response.data.alias;

    if (!temporaryApiKey) {
      throw new Error(
        "No temporary API key received from registration service."
      );
    }

    if (!alias) {
      throw new Error("No alias received from registration service.");
    }

    await updateStorageCors(alias);

    registrationTemporaryApiKey = temporaryApiKey;
    registrationAlias = alias;
    registrationStatus = "success";
    registrationMessage =
      response.data.message ??
      "Registration process completed successfully.  Please check your email for further instructions.";
  } catch (error) {
    const errorMessage = (error as Error).message;
    logger.error("Error:\n", errorMessage);

    registrationTemporaryApiKey = null;
    registrationAlias = null;
    registrationStatus = "failed";
    registrationMessage = errorMessage;
    throw error;
  } finally {
    await applicationMetadataCollection
      .doc(utils.registrationDocId)
      .set(
        {
          status: registrationStatus,
          message: registrationMessage,
          temporaryApiKey: registrationTemporaryApiKey,
          alias: registrationAlias,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
      .catch((updateError) =>
        console.error("Error updating install document:\n", updateError)
      );

    logger.info("Registration process completed.");
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
