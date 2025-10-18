import { JobTask } from "../../jobTask";
import { JobContext } from "../../jobContext";
import { copyCollection } from "./copyCollection";
import { getDatabaseByName, parseDatabasePath } from "../../../utils/utils";

export async function handleCopyDocument(
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

    const [sourceDb, sourceDocPath] = parseDatabasePath(sourcePath);
    const [destDb, destDocPath] = parseDatabasePath(destinationPath);

    await copyDocument(sourceDb, sourceDocPath, destDb, destDocPath);

    return {
        copied: sourcePath,
        to: destinationPath,
    };
}

async function copyDocument(
    sourceDbName: string,
    sourceDocumentPath: string,
    destDbName: string,
    destinationDocumentPath: string
) {
    const sourceDb = getDatabaseByName(sourceDbName);
    const destDb = getDatabaseByName(destDbName);

    const sourceDocRef = sourceDb.doc(sourceDocumentPath);
    const destinationDocRef = destDb.doc(destinationDocumentPath);

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
            sourceDbName,
            `${sourceDocumentPath}/${subcollection.id}`,
            destDbName,
            `${destinationDocumentPath}/${subcollection.id}`
        );
    }
}

