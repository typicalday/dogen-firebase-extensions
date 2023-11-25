import * as admin from "firebase-admin";
import {firestore, logger} from "firebase-functions";

export default firestore
  .document("accounts/{userId}")
  .onUpdate(async (change, context) => {
    // Must match extension.yaml resource definition
    const userId = context.params.userId;

    const accountData = change.after.exists ? change.after.data() : null;
    try {
      if (accountData) {
        const role = accountData.role ?? "registered";
        
        const user = await admin.auth().getUser(userId);
        
        const {customClaims} = user;
        // Check if the user already has the desired role claim
        if (customClaims && customClaims.role === role) {
          logger.info("User already has the same role claim.", {uid: userId});
          return;
        }
        await admin.auth().setCustomUserClaims(userId, {
          role,
        });
        logger.info("Role claim updated for user.", {uid: userId});
      }
    } catch (error) {
      logger.info("Error updating role claim.", {error});
    }
  });
