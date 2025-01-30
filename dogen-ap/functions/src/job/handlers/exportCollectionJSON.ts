import { JobTask } from "../jobTask";
import { Timestamp } from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import * as fs from 'fs';
import * as path from 'path';
import { CollectionData } from "../../utils/utils";
const db = admin.firestore();

interface ExportTaskInput {
  collectionPath: string;
  bucketPathPrefix: string;
  includeSubcollections?: boolean;
  limit?: number;
  orderByField?: string;
  orderByDirection?: 'asc' | 'desc';
}

function transformData(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Timestamp) {
    return obj.toDate().toISOString();
  }

  if (Array.isArray(obj)) {
    return obj.map(item => transformData(item));
  }

  const transformed: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    transformed[key] = transformData(value);
  }
  return transformed;
}

export async function handleExportCollectionJSON(task: JobTask): Promise<Record<string, any>> {
  const input = task.input as ExportTaskInput | undefined;
  
  if (!input?.collectionPath || !input?.bucketPathPrefix) {
    throw new Error("Invalid input: collectionPath and bucketPathPrefix are required");
  }

  const metadata = await exportCollection(
    input.collectionPath, 
    input.bucketPathPrefix, 
    input.includeSubcollections ?? false,
    input.limit,
    input.orderByField,
    input.orderByDirection
  );
  
  return {
    collectionPath: input.collectionPath,
    exportedTo: metadata.exportedTo,
    exportedAt: metadata.exportedAt,
    includesSubcollections: metadata.includesSubcollections,
    documentsProcessed: metadata.totalDocuments
  };
}

async function exportCollection(
  collectionPath: string,
  bucketPathPrefix: string,
  includeSubcollections: boolean,
  limit?: number,
  orderByField?: string,
  orderByDirection?: 'asc' | 'desc'
): Promise<CollectionData['metadata']> {
  const bucket = admin.storage().bucket();
  const timestamp = Math.floor(Date.now() / 1000);
  const baseFileName = collectionPath.replace(/\//g, "_");
  const fileName = `${baseFileName}_${timestamp}.json`;
  const exportName = `${bucketPathPrefix}/${fileName}`.replace(/\/+/g, "/");
  const tempFilePath = `/tmp/${path.basename(exportName)}`;
  const writeStream = fs.createWriteStream(tempFilePath);

  try {
    // Start the JSON structure
    writeStream.write('{\n"documents": {\n');

    const collectionRef = db.collection(collectionPath);
    let queryRef: admin.firestore.Query = collectionRef;
    
    if (orderByField) {
      queryRef = queryRef.orderBy(orderByField, orderByDirection || 'asc');
    }
    
    if (limit) {
      queryRef = queryRef.limit(limit);
    }

    let lastDoc = null;
    let isFirstDoc = true;
    let totalDocuments = 0;
    let hasSubcollections = false;
    const batchSize = 250;

    while (true) {
      let batchQuery = queryRef;
      if (lastDoc) {
        batchQuery = batchQuery.startAfter(lastDoc);
      }
      batchQuery = batchQuery.limit(batchSize);

      const snapshot = await batchQuery.get();
      if (snapshot.empty) break;

      for (const doc of snapshot.docs) {
        if (!isFirstDoc) {
          writeStream.write(',\n');
        }
        isFirstDoc = false;

        // Transform and write document data with ISO8601 timestamps
        const transformedData = transformData(doc.data());
        writeStream.write(`"${doc.id}": {\n"data": ${JSON.stringify(transformedData)}`);

        if (includeSubcollections) {
          const subcollections = await doc.ref.listCollections();
          if (subcollections.length > 0) {
            hasSubcollections = true;
            writeStream.write(',\n"subcollections": {\n');
            await writeSubcollections(writeStream, doc.ref, subcollections);
            writeStream.write('}');
          }
        }

        writeStream.write('}');
        totalDocuments++;
      }

      lastDoc = snapshot.docs[snapshot.docs.length - 1];
      if (limit && totalDocuments >= limit) break;
    }

    // Write closing brackets and metadata
    const metadata: CollectionData['metadata'] = {
      path: collectionPath,
      exportedTo: exportName,
      exportedAt: new Date().toISOString(),
      totalDocuments,
      includesSubcollections: hasSubcollections
    };

    writeStream.write('\n},\n"metadata":');
    writeStream.write(JSON.stringify(metadata));
    writeStream.write('\n}');
    writeStream.end();

    // Wait for write stream to finish
    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // Stream to Cloud Storage
    const file = bucket.file(exportName);
    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(tempFilePath)
        .pipe(file.createWriteStream())
        .on('error', reject)
        .on('finish', resolve);
    });

    return metadata;

  } catch (error) {
    console.error(`Export failed for collection ${collectionPath}:`, error);
    throw error;
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

async function writeSubcollections(
  writeStream: fs.WriteStream, 
  docRef: admin.firestore.DocumentReference,
  subcollections: admin.firestore.CollectionReference[]
): Promise<void> {
  let isFirstSubcollection = true;

  for (const subcollection of subcollections) {
    if (!isFirstSubcollection) {
      writeStream.write(',\n');
    }
    isFirstSubcollection = false;

    writeStream.write(`"${subcollection.id}": {\n"documents": {\n`);

    let isFirstDoc = true;
    const snapshot = await subcollection.get();

    for (const doc of snapshot.docs) {
      if (!isFirstDoc) {
        writeStream.write(',\n');
      }
      isFirstDoc = false;

      // Transform and write document data with ISO8601 timestamps for subcollections
      const transformedData = transformData(doc.data());
      writeStream.write(`"${doc.id}": {\n"data": ${JSON.stringify(transformedData)}`);

      const nestedSubcollections = await doc.ref.listCollections();
      if (nestedSubcollections.length > 0) {
        writeStream.write(',\n"subcollections": {\n');
        await writeSubcollections(writeStream, doc.ref, nestedSubcollections);
        writeStream.write('}');
      }

      writeStream.write('}');
    }

    writeStream.write('\n}}');
  }
}