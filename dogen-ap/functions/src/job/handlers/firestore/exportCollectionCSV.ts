import { JobTask } from "../../jobTask";
import * as admin from "firebase-admin";
import { Timestamp, DocumentReference, GeoPoint } from "firebase-admin/firestore";
import { VectorValue } from "@google-cloud/firestore";
import * as fs from "fs";
import { stringify } from "csv-stringify";
import { getDatabaseByName, parseDatabasePath, parseStoragePath, getBucketByName } from "../../../utils/utils";
import * as path from "path";

interface CSVFieldExport {
  source: string; // Document field in dot notation
  header?: string; // Column header in CSV (defaults to source)
}

interface ExportCsvTaskInput {
  collectionPath: string;
  bucketPathPrefix: string;
  fields: CSVFieldExport[];
  limit?: number;
  orderByField?: string;
  orderByDirection?: "asc" | "desc";
  delimiter?: string;
}

interface ExportMetadata {
  exportedTo: string;
  exportedAt: string;
  documentsProcessed: number;
}

// Special field identifiers
const SPECIAL_FIELDS = {
  ID: "_id_",
  REF: "_ref_",
} as const;

export async function handleExportCollectionCSV(
  task: JobTask
): Promise<Record<string, any>> {
  const input = task.input as ExportCsvTaskInput | undefined;

  if (
    !input?.collectionPath ||
    !input?.bucketPathPrefix ||
    !input?.fields?.length
  ) {
    throw new Error(
      "Invalid input: collectionPath, bucketPathPrefix, and fields are required"
    );
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
    input.fields,
    input.delimiter ?? ",",
    input.limit,
    input.orderByField,
    input.orderByDirection
  );

  return {
    collectionPath: input.collectionPath,
    exportedTo: metadata.exportedTo,
    exportedAt: metadata.exportedAt,
    fields: input.fields,
    delimiter: input.delimiter ?? ",",
    documentsProcessed: metadata.documentsProcessed,
  };
}

async function exportCollection(
  db: admin.firestore.Firestore,
  collectionPath: string,
  bucketName: string,
  pathPrefix: string,
  fields: CSVFieldExport[],
  delimiter: string = ',',
  limit?: number,
  orderByField?: string,
  orderByDirection?: 'asc' | 'desc'
): Promise<ExportMetadata> {
  const bucket = getBucketByName(bucketName);
  const timestamp = Math.floor(Date.now() / 1000);
  const baseFileName = collectionPath.replace(/\//g, "_");
  const fileName = `${baseFileName}_${timestamp}.csv`;
  const exportPath = `${pathPrefix}/${fileName}`.replace(/\/+/g, "/");
  const tempFilePath = `/tmp/${path.basename(exportPath)}`;
  
  // Full storage path to return in the result
  const fullExportPath = `gs://${bucket.name}/${exportPath}`;
  
  try {
    // Create a write stream to the temp file
    const writeStream = fs.createWriteStream(tempFilePath);
    
    // Create CSV stringifier
    const stringifier = stringify({
      header: true,
      columns: fields.map(field => ({
        key: field.source,
        header: field.header || field.source
      })),
      delimiter: delimiter
    });
    
    // Pipe to file
    stringifier.pipe(writeStream);
    
    // Prepare initial query
    const collectionRef = db.collection(collectionPath);
    let queryRef: admin.firestore.Query = collectionRef;
    
    // Apply ordering if specified
    if (orderByField) {
      queryRef = queryRef.orderBy(orderByField, orderByDirection || 'asc');
    }
    
    let lastDoc = null;
    let documentsProcessed = 0;
    const batchSize = 250;
    
    // Calculate effective batch size based on limit
    const effectiveBatchSize = limit ? Math.min(batchSize, limit) : batchSize;

    while (true) {
      let batchQuery = queryRef;
      if (lastDoc) {
        batchQuery = batchQuery.startAfter(lastDoc);
      }
      
      // Apply batch size limit
      const remainingLimit = limit ? limit - documentsProcessed : undefined;
      const currentBatchSize = remainingLimit ? Math.min(effectiveBatchSize, remainingLimit) : effectiveBatchSize;
      batchQuery = batchQuery.limit(currentBatchSize);

      const snapshot = await batchQuery.get();
      if (snapshot.empty) break;

      // Process batch
      for (const doc of snapshot.docs) {
        const data = doc.data();
        const row: Record<string, any> = {};
        
        // Extract fields from document
        for (const field of fields) {
          let value;
          
          // Handle special field identifiers
          if (field.source === SPECIAL_FIELDS.ID) {
            value = doc.id;
          } else if (field.source === SPECIAL_FIELDS.REF) {
            value = doc.ref.path;
          }
          // Handle nested fields (e.g., "user.name")
          else if (field.source.includes('.')) {
            const parts = field.source.split('.');
            let currentValue = data;
            for (const part of parts) {
              currentValue = currentValue?.[part];
              if (currentValue === undefined) break;
            }
            value = currentValue;
          } else {
            value = data[field.source];
          }
          
          // Format the value appropriately
          row[field.source] = formatValue(value);
        }
        
        // Write row to CSV
        stringifier.write(row);
        documentsProcessed++;
        
        // Check if we've reached the limit
        if (limit && documentsProcessed >= limit) {
          break;
        }
      }

      lastDoc = snapshot.docs[snapshot.docs.length - 1];
      
      // Break the loop if we've reached the limit
      if (limit && documentsProcessed >= limit) {
        break;
      }
      
      // Break if we got fewer documents than requested (end of collection)
      if (snapshot.docs.length < currentBatchSize) {
        break;
      }
    }
    
    // End the stringifier
    stringifier.end();
    
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
    
    return {
      exportedTo: fullExportPath,
      exportedAt: new Date().toISOString(),
      documentsProcessed,
    };
    
  } catch (error) {
    console.error(`Export failed for collection ${collectionPath}:`, error);
    throw error;
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return "";
  }

  // Handle Firestore Timestamp
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  // Handle Firestore DocumentReference
  if (value instanceof DocumentReference) {
    return `__ref:${value.path}`;
  }

  // Handle Firestore GeoPoint
  if (value instanceof GeoPoint) {
    return `__geo:${value.latitude},${value.longitude}`;
  }

  // Handle Firestore Vector
  if (value instanceof VectorValue) {
    return `__vector:${value.toArray().join(',')}`;
  }

  // Handle Firestore Bytes
  if (value instanceof Uint8Array || value instanceof Buffer) {
    return `__bytes:${Buffer.from(value).toString('base64')}`;
  }

  // Handle objects and arrays
  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}
