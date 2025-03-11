import { JobTask } from "../../jobTask";
import { getBucketByName, parseStoragePath } from "../../../utils/utils";

const BATCH_SIZE = 100; // Number of files to delete in parallel
const MAX_FILES = 10000; // Safety limit to prevent runaway deletions

export async function handleDeletePath(task: JobTask): Promise<Record<string, any>> {
  const path = task.input?.path;
  console.log("Handling delete path:", path);

  if (!path) {
    throw new Error("Invalid input: path is required");
  }

  const [bucketName, filePath] = parseStoragePath(path);
  console.log("Parsed path:", { bucketName, filePath });
  
  const bucket = getBucketByName(bucketName);
  console.log("Got bucket:", bucket.name);
  
  let filesDeleted = 0;
  let pageToken: string | undefined;
  
  do {
    console.log("Fetching files with prefix:", filePath);
    // Get batch of files
    const [files, _, nextPageToken] = await bucket.getFiles({ 
      prefix: filePath,
      maxResults: BATCH_SIZE,
      pageToken
    });
    console.log("Found files:", files.length);

    if (files.length === 0 && filesDeleted === 0) {
      throw new Error(`No files found with prefix ${filePath} in bucket ${bucketName || 'default'}`);
    }

    // If no files found but we've already deleted some, we're done
    if (files.length === 0) {
      break;
    }

    // Delete current batch
    console.log("Deleting files...");
    await Promise.all(files.map(file => file.delete()));
    filesDeleted += files.length;
    console.log("Files deleted:", filesDeleted);
    
    // Prepare for next batch
    pageToken = nextPageToken as string | undefined;

    // Safety check
    if (filesDeleted >= MAX_FILES) {
      console.warn(`Reached maximum file deletion limit of ${MAX_FILES}`);
      break;
    }
  } while (pageToken);

  return {
    deleted: path,
    bucket: bucketName || 'default',
    filePath: filePath,
    filesDeleted,
    reachedLimit: filesDeleted >= MAX_FILES
  };
}
