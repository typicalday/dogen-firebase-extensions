/* eslint-disable max-len */
import { initializeFirebase } from "./utils/firebase";

initializeFirebase();

// Firestore triggers
export * from "./user/onAccountCreate";
export * from "./user/onAccountUpdate";
export * from "./generation/onGenerationWrite";

// Extension lifecycle events
export * from "./install/runInstall";

// HTTP triggers
export * from "./generation/updateGenerationWebhook";
export * from "./job/processJob";
