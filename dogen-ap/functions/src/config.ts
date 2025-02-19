interface IConfig {
  dogenApiKey?: string;
  location: string;
  adminUserEmail: string;
  firebaseConfigStorageBucket: string;
  firebaseExtensionInstanceId: string;
  webhookValidationSalt: string;
  }

const config: IConfig = {
  dogenApiKey: process.env.DOGEN_API_KEY,
  location: process.env.FUNCTIONS_LOCATION ?? "us-central1",
  adminUserEmail: process.env.ADMIN_USER_EMAIL!,
  firebaseConfigStorageBucket: process.env.STORAGE_BUCKET!,
  firebaseExtensionInstanceId: process.env.EXT_INSTANCE_ID || "dogen-ap",
  webhookValidationSalt: process.env.WEBHOOK_VALIDATION_SALT!,
};

export {IConfig};
export default config;
