import { JobTask } from "../jobTask";
import * as admin from "firebase-admin";
import { copyCollection } from "./copyCollection";

const db = admin.firestore();

export async function handleCopyDocument(
    task: JobTask
): Promise<Record<string, any>> {
    const sourcePath = task.input?.sourcePath;
    const destinationPath = task.input?.destinationPath;

    if (!sourcePath || !destinationPath) {
        throw new Error(
            "Invalid input: sourcePath and destinationPath are required"
        );
    }

    await copyDocument(sourcePath, destinationPath);

    return {
        copied: sourcePath,
        to: destinationPath,
    };
}

async function copyDocument(
    sourceDocumentPath: string,
    destinationDocumentPath: string
) {
    const sourceDocRef = db.doc(sourceDocumentPath);
    const destinationDocRef = db.doc(destinationDocumentPath);

    const sourceDoc = await sourceDocRef.get();

    if (!sourceDoc.exists) {
        throw new Error("Source document does not exist");
    }

    const destinationDoc = await destinationDocRef.get();

    if (destinationDoc.exists) {
        throw new Error("Destination document already exists");
    }

    await destinationDocRef.set(sourceDoc.data() || {});

    const subcollections = await sourceDocRef.listCollections();
    for (const subcollection of subcollections) {
        await copyCollection(
            `${sourceDocumentPath}/${subcollection.id}`,
            `${destinationDocumentPath}/${subcollection.id}`
        );
    }
}

