/* eslint-disable max-len */
import * as admin from "firebase-admin";
import {auth, logger} from "firebase-functions";

export const onUserDelete = auth.user().onDelete(async (user) => {
  const uid = user.uid;
  const firestore = admin.firestore();
  try {
    const accountsRef = firestore.collection("accounts").doc(uid);
    await accountsRef.delete();
    logger.info("Accounts document deleted for UID.", {uid});
  } catch (error) {
    logger.info("Error deleting accounts document.", {
      error,
      uid,
    });
  }
});
