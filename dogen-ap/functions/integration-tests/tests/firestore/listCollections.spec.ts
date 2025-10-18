import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { admin } from "../../setup";
import { JobTask } from "../../../src/job/jobTask";
import { handleListCollections } from "../../../src/job/handlers/firestore/listCollections";
import { createMockJobContext } from "../../helpers/jobContextHelper";

describe("Firebase Admin Firestore List Collections Test", function() {
  this.timeout(10000);
  
  const db = admin.firestore();
  const testCollection1 = "test-list-collection-1";
  const testCollection2 = "test-list-collection-2";
  const testDoc = "test-doc";
  const subcollection1 = "subcollection-1";
  const subcollection2 = "subcollection-2";
  
  before(async function() {
    console.log("Connected to Firestore emulator");
    
    // Create test collections and documents
    await db.collection(testCollection1).doc(testDoc).set({
      name: "Test Document 1"
    });
    
    await db.collection(testCollection2).doc(testDoc).set({
      name: "Test Document 2"
    });
    
    // Create subcollections
    await db.collection(testCollection1).doc(testDoc)
      .collection(subcollection1).doc("subdoc1").set({
        name: "Subcollection Document 1"
      });
    
    await db.collection(testCollection1).doc(testDoc)
      .collection(subcollection2).doc("subdoc2").set({
        name: "Subcollection Document 2"
      });
  });
  
  after(async function() {
    // Clean up test data
    try {
      await db.recursiveDelete(db.collection(testCollection1));
      await db.recursiveDelete(db.collection(testCollection2));
    } catch (error) {
      console.error("Cleanup error:", error);
    }
  });
  
  it("should list all top-level collections", async function() {
    const task = new JobTask({
      service: "firestore",
      command: "list-collections",
      input: {}
    });
    
    // Execute the handler
    const context = createMockJobContext();
    const result = await handleListCollections(task, context);
    
    // Verify collections are returned
    expect(result.collections).to.be.an("array");
    expect(result.collections).to.include(testCollection1);
    expect(result.collections).to.include(testCollection2);
  });
  
  it("should list subcollections of a document", async function() {
    const task = new JobTask({
      service: "firestore",
      command: "list-collections",
      input: {
        documentPath: `firestore/(default)/data/${testCollection1}/${testDoc}`
      }
    });
    
    // Execute the handler
    const context = createMockJobContext();
    const result = await handleListCollections(task, context);
    
    // Verify subcollections are returned
    expect(result.collections).to.be.an("array");
    expect(result.collections).to.include(subcollection1);
    expect(result.collections).to.include(subcollection2);
    expect(result.collections.length).to.equal(2);
  });
  
  it("should return empty array for document with no subcollections", async function() {
    const task = new JobTask({
      service: "firestore",
      command: "list-collections",
      input: {
        documentPath: `firestore/(default)/data/${testCollection2}/${testDoc}`
      }
    });
    
    // Execute the handler
    const context = createMockJobContext();
    const result = await handleListCollections(task, context);
    
    // Verify empty array is returned
    expect(result.collections).to.be.an("array");
    expect(result.collections.length).to.equal(0);
  });
  
  it("should handle non-existent documents gracefully", async function() {
    const task = new JobTask({
      service: "firestore",
      command: "list-collections",
      input: {
        documentPath: `firestore/(default)/data/${testCollection1}/non-existent-doc`
      }
    });
    
    // Execute the handler
    const context = createMockJobContext();
    const result = await handleListCollections(task, context);
    
    // Verify empty array is returned
    expect(result.collections).to.be.an("array");
    expect(result.collections.length).to.equal(0);
  });
});