import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { admin } from "../../setup";
import { JobTask } from "../../../src/job/jobTask";
import { handleExportCollectionJSON } from "../../../src/job/handlers/firestore/exportCollectionJSON";
import { handleImportCollectionJSON } from "../../../src/job/handlers/firestore/importCollectionJSON";

describe("Firebase Admin Firestore Import Collection JSON Test", function() {
  this.timeout(15000);
  
  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  const sourceCollection = "test-export-json-source";
  const importCollection = "test-import-json-collection";
  const exportBucketPrefix = "gs://demo-test.appspot.com/test-exports/json";
  const numDocs = 3;
  let exportedJsonPath: string;
  let exportedWithSubcollectionsPath: string;
  
  before(async function() {
    console.log("Setting up JSON import test data");
    
    // Create source collection with documents and subcollections
    for (let i = 0; i < numDocs; i++) {
      const docRef = db.collection(sourceCollection).doc(`doc-${i}`);
      
      await docRef.set({
        name: `Test Document ${i}`,
        value: i * 10,
        isActive: i % 2 === 0,
        nested: {
          field1: `nested-value-${i}`,
          field2: i * 100
        },
        tags: [`tag-${i}`, "test", i % 3 === 0 ? "special" : "normal"],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        // Add special Firestore types for testing
        geoPoint: new admin.firestore.GeoPoint(i + 40, i - 70),
        reference: db.doc(`${sourceCollection}/reference-doc-${i}`),
        bytes: Buffer.from(`test-bytes-${i}`, 'utf8')
      });
      
      // Add subcollections
      const subcollRef = docRef.collection("subcollection");
      await subcollRef.doc(`subdoc-${i}-1`).set({
        subName: `Subdoc ${i}-1`,
        subValue: i * 100 + 1,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await subcollRef.doc(`subdoc-${i}-2`).set({
        subName: `Subdoc ${i}-2`,
        subValue: i * 100 + 2,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
    try {
      // Export to JSON without subcollections
      const exportTask = new JobTask({
        service: "firestore",
        command: "export-collection-json",
        input: {
          collectionPath: `firestore/(default)/data/${sourceCollection}`,
          bucketPathPrefix: exportBucketPrefix,
          includeSubcollections: false
        }
      });
      
      const exportResult = await handleExportCollectionJSON(exportTask);
      exportedJsonPath = exportResult.exportedTo;
      console.log(`Exported JSON to: ${exportedJsonPath}`);
      
      // Export with subcollections
      const exportWithSubsTask = new JobTask({
        service: "firestore",
        command: "export-collection-json",
        input: {
          collectionPath: `firestore/(default)/data/${sourceCollection}`,
          bucketPathPrefix: exportBucketPrefix,
          includeSubcollections: true
        }
      });
      
      const exportWithSubsResult = await handleExportCollectionJSON(exportWithSubsTask);
      exportedWithSubcollectionsPath = exportWithSubsResult.exportedTo;
      console.log(`Exported JSON with subcollections to: ${exportedWithSubcollectionsPath}`);
    } catch (error) {
      console.error("Export error:", error);
    }
  });
  
  after(async function() {
    // Clean up test data
    try {
      await db.recursiveDelete(db.collection(sourceCollection));
      await db.recursiveDelete(db.collection(importCollection));
      await db.recursiveDelete(db.collection("import-with-subs"));
      
      // Delete any exported files
      const [files] = await bucket.getFiles({ prefix: exportBucketPrefix });
      for (const file of files) {
        await file.delete();
      }
    } catch (error) {
      console.error("Cleanup error:", error);
    }
  });
  
  it("should import a JSON file", async function() {
    const task = new JobTask({
      service: "firestore",
      command: "import-collection-json",
      input: {
        collectionPath: `firestore/(default)/data/${importCollection}`,
        bucketPath: exportedJsonPath
      }
    });
    
    // Execute the handler
    const result = await handleImportCollectionJSON(task);
    
    // Verify response basics
    expect(result.bucketPath).to.equal(exportedJsonPath);
    expect(result.importedTo).to.equal(`firestore/(default)/data/${importCollection}`);
    expect(result.documentsProcessed).to.be.greaterThan(0);
    
    // Verify documents were imported
    const snapshot = await db.collection(importCollection).get();
    expect(snapshot.size).to.be.greaterThan(0);
    
    // Verify special Firestore types were properly imported
    for (let i = 0; i < numDocs; i++) {
      const docId = `doc-${i}`;
      const doc = await db.collection(importCollection).doc(docId).get();
      expect(doc.exists).to.be.true;
      
      const data = doc.data();
      expect(data).to.have.property('name', `Test Document ${i}`);
      
      // Check GeoPoint
      expect(data?.geoPoint).to.be.instanceOf(admin.firestore.GeoPoint);
      expect(data?.geoPoint.latitude).to.equal(i + 40);
      expect(data?.geoPoint.longitude).to.equal(i - 70);
      
      // Check DocumentReference
      expect(data?.reference).to.be.instanceOf(admin.firestore.DocumentReference);
      expect(data?.reference.path).to.include(`${sourceCollection}/reference-doc-${i}`);
      
      // Check Bytes/Buffer
      expect(Buffer.isBuffer(data?.bytes) || data?.bytes instanceof Uint8Array).to.be.true;
      expect(Buffer.from(data?.bytes).toString('utf8')).to.equal(`test-bytes-${i}`);
    }
  });
  
  it("should import a JSON file with subcollections", async function() {
    const importWithSubs = "import-with-subs";
    
    const task = new JobTask({
      service: "firestore",
      command: "import-collection-json",
      input: {
        collectionPath: `firestore/(default)/data/${importWithSubs}`,
        bucketPath: exportedWithSubcollectionsPath
      }
    });
    
    try {
      // Execute the handler
      const result = await handleImportCollectionJSON(task);
      
      // Verify response
      expect(result.bucketPath).to.equal(exportedWithSubcollectionsPath);
      expect(result.importedTo).to.equal(`firestore/(default)/data/${importWithSubs}`);
      expect(result.documentsProcessed).to.be.greaterThan(0);
      
      // Verify documents were imported
      const snapshot = await db.collection(importWithSubs).get();
      expect(snapshot.size).to.be.greaterThan(0);
      
      // Verify subcollections were imported
      for (let i = 0; i < numDocs; i++) {
        const docId = `doc-${i}`;
        const subcollSnapshot = await db.collection(importWithSubs).doc(docId).collection('subcollection').get();
        expect(subcollSnapshot.size).to.be.greaterThan(0);
        
        // Check subcollection documents
        const subdoc = await db.collection(importWithSubs).doc(docId).collection('subcollection').doc(`subdoc-${i}-1`).get();
        expect(subdoc.exists).to.be.true;
        expect(subdoc.data()).to.have.property('subName', `Subdoc ${i}-1`);
      }
    } catch (error) {
      console.error("Import with subcollections error:", error);
      throw error; // Rethrow to fail the test
    }
  });
  
  it("should throw error with missing parameters", async function() {
    // Missing collectionPath
    const task1 = new JobTask({
      service: "firestore",
      command: "import-collection-json",
      input: {
        bucketPath: exportedJsonPath
      }
    });
    
    try {
      await handleImportCollectionJSON(task1);
      expect.fail("Expected an error for missing collectionPath");
    } catch (error) {
      expect((error as Error).message).to.include("collectionPath and bucketPath are required");
    }
    
    // Missing bucketPath
    const task2 = new JobTask({
      service: "firestore",
      command: "import-collection-json",
      input: {
        collectionPath: `firestore/(default)/data/${importCollection}`
      }
    });
    
    try {
      await handleImportCollectionJSON(task2);
      expect.fail("Expected an error for missing bucketPath");
    } catch (error) {
      expect((error as Error).message).to.include("collectionPath and bucketPath are required");
    }
  });
  
  it("should throw error for non-existent file", async function() {
    const task = new JobTask({
      service: "firestore",
      command: "import-collection-json",
      input: {
        collectionPath: `firestore/(default)/data/${importCollection}`,
        bucketPath: "gs://demo-test.appspot.com/non-existent-path.json"
      }
    });
    
    try {
      await handleImportCollectionJSON(task);
      expect.fail("Expected an error for non-existent file");
    } catch (error) {
      // Error will be from file.download
      expect((error as Error).message).to.include("No such object");
    }
  });
});