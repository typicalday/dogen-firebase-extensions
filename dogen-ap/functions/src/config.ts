interface IConfig {
    dogenAccountEmail: string;
    dogenInvitationCode?: string;
    dogenApiKey?: string;
    location: string;
    backfillExistingUsers: boolean;
    adminUserEmail: string;
    firebaseConfigApiKey: string;
    firebaseConfigAppId: string;
    firebaseConfigMessagingSenderId: string;
    firebaseConfigAuthDomain: string;
    firebaseConfigStorageBucket: string;
    firebaseConfigProjectId: string;
  }

const config: IConfig = {
  dogenAccountEmail: process.env.DOGEN_ACCOUNT_EMAIL!,
  dogenInvitationCode: process.env.DOGEN_INVITATION_CODE,
  dogenApiKey: process.env.DOGEN_API_KEY,
  location: process.env.FUNCTIONS_LOCATION ?? "us-central1",
  backfillExistingUsers: (process.env.BACKFILL_EXISTING_USERS ?? "false") === "true",
  adminUserEmail: process.env.ADMIN_USER_EMAIL!,
  firebaseConfigApiKey: process.env.FIREBASE_CONFIG_API_KEY!,
  firebaseConfigAppId: process.env.FIREBASE_CONFIG_APP_ID!,
  firebaseConfigMessagingSenderId: process.env.FIREBASE_CONFIG_MESSAGING_SENDER_ID!,
  firebaseConfigAuthDomain: process.env.FIREBASE_CONFIG_AUTH_DOMAIN!,
  firebaseConfigStorageBucket: process.env.STORAGE_BUCKET!,
  firebaseConfigProjectId: process.env.PROJECT_ID!,
};

export {IConfig};
export default config;
