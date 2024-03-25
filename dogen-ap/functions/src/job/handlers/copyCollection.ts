import { BatchManager } from "../../utils/batchManager";
import { JobTask } from "../jobTask";
import * as admin from "firebase-admin";

const db = admin.firestore();

export async function handleCopyCollection(
  task: JobTask
): Promise<Record<string, any>> {
  const sourcePath = task.input?.sourcePath;
  const destinationPath = task.input?.destinationPath;

  if (!sourcePath || !destinationPath) {
    throw new Error(
      "Invalid input: sourcePath and destinationPath are required"
    );
  }

  await copyCollection(sourcePath, destinationPath);

  return {};
}

async function copyCollection(
  sourceCollectionPath: string,
  destinationCollectionPath: string
) {
  const collectionRef = db.collection(sourceCollectionPath);
  const documents = await collectionRef.get();
  const batchManager = new BatchManager(db);

  for (const doc of documents.docs) {
    const sourceDocRef = db.doc(`${sourceCollectionPath}/${doc.id}`);
    const destinationDocRef = db.doc(`${destinationCollectionPath}/${doc.id}`);

    if (doc.exists) {
      await batchManager.add(destinationDocRef, doc.data() || {});
    }

    const subcollections = await sourceDocRef.listCollections();
    for (const subcollection of subcollections) {
      await copyCollection(
        `${sourceCollectionPath}/${doc.id}/${subcollection.id}`,
        `${destinationCollectionPath}/${doc.id}/${subcollection.id}`
      );
    }
  }

  await batchManager.commit();
}
