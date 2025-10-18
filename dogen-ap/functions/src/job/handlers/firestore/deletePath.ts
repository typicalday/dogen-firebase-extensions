import { JobTask } from "../../jobTask";
import { JobContext } from "../../jobContext";
import * as admin from "firebase-admin";
import { getDatabaseByName, parseDatabasePath } from "../../../utils/utils";

export async function handleDeletePath(task: JobTask, context: JobContext): Promise<Record<string, any>> {
  const path = task.input?.path;

  if (!path) {
    throw new Error("Invalid input: path is required");
  }

  const [dbName, fsPath] = parseDatabasePath(path);
  const db = getDatabaseByName(dbName);
  await db.recursiveDelete(getPathRef(db, fsPath));

  return {
    deleted: path,
  };
}

function getPathRef(
  db: admin.firestore.Firestore,
  path: string
): admin.firestore.DocumentReference | admin.firestore.CollectionReference {
  const segments = path.split("/").filter(Boolean);

  if (segments.length % 2 === 0) {
    return db.doc(path);
  } else {
    return db.collection(path);
  }
}
