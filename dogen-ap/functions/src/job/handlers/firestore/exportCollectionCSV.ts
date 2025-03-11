import { JobTask } from "../../jobTask";
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import * as fs from "fs";
import * as path from "path";
import { stringify } from "csv-stringify";
import { getDatabaseByName, parseDatabasePath } from "../../../utils/utils";

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
  
  const metadata = await exportCollection(
    db,
    fsPath,
    input.bucketPathPrefix,
    input.fields,
    input.limit,
    input.orderByField,
    input.orderByDirection,
    input.delimiter ?? ","
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
  bucketPathPrefix: string,
  fields: CSVFieldExport[],
  limit?: number,
  orderByField?: string,
  orderByDirection?: "asc" | "desc",
  delimiter: string = ","
): Promise<ExportMetadata> {
  const bucket = admin.storage().bucket();
  const timestamp = Math.floor(Date.now() / 1000);
  const baseFileName = collectionPath.replace(/\//g, "_");
  const fileName = `${baseFileName}_${timestamp}.csv`;
  const exportName = `${bucketPathPrefix}/${fileName}`.replace(/\/+/g, "/");

  const tempFilePath = `/tmp/${path.basename(exportName)}`;
  const writeStream = fs.createWriteStream(tempFilePath);

  // Create CSV stringifier
  const stringifier = stringify({
    delimiter,
    header: true,
    columns: fields.map((f) => ({
      key: f.source,
      header: f.header || f.source,
    })),
  });

  // Pipe stringifier to write stream
  stringifier.pipe(writeStream);

  try {
    const collectionRef = db.collection(collectionPath);
    let queryRef: admin.firestore.Query = collectionRef;

    if (orderByField) {
      queryRef = queryRef.orderBy(orderByField, orderByDirection || "asc");
    }

    if (limit) {
      queryRef = queryRef.limit(limit);
    }

    let lastDoc = null;
    let documentsProcessed = 0;
    const batchSize = 250;

    while (true) {
      let batchQuery = queryRef;
      if (lastDoc) {
        batchQuery = batchQuery.startAfter(lastDoc);
      }
      batchQuery = batchQuery.limit(batchSize);

      const snapshot = await batchQuery.get();
      if (snapshot.empty) break;

      // Process batch
      const rows = snapshot.docs.map((doc) => {
        const data = doc.data();
        const row: Record<string, any> = {};

        fields.forEach((field) => {
          if (field.source === SPECIAL_FIELDS.ID) {
            row[field.source] = doc.id;
          } else if (field.source === SPECIAL_FIELDS.REF) {
            row[field.source] = doc.ref.path;
          } else {
            const value = getValueFromPath(data, field.source);
            row[field.source] = formatValue(value);
          }
        });

        return row;
      });

      // Write rows
      for (const row of rows) {
        stringifier.write(row);
      }

      documentsProcessed += snapshot.docs.length;
      lastDoc = snapshot.docs[snapshot.docs.length - 1];
      if (limit && documentsProcessed >= limit) break;
    }

    // End the stringifier
    stringifier.end();

    // Wait for write stream to finish
    await new Promise<void>((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });

    // Stream to Cloud Storage
    const file = bucket.file(exportName);
    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(tempFilePath)
        .pipe(file.createWriteStream())
        .on("error", reject)
        .on("finish", resolve);
    });

    return {
      exportedTo: exportName,
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

  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function getValueFromPath(obj: any, path: string): any {
  const parts = path.split(".");
  let current = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[part];
  }

  return current;
}
