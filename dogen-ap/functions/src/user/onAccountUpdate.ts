import * as admin from "firebase-admin";
import { firestore, logger } from "firebase-functions";

export const onAccountUpdate = firestore
  .document("dogen_application_accounts/{userId}")
  .onUpdate(async (change, context) => {
    // Must match extension.yaml resource definition
    const userId = context.params.userId;

    const accountData = change.after.exists ? change.after.data() : null;

    if (!accountData) {
      logger.error("No account data available.");
      return;
    }

    const disabled = accountData.disabled;

    // Allow a temporary (insecure plaintext) password to be set
    const password = accountData.temporaryPassword;

    const role = accountData.role ?? "registered";

    try {
      const user = await admin.auth().getUser(userId);

      const updateRequest = {
        ...(password != null ? { password: password } : {}),
        ...(disabled != null ? { disabled: disabled } : {}),
      };

      if (Object.keys(updateRequest).length > 0) {
        await admin.auth().updateUser(userId, updateRequest);
      }

      const { customClaims } = user;

      if (customClaims && customClaims.role != role) {
        await admin.auth().setCustomUserClaims(userId, {
          role,
        });
        logger.info("Role claim updated for user.", { uid: userId });
      }

      logger.info("Updated user.", { uid: userId });
    } catch (error) {
      logger.info("Error updating auth user from account.", { error });
    } finally {
      if (password != null) {
        await change.after.ref.update({
          temporaryPassword: admin.firestore.FieldValue.delete(),
        });
      }
    }
  });
