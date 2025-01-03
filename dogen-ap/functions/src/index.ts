/* eslint-disable max-len */
import * as admin from "firebase-admin";

admin.initializeApp();

// Firestore triggers
export * from "./user/onAccountCreate";
export * from "./user/onAccountUpdate";
export * from "./generation/onGenerationWrite";

// Extension lifecycle events
export * from "./install/runInstall";

// HTTP triggers
export * from "./generation/updateGenerationWebhook";
export * from "./job/processJob";
