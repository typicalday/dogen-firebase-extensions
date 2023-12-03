/* eslint-disable max-len */
import * as admin from "firebase-admin";

admin.initializeApp();

// Auth triggers
export * from "./user/onUserCreate";
export * from "./user/onUserDelete";

// Firestore triggers
export * from "./user/onAccountUpdate";
export * from "./config/onConfigParameterUpdateWrite";
export * from "./generation/onGenerationWrite";

// Extension lifecycle events
export * from "./user/backfillExistingUsers";

// HTTP triggers
export * from "./generation/updateGenerationWebhook";
