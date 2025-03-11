import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { admin } from "../setup";
import { JobTask } from "../../src/job/jobTask";
import { handleCreateDocument } from "../../src/job/handlers/firestore/createDocument";

describe("Firebase Admin Firestore Create Document Test", function() {
  this.timeout(10000);
  
  const db = admin.firestore();
  const testCollection = "test-create-collection";
  const testDoc = "test-create-doc";
  const nestedCollection = "nested-collection";
  const nestedDoc = "nested-doc";
  
  before(async function() {
    console.log("Connected to Firestore emulator");
  });
  
  after(async function() {
    // Clean up test data
    try {
      await db.recursiveDelete(db.collection(testCollection));
    } catch (error) {
      console.error("Cleanup error:", error);
    }
  });
  
  it("should create a document with the specified data", async function() {
    const documentData = {
      name: "Test Document",
      value: 42,
      tags: ["test", "document"],
      nested: {
        field1: "value1",
        field2: true
      },
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
    
    const task = new JobTask({
      service: "firestore",
      command: "create-document",
      input: {
        documentPath: `firestore/(default)/data/${testCollection}/${testDoc}`,
        documentData: documentData
      }
    });
    
    // Execute the handler
    const result = await handleCreateDocument(task);
    
    // Verify response
    expect(result.created).to.equal(`firestore/(default)/data/${testCollection}/${testDoc}`);
    
    // Verify document was created with correct data
    const docSnapshot = await db.collection(testCollection).doc(testDoc).get();
    expect(docSnapshot.exists).to.be.true;
    
    const data = docSnapshot.data();
    expect(data).to.have.property("name", "Test Document");
    expect(data).to.have.property("value", 42);
    expect(data?.tags).to.deep.equal(["test", "document"]);
    expect(data?.nested).to.deep.equal({
      field1: "value1",
      field2: true
    });
    expect(data).to.have.property("timestamp");
  });
  
  it("should create a nested document", async function() {
    const documentData = {
      name: "Nested Document",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    const task = new JobTask({
      service: "firestore",
      command: "create-document",
      input: {
        documentPath: `firestore/(default)/data/${testCollection}/${testDoc}/${nestedCollection}/${nestedDoc}`,
        documentData: documentData
      }
    });
    
    // Execute the handler
    const result = await handleCreateDocument(task);
    
    // Verify response
    expect(result.created).to.equal(`firestore/(default)/data/${testCollection}/${testDoc}/${nestedCollection}/${nestedDoc}`);
    
    // Verify nested document was created
    const docSnapshot = await db.collection(testCollection).doc(testDoc)
      .collection(nestedCollection).doc(nestedDoc).get();
    expect(docSnapshot.exists).to.be.true;
    
    const data = docSnapshot.data();
    expect(data).to.have.property("name", "Nested Document");
    expect(data).to.have.property("createdAt");
  });
  
  it("should throw error for invalid document path", async function() {
    const task = new JobTask({
      service: "firestore",
      command: "create-document",
      input: {
        documentPath: `firestore/(default)/data/${testCollection}`, // Collection path, not document
        documentData: { test: "data" }
      }
    });
    
    try {
      await handleCreateDocument(task);
      expect.fail("Expected an error for invalid document path");
    } catch (error) {
      expect((error as Error).message).to.include("Invalid documentPath: Document path should have an even number of segments");
    }
  });
  
  it("should throw error for missing document path", async function() {
    const task = new JobTask({
      service: "firestore",
      command: "create-document",
      input: {
        documentData: { test: "data" }
      }
    });
    
    try {
      await handleCreateDocument(task);
      expect.fail("Expected an error for missing document path");
    } catch (error) {
      expect((error as Error).message).to.include("Invalid documentPath");
    }
  });
  
  it("should throw error for missing document data", async function() {
    const task = new JobTask({
      service: "firestore",
      command: "create-document",
      input: {
        documentPath: `firestore/(default)/data/${testCollection}/missing-data-doc`
      }
    });
    
    try {
      await handleCreateDocument(task);
      expect.fail("Expected an error for missing document data");
    } catch (error) {
      expect((error as Error).message).to.include("Invalid documentData");
    }
  });
});