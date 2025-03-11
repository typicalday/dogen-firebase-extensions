import { BatchManager } from "../../../utils/batchManager";
import { JobTask } from "../../jobTask";
import * as admin from "firebase-admin";
import { getDatabaseByName, parseDatabasePath } from "../../../utils/utils";

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
  // Group paths by database to use separate batch managers
  const dbGroups = new Map<string, { db: admin.firestore.Firestore, paths: string[] }>();
  
  for (const path of documentPaths) {
    const [dbName, docPath] = parseDatabasePath(path);
    if (!dbGroups.has(dbName)) {
      dbGroups.set(dbName, {
        db: getDatabaseByName(dbName),
        paths: []
      });
    }
    dbGroups.get(dbName)!.paths.push(docPath);
  }

  // Delete documents for each database
  for (const { db, paths } of dbGroups.values()) {
    const batchManager = new BatchManager(db);
    paths.forEach(path => {
      batchManager.delete(db.doc(path));
    });
    await batchManager.commit();
  }
}

