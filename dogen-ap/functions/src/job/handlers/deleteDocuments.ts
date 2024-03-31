import { BatchManager } from "../../utils/batchManager";
import { JobTask } from "../jobTask";
import * as admin from "firebase-admin";

const db = admin.firestore();

export async function handleDeleteDocuments(task: JobTask) : Promise<Record<string, any>> {
  const documentPaths: string[] = task.input?.paths;

  if (!Array.isArray(documentPaths) || documentPaths.length === 0) {
    throw new Error(
      "Invalid input: documentPaths must be a non-empty array"
    );
  }

  await deleteDocuments(documentPaths);

  return {
    deleted: documentPaths,
  };
}

async function deleteDocuments(documentPaths: string[]): Promise<void> {
  const batchManager = new BatchManager(db);

  documentPaths.forEach((path) => {
    const docRef = db.doc(path);
    batchManager.delete(docRef);
  });

  await batchManager.commit();
}

