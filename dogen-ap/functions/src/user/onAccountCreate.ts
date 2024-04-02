import * as admin from "firebase-admin";
import { firestore, logger } from "firebase-functions";

export const onAccountCreate = firestore
  .document("dogen_application_accounts/{userId}")
  .onCreate(async (snapshot, context) => {
    const accountData = snapshot.data();
    const userId = context.params.userId;
    const disabled = accountData.disabled ?? false;

    if (!accountData) {
      logger.error("No account data available.");
      return;
    }

    try {
      try {
        await admin.auth().getUser(userId);
        logger.info("User already exists.", { uid: userId });
        return;
      } catch (userNotFoundError) {
        // User does not exist, proceed with creation
      }

      const email = accountData.email;
      const role = accountData.role ?? "registered";

      // Allow a temporary (insecure plaintext) password to be set
      let password = accountData.temporaryPassword;

      if (!password) {
        password = generateRandomPassword();
      }

      const userRecord = await admin.auth().createUser({
        uid: userId,
        email,
        password,
        disabled: disabled,
      });

      await admin.auth().setCustomUserClaims(userRecord.uid, {
        role,
      });

      if (accountData.temporaryPassword != null) {
        await snapshot.ref.update({
          temporaryPassword: admin.firestore.FieldValue.delete(),
        });
      }

      logger.info("Created new user with role.", { uid: userId, role });
    } catch (error) {
      logger.error("Error creating new user.", { error });
    }
  });

function generateRandomPassword() {
  const length = 10;
  const charset =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let retVal = "";
  for (let i = 0, n = charset.length; i < length; ++i) {
    retVal += charset.charAt(Math.floor(Math.random() * n));
  }
  return retVal;
}
