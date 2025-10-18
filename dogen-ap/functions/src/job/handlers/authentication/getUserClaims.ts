import { JobTask } from "../../jobTask";
import { JobContext } from "../../jobContext";
import * as admin from "firebase-admin";

export async function handleGetUserClaims(task: JobTask, context: JobContext): Promise<Record<string, any>> {
  const uid = task.input?.uid;
  
  if (!uid) {
    throw new Error("Invalid input: uid is required");
  }

  try {
    const userRecord = await admin.auth().getUser(uid);
    
    console.log(`Retrieved claims for user: ${uid}`);
    
    return {
      uid: userRecord.uid,
      email: userRecord.email,
      customClaims: userRecord.customClaims || {},
      claimsRetrievedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`Error getting user claims: ${error}`);
    throw error;
  }
}