import { JobTask } from "../../jobTask";
import { getBucketByName, parseStoragePath } from "../../../utils/utils";

const BATCH_SIZE = 100; // Number of files to delete in parallel
const MAX_FILES = 1; // Safety limit to prevent runaway deletions

export async function handleDeleteStoragePath(task: JobTask): Promise<Record<string, any>> {
  const path = task.input?.path;
  const limit = task.input?.limit !== undefined ? parseInt(String(task.input.limit), 10) : MAX_FILES;
  console.log(`Handling delete path: ${path} with limit: ${limit}`);

  if (!path) {
    throw new Error("Invalid input: path is required");
  }

  const [bucketName, filePath] = parseStoragePath(path);
  const bucket = getBucketByName(bucketName);

  let filesDeleted = 0;
  let pageToken: string | undefined;

  try {
    // Loop until we hit the limit or run out of files
    while (filesDeleted < limit && (pageToken !== undefined || filesDeleted === 0)) {
      // Get a batch of files (only get what we need)
      const [files, , nextPageToken] = await bucket.getFiles({
        prefix: filePath,
        maxResults: Math.min(BATCH_SIZE, limit - filesDeleted),
        pageToken
      });
      
      pageToken = nextPageToken as string | undefined;
      
      // Check if we found anything on the first pass
      if (files.length === 0 && filesDeleted === 0) {
        throw new Error(`No files found with prefix: ${filePath}`);
      }
      
      // If we have files to delete
      if (files.length > 0) {
        // Delete files in batch (already limited by maxResults above)
        await Promise.all(files.map(file => file.delete()));
        
        // Update count
        filesDeleted += files.length;
        console.log(`Deleted batch: ${files.length} files, total: ${filesDeleted}`);
      }
      
      // Exit if no more files or if we've hit our limit
      if (files.length === 0 || filesDeleted >= limit) {
        break;
      }
    }
  } catch (error) {
    console.error(`Error deleting files: ${error}`);
    throw error;
  }

  console.log(`Completed: Deleted ${filesDeleted} files from ${path}`);

  return {
    deleted: path,
    bucket: bucketName || 'default',
    filePath: filePath,
    filesDeleted,
    limit: limit,
    reachedLimit: filesDeleted >= limit
  };
}
