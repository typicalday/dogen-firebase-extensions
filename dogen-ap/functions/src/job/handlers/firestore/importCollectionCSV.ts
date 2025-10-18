import { JobTask } from "../../jobTask";
import { JobContext } from "../../jobContext";
import { BatchManager } from "../../../utils/batchManager";
import { Timestamp, DocumentReference } from "firebase-admin/firestore";
import * as admin from "firebase-admin";
import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse";
import { getDatabaseByName, parseDatabasePath, parseStoragePath, getBucketByName } from "../../../utils/utils";

// Special field identifiers
const SPECIAL_FIELDS = {
  ID: "_id_",
  REF: "_ref_",
} as const;

interface CSVFieldImport {
  header?: string;
  destination?: string | null;
}

interface ImportCsvTaskInput {
  collectionPath: string;
  bucketPath: string;
  fieldMappings?: CSVFieldImport[];
  delimiter?: string;
}

interface ImportMetadata {
  documentsProcessed: number;
  importedTo: string;
  importedAt: string;
}

interface SpecialFields {
  docId?: string;
  docRef?: DocumentReference;
}

export async function handleImportCollectionCSV(
  task: JobTask,
  context: JobContext
): Promise<Record<string, any>> {
  const input = task.input as ImportCsvTaskInput | undefined;

  if (!input?.collectionPath || !input?.bucketPath) {
    throw new Error(
      "Invalid input: collectionPath and bucketPath are required"
    );
  }

  const [dbName, fsPath] = parseDatabasePath(input.collectionPath);
  const db = getDatabaseByName(dbName);
  
  // Parse bucket path to get bucket name and path
  const [bucketName, storagePath] = parseStoragePath(input.bucketPath);

  const metadata = await importCollection(
    db,
    fsPath,
    bucketName,
    storagePath,
    input.fieldMappings ?? [],
    input.delimiter ?? ","
  );

  return {
    bucketPath: input.bucketPath,
    importedTo: input.collectionPath,
    importedAt: metadata.importedAt,
    fieldMappings: input.fieldMappings ?? [],
    delimiter: input.delimiter ?? ",",
    documentsProcessed: metadata.documentsProcessed,
  };
}

function isISO8601(str: string): boolean {
  const iso8601Regex =
    /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[-+]\d{2}:?\d{2})?)?$/;
  return iso8601Regex.test(str);
}

function parseValue(value: any): any {
  if (typeof value !== "string" || value === "") {
    return value;
  }

  // Handle special Firestore types with prefixes
  if (value.startsWith('__ref:')) {
    const path = value.substring(6);
    return admin.firestore().doc(path);
  }

  if (value.startsWith('__geo:')) {
    const [lat, lng] = value.substring(6).split(',').map(Number);
    return new admin.firestore.GeoPoint(lat, lng);
  }

  if (value.startsWith('__vector:')) {
    const values = value.substring(9).split(',').map(Number);
    return admin.firestore.FieldValue.arrayUnion(...values);
  }

  if (value.startsWith('__bytes:')) {
    const base64 = value.substring(8);
    return Buffer.from(base64, 'base64');
  }

  // Check for ISO8601 date strings
  if (isISO8601(value)) {
    return Timestamp.fromDate(new Date(value));
  }

  // Try to parse JSON if it looks like a JSON string
  if ((value.startsWith("{") && value.endsWith("}")) || 
      (value.startsWith("[") && value.endsWith("]"))) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}

function setValueAtPath(obj: any, path: string, value: any): void {
  const parts = path.split(".");
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const nextPart = parts[i + 1];
    const isNextNumeric = /^\d+$/.test(nextPart);

    if (/^\d+$/.test(part)) {
      // Current part is numeric - ensure parent is array
      const index = parseInt(part, 10);
      if (!Array.isArray(current)) {
        current = Array(index + 1).fill(null);
      } else if (current.length <= index) {
        // Extend array preserving existing values
        const oldLength = current.length;
        const extension = Array(index - oldLength + 1).fill(null);
        current.push(...extension);
      }
      // Initialize next level based on next part if not already set
      if (current[index] === null) {
        current[index] = isNextNumeric ? [] : {};
      }
      current = current[index];
    } else {
      // Current part is string - ensure parent is object
      if (!current[part]) {
        current[part] = isNextNumeric ? [] : {};
      }
      current = current[part];
    }
  }

  // Handle the final part
  const lastPart = parts[parts.length - 1];
  if (/^\d+$/.test(lastPart)) {
    const index = parseInt(lastPart, 10);
    if (!Array.isArray(current)) {
      current = Array(index + 1).fill(null);
    } else if (current.length <= index) {
      // Extend array preserving existing values
      const oldLength = current.length;
      const extension = Array(index - oldLength + 1).fill(null);
      current.push(...extension);
    }
    current[index] = value;
  } else {
    current[lastPart] = value;
  }
}

function processRowData(
  db: admin.firestore.Firestore,
  row: any,
  mappingsByHeader: Map<string, string | null | undefined>,
  collectionPath: string
): { processedData: Record<string, any>; specialFields: SpecialFields } {
  const doc: Record<string, any> = {};
  const specialFields: SpecialFields = {};
  const specialFieldsFound = new Map<string, string>();

  // Get all headers from the row
  const headers = Object.keys(row);

  // First pass: collect all potential special field values
  for (const header of headers) {
    const value = row[header];
    if (value === undefined || value === null || value === "") continue;

    // Check if there's an override mapping
    const destination = mappingsByHeader.get(header);

    // Three cases to handle:
    // 1. Header is a special field with no mapping
    // 2. Header maps to a special field
    // 3. Neither - regular field
    
    if (header === SPECIAL_FIELDS.ID || destination === SPECIAL_FIELDS.ID) {
      specialFieldsFound.set(SPECIAL_FIELDS.ID, String(value));
    } else if (header === SPECIAL_FIELDS.REF || destination === SPECIAL_FIELDS.REF) {
      specialFieldsFound.set(SPECIAL_FIELDS.REF, String(value));
    } else if (destination !== null) {
      // Only process non-special fields that aren't explicitly mapped to null
      const fieldPath = destination || header;
      setValueAtPath(doc, fieldPath, parseValue(value));
    }
  }

  // Process special fields with correct precedence (REF takes precedence over ID)
  if (specialFieldsFound.has(SPECIAL_FIELDS.REF)) {
    const refValue = specialFieldsFound.get(SPECIAL_FIELDS.REF)!;
    const refPath = refValue.includes('/')
      ? refValue
      : `${collectionPath}/${refValue}`;
    specialFields.docRef = db.doc(refPath);
  } else if (specialFieldsFound.has(SPECIAL_FIELDS.ID)) {
    specialFields.docId = specialFieldsFound.get(SPECIAL_FIELDS.ID);
  }

  return { processedData: doc, specialFields };
}

async function importCollection(
  db: admin.firestore.Firestore,
  collectionPath: string,
  bucketName: string,
  storagePath: string,
  fieldMappings: CSVFieldImport[],
  delimiter: string = ","
): Promise<ImportMetadata> {
  const bucket = getBucketByName(bucketName);
  const tempFilePath = `/tmp/${path.basename(storagePath)}`;
  let documentsProcessed = 0;
  let fileStream: fs.ReadStream | null = null;
  let mappingsByHeader = new Map<string, string | null | undefined>();

  try {
    console.log(`Attempting to download from bucket path: ${storagePath}`);
    const file = bucket.file(storagePath);
    const [exists] = await file.exists();

    if (!exists) {
      throw new Error(
        `File ${storagePath} not found in Firebase Storage bucket`
      );
    }

    console.log(`File exists, downloading to ${tempFilePath}`);
    await file.download({ destination: tempFilePath });
    console.log(`Download completed, checking file details`);

    fileStream = fs.createReadStream(tempFilePath);
    const batchManager = new BatchManager(db);
    let isFirstRow = true;

    // Create the parser
    const parser = fileStream.pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
        delimiter,
      })
    );

    for await (const row of parser) {
      // Initialize mappings from first row
      if (isFirstRow) {
        const headers = Object.keys(row);

        // Reset the map with initial header mappings
        mappingsByHeader = new Map(headers.map((header) => [header, header]));

        // Apply override mappings
        fieldMappings.forEach((mapping) => {
          if (mapping.header) {
            console.log(
              `Applying mapping override: ${mapping.header} -> ${mapping.destination}`
            );
            mappingsByHeader.set(mapping.header, mapping.destination);
          }
        });

        console.log(
          "Final mappings:",
          JSON.stringify(
            Object.fromEntries(mappingsByHeader.entries()),
            null,
            2
          )
        );

        isFirstRow = false;
      }

      const { processedData, specialFields } = processRowData(
        db,
        row,
        mappingsByHeader,
        collectionPath
      );

      const finalDocRef =
        specialFields.docRef ||
        (specialFields.docId
          ? db.collection(collectionPath).doc(specialFields.docId)
          : db.collection(collectionPath).doc());

      await batchManager.add(finalDocRef, processedData);
      documentsProcessed++;
    }

    await batchManager.commit();
    return {
      documentsProcessed,
      importedTo: collectionPath,
      importedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (fileStream) {
      fileStream.destroy();
    }
    console.error(`Import failed for collection ${collectionPath}:`, error);
    throw error;
  } finally {
    if (fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (error) {
        console.error("Error deleting temp file:", error);
      }
    }
  }
}
