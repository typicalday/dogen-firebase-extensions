import { firestore, logger } from "firebase-functions";
import { AccountData, createOrUpdateUser } from "./userManagement";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export const onAccountCreate = firestore
  .document("dogen_application_accounts/{accountId}")
  .onCreate(async (snapshot, context) => {
    const accountId = context.params.accountId; // Must match extension.yaml resource definition
    const snapshotData = snapshot.data();

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
      temporaryPassword: typeof snapshotData.temporaryPassword === 'string' ? snapshotData.temporaryPassword : undefined
    };    

    try {
      const { user, isNewUser, needsNewAccount } = await createOrUpdateUser(accountId, accountData);

      if (needsNewAccount) {
        const recreatedAt = accountData.recreatedAt;

        if (recreatedAt != null && recreatedAt != undefined) {
          logger.warn(`Could not recreate account for user ${user.uid} because it was already recreated at ${recreatedAt}.`);
          return;
        }

        // This shouldn't happen on account creation, but let's handle it just in case
        logger.warn(`Unexpected needsNewAccount flag on account creation`, { accountId, uid: user.uid });
        
        // Delete the original document
        await snapshot.ref.delete();

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
          await snapshot.ref.update({
            temporaryPassword: admin.firestore.FieldValue.delete(),
          });
        }
      }

      logger.info(`${isNewUser ? 'Created' : 'Updated'} user and account`, { uid: user.uid, isNewUser, needsNewAccount });
    } catch (error) {
      logger.error("Error processing account creation.", { error, accountId });
    }
  });