/* eslint-disable max-len */
import * as admin from "firebase-admin";
import {getExtensions} from "firebase-admin/extensions";
import {getFunctions} from "firebase-admin/functions";
import {logger, tasks} from "firebase-functions";
import {getUserData} from "./onUserCreate";
import config from "../config";

const BATCH_SIZE = 500;

const auth = admin.auth();
const db = admin.firestore();

export const backfillExistingUsers = tasks
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
    const runtime = getExtensions().runtime();

    if (!config.backfillExistingUsers) {
      return runtime.setProcessingState(
        "PROCESSING_COMPLETE",
        "Skipping backfill of existing users."
      );
    }

    const offset = data.offset ?? 0;

    if (data.pageToken) {
      logger.info(
        `Backfilling existing users, continuing with page token: ${data.pageToken}`
      );
    } else {
      logger.info(
        "Starting auth user backfill into accounts collection."
      );
    }

    try {
      // Obtain a list of Auth users.
      const {users, pageToken} = await auth.listUsers(BATCH_SIZE, data.pageToken);

      const batch = db.batch();

      // For each one create a Firestore document in the accounts collection.
      for (const user of users) {
        const userDocumentRef = db.collection("accounts").doc(user.uid);
        batch.set(userDocumentRef, getUserData(user), {merge: true});
      }

      const commitResult = await batch.commit();

      // Prepare for next execution if necessary.
      const nextOffset = offset + commitResult.length;

      if (pageToken) {
        const queue = getFunctions().taskQueue(
          `locations/${config.location}/functions/backfillExistingUsers`,
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
      logger.error(`Auth user backfill failed at offset ${offset}, with error:`, e);

      // Rethrow error so that it can be retried.
      throw e;
    }
  });
