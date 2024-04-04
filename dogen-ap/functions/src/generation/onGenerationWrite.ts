import * as admin from "firebase-admin";
import axios from "axios";
import { createGzip } from "zlib";
import { firestore, logger, EventContext, Change } from "firebase-functions";
import config from "../config";
import { BatchManager } from "../utils/batchManager";

const db = admin.firestore();

const defaultDogenServiceUrl = "https://api.dogen.io/";
const generationApiVersion = "1";

const actionGenerate = "generate";
const actionPublish = "publish";
const actionUnpublish = "unpublish";

const statusCreated = "created";
const statusInitialized = "initialized";
const statusRequested = "requested";
const statusPromoted = "promoted";
const statusPublished = "published";
const statusDemoted = "demoted";
const statusUnpublished = "unpublished";
const statusFailed = "failed";

export const onGenerationWrite = firestore
  .document("generations/{generationId}")
  .onWrite(async (change, context) => {
    const document = change.after.exists ? change.after : change.before;

    if (!document.exists) {
      logger.info(`Document ${context.params.generationId} was deleted!`);
      return null;
    }

    const documentData = document.data() || {};

    const status = documentData?.status || statusCreated;

    switch (status) {
      case statusCreated:
        handleCreatedEvent(change, context);
        break;
      case statusPromoted:
        handlePromotedEvent(change, context, documentData);
        break;
      case statusDemoted:
        handleDemotedEvent(change, context, documentData);
        break;
    }

    return null;
  });

function getGenerationId(context: EventContext) {
  // Must match extension.yaml resource definition
  return context.params.generationId;
}

function getDogenGenerateServiceUrl() {
  return (
    process.env.DOGEN_TRIGGER_GENERATION_URL ||
    defaultDogenServiceUrl + actionGenerate
  );
}

function getDogenPublishServiceUrl() {
  return (
    process.env.DOGEN_TRIGGER_PUBLISH_URL ||
    defaultDogenServiceUrl + actionPublish
  );
}

function getDogenUnpublishServiceUrl() {
  return (
    process.env.DOGEN_TRIGGER_UNPUBLISH_URL ||
    defaultDogenServiceUrl + actionUnpublish
  );
}

function getWebhookBaseUrl() {
  const projectId = admin.instanceId().app.options.projectId;
  return (
    process.env.GENERATION_WEBHOOK_BASE_URL ||
    `https://${config.location}-${projectId}.cloudfunctions.net/`
  );
}

function getWebhookUrl(webhookKey: any) {
  return `${getWebhookBaseUrl()}ext-dogen-ap-updateGenerationWebhook?key=${webhookKey}`;
}

async function handleCreatedEvent(
  snapshot: Change<firestore.DocumentSnapshot>,
  context: EventContext
) {
  const generationId = getGenerationId(context);

  const dogenServiceUrl = getDogenGenerateServiceUrl();

  const objectEntitiesCollection = "dogen_blueprint_object_entities";
  const embeddedEntitiesCollection = "dogen_blueprint_embedded_entities";
  const variantEntitiesCollection = "dogen_blueprint_variant_entities";
  const enumEntitiesCollection = "dogen_blueprint_enum_entities";
  const configParametersCollection = "dogen_blueprint_config_parameters";

  const objectEntitiesKey = "objectEntities";
  const embeddedEntitiesKey = "embeddedEntities";
  const variantEntitiesKey = "variantEntities";
  const enumEntitiesKey = "enumEntities";
  const configParametersKey = "configParameters";

  try {
    const batchManager = new BatchManager(db);

    // Generate a random webhook key for the generation.
    const webhookKey = Math.random().toString(36).substring(2, 15);

    // Update the generation document with the webhook key.
    await snapshot.after.ref.set(
      {
        apiVersion: generationApiVersion,
        status: statusInitialized,
        webhookKey: webhookKey,
      },
      { merge: true }
    );

    const snapshotData = snapshot.after.data();

    // 1. Build JSON of Blueprints data.
    // 2. Archive the current state of the Blueprint collections under the generation.
    const jsonData = {
      generationId,
      generationApiVersion,
      generationTemplateVersion: snapshotData?.templateVersion,
      ignoreCache: snapshotData?.ignoreCache ?? true,
      webhookUrl: getWebhookUrl(webhookKey),
      [objectEntitiesKey]: await processCollection(
        batchManager,
        objectEntitiesCollection,
        generationId
      ),
      [embeddedEntitiesKey]: await processCollection(
        batchManager,
        embeddedEntitiesCollection,
        generationId
      ),
      [variantEntitiesKey]: await processCollection(
        batchManager,
        variantEntitiesCollection,
        generationId
      ),
      [enumEntitiesKey]: await processCollection(
        batchManager,
        enumEntitiesCollection,
        generationId
      ),
      [configParametersKey]: await processCollection(
        batchManager,
        configParametersCollection,
        generationId
      ),
    };

    await batchManager.commit();

    // 3. Compress and send JSON of Blueprints data to Dogen service.
    const jsonString = JSON.stringify(jsonData);
    const compressedData = await compressData(jsonString);

    const response = await axios.post(dogenServiceUrl, compressedData, {
      headers: {
        "Content-Encoding": "gzip",
        "Content-Type": "application/json",
        "x-api-key": process.env.DOGEN_API_KEY,
      },
      validateStatus: (_) => true,
    });

    if (response.status !== 200) {
      throw new Error(
        `Status Code: ${response.status}\nBody: ${response.data}`
      );
    }

    logger.info("Request sent successfully:\n", response.data);

    await snapshot.after.ref
      .set(
        {
          status: statusRequested,
          webhookKey: webhookKey,
        },
        { merge: true }
      )
      .catch((updateError) =>
        console.error("Error updating status:\n", updateError)
      );
  } catch (error) {
    const errorMessage = getErrorString(error);
    logger.error("Error:\n", errorMessage);

    await snapshot.after.ref
      .set(
        {
          status: statusFailed,
          outputMessage: errorMessage,
        },
        { merge: true }
      )
      .catch((updateError) =>
        console.error("Error updating status:\n", updateError)
      );
  }
}

async function handlePromotedEvent(
  snapshot: Change<firestore.DocumentSnapshot>,
  context: EventContext,
  documentData: FirebaseFirestore.DocumentData
) {
  await handlePromotionDemotionEvent(
    snapshot,
    context,
    documentData,
    statusPromoted,
    statusPublished,
    getDogenPublishServiceUrl
  );
}

async function handleDemotedEvent(
  snapshot: Change<firestore.DocumentSnapshot>,
  context: EventContext,
  documentData: FirebaseFirestore.DocumentData
) {
  await handlePromotionDemotionEvent(
    snapshot,
    context,
    documentData,
    statusDemoted,
    statusUnpublished,
    getDogenUnpublishServiceUrl
  );
}

async function handlePromotionDemotionEvent(
  snapshot: Change<firestore.DocumentSnapshot>,
  context: EventContext,
  documentData: FirebaseFirestore.DocumentData,
  expectedStatus: string,
  successStatus: string,
  getServiceUrl: () => string
) {
  if (documentData.status !== expectedStatus) {
    logger.info(
      `Skipping processing due to invalid status. Expected: ${expectedStatus}, found: ${documentData.status}`
    );
    return;
  }

  if (!documentData.webhookKey || documentData.webhookKey.length === 0) {
    logger.info("Skipping processing because webhookKey is invalid.");
    return;
  }

  const generationId = getGenerationId(context);
  const serviceUrl = getServiceUrl();

  try {
    const body = {
      generationId: generationId,
    };

    const response = await axios.post(serviceUrl, body, {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.DOGEN_API_KEY,
      },
    });

    logger.info("Request sent successfully:", response.data);

    if (response.status !== 200) {
      throw new Error(
        `Status Code: ${response.status}\nBody: ${response.data}`
      );
    }

    await snapshot.after.ref
      .set({ status: successStatus }, { merge: true })
      .catch((updateError) =>
        console.error("Error updating status:\n", updateError)
      );
  } catch (error) {
    logger.error("Error:\n", error);

    await snapshot.after.ref
      .set(
        {
          status: statusFailed,
          outputMessage: getErrorString(error),
        },
        { merge: true }
      )
      .catch((updateError) =>
        console.error("Error updating status:", updateError)
      );
  }
}

async function processCollection(
  batchManager: BatchManager,
  collectionName: string,
  generationId: string
): Promise<Array<FirebaseFirestore.DocumentData>> {
  // Read all documents
  const snapshot = await db.collection(collectionName).get();
  const documents = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));

  // Copy documents to generation document sub-collection
  for (const doc of documents) {
    const docRef = db.doc(
      `dogen_application_generations/${generationId}/${collectionName}/${doc.id}`
    );
    await batchManager.add(docRef, doc);
  }

  return documents;
}

async function compressData(data: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const gzip = createGzip();
    const buffers: Buffer[] = [];
    gzip.on("data", (buffer) => buffers.push(buffer));
    gzip.on("end", () => resolve(Buffer.concat(buffers)));
    gzip.on("error", reject);
    gzip.write(data);
    gzip.end();
  });
}

function getErrorString(error: unknown) {
  if (axios.isAxiosError(error)) {
    return "[AxiosError]\n" + error.message;
  } else if (error instanceof Error) {
    return "[Error]\n" + error.message;
  } 
  
  return "[Generic Error]\n" + String(error);
}
