import { JobTask } from "../../jobTask";
import * as admin from "firebase-admin";

export async function handleGetUser(task: JobTask): Promise<Record<string, any>> {
  const uid = task.input?.uid;
  const email = task.input?.email;
  const phoneNumber = task.input?.phoneNumber;
  
  if (!uid && !email && !phoneNumber) {
    throw new Error("Invalid input: uid, email, or phoneNumber is required");
  }

  try {
    let userRecord: admin.auth.UserRecord;
    
    if (uid) {
      userRecord = await admin.auth().getUser(uid);
    } else if (email) {
      userRecord = await admin.auth().getUserByEmail(email);
    } else if (phoneNumber) {
      userRecord = await admin.auth().getUserByPhoneNumber(phoneNumber);
    } else {
      throw new Error("No valid identifier provided");
    }
    
    console.log(`User retrieved successfully: ${userRecord.uid}`);
    
    return {
      uid: userRecord.uid,
      email: userRecord.email,
      emailVerified: userRecord.emailVerified,
      phoneNumber: userRecord.phoneNumber,
      disabled: userRecord.disabled,
      displayName: userRecord.displayName,
      photoURL: userRecord.photoURL,
      metadata: {
        creationTime: userRecord.metadata.creationTime,
        lastSignInTime: userRecord.metadata.lastSignInTime,
        lastRefreshTime: userRecord.metadata.lastRefreshTime,
      },
      customClaims: userRecord.customClaims,
      providerData: userRecord.providerData,
      tokensValidAfterTime: userRecord.tokensValidAfterTime,
    };
  } catch (error) {
    console.error(`Error reading user: ${error}`);
    throw error;
  }
}