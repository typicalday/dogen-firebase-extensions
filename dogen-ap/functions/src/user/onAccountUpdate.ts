import { firestore, logger } from "firebase-functions";
import { createOrUpdateUser } from "./userManagement";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export const onAccountUpdate = firestore
  .document("dogen_application_accounts/{accountId}")
  .onUpdate(async (change, context) => {
    const accountId = context.params.accountId; // Must match extension.yaml resource definition
    const accountData = change.after.exists ? change.after.data() : null;

    if (!accountData) {
      logger.error("No account data available.");
      return;
    }

    try {
      const { user, isNewUser, needsNewAccount } = await createOrUpdateUser(accountId, accountData);

      if (needsNewAccount) {
        // Delete the old account document
        await change.after.ref.delete();

        // Create a new account document with the correct ID
        const newAccountRef = admin.firestore().collection('dogen_application_accounts').doc(user.uid);
        await newAccountRef.set({
          ...accountData,
          uid: user.uid,  // Ensure the UID in the document matches the auth UID
          recreatedAt: FieldValue.serverTimestamp(),
        });

        logger.info(`Created new account document for user`, { uid: user.uid, oldAccountId: accountId });
      } else {
        if (accountData.temporaryPassword != null) {
          await change.after.ref.update({
            temporaryPassword: admin.firestore.FieldValue.delete(),
          });
        }
      }

      logger.info(`${isNewUser ? 'Created' : 'Updated'} user and account`, { uid: user.uid, isNewUser, needsNewAccount });
    } catch (error) {
      logger.error("Error processing account update.", { error, accountId });
    }
  });