import * as admin from "firebase-admin";
import axios from "axios";
import {createGzip} from "zlib";
import {firestore, logger, EventContext, Change} from "firebase-functions";
import config from "../config";

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
  return process.env.DOGEN_TRIGGER_GENERATION_URL || defaultDogenServiceUrl + actionGenerate;
}

function getDogenPublishServiceUrl() {
  return process.env.DOGEN_TRIGGER_PUBLISH_URL || defaultDogenServiceUrl + actionPublish;
}

function getDogenUnpublishServiceUrl() {
  return process.env.DOGEN_TRIGGER_UNPUBLISH_URL || defaultDogenServiceUrl + actionUnpublish;
}

function getWebhookBaseUrl() {
  const projectId = admin.instanceId().app.options.projectId;
  return process.env.GENERATION_WEBHOOK_BASE_URL || `https://${config.location}-${projectId}.cloudfunctions.net/`;
}

function getWebhookUrl(webhookKey: any) {
  return `${getWebhookBaseUrl()}ext-dogen-cms-updateGenerationWebhook?key=${webhookKey}`;
}

async function handleCreatedEvent(
  snapshot: Change<firestore.DocumentSnapshot>, 
  context: EventContext, 
) {
  const generationId = getGenerationId(context);

  const dogenServiceUrl = getDogenGenerateServiceUrl();

  const objectEntitiesCollection = "object_entities";
  const embeddedEntitiesCollection = "embedded_entities";
  const variantEntitiesCollection = "variant_entities";
  const enumEntitiesCollection = "enum_entities";
  const configParametersCollection = "config_parameters";

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
    await snapshot.after.ref
      .set({
        apiVersion: generationApiVersion,
        status: statusInitialized,
        webhookKey: webhookKey,
      }, 
      {merge: true}
    );

    const snapshotData = snapshot.after.data();

    // 1. Build JSON of Blueprints data.
    // 2. Archive the current state of the Blueprint collections under the generation.
    const jsonData = {
      "generationId": generationId,
      "generationApiVersion": generationApiVersion,
      "generationTemplateVersion": snapshotData?.templateVersion,
      "ignoreCache": snapshotData?.ignoreCache ?? true,
      "webhookUrl": getWebhookUrl(webhookKey),
      [objectEntitiesKey]: await processCollection(
        batchManager,
        objectEntitiesCollection,
        generationId,
      ),
      [embeddedEntitiesKey]: await processCollection(
        batchManager,
        embeddedEntitiesCollection,
        generationId,
      ),
      [variantEntitiesKey]: await processCollection(
        batchManager,
        variantEntitiesCollection,
        generationId,
      ),
      [enumEntitiesKey]: await processCollection(
        batchManager,
        enumEntitiesCollection,
        generationId,
      ),
      [configParametersKey]: await processCollection(
        batchManager,
        configParametersCollection,
        generationId,
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
    });

    logger.info("Request sent successfully:", response.data);

    await snapshot.after.ref
      .set({
        status: statusRequested,
        webhookKey: webhookKey,
      }, {merge: true})
      .catch((updateError) => console.error(
        "Error updating status:", updateError
      ));
  } catch (error) {
    logger.error("Error:", error);

    await snapshot.after.ref
      .set({status: statusFailed}, {merge: true})
      .catch((updateError) => console.error(
        "Error updating status:", updateError
      ));
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
    getDogenPublishServiceUrl,
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
    getDogenUnpublishServiceUrl,
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
    logger.info(`Skipping processing due to invalid status. Expected: ${expectedStatus}, found: ${documentData.status}`);
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
      "generationId": generationId,
    };

    const response = await axios.post(serviceUrl, body, {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.DOGEN_API_KEY,
      },
    });

    logger.info("Request sent successfully:", response.data);

    if (response.status !== 200) {
      throw new Error(`Unexpected Error:\nStatus Code: ${response.status}\nBody: ${response.statusText}`);
    }

    await snapshot.after.ref
      .set({ status: successStatus}, { merge: true })
      .catch((updateError) => console.error("Error updating status:", updateError));

  } catch (error) {
    logger.error("Error:", error);

    await snapshot.after.ref
      .set({ 
        status: statusFailed, 
        outputMessage: getErrorString(error),
      }, { merge: true })
      .catch((updateError) => console.error("Error updating status:", updateError));
  }

  function getErrorString(error: unknown) {
    let errorInfo: { message?: string; name?: string; statusCode?: number; statusText?: string; data?: any; };

    if (axios.isAxiosError(error)) {
      errorInfo = {
        message: error.message,
        name: error.name,
        statusCode: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      };
    } else if (error instanceof Error) {
      errorInfo = {
        message: error.message,
        name: error.name,
      };
    } else {
      errorInfo = {
        message: String(error),
      };
    }

    return JSON.stringify(errorInfo);
  }
}

async function processCollection(
  batchManager: BatchManager,
  collectionName: string,
  generationId: string,
): Promise<Array<FirebaseFirestore.DocumentData>> {
  // Read all documents
  const snapshot = await db.collection(collectionName).get();
  const documents = snapshot.docs
    .map((doc) => ({...doc.data(), id: doc.id}));

  // Copy documents to generation document sub-collection
  for (const doc of documents) {
    const docRef = db.doc(
      `generations/${generationId}/${collectionName}/${doc.id}`
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

const batchLimit = 500;

/**
 * Manages batch writes to Firestore.
 */
class BatchManager {
  /**
   * The Firestore write batch.
   */
  batch: FirebaseFirestore.WriteBatch;
  /**
   * The current size of the batch.
   */
  batchSize: number;

  /**
   * Creates a new BatchManager instance.
   * @param {FirebaseFirestore.Firestore} db - The Firestore instance to use.
   */
  constructor(private db: FirebaseFirestore.Firestore) {
    this.batch = db.batch();
    this.batchSize = 0;
  }

  /**
   * Adds a document to the batch.
   * @param {FirebaseFirestore.DocumentReference} docRef - The document
   * reference to add.
   * @param {FirebaseFirestore.DocumentData} data - The data to add to the
   * document.
   */
  async add(
    docRef: FirebaseFirestore.DocumentReference,
    data: FirebaseFirestore.DocumentData
  ) {
    this.batch.set(docRef, data);
    this.batchSize++;

    if (this.batchSize >= batchLimit) {
      await this.commit();
    }
  }

  /**
   * Commits the current batch.
   */
  async commit() {
    if (this.batchSize > 0) {
      await this.batch.commit();
      this.batch = this.db.batch();
      this.batchSize = 0;
    }
  }
}
