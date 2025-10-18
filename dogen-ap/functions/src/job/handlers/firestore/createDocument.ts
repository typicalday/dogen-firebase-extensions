import { JobTask } from "../../jobTask";
import { JobContext } from "../../jobContext";
import { getDatabaseByName, parseDatabasePath } from "../../../utils/utils";

export async function handleCreateDocument(
    task: JobTask,
    context: JobContext
): Promise<Record<string, any>> {
    const documentPath = task.input?.documentPath;
    const documentData = task.input?.documentData;

    if (typeof documentPath !== 'string' || documentPath.trim() === '') {
        throw new Error('Invalid documentPath');
    }

    if (typeof documentData !== 'object' || documentData === null) {
        throw new Error('Invalid documentData');
    }

    const [dbName, path] = parseDatabasePath(documentPath);
    const db = getDatabaseByName(dbName);

    const segments = path.split('/');
    if (segments.length % 2 !== 0) {
        throw new Error('Invalid documentPath: Document path should have an even number of segments');
    }

    const documentRef = db.doc(path);
    await documentRef.set(documentData);

    return {
        created: documentPath,
    };
}
