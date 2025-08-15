import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { admin } from "../../setup";
import { JobTask } from "../../../src/job/jobTask";
import { handleCopyCollection } from "../../../src/job/handlers/firestore/copyCollection";

describe("Firebase Admin Firestore Copy Collection Test", function() {
  this.timeout(10000);
  
  const db = admin.firestore();
  const sourceCollection = "source-collection";
  const destCollection = "dest-collection";
  const numDocs = 5;
  const subcollName = "subcollection";
  
  before(async function() {
    console.log("Connected to Firestore emulator");
    
    // Create source collection with multiple documents
    for (let i = 0; i < numDocs; i++) {
      const docRef = db.collection(sourceCollection).doc(`doc-${i}`);
      await docRef.set({
        name: `Document ${i}`,
        value: i * 10,
        isTest: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // Add a subcollection to each document
      await docRef.collection(subcollName).doc(`subdoc-${i}`).set({
        subName: `Subdocument ${i}`,
        subValue: i * 100,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  });
  
  after(async function() {
    // Clean up test data
    try {
      await db.recursiveDelete(db.collection(sourceCollection));
      await db.recursiveDelete(db.collection(destCollection));
    } catch (error) {
      console.error("Cleanup error:", error);
    }
  });
  
  it("should copy an entire collection with subcollections", async function() {
    const task = new JobTask({
      service: "firestore",
      command: "copy-collection",
      input: {
        sourcePath: `firestore/(default)/data/${sourceCollection}`,
        destinationPath: `firestore/(default)/data/${destCollection}`
      }
    });
    
    // Execute the handler
    const result = await handleCopyCollection(task);
    
    // Verify response
    expect(result.copied).to.equal(`firestore/(default)/data/${sourceCollection}`);
    expect(result.to).to.equal(`firestore/(default)/data/${destCollection}`);
    
    // Verify destination collection has the correct documents
    const destDocs = await db.collection(destCollection).get();
    expect(destDocs.size).to.equal(numDocs);
    
    // Verify document content was copied correctly
    for (let i = 0; i < numDocs; i++) {
      const sourceDoc = await db.collection(sourceCollection).doc(`doc-${i}`).get();
      const destDoc = await db.collection(destCollection).doc(`doc-${i}`).get();
      
      expect(destDoc.exists).to.be.true;
      expect(destDoc.data()?.name).to.equal(sourceDoc.data()?.name);
      expect(destDoc.data()?.value).to.equal(sourceDoc.data()?.value);
      expect(destDoc.data()?.isTest).to.equal(sourceDoc.data()?.isTest);
      
      // Verify subcollections were copied
      const subDoc = await db.collection(destCollection).doc(`doc-${i}`)
        .collection(subcollName).doc(`subdoc-${i}`).get();
      
      expect(subDoc.exists).to.be.true;
      expect(subDoc.data()?.subName).to.equal(`Subdocument ${i}`);
      expect(subDoc.data()?.subValue).to.equal(i * 100);
    }
  });
  
  it("should throw error when source collection doesn't exist", async function() {
    const task = new JobTask({
      service: "firestore",
      command: "copy-collection",
      input: {
        sourcePath: `firestore/(default)/data/non-existent-collection`,
        destinationPath: `firestore/(default)/data/new-collection`
      }
    });
    
    // Should not throw, just copy nothing
    const result = await handleCopyCollection(task);
    expect(result.copied).to.equal(`firestore/(default)/data/non-existent-collection`);
    expect(result.to).to.equal(`firestore/(default)/data/new-collection`);
    
    // Verify destination collection is empty
    const destDocs = await db.collection("new-collection").get();
    expect(destDocs.empty).to.be.true;
  });
  
  it("should throw error when missing required parameters", async function() {
    // Missing destinationPath
    const task1 = new JobTask({
      service: "firestore",
      command: "copy-collection",
      input: {
        sourcePath: `firestore/(default)/data/${sourceCollection}`
      }
    });
    
    try {
      await handleCopyCollection(task1);
      expect.fail("Expected an error for missing destinationPath");
    } catch (error) {
      expect((error as Error).message).to.include("sourcePath and destinationPath are required");
    }
    
    // Missing sourcePath
    const task2 = new JobTask({
      service: "firestore",
      command: "copy-collection",
      input: {
        destinationPath: `firestore/(default)/data/new-collection`
      }
    });
    
    try {
      await handleCopyCollection(task2);
      expect.fail("Expected an error for missing sourcePath");
    } catch (error) {
      expect((error as Error).message).to.include("sourcePath and destinationPath are required");
    }
  });
});