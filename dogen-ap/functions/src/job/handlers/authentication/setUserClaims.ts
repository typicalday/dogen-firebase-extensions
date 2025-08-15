import { JobTask } from "../../jobTask";
import * as admin from "firebase-admin";

export async function handleSetUserClaims(task: JobTask): Promise<Record<string, any>> {
  const uid = task.input?.uid;
  const customClaims = task.input?.customClaims;
  
  if (!uid) {
    throw new Error("Invalid input: uid is required");
  }
  
  if (customClaims === undefined) {
    throw new Error("Invalid input: customClaims is required (can be null to clear claims)");
  }

  try {
    await admin.auth().setCustomUserClaims(uid, customClaims);
    
    // Get updated user record to confirm changes
    const userRecord = await admin.auth().getUser(uid);
    
    console.log(`Custom claims set for user: ${uid}`);
    
    return {
      uid: userRecord.uid,
      email: userRecord.email,
      customClaims: userRecord.customClaims || {},
      claimsUpdatedAt: new Date().toISOString(),
      success: true,
    };
  } catch (error) {
    console.error(`Error setting user claims: ${error}`);
    throw error;
  }
}