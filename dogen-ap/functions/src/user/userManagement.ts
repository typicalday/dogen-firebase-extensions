import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { updateUserClaims } from "../utils/utils";

export async function createOrUpdateUser(accountId: string, accountData: any) {
  const { email, disabled = false, roles = ["registered"], temporaryPassword } = accountData;
  let user: admin.auth.UserRecord;
  let isNewUser = false;
  let needsNewAccount = false;

  try {
    try {
      user = await admin.auth().getUserByEmail(email);
      
      if (user.uid !== accountId) {
        logger.warn(`Account ID ${accountId} does not match auth user ID ${user.uid} for email ${email}. Will create new account.`);
        needsNewAccount = true;
      }
    } catch (userNotFoundError) {
      // User does not exist, create a new one
      const password = temporaryPassword || generateRandomPassword();
      user = await admin.auth().createUser({
        uid: accountId,
        email,
        password,
        disabled,
      });
      isNewUser = true;
    }

    if (!isNewUser) {
      // Update user if needed
      const updateRequest: admin.auth.UpdateRequest = {
        ...(disabled !== undefined ? { disabled } : {}),
      };

      if (temporaryPassword) {
        updateRequest.password = temporaryPassword;
      }

      if (Object.keys(updateRequest).length > 0) {
        await admin.auth().updateUser(user.uid, updateRequest);
      }
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