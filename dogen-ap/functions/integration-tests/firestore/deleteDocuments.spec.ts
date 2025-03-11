import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { admin } from "../setup";
import { JobTask } from "../../src/job/jobTask";
import { handleDeleteDocuments } from "../../src/job/handlers/firestore/deleteDocuments";

describe("Firebase Admin Firestore Delete Documents Test", function() {
  this.timeout(10000);
  
  const db = admin.firestore();
  const testCollection = "test-delete-docs-collection";
  const docCount = 5;
  const testDocs: string[] = [];
  const paths: string[] = [];
  
  before(async function() {
    console.log("Connected to Firestore emulator");
    
    // Create test documents
    for (let i = 0; i < docCount; i++) {
      const docId = `test-doc-${i}`;
      testDocs.push(docId);
      
      await db.collection(testCollection).doc(docId).set({
        name: `Test Document ${i}`,
        index: i,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      
      paths.push(`firestore/(default)/data/${testCollection}/${docId}`);
    }
    
    // Verify all documents were created
    for (const docId of testDocs) {
      const doc = await db.collection(testCollection).doc(docId).get();
      expect(doc.exists).to.be.true;
    }
  });
  
  after(async function() {
    // Clean up any remaining test data
    try {
      await db.recursiveDelete(db.collection(testCollection));
    } catch (error) {
      console.error("Cleanup error:", error);
    }
  });
  
  it("should delete multiple documents in a batch", async function() {
    // Create a task to delete multiple documents
    const task = new JobTask({
      service: "firestore",
      command: "delete-documents",
      input: {
        paths: paths
      }
    });
    
    // Execute the handler
    const result = await handleDeleteDocuments(task);
    
    // Verify response
    expect(result.deleted).to.deep.equal(paths);
    
    // Verify all documents were deleted
    for (const docId of testDocs) {
      const doc = await db.collection(testCollection).doc(docId).get();
      expect(doc.exists).to.be.false;
    }
  });
  
  it("should throw error for empty paths array", async function() {
    const task = new JobTask({
      service: "firestore",
      command: "delete-documents",
      input: {
        paths: []
      }
    });
    
    try {
      await handleDeleteDocuments(task);
      expect.fail("Expected an error for empty paths array");
    } catch (error) {
      expect((error as Error).message).to.include("must be a non-empty array");
    }
  });
  
  it("should throw error for missing paths parameter", async function() {
    const task = new JobTask({
      service: "firestore",
      command: "delete-documents",
      input: {}
    });
    
    try {
      await handleDeleteDocuments(task);
      expect.fail("Expected an error for missing paths");
    } catch (error) {
      expect((error as Error).message).to.include("must be a non-empty array");
    }
  });
  
  it("should handle non-existent documents without error", async function() {
    // Create docs to test with
    const tempDoc1 = "temp-doc-1";
    const tempDoc2 = "non-existent-doc";
    
    await db.collection(testCollection).doc(tempDoc1).set({
      name: "Temporary Document"
    });
    
    const task = new JobTask({
      service: "firestore",
      command: "delete-documents",
      input: {
        paths: [
          `firestore/(default)/data/${testCollection}/${tempDoc1}`,
          `firestore/(default)/data/${testCollection}/${tempDoc2}`
        ]
      }
    });
    
    // This should not throw an error even though one document doesn't exist
    await handleDeleteDocuments(task);
    
    // Verify the existing document was deleted
    const doc = await db.collection(testCollection).doc(tempDoc1).get();
    expect(doc.exists).to.be.false;
  });
});