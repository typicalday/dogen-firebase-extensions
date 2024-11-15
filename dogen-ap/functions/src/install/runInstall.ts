/* eslint-disable max-len */
import * as admin from "firebase-admin";
import * as utils from "../utils/utils";
import { getExtensions } from "firebase-admin/extensions";
import { getFunctions } from "firebase-admin/functions";
import { logger, tasks } from "firebase-functions";
import { getUserData } from "../user/onUserCreate";
import config, { IConfig } from "../config";
import axios from "axios";

const BATCH_SIZE = 500;

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
  .onDispatch(async (data) => {
    const accountsCollection = db.collection(utils.accountsCollectionId);
    const runtime = getExtensions().runtime();
    const offset = data.offset ?? 0;

    if (data.pageToken === undefined) {
      logger.info("Starting installation process.");

      // Since this is the first execution, process the main admin user.
      await processAdminUser(accountsCollection, auth, config);

      await processRegistration(config);

      if (!config.backfillExistingUsers) {
        return runtime.setProcessingState(
          "PROCESSING_COMPLETE",
          "Skipping backfill of existing users."
        );
      }

      logger.info("Starting auth user backfill into accounts collection.");
    } else {
      logger.info(
        `Backfilling existing users, continuing with page token: ${data.pageToken}`
      );
    }

    try {
      // Obtain a list of Auth users.
      const { users, pageToken } = await auth.listUsers(
        BATCH_SIZE,
        data.pageToken
      );

      const batch = db.batch();

      // For each user create a Firestore document in the accounts collection.
      for (const user of users) {
        // This user should have been processed already.
        if (user.email === config.adminUserEmail) {
          continue;
        }

        const userDocumentRef = accountsCollection.doc(user.uid);
        batch.set(userDocumentRef, getUserData(user), { merge: true });
      }

      const commitResult = await batch.commit();

      // Prepare for next execution if necessary.
      const nextOffset = offset + commitResult.length;

      if (pageToken) {
        const queue = getFunctions().taskQueue(
          `locations/${config.location}/functions/runInstall`,
          process.env.EXT_INSTANCE_ID
        );

        await queue.enqueue({
          pageToken,
          offset: nextOffset,
        });
      } else {
        // If there are no more users to process, mark the task as complete.
        logger.info(
          `Auth user backfill completed with ${nextOffset} documents.`
        );

        return runtime.setProcessingState(
          "PROCESSING_COMPLETE",
          `Auth user backfill created ${nextOffset} documents.`
        );
      }
    } catch (e) {
      logger.error(
        `Auth user backfill failed at offset ${offset}, with error:`,
        e
      );

      // Rethrow error so that it can be retried.
      throw e;
    }
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
  if (config.dogenApiKey !== undefined) {
    // Do not process a registration if this project has already been registered.
    return;
  }

  const applicationMetadataCollection = admin
    .firestore()
    .collection(utils.applicationCollectionId);

  const registrationDoc = await applicationMetadataCollection
    .doc(utils.registrationDocId)
    .get();

  if (registrationDoc.exists && registrationDoc.data()?.temporaryApiKey != null) {
    logger.info(
      "Skipping registration process because it has already been completed."
    );
    return;
  }

  const serviceUrl = utils.getDogenRegisterServiceUrl();
  let registrationTemporaryApiKey;
  let registrationStatus;
  let registrationMessage;

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
      firebaseExtensionInstanceId: config.firebaseExtensionInstanceId
    };

    const response = await axios.post(serviceUrl, body, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    logger.info("Registration response received successfully:", response.data);

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

    if (!temporaryApiKey) {
      throw new Error(
        "No temporary API key received from registration service."
      );
    }

    registrationTemporaryApiKey = temporaryApiKey;
    registrationStatus = "success";
    registrationMessage =
      response.data.message ??
      "Registration process completed successfully.  Please check your email for further instructions.";
  } catch (error) {
    const errorMessage = (error as Error).message;
    logger.error("Error:\n", errorMessage);

    registrationTemporaryApiKey = null;
    registrationStatus = "failed";
    registrationMessage = errorMessage;
  } finally {
    await applicationMetadataCollection
      .doc(utils.registrationDocId)
      .set(
        {
          status: registrationStatus,
          message: registrationMessage,
          temporaryApiKey: registrationTemporaryApiKey,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
      .catch((updateError) =>
        console.error("Error updating install document:\n", updateError)
      );

    logger.info("Registration process completed.");
  }
}
