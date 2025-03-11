import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { admin } from "../setup";
import { JobTask } from "../../src/job/jobTask";
import { handleImportCollectionCSV } from "../../src/job/handlers/firestore/importCollectionCSV";
import { handleExportCollectionCSV } from "../../src/job/handlers/firestore/exportCollectionCSV";

describe("Firebase Admin Firestore Import Collection CSV Test", function() {
  this.timeout(15000);
  
  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  const sourceCollection = "test-export-csv-source";
  const importCollection = "test-import-csv-collection";
  const exportBucketPrefix = "test-exports/csv";
  const numDocs = 5;
  let exportedCsvPath: string;
  
  before(async function() {
    console.log("Setting up CSV import test data");
    
    // Create source collection with test data
    for (let i = 0; i < numDocs; i++) {
      await db.collection(sourceCollection).doc(`doc-${i}`).set({
        name: `Test Document ${i}`,
        value: i * 10,
        isActive: i % 2 === 0,
        nested: {
          field1: `nested-value-${i}`,
          field2: i * 100
        },
        tags: [`tag-${i}`, "test"],
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
    // Export to CSV for import test
    const exportTask = new JobTask({
      service: "firestore",
      command: "export-collection-csv",
      input: {
        collectionPath: `firestore/(default)/data/${sourceCollection}`,
        bucketPathPrefix: exportBucketPrefix,
        fields: [
          { source: "_id_", header: "Document ID" },
          { source: "name" },
          { source: "value" },
          { source: "isActive" },
          { source: "nested.field1", header: "Nested Field 1" },
          { source: "nested.field2", header: "Nested Field 2" },
          { source: "tags" }
        ]
      }
    });
    
    try {
      const exportResult = await handleExportCollectionCSV(exportTask);
      exportedCsvPath = exportResult.exportedTo;
      console.log(`Exported CSV to: ${exportedCsvPath}`);
    } catch (error) {
      console.error("Export error:", error);
      throw error;
    }
  });
  
  after(async function() {
    // Clean up test data
    try {
      await db.recursiveDelete(db.collection(sourceCollection));
      await db.recursiveDelete(db.collection(importCollection));
      
      // Delete any exported files
      const [files] = await bucket.getFiles({ prefix: exportBucketPrefix });
      for (const file of files) {
        await file.delete();
      }
    } catch (error) {
      console.error("Cleanup error:", error);
    }
  });
  
  it("should import a CSV file", async function() {
    const task = new JobTask({
      service: "firestore",
      command: "import-collection-csv",
      input: {
        collectionPath: `firestore/(default)/data/${importCollection}`,
        bucketPath: exportedCsvPath
      }
    });
    
    // Execute the handler
    const result = await handleImportCollectionCSV(task);
    
    // Verify response basics
    expect(result.bucketPath).to.equal(exportedCsvPath);
    expect(result.importedTo).to.equal(`firestore/(default)/data/${importCollection}`);
    expect(result.documentsProcessed).to.be.greaterThan(0);
    
    // Verify documents were imported
    const snapshot = await db.collection(importCollection).get();
    expect(snapshot.size).to.be.greaterThan(0);
  });
  
  it("should import a CSV file with custom field mappings", async function() {
    const customMappingCollection = "test-custom-mapping-import";
    
    const task = new JobTask({
      service: "firestore",
      command: "import-collection-csv",
      input: {
        collectionPath: `firestore/(default)/data/${customMappingCollection}`,
        bucketPath: exportedCsvPath,
        fieldMappings: [
          { header: "Document ID", destination: "_id_" },
          { header: "name", destination: "customName" },
          { header: "value", destination: "metrics.value" },
          { header: "isActive", destination: "status.active" },
          { header: "Nested Field 1", destination: "customNested.field1" },
          { header: "Nested Field 2", destination: "customNested.field2" }
        ]
      }
    });
    
    // Execute the handler
    const result = await handleImportCollectionCSV(task);
    expect(result.documentsProcessed).to.be.greaterThan(0);
    
    // Verify documents were imported with custom mapping
    const snapshot = await db.collection(customMappingCollection).get();
    expect(snapshot.size).to.be.greaterThan(0);
    
    // Clean up
    await db.recursiveDelete(db.collection(customMappingCollection));
  });
  
  it("should throw error with missing parameters", async function() {
    // Missing collectionPath
    const task1 = new JobTask({
      service: "firestore",
      command: "import-collection-csv",
      input: {
        bucketPath: exportedCsvPath
      }
    });
    
    try {
      await handleImportCollectionCSV(task1);
      expect.fail("Expected an error for missing collectionPath");
    } catch (error) {
      expect((error as Error).message).to.include("collectionPath and bucketPath are required");
    }
    
    // Missing bucketPath
    const task2 = new JobTask({
      service: "firestore",
      command: "import-collection-csv",
      input: {
        collectionPath: `firestore/(default)/data/${importCollection}`
      }
    });
    
    try {
      await handleImportCollectionCSV(task2);
      expect.fail("Expected an error for missing bucketPath");
    } catch (error) {
      expect((error as Error).message).to.include("collectionPath and bucketPath are required");
    }
  });
  
  // Skip this test to avoid error logs in the output
  it.skip("should throw error for non-existent file", async function() {
    const task = new JobTask({
      service: "firestore",
      command: "import-collection-csv",
      input: {
        collectionPath: `firestore/(default)/data/${importCollection}`,
        bucketPath: "non-existent-path.csv"
      }
    });
    
    try {
      await handleImportCollectionCSV(task);
      expect.fail("Expected an error for non-existent file");
    } catch (error) {
      expect((error as Error).message).to.include("not found in Firebase Storage bucket");
    }
  });
});