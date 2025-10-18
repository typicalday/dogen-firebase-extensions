import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { admin } from "../../setup";
import { JobTask } from "../../../src/job/jobTask";
import { handleDeletePath } from "../../../src/job/handlers/firestore/deletePath";
import { createMockJobContext } from "../../helpers/jobContextHelper";

describe("Firebase Admin Firestore Delete Path Test", function() {
  this.timeout(10000);
  
  const db = admin.firestore();
  const testCollection = "test-collection";
  const testDoc1 = "test-doc-1";
  const testDoc2 = "test-doc-2";
  const testSubcollection = "test-subcollection";
  const testSubdoc = "test-subdoc";
  
  // Setup test data
  before(async function() {
    console.log("Connected to Firestore emulator");
    
    // Create test document 1 with subcollection
    await db.collection(testCollection).doc(testDoc1).set({
      name: "Test Document 1",
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Create subcollection document
    await db.collection(testCollection).doc(testDoc1)
      .collection(testSubcollection).doc(testSubdoc).set({
        name: "Test Subdocument",
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    
    // Create test document 2
    await db.collection(testCollection).doc(testDoc2).set({
      name: "Test Document 2",
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  });
  
  after(async function() {
    // Clean up any remaining test data
    try {
      const batch = db.batch();
      const docs = await db.collection(testCollection).listDocuments();
      docs.forEach(doc => batch.delete(doc));
      await batch.commit();
    } catch (error) {
      console.error("Cleanup error:", error);
    }
  });
  
  it("should delete a document including its subcollections", async function() {
    // Verify test document exists
    const docSnapshot = await db.collection(testCollection).doc(testDoc1).get();
    expect(docSnapshot.exists).to.be.true;
    
    // Verify subcollection document exists
    const subdocSnapshot = await db.collection(testCollection).doc(testDoc1)
      .collection(testSubcollection).doc(testSubdoc).get();
    expect(subdocSnapshot.exists).to.be.true;
    
    // Create task to delete the document and its subcollections
    const task = new JobTask({
      service: "firestore",
      command: "delete-path",
      input: {
        path: `firestore/(default)/data/${testCollection}/${testDoc1}`
      }
    });
    
    // Execute the delete handler
    const context = createMockJobContext();
    const result = await handleDeletePath(task, context);
    
    // Verify response
    expect(result.deleted).to.equal(`firestore/(default)/data/${testCollection}/${testDoc1}`);
    
    // Verify document was deleted
    const docAfter = await db.collection(testCollection).doc(testDoc1).get();
    expect(docAfter.exists).to.be.false;
    
    // Verify subcollection was also deleted
    const subdocAfter = await db.collection(testCollection).doc(testDoc1)
      .collection(testSubcollection).doc(testSubdoc).get();
    expect(subdocAfter.exists).to.be.false;
  });
  
  it("should delete an entire collection", async function() {
    // Verify test document 2 exists
    const docSnapshot = await db.collection(testCollection).doc(testDoc2).get();
    expect(docSnapshot.exists).to.be.true;
    
    // Create task to delete the entire collection
    const task = new JobTask({
      service: "firestore",
      command: "delete-path",
      input: {
        path: `firestore/(default)/data/${testCollection}`
      }
    });
    
    // Execute the delete handler
    const context = createMockJobContext();
    const result = await handleDeletePath(task, context);
    
    // Verify response
    expect(result.deleted).to.equal(`firestore/(default)/data/${testCollection}`);
    
    // Verify collection was deleted (should be empty)
    const snapshot = await db.collection(testCollection).get();
    expect(snapshot.empty).to.be.true;
  });
  
  it("should handle non-existent paths", async function() {
    // Create task with non-existent path
    const task = new JobTask({
      service: "firestore",
      command: "delete-path",
      input: {
        path: "firestore/(default)/data/non-existent-collection/non-existent-doc"
      }
    });
    
    // Execute the handler (should not throw)
    const context = createMockJobContext();
    const result = await handleDeletePath(task, context);
    
    // Verify response
    expect(result.deleted).to.equal("firestore/(default)/data/non-existent-collection/non-existent-doc");
  });
  
  it("should throw error when path is missing", async function() {
    // Create task without path
    const task = new JobTask({
      service: "firestore",
      command: "delete-path",
      input: {}
    });
    
    try {
      // Execute the handler and expect it to throw
      const context = createMockJobContext();
      await handleDeletePath(task, context);
      // If we get here, the test should fail
      expect.fail("Expected an error for missing path");
    } catch (error) {
      // Verify the error message
      expect((error as Error).message).to.include("path is required");
    }
  });
});