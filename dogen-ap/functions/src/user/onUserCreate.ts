import * as admin from "firebase-admin";
import {auth, logger} from "firebase-functions";
import {FieldValue} from "firebase-admin/firestore";

export const onUserCreate = auth.user().onCreate(async (user) => {
  const firestore = admin.firestore();
  try {
    const accountsRef = firestore.collection("dogen_application_accounts").doc(user.uid);
    const accountsSnapshot = await accountsRef.get();
    if (!accountsSnapshot.exists) {
      const data = getUserData(user);
      await accountsRef.set(data);
      logger.info("Accounts document created for UID.", {uid: user.uid});
    } else {
      logger.info("Accounts document already exists for UID.", {uid: user.uid});
    }
  } catch (error) {
    logger.info("Error creating Accounts document:", {
      error,
      uid: user.uid,
    });
  }
});

export const getUserData = (user: admin.auth.UserRecord) => {
  return {
    id: user.uid,
    roles: ["registered"],
    email: user.email,
    displayName: user.displayName,
    createdAt: FieldValue.serverTimestamp(),
  };
};
