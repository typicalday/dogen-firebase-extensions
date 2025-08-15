import { JobTask } from "../../jobTask";
import * as admin from "firebase-admin";

export async function handleListUsers(task: JobTask): Promise<Record<string, any>> {
  const maxResults = task.input?.maxResults || 1000;
  const pageToken = task.input?.pageToken;
  
  try {
    const listUsersResult = await admin.auth().listUsers(maxResults, pageToken);
    
    console.log(`Listed ${listUsersResult.users.length} users`);
    
    const users = listUsersResult.users.map(userRecord => ({
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
    }));
    
    return {
      users,
      pageToken: listUsersResult.pageToken,
      userCount: listUsersResult.users.length,
      hasMoreUsers: !!listUsersResult.pageToken,
    };
  } catch (error) {
    console.error(`Error listing users: ${error}`);
    throw error;
  }
}