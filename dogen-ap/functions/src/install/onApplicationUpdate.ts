import { Storage } from "@google-cloud/storage";
import { logger, firestore } from "firebase-functions/v1";
import * as utils from "../utils/utils";
import config from "../config";

export const onApplicationUpdate = firestore
  .document(utils.applicationDocumentPath)
  .onUpdate(async (change, _) => {
    const newValue = change.after.data();
    const aliases = Array.isArray(newValue.aliases) ? newValue.aliases : [];
    
    if (aliases.length === 0) {
      logger.info("No aliases found in application document");
      return null;
    }
    
    try {
      await updateStorageCorsForAliases(aliases);
      logger.info(`Successfully updated CORS rules for ${aliases.length} aliases`);
    } catch (error) {
      logger.error("Error updating CORS configuration:", error);
    }
    
    return null;
  });

// We need to update the CORS configuration for all project aliases (subdomains)
async function updateStorageCorsForAliases(aliases: string[]) {
  try {
    const storage = new Storage();
    const bucket = storage.bucket(config.firebaseConfigStorageBucket);

    // Get existing metadata to check current CORS
    const [metadata] = await bucket.getMetadata();
    
    // Create domain URLs for all aliases
    const allDomainUrls = aliases.flatMap(alias => [
      `https://${alias}.dogen.io`,
      `https://${alias}f.dogen.io`
    ]);
    
    // Create a new CORS configuration
    let newCorsConfig = [];
    
    // Identify the Dogen-specific entry if it exists (using a special responseHeader as identifier)
    const dogenIdentifier = "x-dogen-cors";
    const dogenCorsIndex = metadata.cors?.findIndex(rule => 
      rule.responseHeader?.includes(dogenIdentifier)
    );
    
    // Keep any non-Dogen CORS entries
    if (metadata.cors) {
      for (let i = 0; i < metadata.cors.length; i++) {
        if (dogenCorsIndex === -1 || i !== dogenCorsIndex) {
          newCorsConfig.push(metadata.cors[i]);
        }
      }
    }
    
    newCorsConfig.push({
      maxAgeSeconds: 3600,
      method: ["GET", "POST", "PUT", "DELETE", "HEAD"],
      origin: allDomainUrls,
      responseHeader: [
        "Content-Type",
        "Authorization",
        "Content-Length",
        "User-Agent",
        "x-requested-with",
        dogenIdentifier,
      ],
    });

    // Set the updated CORS configuration
    await bucket.setCorsConfiguration(newCorsConfig);
    logger.info(`Updated CORS rules for domains: ${allDomainUrls.join(', ')}`);
  } catch (error) {
    logger.error("Error updating CORS configuration:", error);
    throw error;
  }
} 