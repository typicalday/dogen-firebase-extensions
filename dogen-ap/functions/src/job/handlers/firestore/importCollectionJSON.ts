import { JobTask } from "../../jobTask";
import { BatchManager } from "../../../utils/batchManager";
import * as admin from "firebase-admin";
import { Timestamp, GeoPoint } from "firebase-admin/firestore";
import * as fs from 'fs';
import * as path from 'path';
import * as JSONStream from 'jsonstream';
import { CollectionData, getDatabaseByName, parseDatabasePath, parseStoragePath, getBucketByName } from "../../../utils/utils";

interface ImportTaskInput {
  collectionPath: string;
  bucketPath: string;
}

interface ImportMetadata {
  importedTo: string;
  importedAt: string;
  documentsProcessed: number;
  includesSubcollections: boolean;
}

export async function handleImportCollectionJSON(task: JobTask): Promise<Record<string, any>> {
  const input = task.input as ImportTaskInput | undefined;
  
  if (!input?.collectionPath || !input?.bucketPath) {
    throw new Error("Invalid input: collectionPath and bucketPath are required");
  }

  const [dbName, fsPath] = parseDatabasePath(input.collectionPath);
  const db = getDatabaseByName(dbName);
  
  // Parse bucket path to get bucket name and path
  const [bucketName, storagePath] = parseStoragePath(input.bucketPath);

  const metadata = await importCollection(db, fsPath, bucketName, storagePath);
  
  return {
    bucketPath: input.bucketPath,
    importedTo: input.collectionPath,
    importedAt: metadata.importedAt,
    documentsProcessed: metadata.documentsProcessed,
    includesSubcollections: metadata.includesSubcollections
  };
}

async function importCollection(
  db: admin.firestore.Firestore,
  collectionPath: string,
  bucketName: string,
  storagePath: string
): Promise<ImportMetadata> {
  const bucket = getBucketByName(bucketName);
  const file = bucket.file(storagePath);
  const tempFilePath = `/tmp/${path.basename(storagePath)}`;

  try {
    await file.download({ destination: tempFilePath });
    const batchManager = new BatchManager(db);
    let documentsProcessed = 0;
    let includesSubcollections = false;

    await new Promise<void>((resolve, reject) => {
      const readStream = fs.createReadStream(tempFilePath);
      // Use array syntax to properly get document ID and data
      const parser = JSONStream.parse(['documents', {emitKey: true}]);

      parser.on('data', async ({key: docId, value: docEntry}: {key: string, value: any}) => {
        try {
          readStream.pause();
          
          // Transform data to convert special types back to Firestore types
          const transformedData = transformData(docEntry.data);
          const docRef = db.collection(collectionPath).doc(docId);
          await batchManager.add(docRef, transformedData);
          documentsProcessed++;

          if (docEntry.subcollections) {
            includesSubcollections = true;
            for (const [subName, subData] of Object.entries(docEntry.subcollections)) {
              await importSubcollection(
                db,
                `${collectionPath}/${docId}/${subName}`,
                subData as CollectionData
              );
            }
          }
          
          readStream.resume();
        } catch (error) {
          console.error('Error processing document:', docId, error);
          readStream.resume();
          reject(error);
        }
      });

      parser.on('end', () => resolve());
      parser.on('error', (error: Error) => reject(error));
      readStream.pipe(parser);
    });

    await batchManager.commit();

    return {
      importedTo: collectionPath,
      importedAt: new Date().toISOString(),
      documentsProcessed,
      includesSubcollections
    };

  } catch (error) {
    console.error(`Import failed for collection ${collectionPath}:`, error);
    throw error;
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

async function importSubcollection(
  db: admin.firestore.Firestore,
  path: string,
  collectionData: CollectionData
) {
  const batchManager = new BatchManager(db);

  for (const [docId, docData] of Object.entries(collectionData.documents)) {
    // Transform data to convert special types back to Firestore types
    const transformedData = transformData(docData.data);
    const docRef = db.collection(path).doc(docId);
    await batchManager.add(docRef, transformedData);

    if (docData.subcollections) {
      for (const [subName, subData] of Object.entries(docData.subcollections)) {
        await importSubcollection(
          db,
          `${path}/${docId}/${subName}`,
          subData
        );
      }
    }
  }

  await batchManager.commit();
}

// Helper function to transform data back to Firestore types
function transformData(obj: any): any {
  // Handle primitive values
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // Handle Firestore type identifiers
  if (obj._firestore_type) {
    switch (obj._firestore_type) {
      case 'timestamp':
        return new Timestamp(
          Math.floor(new Date(obj.value).getTime() / 1000),
          (new Date(obj.value).getTime() % 1000) * 1000000
        );
      
      case 'reference':
        return admin.firestore().doc(obj.path);
      
      case 'geopoint':
        return new GeoPoint(obj.latitude, obj.longitude);
      
      case 'vector':
        if (Array.isArray(obj.values)) {
          return obj.values;
        }
        return [];
      
      case 'bytes':
        return Buffer.from(obj.base64, 'base64');
      
      default:
        return obj;
    }
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => transformData(item));
  }

  // Handle objects
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = transformData(value);
  }
  return result;
}