import { JobTask } from "../../jobTask";
import * as admin from "firebase-admin";
import { getDatabaseByName, parseDatabasePath } from "../../../utils/utils";

export async function handleListCollections(
  task: JobTask
): Promise<Record<string, any>> {
  const documentPath = task.input?.documentPath;
  
  // Use default database if no path provided
  if (!documentPath) {
    const db = admin.firestore();
    return {
      collections: await listTopLevelCollections(db),
    };
  }

  const [dbName, fsPath] = parseDatabasePath(documentPath);
  const db = getDatabaseByName(dbName);

  return {
    collections: fsPath 
      ? await listSubcollections(db, fsPath)
      : await listTopLevelCollections(db),
  };
}

async function listTopLevelCollections(db: admin.firestore.Firestore): Promise<string[]> {
  const collections = await db.listCollections();
  const collectionNames = collections.map((collectionRef) => collectionRef.id);
  return collectionNames;
}

async function listSubcollections(
  db: admin.firestore.Firestore,
  documentPath: string
): Promise<string[]> {
  const documentRef = db.doc(documentPath);
  const collections = await documentRef.listCollections();
  const collectionNames = collections.map((collectionRef) => collectionRef.id);
  return collectionNames;
}



