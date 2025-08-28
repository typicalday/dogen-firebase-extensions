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
    
    const response: any = {
      uid: finalUser.uid,
      emailVerified: finalUser.emailVerified,
      disabled: finalUser.disabled,
    };
    
    // Convert dates to ISO strings for FirestoreTimestampWrapper
    if (finalUser.metadata.creationTime) {
      response.creationTime = new Date(finalUser.metadata.creationTime).toISOString();
    }
    if (finalUser.metadata.lastSignInTime) {
      response.lastSignInTime = new Date(finalUser.metadata.lastSignInTime).toISOString();
    }
    
    // Only add optional fields if they are defined
    if (finalUser.email !== undefined) response.email = finalUser.email;
    if (finalUser.phoneNumber !== undefined) response.phoneNumber = finalUser.phoneNumber;
    if (finalUser.displayName !== undefined) response.displayName = finalUser.displayName;
    if (finalUser.photoURL !== undefined) response.photoURL = finalUser.photoURL;
    if (finalUser.metadata.lastRefreshTime !== undefined && finalUser.metadata.lastRefreshTime !== null) {
      response.lastRefreshTime = new Date(finalUser.metadata.lastRefreshTime).toISOString();
    }
    if (finalUser.tokensValidAfterTime !== undefined) {
      response.tokensValidAfterTime = new Date(finalUser.tokensValidAfterTime).toISOString();
    }
    
    // Only include customClaims if they exist and are not empty
    if (finalUser.customClaims !== undefined && Object.keys(finalUser.customClaims).length > 0) {
      response.customClaims = finalUser.customClaims;
    }
    
    // Convert providerData to plain objects if it exists
    if (finalUser.providerData !== undefined && Array.isArray(finalUser.providerData)) {
      response.providerData = finalUser.providerData.map(provider => {
        const providerInfo: any = {
          uid: provider.uid,
          providerId: provider.providerId,
        };
        
        // Only add optional provider fields if they are defined
        if (provider.email !== undefined) providerInfo.email = provider.email;
        if (provider.displayName !== undefined) providerInfo.displayName = provider.displayName;
        if (provider.photoURL !== undefined) providerInfo.photoURL = provider.photoURL;
        if (provider.phoneNumber !== undefined) providerInfo.phoneNumber = provider.phoneNumber;
        
        return providerInfo;
      });
    }
    
    return response;
  } catch (error) {
    console.error(`Error updating user: ${error}`);
    throw error;
  }
}