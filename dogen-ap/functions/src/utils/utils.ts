import * as admin from "firebase-admin";
import config from "../config";
import { UserRecord } from "firebase-admin/auth";

const defaultDogenServiceUrl = "https://api.dogen.io/";

const actionRegister = "register";
const actionGenerate = "generate";
const actionPublish = "publish";
const actionUnpublish = "unpublish";

export const applicationCollectionId = "dogen_application";
export const registrationDocId = "registration";

export function getDogenRegisterServiceUrl() {
  return (
    process.env.DOGEN_REGISTRATION_URL ||
    defaultDogenServiceUrl + actionRegister
  );
}

export function getDogenGenerateServiceUrl() {
  return (
    process.env.DOGEN_TRIGGER_GENERATION_URL ||
    defaultDogenServiceUrl + actionGenerate
  );
}

export function getDogenPublishServiceUrl() {
  return (
    process.env.DOGEN_TRIGGER_PUBLISH_URL ||
    defaultDogenServiceUrl + actionPublish
  );
}

export function getDogenUnpublishServiceUrl() {
  return (
    process.env.DOGEN_TRIGGER_UNPUBLISH_URL ||
    defaultDogenServiceUrl + actionUnpublish
  );
}

export function getWebhookBaseUrl() {
  const projectId = admin.instanceId().app.options.projectId;
  return (
    process.env.GENERATION_WEBHOOK_BASE_URL ||
    `https://${config.location}-${projectId}.cloudfunctions.net/`
  );
}

export function getWebhookUrl(webhookKey: any) {
  return `${getWebhookBaseUrl()}ext-dogen-ap-updateGenerationWebhook?key=${webhookKey}`;
}

export async function getApiKey() : Promise<string> {
  // Allow trial installations to use a temporary (unsecure) API Key
  if (process.env.DOGEN_API_KEY === undefined) {
    const registrationDoc = await admin
      .firestore()
      .collection(applicationCollectionId)
      .doc(registrationDocId)
      .get();

    if (!registrationDoc.exists || !registrationDoc.data()?.temporaryApiKey) {
      throw new Error(
        "Could not find a valid API Key in the extension config nor in the registration details."
      );
    }

    return registrationDoc.data()?.temporaryApiKey;
  }

  return process.env.DOGEN_API_KEY;
}

export async function updateUserClaims(user: UserRecord, roles: string[]) {
  const currentClaims = user.customClaims || {};
  const updatedClaims = { ...currentClaims, dogenRoles: roles };

  await admin.auth().setCustomUserClaims(user.uid, updatedClaims);
}
