interface IConfig {
  dogenAccountEmail: string;
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
  firebaseExtensionInstanceId: string;
  webhookValidationSalt: string;
  }

const config: IConfig = {
  dogenAccountEmail: process.env.DOGEN_ACCOUNT_EMAIL!,
  dogenApiKey: process.env.DOGEN_API_KEY,
  location: process.env.FUNCTIONS_LOCATION ?? "us-central1",
  backfillExistingUsers: (process.env.BACKFILL_EXISTING_USERS ?? "false") === "true",
  adminUserEmail: process.env.ADMIN_USER_EMAIL!,
  firebaseConfigApiKey: process.env.FIREBASE_CONFIG_API_KEY!,
  firebaseConfigAppId: process.env.FIREBASE_CONFIG_APP_ID!,
  firebaseConfigMessagingSenderId: process.env.FIREBASE_CONFIG_APP_ID?.split(':')[1]|| "0000000000",
  firebaseConfigAuthDomain: `${process.env.PROJECT_ID!}.firebaseapp.com`,
  firebaseConfigStorageBucket: process.env.STORAGE_BUCKET!,
  firebaseConfigProjectId: process.env.PROJECT_ID!,
  firebaseExtensionInstanceId: process.env.EXT_INSTANCE_ID || "dogen-ap",
  webhookValidationSalt: process.env.WEBHOOK_VALIDATION_SALT!,
};

export {IConfig};
export default config;
