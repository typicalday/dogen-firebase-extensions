import { BatchManager } from "../../../utils/batchManager";
import { getDatabaseByName, parseDatabasePath } from "../../../utils/utils";
import { JobTask } from "../../jobTask";
import { JobContext } from "../../jobContext";

export async function handleCopyCollection(
  task: JobTask,
  context: JobContext
): Promise<Record<string, any>> {
  const sourcePath = task.input?.sourcePath;
  const destinationPath = task.input?.destinationPath;

  if (!sourcePath || !destinationPath) {
    throw new Error(
      "Invalid input: sourcePath and destinationPath are required"
    );
  }

  const [sourceDb, sourceCollPath] = parseDatabasePath(sourcePath);
  const [destDb, destCollPath] = parseDatabasePath(destinationPath);

  await copyCollection(sourceDb, sourceCollPath, destDb, destCollPath);

  return {
    copied: sourcePath,
    to: destinationPath,
  };
}

export async function copyCollection(
  sourceDbName: string,
  sourceCollectionPath: string,
  destDbName: string,
  destinationCollectionPath: string
) {
  const sourceDb = getDatabaseByName(sourceDbName);
  const destDb = getDatabaseByName(destDbName);
  
  const collectionRef = sourceDb.collection(sourceCollectionPath);
  const documents = await collectionRef.get();
  const batchManager = new BatchManager(destDb);

  for (const doc of documents.docs) {
    const sourceDocRef = sourceDb.doc(`${sourceCollectionPath}/${doc.id}`);
    const destinationDocRef = destDb.doc(`${destinationCollectionPath}/${doc.id}`);

    if (doc.exists) {
      await batchManager.add(destinationDocRef, doc.data() || {});
    }

    const subcollections = await sourceDocRef.listCollections();
    for (const subcollection of subcollections) {
      await copyCollection(
        sourceDbName,
        `${sourceCollectionPath}/${doc.id}/${subcollection.id}`,
        destDbName,
        `${destinationCollectionPath}/${doc.id}/${subcollection.id}`
      );
    }
  }

  await batchManager.commit();
}
