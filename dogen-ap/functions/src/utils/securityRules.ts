/* eslint-disable max-len */
import * as admin from "firebase-admin";
import { logger } from "firebase-functions/v1";

const DOGEN_FIRESTORE_RULES = `
  // Dogen helper functions
  function isDogenAuthenticated() {
    return request.auth != null && ('dogenRoles' in request.auth.token);
  }

  function isDogenAuthorized(role) {
    return isDogenAuthenticated() &&
           ('admin' in request.auth.token.dogenRoles || role in request.auth.token.dogenRoles);
  }

  // Dogen access rules
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if isDogenAuthorized('admin');
    }
  }
`;

const DOGEN_STORAGE_RULES = `
    // Dogen helper functions
    function isDogenAuthenticated() {
        return request.auth != null && ('dogenRoles' in request.auth.token);
    }

    function isDogenAuthorized(role) {
        return isDogenAuthenticated() &&
            ('admin' in request.auth.token.dogenRoles || role in request.auth.token.dogenRoles);
    }

    // Dogen access rules
    match /b/{bucket}/o {
        match /{allPaths=**} {
            allow read, write: if isDogenAuthorized('admin');
        }
    }
`;

/**
 * Configures Firestore Security Rules to include Dogen authentication helpers
 * and admin access rules.
 */
export async function configureDogenFirestoreRules(): Promise<void> {
  try {
    logger.info("Configuring Dogen Firestore security rules...");

    // Get the current ruleset
    const currentRules = await getCurrentFirestoreRules();

    // Check if rules already contain Dogen functions
    if (currentRules.includes("isDogenAuthenticated")) {
      logger.info("Dogen Firestore security rules already configured. Skipping.");
      return;
    }

    // Validate and update rules
    const updatedRules = injectDogenFirestoreRules(currentRules);
    await updateFirestoreRules(updatedRules);

    logger.info("Dogen Firestore security rules configured successfully.");
  } catch (error) {
    logger.error("Error configuring Dogen Firestore security rules:", error);
    throw error;
  }
}

/**
 * Retrieves the current Firestore Security Rules.
 */
async function getCurrentFirestoreRules(): Promise<string> {
  try {
    const securityRules = admin.securityRules();

    // Get the current Firestore ruleset - returns a Ruleset which includes source
    const ruleset = await securityRules.getFirestoreRuleset();

    // Find the Firestore rules file
    const rulesFile = ruleset.source.find(
      (file) => file.name === 'firestore.rules' || file.name?.includes('firestore')
    );

    if (!rulesFile || !rulesFile.content) {
      logger.warn("No existing Firestore rules found. Creating default rules.");
      return generateDefaultFirestoreRules();
    }

    return rulesFile.content;
  } catch (error: any) {
    // If no ruleset exists, return default rules
    if (error.code === 5 || error.message?.includes('not found') || error.message?.includes('NOT_FOUND')) {
      logger.warn("No existing Firestore rules found. Creating default rules.");
      return generateDefaultFirestoreRules();
    }
    logger.error("Error fetching current security rules:", error);
    throw error;
  }
}

/**
 * Generates default Firestore Security Rules structure.
 */
export function generateDefaultFirestoreRules(): string {
  return `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Default: deny all access
    match /{document=**} {
      allow read, write: if false;
    }
  }
}`;
}

/**
 * Injects Dogen authentication helpers and access rules into existing Firestore rules.
 */
export function injectDogenFirestoreRules(currentRules: string): string {
  // Validate that rules aren't completely empty or malformed
  if (!currentRules || currentRules.trim().length === 0) {
    logger.warn("Empty rules detected. Using default rules template.");
    currentRules = generateDefaultFirestoreRules();
  }

  // Check if rules have proper structure
  if (!currentRules.includes("service cloud.firestore")) {
    throw new Error("Invalid Firestore rules structure: missing 'service cloud.firestore' declaration");
  }

  // Find the position to inject right after the service cloud.firestore opening brace
  const serviceBlockRegex = /service\s+cloud\.firestore\s*\{/;
  const serviceMatch = currentRules.match(serviceBlockRegex);

  if (!serviceMatch || serviceMatch.index === undefined) {
    throw new Error("Invalid Firestore rules structure: unable to locate service block");
  }

  const insertPosition = serviceMatch.index + serviceMatch[0].length;

  // Insert Dogen rules (helper functions + match block) right after the service block opening
  const updatedRules =
    currentRules.slice(0, insertPosition) +
    "\n" +
    DOGEN_FIRESTORE_RULES +
    "\n" +
    currentRules.slice(insertPosition);

  return updatedRules;
}

/**
 * Updates the Firestore Security Rules.
 */
async function updateFirestoreRules(rules: string): Promise<void> {
  try {
    const securityRules = admin.securityRules();

    // Release the new ruleset to Firestore using the SDK method
    await securityRules.releaseFirestoreRulesetFromSource(rules);

    logger.info("Security rules updated successfully.");
  } catch (error) {
    logger.error("Error updating security rules:", error);
    throw error;
  }
}

/**
 * Configures Firebase Storage Security Rules to include Dogen authentication helpers
 * and admin access rules.
 * @param bucketName - Optional bucket name. If not provided, uses default bucket from admin app config.
 */
export async function configureDogenStorageRules(bucketName?: string): Promise<void> {
  try {
    logger.info("Configuring Dogen storage rules...", { bucket: bucketName || 'default' });

    // Get the current ruleset
    const currentRules = await getCurrentStorageRules(bucketName);

    // Check if rules already contain Dogen functions
    if (currentRules.includes("isDogenAuthenticated")) {
      logger.info("Dogen storage rules already configured. Skipping.");
      return;
    }

    // Validate and update rules
    const updatedRules = injectDogenStorageRules(currentRules);
    await updateStorageRules(updatedRules, bucketName);

    logger.info("Dogen storage rules configured successfully.");
  } catch (error) {
    logger.error("Error configuring Dogen storage rules:", error);
    throw error;
  }
}

/**
 * Retrieves the current Firebase Storage Security Rules.
 * @param bucketName - Optional bucket name. If not provided, uses default bucket from admin app config.
 */
async function getCurrentStorageRules(bucketName?: string): Promise<string> {
  try {
    const securityRules = admin.securityRules();

    // Get the current Storage ruleset - returns a Ruleset which includes source
    // Pass the bucket name to target the correct bucket
    const ruleset = await securityRules.getStorageRuleset(bucketName);

    // Find the Storage rules file
    const rulesFile = ruleset.source.find(
      (file) => file.name === 'storage.rules' || file.name?.includes('storage')
    );

    if (!rulesFile || !rulesFile.content) {
      logger.warn("No existing Storage rules found. Creating default rules.");
      return generateDefaultStorageRules();
    }

    return rulesFile.content;
  } catch (error: any) {
    // If no ruleset exists, return default rules
    if (error.code === 5 || error.message?.includes('not found') || error.message?.includes('NOT_FOUND')) {
      logger.warn("No existing Storage rules found. Creating default rules.");
      return generateDefaultStorageRules();
    }
    logger.error("Error fetching current storage rules:", error);
    throw error;
  }
}

/**
 * Generates default Firebase Storage Security Rules structure.
 */
export function generateDefaultStorageRules(): string {
  return `rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Default: deny all access
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}`;
}

/**
 * Injects Dogen authentication helpers and access rules into existing Storage rules.
 */
export function injectDogenStorageRules(currentRules: string): string {
  // Validate that rules aren't completely empty or malformed
  if (!currentRules || currentRules.trim().length === 0) {
    logger.warn("Empty rules detected. Using default rules template.");
    currentRules = generateDefaultStorageRules();
  }

  // Check if rules have proper structure
  if (!currentRules.includes("service firebase.storage")) {
    throw new Error("Invalid Storage rules structure: missing 'service firebase.storage' declaration");
  }

  // Find the position to inject right after the service firebase.storage opening brace
  const serviceBlockRegex = /service\s+firebase\.storage\s*\{/;
  const serviceMatch = currentRules.match(serviceBlockRegex);

  if (!serviceMatch || serviceMatch.index === undefined) {
    throw new Error("Invalid Storage rules structure: unable to locate service block");
  }

  const insertPosition = serviceMatch.index + serviceMatch[0].length;

  // Insert Dogen rules (helper functions + match block) right after the service block opening
  const updatedRules =
    currentRules.slice(0, insertPosition) +
    "\n" +
    DOGEN_STORAGE_RULES +
    "\n" +
    currentRules.slice(insertPosition);

  return updatedRules;
}

/**
 * Updates the Firebase Storage Security Rules.
 * @param rules - The security rules content to deploy.
 * @param bucketName - Optional bucket name. If not provided, uses default bucket from admin app config.
 */
async function updateStorageRules(rules: string, bucketName?: string): Promise<void> {
  try {
    const securityRules = admin.securityRules();

    // Release the new ruleset to Storage using the SDK method
    // Pass the bucket name to target the correct bucket
    await securityRules.releaseStorageRulesetFromSource(rules, bucketName);

    logger.info("Storage rules updated successfully.", { bucket: bucketName || 'default' });
  } catch (error) {
    logger.error("Error updating storage rules:", error);
    throw error;
  }
}
