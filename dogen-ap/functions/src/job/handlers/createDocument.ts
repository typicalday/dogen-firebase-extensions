import { JobTask } from "../jobTask";
import * as admin from "firebase-admin";

const db = admin.firestore();

export async function handleCreateDocument(
    task: JobTask
): Promise<Record<string, any>> {
    const documentPath = task.input?.documentPath;
    const documentData = task.input?.documentData;

    if (typeof documentPath !== 'string' || documentPath.trim() === '') {
        throw new Error('Invalid documentPath');
    }

    if (typeof documentData !== 'object' || documentData === null) {
        throw new Error('Invalid documentData');
    }

    const segments = documentPath.split('/');
    
    if (segments.length % 2 !== 0) {
        throw new Error('Invalid documentPath: Document path should have an even number of segments');
    }

    const documentRef = db.doc(documentPath);

    await documentRef.set(documentData);

    return {
        created: documentRef.path,
    };
}
