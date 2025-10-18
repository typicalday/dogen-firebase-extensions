import { JobTask } from "../../jobTask";
import { JobContext } from "../../jobContext";
import * as admin from "firebase-admin";

export async function handleCreateUser(task: JobTask, context: JobContext): Promise<Record<string, any>> {
  const userRecord = task.input?.userRecord;
  const customClaims = task.input?.customClaims;
  
  if (!userRecord) {
    throw new Error("Invalid input: userRecord is required");
  }

  try {
    // Create user first (Firebase SDK doesn't support custom claims in createUser)
    const createdUser = await admin.auth().createUser(userRecord);
    
    console.log(`User created successfully: ${createdUser.uid}`);
    
    let finalUser = createdUser;
    
    // Set custom claims separately if provided
    if (customClaims && Object.keys(customClaims).length > 0) {
      await admin.auth().setCustomUserClaims(createdUser.uid, customClaims);
      console.log(`Custom claims set for user: ${createdUser.uid}`, customClaims);
      
      // Fetch updated user data to include custom claims
      finalUser = await admin.auth().getUser(createdUser.uid);
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
    if (finalUser.customClaims !== undefined) response.customClaims = finalUser.customClaims;
    if (finalUser.metadata.lastRefreshTime !== undefined && finalUser.metadata.lastRefreshTime !== null) {
      response.lastRefreshTime = new Date(finalUser.metadata.lastRefreshTime).toISOString();
    }
    if (finalUser.tokensValidAfterTime !== undefined) {
      response.tokensValidAfterTime = new Date(finalUser.tokensValidAfterTime).toISOString();
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
    console.error(`Error creating user: ${error}`);
    throw error;
  }
}