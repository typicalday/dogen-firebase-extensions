import * as admin from "firebase-admin";
import axios from "axios";
import {createGzip} from "zlib";
import {firestore, logger} from "firebase-functions";
import config from "../config";

const db = admin.firestore();

export const onGenerationsCreate = firestore
  .document("generations/{generationId}")
  .onCreate(async (snapshot, context) => {
    /**
     * Compresses the given data using gzip.
     * @param {string} data - The data to compress.
     * @return {Promise<Buffer>} - A promise of compressed data.
     */
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

    /**
     * Copy collection to a sub-collection, and return docs.
     * @param {BatchManager} batchManager - The batch manager for writes.
     * @param {string} collectionName - The name of the collection to process.
     * @return {Promise<Array>} - A promise of the processed documents.
     */
    async function processCollection(
      batchManager: BatchManager,
      collectionName: string
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
    
    const projectId = admin.instanceId().app.options.projectId;

    const dogenServiceUrl = process.env.DOGEN_TRIGGER_GENERATION_URL || "https://dogen.io/generate";
    const webhookBaseUrl = process.env.GENERATION_WEBHOOK_BASE_URL || `https://${config.location}-${projectId}.cloudfunctions.net/`;

    // Must match extension.yaml resource definition
    const generationId = context.params.generationId;

    const objectEntitiesCollection = "object_entities";
    const embeddedEntitiesCollection = "embedded_entities";
    const enumEntitiesCollection = "enum_entities";
    const configParametersCollection = "config_parameters";

    try {
      const batchManager = new BatchManager(db);

      // Generate a random webhook key for the generation.
      const webhookKey = Math.random().toString(36).substring(2, 15); 

      // Update the generation document with the webhook key.
      await snapshot.ref
        .set({
          webhookKey: webhookKey,
        }, 
        {merge: true}
      );

      // 1. Build JSON of Blueprints data.
      // 2. Archive the current state of the Blueprints under the generation.
      const jsonData = {
        "generation_id": generationId,
        "webhook_url": `${webhookBaseUrl}ext-dogen-cms-updateGenerationWebhook?key=${webhookKey}`,
        [objectEntitiesCollection]: await processCollection(
          batchManager,
          objectEntitiesCollection,
        ),
        [embeddedEntitiesCollection]: await processCollection(
          batchManager,
          embeddedEntitiesCollection,
        ),
        [enumEntitiesCollection]: await processCollection(
          batchManager,
          enumEntitiesCollection,
        ),
        [configParametersCollection]: await processCollection(
          batchManager,
          configParametersCollection,
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

      await snapshot.ref
        .set({
          status: "requested",
          webhookKey: webhookKey,
        }, {merge: true})
        .catch((updateError) => console.error(
          "Error updating status:", updateError
        ));
    } catch (error) {
      logger.error("Error:", error);

      await snapshot.ref
        .set({status: "failed"}, {merge: true})
        .catch((updateError) => console.error(
          "Error updating status:", updateError
        ));
    }
  });

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
