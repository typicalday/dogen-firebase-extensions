interface IConfig {
  dogenApiKey?: string;
  location: string;
  adminUserEmail: string;
  firebaseConfigStorageBucket: string;
  firebaseExtensionInstanceId: string;
  webhookValidationSalt: string;
  firebaseProjectId: string;
  firestoreDatabaseId: string;
  enableDogenSecurityRules: boolean;
}

const config: IConfig = {
  dogenApiKey: process.env.DOGEN_API_KEY,
  location: process.env.FUNCTIONS_LOCATION ?? "us-central1",
  adminUserEmail: process.env.ADMIN_USER_EMAIL!,
  firebaseConfigStorageBucket: process.env.STORAGE_BUCKET!,
  firebaseExtensionInstanceId: process.env.EXT_INSTANCE_ID || "dogen-ap",
  webhookValidationSalt: process.env.WEBHOOK_VALIDATION_SALT!,
  firebaseProjectId: process.env.GCLOUD_PROJECT!,
  firestoreDatabaseId: process.env.FIRESTORE_DATABASE_ID!,
  enableDogenSecurityRules: process.env.ENABLE_DOGEN_SECURITY_RULES === 'true',
};

export {IConfig};
export default config;
