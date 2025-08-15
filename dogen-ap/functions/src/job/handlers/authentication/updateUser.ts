import { JobTask } from "../../jobTask";
import * as admin from "firebase-admin";

export async function handleUpdateUser(task: JobTask): Promise<Record<string, any>> {
  const uid = task.input?.uid;
  const updateRequest = task.input?.updateRequest;
  const customClaims = task.input?.customClaims;
  
  if (!uid) {
    throw new Error("Invalid input: uid is required");
  }
  
  if (!updateRequest) {
    throw new Error("Invalid input: updateRequest is required");
  }

  try {
    // Update user first (Firebase SDK doesn't support custom claims in updateUser)
    const updatedUser = await admin.auth().updateUser(uid, updateRequest);
    
    console.log(`User updated successfully: ${updatedUser.uid}`);
    
    let finalUser = updatedUser;
    
    // Set custom claims separately if provided
    if (customClaims !== undefined) {
      await admin.auth().setCustomUserClaims(uid, customClaims);
      console.log(`Custom claims updated for user: ${uid}`, customClaims);
      
      // Fetch updated user data to include custom claims
      finalUser = await admin.auth().getUser(uid);
    }
    
    const response: Record<string, any> = {
      uid: finalUser.uid,
      email: finalUser.email,
      emailVerified: finalUser.emailVerified,
      phoneNumber: finalUser.phoneNumber,
      disabled: finalUser.disabled,
      displayName: finalUser.displayName,
      photoURL: finalUser.photoURL,
      metadata: {
        creationTime: finalUser.metadata.creationTime,
        lastSignInTime: finalUser.metadata.lastSignInTime,
        lastRefreshTime: finalUser.metadata.lastRefreshTime,
      },
      providerData: finalUser.providerData,
      tokensValidAfterTime: finalUser.tokensValidAfterTime,
    };
    
    // Only include customClaims if they exist and are not empty
    if (finalUser.customClaims && Object.keys(finalUser.customClaims).length > 0) {
      response.customClaims = finalUser.customClaims;
    }
    
    return response;
  } catch (error) {
    console.error(`Error updating user: ${error}`);
    throw error;
  }
}