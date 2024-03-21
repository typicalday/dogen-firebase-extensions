import { FirebaseTask } from "../firebaseTask";
import * as admin from "firebase-admin";

const db = admin.firestore();

export async function handleDeletePath(task: FirebaseTask): Promise<Record<string, any>> {
  const path = task.input?.path;

  if (!path) {
    throw new Error("Invalid input: path is required");
  }

  await deletePath(path);

  return {};
}

async function deletePath(path: string) {
  if (path) await db.recursiveDelete(getPathRef(path));
}

function getPathRef(
  path: string
): admin.firestore.DocumentReference | admin.firestore.CollectionReference {
  const firestore = db;
  const segments = path.split("/").filter(Boolean);

  if (segments.length % 2 === 0) {
    return firestore.doc(path);
  } else {
    return firestore.collection(path);
  }
}
