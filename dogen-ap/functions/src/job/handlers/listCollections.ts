import { JobTask } from "../jobTask";
import * as admin from "firebase-admin";

const db = admin.firestore();

export async function handleListCollections(
  task: JobTask
): Promise<Record<string, any>> {
  const documentPath = task.input?.documentPath;

  return {
    collections: documentPath 
      ? await listSubcollections(documentPath)
      : await listTopLevelCollections(),
  };
}

async function listTopLevelCollections(): Promise<string[]> {
  const collections = await db.listCollections();
  const collectionNames = collections.map((collectionRef) => collectionRef.id);
  return collectionNames;
}

async function listSubcollections(documentPath: string): Promise<string[]> {
  const documentRef = db.doc(documentPath);
  const collections = await documentRef.listCollections();
  const collectionNames = collections.map((collectionRef) => collectionRef.id);
  return collectionNames;
}



