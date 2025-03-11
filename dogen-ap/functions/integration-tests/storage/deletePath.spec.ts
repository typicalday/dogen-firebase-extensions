import { describe, it, before } from "mocha";
import { expect } from "chai";
import { admin } from "../setup";
import { JobTask } from "../../src/job/jobTask";
import { handleDeletePath } from "../../src/job/handlers/storage/deletePath";

describe("Firebase Admin Storage Test", function() {
  this.timeout(10000);
  
  before(async function() {
    // Verify emulator connection
    const bucket = admin.storage().bucket();
    console.log("Connected to storage emulator with bucket:", bucket.name);
  });

  it("should be able to use Firebase Admin Storage with emulator", async function() {
    try {
      // Get the default bucket
      const bucket = admin.storage().bucket();
      
      // Create a test file
      const fileName = "test-file.txt";
      const file = bucket.file(fileName);
      
      // Upload content
      await file.save("Test content", {
        contentType: "text/plain"
      });
      console.log("File saved");
      
      // Verify file exists
      const [fileExists] = await file.exists();
      expect(fileExists).to.be.true;
      console.log("File exists check passed");
      
      // Delete the file
      await file.delete();
      console.log("File deleted");
      
      // Verify deletion
      const [fileExistsAfter] = await file.exists();
      expect(fileExistsAfter).to.be.false;
    } catch (error) {
      console.error("Test error details:", error);
      throw error;
    }
  });

  it("should delete a folder with multiple files", async function() {
    try {
      // Get the default bucket
      const bucket = admin.storage().bucket();
      
      // Create test files in a folder structure
      const files = ["test-folder/file1.txt", "test-folder/file2.txt", "test-folder/subfolder/file3.txt"];
      for (const fileName of files) {
        await bucket.file(fileName).save("Test content", {
          contentType: "text/plain"
        });
        // Verify file was created
        const [exists] = await bucket.file(fileName).exists();
        expect(exists).to.be.true;
      }
      
      // Create a task to delete the folder
      const task = new JobTask({
        service: "storage",
        command: "delete-path",
        input: {
          path: "storage/(default)/data/test-folder"
        }
      });
      
      // Execute the handler
      const result = await handleDeletePath(task);
      
      // Verify results
      expect(result.filesDeleted).to.equal(3);
      expect(result.bucket).to.equal("default");
      expect(result.filePath).to.equal("test-folder");
      
      // Verify files are deleted
      for (const fileName of files) {
        const [exists] = await bucket.file(fileName).exists();
        expect(exists).to.be.false;
      }
    } catch (error) {
      console.error("Test error details:", error);
      throw error;
    }
  });

  it("should delete a single file by path", async function() {
    try {
      // Get the default bucket
      const bucket = admin.storage().bucket();
      
      // Create a single test file
      const fileName = "single-file-test.txt";
      await bucket.file(fileName).save("Test content", {
        contentType: "text/plain"
      });
      
      // Verify file was created
      const [exists] = await bucket.file(fileName).exists();
      expect(exists).to.be.true;
      
      // Create a task to delete the single file
      const task = new JobTask({
        service: "storage",
        command: "delete-path",
        input: {
          path: `storage/(default)/data/${fileName}`
        }
      });
      
      // Execute the handler
      const result = await handleDeletePath(task);
      
      // Verify results
      expect(result.filesDeleted).to.equal(1);
      expect(result.bucket).to.equal("default");
      expect(result.filePath).to.equal(fileName);
      
      // Verify file is deleted
      const [existsAfter] = await bucket.file(fileName).exists();
      expect(existsAfter).to.be.false;
    } catch (error) {
      console.error("Test error details:", error);
      throw error;
    }
  });

  it("should handle non-existent paths gracefully", async function() {
    try {
      // Create a task with a non-existent path
      const task = new JobTask({
        service: "storage",
        command: "delete-path",
        input: {
          path: "storage/(default)/data/non-existent-path"
        }
      });
      
      // Execute the handler and expect it to throw
      await handleDeletePath(task);
      // If we get here, the test should fail
      expect.fail("Expected an error for non-existent path");
    } catch (error) {
      // Verify the error message
      expect((error as Error).message).to.include("No files found with prefix");
    }
  });
}); 