/* eslint-disable max-len */
import * as admin from "firebase-admin";

admin.initializeApp();

import onUserCreate from "./user/onUserCreate";
import onUserDelete from "./user/onUserDelete";
import backfillExistingUsers from "./user/backfillExistingUsers";
import onAccountsUpdate from "./user/onAccountsUpdate";
import onConfigParameterUpdateWrite from "./config/onConfigParameterUpdateWrite";
import onGenerationsCreate from "./generation/onGenerationCreate";

// Auth triggers
export {onUserCreate};
export {onUserDelete};

// Firestore triggers
export {onAccountsUpdate};
export {onConfigParameterUpdateWrite};
export {onGenerationsCreate};

// Extension lifecycle events
export {backfillExistingUsers};
