import { JobTask } from "../../jobTask";
import * as admin from "firebase-admin";

export async function handleListUsers(task: JobTask): Promise<Record<string, any>> {
  const maxResults = task.input?.maxResults || 1000;
  const pageToken = task.input?.pageToken;
  
  try {
    const listUsersResult = await admin.auth().listUsers(maxResults, pageToken);
    
    console.log(`Listed ${listUsersResult.users.length} users`);
    
    const users = listUsersResult.users.map(userRecord => {
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
    });
    
    const result: any = {
      users,
      userCount: listUsersResult.users.length,
      hasMoreUsers: !!listUsersResult.pageToken,
    };
    
    // Only add pageToken if it exists
    if (listUsersResult.pageToken !== undefined) {
      result.pageToken = listUsersResult.pageToken;
    }
    
    return result;
  } catch (error) {
    console.error(`Error listing users: ${error}`);
    throw error;
  }
}