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
    
    const user: any = {
      uid: userRecord.uid,
      emailVerified: userRecord.emailVerified,
      disabled: userRecord.disabled,
    };
    
    // Convert dates to ISO strings
    if (userRecord.metadata.creationTime) {
      user.creationTime = new Date(userRecord.metadata.creationTime).toISOString();
    }
    if (userRecord.metadata.lastSignInTime) {
      user.lastSignInTime = new Date(userRecord.metadata.lastSignInTime).toISOString();
    }
    if (userRecord.metadata.lastRefreshTime) {
      user.lastRefreshTime = new Date(userRecord.metadata.lastRefreshTime).toISOString();
    }
    
    // Only add optional fields if they are defined
    if (userRecord.email !== undefined) user.email = userRecord.email;
    if (userRecord.phoneNumber !== undefined) user.phoneNumber = userRecord.phoneNumber;
    if (userRecord.displayName !== undefined) user.displayName = userRecord.displayName;
    if (userRecord.photoURL !== undefined) user.photoURL = userRecord.photoURL;
    if (userRecord.customClaims !== undefined) user.customClaims = userRecord.customClaims;
    
    // Convert providerData to plain objects
    if (userRecord.providerData !== undefined && Array.isArray(userRecord.providerData)) {
      user.providerData = userRecord.providerData.map(provider => {
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
    
    if (userRecord.tokensValidAfterTime !== undefined) {
      user.tokensValidAfterTime = new Date(userRecord.tokensValidAfterTime).toISOString();
    }
    
    return user;
  } catch (error) {
    console.error(`Error reading user: ${error}`);
    throw error;
  }
}