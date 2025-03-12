import { JobTask } from "../../jobTask";
import { DocumentReference, GeoPoint, Timestamp } from "firebase-admin/firestore";
import { VectorValue } from "@google-cloud/firestore";
import * as admin from "firebase-admin";
import * as fs from 'fs';
import * as path from 'path';
import { CollectionData, getDatabaseByName, parseDatabasePath, parseStoragePath, getBucketByName } from "../../../utils/utils";

interface ExportTaskInput {
  collectionPath: string;
  bucketPathPrefix: string;
  includeSubcollections?: boolean;
  limit?: number;
  orderByField?: string;
  orderByDirection?: 'asc' | 'desc';
}

function transformData(obj: any, seen = new WeakSet()): any {
  // Return primitive values as-is
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // Throw an error if a circular reference is detected
  if (seen.has(obj)) {
    throw new Error("Circular reference detected");
  }
  seen.add(obj);

  // Handle Firestore Timestamp: convert to ISO string with type identifier
  if (obj instanceof Timestamp) {
    return {
      _firestore_type: 'timestamp',
      value: obj.toDate().toISOString()
    };
  }

  // Handle Firestore DocumentReference: return its path with type identifier
  if (obj instanceof DocumentReference) {
    return {
      _firestore_type: 'reference',
      path: obj.path
    };
  }

  // Handle Firestore GeoPoint: return latitude and longitude with type identifier
  if (obj instanceof GeoPoint) {
    return {
      _firestore_type: 'geopoint',
      latitude: obj.latitude, 
      longitude: obj.longitude
    };
  }

  // Handle Firestore VectorValue: return array representation with type identifier
  if (obj instanceof VectorValue) {
    return {
      _firestore_type: 'vector',
      values: obj.toArray()
    };
  }

  // Handle Firestore Blob/Bytes: convert to base64 string with type identifier
  if (obj instanceof Uint8Array || obj instanceof Buffer) {
    return {
      _firestore_type: 'bytes',
      base64: Buffer.from(obj).toString('base64')
    };
  }

  // Recursively transform arrays
  if (Array.isArray(obj)) {
    return obj.map(item => transformData(item, seen));
  }

  // Process plain objects recursively
  const transformed: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    transformed[key] = transformData(value, seen);
  }
  return transformed;
}


export async function handleExportCollectionJSON(task: JobTask): Promise<Record<string, any>> {
  const input = task.input as ExportTaskInput | undefined;
  
  if (!input?.collectionPath || !input?.bucketPathPrefix) {
    throw new Error("Invalid input: collectionPath and bucketPathPrefix are required");
  }

  const [dbName, fsPath] = parseDatabasePath(input.collectionPath);
  const db = getDatabaseByName(dbName);
  
  // Parse bucket path to get bucket name and path
  const [bucketName, pathPrefix] = parseStoragePath(input.bucketPathPrefix);
  
  const metadata = await exportCollection(
    db,
    fsPath, 
    bucketName,
    pathPrefix,
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
  db: admin.firestore.Firestore,
  collectionPath: string,
  bucketName: string,
  pathPrefix: string,
  includeSubcollections: boolean,
  limit?: number,
  orderByField?: string,
  orderByDirection?: 'asc' | 'desc'
): Promise<CollectionData['metadata']> {
  const bucket = getBucketByName(bucketName);
  const timestamp = Math.floor(Date.now() / 1000);
  const baseFileName = collectionPath.replace(/\//g, "_");
  const fileName = `${baseFileName}_${timestamp}.json`;
  const exportPath = `${pathPrefix}/${fileName}`.replace(/\/+/g, "/");
  const tempFilePath = `/tmp/${path.basename(exportPath)}`;
  const writeStream = fs.createWriteStream(tempFilePath);
  
  // Full storage path to return in the result
  const fullExportPath = `gs://${bucket.name}/${exportPath}`;

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
      exportedTo: fullExportPath,
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
    const file = bucket.file(exportPath);
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