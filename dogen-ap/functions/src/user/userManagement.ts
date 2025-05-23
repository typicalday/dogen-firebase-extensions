import * as admin from "firebase-admin";
import { logger } from "firebase-functions/v1";
import { updateUserClaims } from "../utils/utils";
import { FieldValue } from "firebase-admin/firestore";

export interface AccountData {
  email: string;
  disabled?: boolean;
  roles?: string[];
  temporaryPassword?: string | null;
  recreatedAt?: admin.firestore.Timestamp;
}

export async function createOrUpdateUser(accountId: string, accountData: AccountData) {
  const { email, disabled = false, roles = ["registered"], temporaryPassword } = accountData;

  let user: admin.auth.UserRecord;
  let isNewUser = false;
  let needsNewAccount = false;

  try {
    try {
      user = await admin.auth().getUserByEmail(email);

      // Update user if needed
      const updateRequest: admin.auth.UpdateRequest = {
        ...(disabled !== undefined ? { disabled: disabled ?? false } : {}),
      };

      if (temporaryPassword) {
        updateRequest.password = temporaryPassword;
      }

      if (Object.keys(updateRequest).length > 0) {
        await admin.auth().updateUser(user.uid, updateRequest);
      }
    } catch (error) {
      // Check if it's specifically a user not found error
      if (error instanceof Error && 'code' in error && error.code === 'auth/user-not-found') {
        // User does not exist, create a new one
        const password = temporaryPassword || generateRandomPassword();
        user = await admin.auth().createUser({
          email,
          password,
          disabled: disabled ?? false,
          // Firestore IDs typically have a length of 20, and Auth UIDs are 28 characters long.
          // If the account ID is at least 28 characters, lets assume its a suitable Auth UID.
          ...(accountId.length >= 28 ? { uid: accountId } : {}),
        });
        isNewUser = true;
      } else {
        // Rethrow any other errors
        throw error;
      }
    }

    if (user.uid !== accountId) {
      logger.info(`Account ID ${accountId} does not match auth user ID ${user.uid} for email ${email}. Will create new account.`);
      needsNewAccount = true;
    }

    await updateUserClaims(user, roles);

    logger.info(`${isNewUser ? 'Created' : 'Updated'} user with roles.`, { uid: user.uid, roles });

    return { user, isNewUser, needsNewAccount };
  } catch (error) {
    logger.error(`Error ${isNewUser ? 'creating' : 'updating'} user.`, { error, accountId });
    throw error;
  }
}

function generateRandomPassword() {
  const length = 10;
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let retVal = "";
  for (let i = 0, n = charset.length; i < length; ++i) {
    retVal += charset.charAt(Math.floor(Math.random() * n));
  }
  return retVal;
}

export const getUserData = (user: admin.auth.UserRecord, roles: string[] = ["registered"]) => {
  return {
    roles: roles,
    email: user.email,
    displayName: user.displayName ?? null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
};