import { firestore, logger } from "firebase-functions/v1";
import { AccountData, createOrUpdateUser } from "./userManagement";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as utils from "../utils/utils";

export const onAccountUpdate = firestore
  .document(`${utils.accountsCollectionPath}/{accountId}`)
  .onUpdate(async (change, context) => {
    const accountId = context.params.accountId; // Must match extension.yaml resource definition
    const snapshotData = change.after.exists ? change.after.data() : null;

    if (!snapshotData) {
      logger.error("No account data available.");
      return;
    }

    // Validate the data has required fields
    if (!snapshotData.email || typeof snapshotData.email !== 'string') {
      logger.error("Account data missing required email field or invalid email type");
      return;
    }

    // Create a validated AccountData object
    const accountData: AccountData = {
      email: snapshotData.email,
      disabled: typeof snapshotData.disabled === 'boolean' ? snapshotData.disabled : false,
      roles: Array.isArray(snapshotData.roles) ? snapshotData.roles : ['registered'],
      temporaryPassword: typeof snapshotData.temporaryPassword === 'string' ? snapshotData.temporaryPassword : null
    };

    try {
      const { user, isNewUser, needsNewAccount } = await createOrUpdateUser(accountId, accountData);

      // Sometimes we need to recreate the account to maintain User ID consistency
      if (needsNewAccount) {
        try {
          // Delete the original document
          await change.after.ref.delete();
          
          // Create a new account document with the correct ID
          const newAccountRef = admin.firestore().collection(utils.accountsCollectionPath).doc(user.uid);
          await newAccountRef.set({
            ...accountData,
            uid: user.uid,
            recreatedAt: FieldValue.serverTimestamp(),
          });
          
          logger.info(`Created new account document for user`, { uid: user.uid, oldAccountId: accountId });
        } catch (error) {
          logger.error("Error during account recreation", { 
            error: error instanceof Error ? error.message : error,
            uid: user.uid, 
            oldAccountId: accountId 
          });
          throw error; // Re-throw to be caught by outer catch block
        }
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