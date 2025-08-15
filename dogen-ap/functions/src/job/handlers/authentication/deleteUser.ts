import { JobTask } from "../../jobTask";
import * as admin from "firebase-admin";

export async function handleDeleteUser(task: JobTask): Promise<Record<string, any>> {
  const uid = task.input?.uid;
  
  if (!uid) {
    throw new Error("Invalid input: uid is required");
  }

  try {
    // Get user record before deletion for response
    const userRecord = await admin.auth().getUser(uid);
    
    await admin.auth().deleteUser(uid);
    
    console.log(`User deleted successfully: ${uid}`);
    
    return {
      deletedUid: uid,
      deletedEmail: userRecord.email,
      deletedAt: new Date().toISOString(),
      success: true,
    };
  } catch (error) {
    console.error(`Error deleting user: ${error}`);
    throw error;
  }
}