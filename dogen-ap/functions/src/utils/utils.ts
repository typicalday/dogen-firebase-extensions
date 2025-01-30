import * as admin from "firebase-admin";
import config from "../config";
import * as crypto from 'crypto';
import { UserRecord } from "firebase-admin/auth";
import { GoogleAuth } from 'google-auth-library';

const defaultDogenServiceUrl = "https://api.dogen.io/";

const actionRegister = "register";
const actionGenerate = "generate";
const actionPublish = "publish";
const actionUnpublish = "unpublish";

export enum GenerationStatus {
  CREATED = "created",
  INITIALIZED = "initialized",
  REQUESTED = "requested",
  PROMOTED = "promoted",
  PUBLISHED = "published",
  DEMOTED = "demoted",
  UNPUBLISHED = "unpublished",
  FAILED = "failed"
}

export const accountsCollectionId = "dogen_application_accounts";
export const applicationCollectionId = "dogen_application";
export const generationCollectionId = "dogen_application_generations";

export const registrationDocId = "registration";

export function getDogenRegisterServiceUrl() {
  if (isDevEnvironment() && process.env.DOGEN_REGISTRATION_URL) {
    return process.env.DOGEN_REGISTRATION_URL;
  } else {
    return defaultDogenServiceUrl + actionRegister;
  }
}

export function getDogenGenerateServiceUrl() {
  if (isDevEnvironment() && process.env.DOGEN_TRIGGER_GENERATION_URL) {
    return process.env.DOGEN_TRIGGER_GENERATION_URL;
  } else {
    return defaultDogenServiceUrl + actionGenerate;
  }
}

export function getDogenPublishServiceUrl() {
  if (isDevEnvironment() && process.env.DOGEN_TRIGGER_PUBLISH_URL) {
    return process.env.DOGEN_TRIGGER_PUBLISH_URL;
  } else {
    return defaultDogenServiceUrl + actionPublish;
  }
}

export function getDogenUnpublishServiceUrl() {
  if (isDevEnvironment() && process.env.DOGEN_TRIGGER_UNPUBLISH_URL) {
    return process.env.DOGEN_TRIGGER_UNPUBLISH_URL;
  } else {
    return defaultDogenServiceUrl + actionUnpublish;
  }
}

export function isDevEnvironment() {
  return process.env.FUNCTIONS_EMULATOR === "true";
}

export function getWebhookBaseUrl() {
  const projectId = admin.instanceId().app.options.projectId;
  return (
    process.env.GENERATION_WEBHOOK_BASE_URL ||
    `https://${config.location}-${projectId}.cloudfunctions.net/`
  );
}

export function getWebhookUrl(generationId: string, webhookKey: string) {
  return `${getWebhookBaseUrl()}ext-${process.env.EXT_INSTANCE_ID || "dogen-ap"}-updateGenerationWebhook?key=${generateWebhookKeyHash(generationId, webhookKey)}`;
}

export function generateWebhookKeyHash(generationId: string, webhookKey: string) {
  return crypto.createHash("sha256").update(config.webhookValidationSalt + generationId + webhookKey).digest("hex");
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

export async function getIdentityToken(): Promise<string> {
  const auth = new GoogleAuth();
  const client = await auth.getIdTokenClient(defaultDogenServiceUrl);
  return await client.idTokenProvider.fetchIdToken(defaultDogenServiceUrl);
}

export interface CollectionData {
  documents: {
    [documentId: string]: {
      data: Record<string, any>;
      subcollections?: {
        [subcollectionName: string]: CollectionData;
      };
    }
  };
  metadata: {
    path: string;
    exportedTo: string;
    exportedAt: string;
    totalDocuments: number;
    includesSubcollections: boolean;
    limit?: number;
    orderByField?: string;
    orderByDirection?: 'asc' | 'desc';
  };
}