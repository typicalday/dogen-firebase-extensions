import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { admin } from "../../setup";
import { JobTask } from "../../../src/job/jobTask";
import { handleCopyDocument } from "../../../src/job/handlers/firestore/copyDocument";
import { createMockJobContext } from "../../helpers/jobContextHelper";

describe("Firebase Admin Firestore Copy Document Test", function() {
  this.timeout(10000);
  
  const db = admin.firestore();
  const testCollection = "test-copy-collection";
  const sourceDoc = "source-doc";
  const destDoc = "dest-doc";
  const subcollName = "subcollection";
  const subcollDoc = "subcoll-doc";
  
  before(async function() {
    console.log("Connected to Firestore emulator");
    
    // Create source document with data
    await db.collection(testCollection).doc(sourceDoc).set({
      name: "Source Document",
      value: 100,
      tags: ["source", "test", "original"],
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Add subcollection to source document
    await db.collection(testCollection).doc(sourceDoc)
      .collection(subcollName).doc(subcollDoc).set({
        name: "Subcollection Document",
        value: 200
      });
  });
  
  after(async function() {
    // Clean up test data
    try {
      await db.recursiveDelete(db.collection(testCollection));
    } catch (error) {
      console.error("Cleanup error:", error);
    }
  });
  
  it("should copy a document with its subcollections", async function() {
    const task = new JobTask({
      service: "firestore",
      command: "copy-document",
      input: {
        sourcePath: `firestore/(default)/data/${testCollection}/${sourceDoc}`,
        destinationPath: `firestore/(default)/data/${testCollection}/${destDoc}`
      }
    });
    
    // Execute the handler
    const context = createMockJobContext();
    const result = await handleCopyDocument(task, context);
    
    // Verify response
    expect(result.copied).to.equal(`firestore/(default)/data/${testCollection}/${sourceDoc}`);
    expect(result.to).to.equal(`firestore/(default)/data/${testCollection}/${destDoc}`);
    
    // Verify destination document exists and has correct data
    const destDocSnapshot = await db.collection(testCollection).doc(destDoc).get();
    expect(destDocSnapshot.exists).to.be.true;
    
    const destData = destDocSnapshot.data();
    expect(destData).to.have.property("name", "Source Document");
    expect(destData).to.have.property("value", 100);
    expect(destData?.tags).to.deep.equal(["source", "test", "original"]);
    expect(destData).to.have.property("timestamp");
    
    // Verify subcollection was copied
    const subcollDocSnapshot = await db.collection(testCollection).doc(destDoc)
      .collection(subcollName).doc(subcollDoc).get();
    expect(subcollDocSnapshot.exists).to.be.true;
    
    const subcollData = subcollDocSnapshot.data();
    expect(subcollData).to.have.property("name", "Subcollection Document");
    expect(subcollData).to.have.property("value", 200);
  });
  
  it("should throw error when source document doesn't exist", async function() {
    const task = new JobTask({
      service: "firestore",
      command: "copy-document",
      input: {
        sourcePath: `firestore/(default)/data/${testCollection}/non-existent-doc`,
        destinationPath: `firestore/(default)/data/${testCollection}/new-doc`
      }
    });

    const context = createMockJobContext();
    try {
      await handleCopyDocument(task, context);
      expect.fail("Expected an error for non-existent source document");
    } catch (error) {
      expect((error as Error).message).to.include("Source document does not exist");
    }
  });
  
  it("should throw error when destination document already exists", async function() {
    // Create the destination document first
    await db.collection(testCollection).doc("existing-dest").set({
      name: "Existing Destination"
    });

    const task = new JobTask({
      service: "firestore",
      command: "copy-document",
      input: {
        sourcePath: `firestore/(default)/data/${testCollection}/${sourceDoc}`,
        destinationPath: `firestore/(default)/data/${testCollection}/existing-dest`
      }
    });

    const context = createMockJobContext();
    try {
      await handleCopyDocument(task, context);
      expect.fail("Expected an error for existing destination document");
    } catch (error) {
      expect((error as Error).message).to.include("Destination document already exists");
    }
  });
  
  it("should throw error when missing required parameters", async function() {
    const context = createMockJobContext();

    // Missing destinationPath
    const task1 = new JobTask({
      service: "firestore",
      command: "copy-document",
      input: {
        sourcePath: `firestore/(default)/data/${testCollection}/${sourceDoc}`
      }
    });

    try {
      await handleCopyDocument(task1, context);
      expect.fail("Expected an error for missing destinationPath");
    } catch (error) {
      expect((error as Error).message).to.include("sourcePath and destinationPath are required");
    }

    // Missing sourcePath
    const task2 = new JobTask({
      service: "firestore",
      command: "copy-document",
      input: {
        destinationPath: `firestore/(default)/data/${testCollection}/new-doc`
      }
    });

    try {
      await handleCopyDocument(task2, context);
      expect.fail("Expected an error for missing sourcePath");
    } catch (error) {
      expect((error as Error).message).to.include("sourcePath and destinationPath are required");
    }
  });
});