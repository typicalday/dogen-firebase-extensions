import * as admin from "firebase-admin";
import { firestore, logger } from "firebase-functions";
import { updateUserClaims } from "../utils/utils";

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

    const email = accountData.email;
    const roles = accountData.roles ?? ["registered"];

    try {
      try {
        let user = await admin.auth().getUser(userId);
        logger.info("User already exists, skipping creation.", { uid: userId });

        await updateUserClaims(user, roles);
        logger.info("Dogen role claims updated for user.", { uid: userId });

        return;
      } catch (userNotFoundError) {
        // User does not exist, proceed with creation
      }

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

      await updateUserClaims(userRecord, roles);

      if (accountData.temporaryPassword != null) {
        await snapshot.ref.update({
          temporaryPassword: admin.firestore.FieldValue.delete(),
        });
      }

      logger.info("Created new user with roles.", { uid: userId, roles });
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
