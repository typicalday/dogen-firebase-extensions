import { JobTask } from "../../jobTask";
import { BatchManager } from "../../../utils/batchManager";
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import * as fs from 'fs';
import * as path from 'path';
import * as JSONStream from 'JSONStream';
import { CollectionData, getDatabaseByName, parseDatabasePath } from "../../../utils/utils";

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

  const metadata = await importCollection(db, fsPath, input.bucketPath);
  
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
  bucketPath: string
): Promise<ImportMetadata> {
  const bucket = admin.storage().bucket();
  const file = bucket.file(bucketPath);
  const tempFilePath = `/tmp/${path.basename(bucketPath)}`;

  try {
    await file.download({ destination: tempFilePath });
    const batchManager = new BatchManager(db);
    let documentsProcessed = 0;
    let includesSubcollections = false;

    await new Promise<void>((resolve, reject) => {
      const readStream = fs.createReadStream(tempFilePath);
      // Use array syntax to properly get document ID and data
      const parser = JSONStream.parse(['documents', {emitKey: true}]);

      parser.on('data', async ({key: docId, value: docEntry}) => {
        try {
          readStream.pause();
          
          // docEntry.data is now a plain object ready for Firestore
          const docRef = db.collection(collectionPath).doc(docId);
          await batchManager.add(docRef, docEntry.data);
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
      parser.on('error', (error) => reject(error));
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
    // Transform ISO8601 strings to Timestamps for subcollection documents
    const transformedData = transformData(docData.data);
    // Use the original document ID from the JSON instead of generating a new one
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

// Helper function to check if a string is a valid ISO8601 date
function isValidISODate(str: string): boolean {
  try {
    const d = new Date(str);
    return d instanceof Date && !isNaN(d.getTime()) && str.includes('T');
  } catch {
    return false;
  }
}

// Helper function to transform ISO8601 strings back to Firestore Timestamps
function transformData(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    if (typeof obj === 'string' && isValidISODate(obj)) {
      return Timestamp.fromDate(new Date(obj));
    }
    return obj;
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