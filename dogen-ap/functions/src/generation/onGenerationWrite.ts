import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as utils from "../utils/utils";
import axios from "axios";
import { createGzip } from "zlib";
import { firestore, logger, EventContext, Change } from "firebase-functions/v1";
import { BatchManager } from "../utils/batchManager";

const db = admin.firestore();

const generationApiVersion = "1";

export const onGenerationWrite = firestore
  .document(`${utils.generationCollectionPath}/{generationId}`)
  .onWrite(async (change, context) => {
    const document = change.after.exists ? change.after : change.before;

    if (!document.exists) {
      logger.info(`Document ${context.params.generationId} was deleted!`);
      return null;
    }

    const documentData = document.data() || {};

    const status = documentData?.status || utils.GenerationStatus.CREATED;

    switch (status) {
      case utils.GenerationStatus.CREATED:
        await handleCreatedEvent(change, context);
        break;
      case utils.GenerationStatus.PROMOTED:
        await handlePromotedEvent(change, context, documentData);
        break;
      case utils.GenerationStatus.DEMOTED:
        await handleDemotedEvent(change, context, documentData);
        break;
    }

    return null;
  });

function getGenerationId(context: EventContext) {
  // Must match extension.yaml resource definition
  return context.params.generationId;
}

async function handleCreatedEvent(
  snapshot: Change<firestore.DocumentSnapshot>,
  context: EventContext
) {
  const dogenApiKey = await utils.getApiKey();

  const generationId = getGenerationId(context);

  const dogenServiceUrl = utils.getDogenGenerateServiceUrl();

  const objectEntitiesCollection = "dogen/application/object_entity_blueprints";
  const embeddedEntitiesCollection = "dogen/application/embedded_entity_blueprints";
  const adapterEntitiesCollection = "dogen/application/adapter_entity_blueprints";
  const variantEntitiesCollection = "dogen/application/variant_entity_blueprints";
  const enumEntitiesCollection = "dogen/application/enum_entity_blueprints";
  const configParametersCollection = "dogen/application/config_parameter_blueprints";

  const objectEntitiesKey = "objectEntities";
  const embeddedEntitiesKey = "embeddedEntities";
  const adapterEntitiesKey = "adapterEntities";
  const variantEntitiesKey = "variantEntities";
  const enumEntitiesKey = "enumEntities";
  const configParametersKey = "configParameters";

  try {
    const batchManager = new BatchManager(db);

    // Generate a random webhook key for the generation.
    const webhookKey = Math.random().toString(36).substring(2, 15);

    const currentData = snapshot.after.data() || {};
    const now = FieldValue.serverTimestamp();

    // Update the generation document with the webhook key and timestamps.
    await snapshot.after.ref.set(
      {
        apiVersion: generationApiVersion,
        status: utils.GenerationStatus.INITIALIZED,
        webhookKey: webhookKey,
        description: currentData.description || "New Generation",
        ignoreCache: currentData.ignoreCache ?? true,
        createdAt: currentData.createdAt || now,
        updatedAt: now,
      },
      { merge: true }
    );

    const snapshotData = snapshot.after.data();

    // Rest of the code remains the same...
    const jsonData = {
      generationId,
      generationApiVersion,
      generationTemplateVersion: snapshotData?.templateVersion,
      ignoreCache: snapshotData?.ignoreCache ?? true,
      webhookUrl: utils.getWebhookUrl(generationId, webhookKey),
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
      [adapterEntitiesKey]: await processCollection(
        batchManager,
        adapterEntitiesCollection,
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

    const jsonString = JSON.stringify(jsonData);
    const compressedData = await compressData(jsonString);

    const response = await axios.post(dogenServiceUrl, compressedData, {
      headers: {
        "Content-Encoding": "gzip",
        "Content-Type": "application/json",
        "x-api-key": dogenApiKey,
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
          status: utils.GenerationStatus.REQUESTED,
          webhookKey: webhookKey,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
      .catch((updateError) =>
        logger.error("Error updating status:\n", updateError)
      );
  } catch (error) {
    const errorMessage = getErrorString(error);
    logger.error("Error:\n", errorMessage);

    await snapshot.after.ref
      .set(
        {
          status: utils.GenerationStatus.FAILED,
          outputMessage: errorMessage,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
      .catch((updateError) =>
        logger.error("Error updating status:\n", updateError)
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
    utils.GenerationStatus.PROMOTED,
    utils.GenerationStatus.PUBLISHED,
    utils.getDogenPublishServiceUrl
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
    utils.GenerationStatus.DEMOTED,
    utils.GenerationStatus.UNPUBLISHED,
    utils.getDogenUnpublishServiceUrl
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
  const dogenApiKey = await utils.getApiKey();
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
        "x-api-key": dogenApiKey,
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
        logger.error("Error updating status:\n", updateError)
      );
  } catch (error) {
    logger.error("Error:\n", error);

    await snapshot.after.ref
      .set(
        {
          status: utils.GenerationStatus.FAILED,
          outputMessage: getErrorString(error),
        },
        { merge: true }
      )
      .catch((updateError) =>
        logger.error("Error updating status:", updateError)
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

  const documents: FirebaseFirestore.DocumentData[] = [];

  // Copy documents to generation document sub-collection
  for (const doc of snapshot.docs) {
    const docRef = db.doc(
      `${utils.generationCollectionPath}/${generationId}/${collectionName}/${doc.id}`
    );
    const docData = doc.data();
    documents.push(docData);
    await batchManager.add(docRef, docData);
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
