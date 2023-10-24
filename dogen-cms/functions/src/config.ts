interface IConfig {
    backfillExistingUsers: boolean;
    location: string;
  }

const config: IConfig = {
  backfillExistingUsers: process.env.BACKFILL_EXISTING_USERS === "true",
  location: process.env.FUNCTIONS_LOCATION ?? "us-central1",
};

export default config;
