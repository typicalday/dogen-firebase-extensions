import { JobTask } from "../../jobTask";
import * as admin from "firebase-admin";

export async function handleCreateUser(task: JobTask): Promise<Record<string, any>> {
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
    
    const response: Record<string, any> = {
      uid: finalUser.uid,
      email: finalUser.email,
      phoneNumber: finalUser.phoneNumber,
      emailVerified: finalUser.emailVerified,
      disabled: finalUser.disabled,
      metadata: {
        creationTime: finalUser.metadata.creationTime,
        lastSignInTime: finalUser.metadata.lastSignInTime,
      },
    };
    
    // Only include customClaims if they exist
    if (finalUser.customClaims) {
      response.customClaims = finalUser.customClaims;
    }
    
    return response;
  } catch (error) {
    console.error(`Error creating user: ${error}`);
    throw error;
  }
}