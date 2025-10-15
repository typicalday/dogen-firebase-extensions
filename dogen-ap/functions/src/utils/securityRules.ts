/* eslint-disable max-len */
import * as admin from "firebase-admin";
import { logger } from "firebase-functions/v1";

const DOGEN_RULES = `
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

/**
 * Configures Firestore Security Rules to include Dogen authentication helpers
 * and admin access rules.
 */
export async function configureDogenSecurityRules(): Promise<void> {
  try {
    logger.info("Configuring Dogen security rules...");

    // Get the current ruleset
    const currentRules = await getCurrentSecurityRules();

    // Check if rules already contain Dogen functions
    if (currentRules.includes("isDogenAuthenticated")) {
      logger.info("Dogen security rules already configured. Skipping.");
      return;
    }

    // Validate and update rules
    const updatedRules = injectDogenRules(currentRules);
    await updateSecurityRules(updatedRules);

    logger.info("Dogen security rules configured successfully.");
  } catch (error) {
    logger.error("Error configuring Dogen security rules:", error);
    throw error;
  }
}

/**
 * Retrieves the current Firestore Security Rules.
 */
async function getCurrentSecurityRules(): Promise<string> {
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
      return generateDefaultRules();
    }

    return rulesFile.content;
  } catch (error: any) {
    // If no ruleset exists, return default rules
    if (error.code === 5 || error.message?.includes('not found') || error.message?.includes('NOT_FOUND')) {
      logger.warn("No existing Firestore rules found. Creating default rules.");
      return generateDefaultRules();
    }
    logger.error("Error fetching current security rules:", error);
    throw error;
  }
}

/**
 * Generates default Firestore Security Rules structure.
 */
export function generateDefaultRules(): string {
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
 * Injects Dogen authentication helpers and access rules into existing rules.
 */
export function injectDogenRules(currentRules: string): string {
  // Validate that rules aren't completely empty or malformed
  if (!currentRules || currentRules.trim().length === 0) {
    logger.warn("Empty rules detected. Using default rules template.");
    currentRules = generateDefaultRules();
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
    DOGEN_RULES +
    "\n" +
    currentRules.slice(insertPosition);

  return updatedRules;
}

/**
 * Updates the Firestore Security Rules.
 */
async function updateSecurityRules(rules: string): Promise<void> {
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
