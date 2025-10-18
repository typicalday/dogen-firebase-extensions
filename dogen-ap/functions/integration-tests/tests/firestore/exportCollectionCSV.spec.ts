import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { admin } from "../../setup";
import { JobTask } from "../../../src/job/jobTask";
import { handleExportCollectionCSV } from "../../../src/job/handlers/firestore/exportCollectionCSV";
import { createMockJobContext } from "../../helpers/jobContextHelper";
import * as fs from "fs";
import { parse } from "csv-parse/sync";

describe("Firebase Admin Firestore Export Collection CSV Test", function() {
  this.timeout(15000);
  
  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  const testCollection = "test-export-csv-collection";
  const exportPrefix = "gs://demo-test.appspot.com/exports/csv";
  const numDocs = 10;
  
  before(async function() {
    console.log("Setting up CSV export test data");
    
    // Create test collection with multiple documents and diverse data types
    for (let i = 0; i < numDocs; i++) {
      await db.collection(testCollection).doc(`doc-${i}`).set({
        name: `Document ${i}`,
        value: i * 10,
        isActive: i % 2 === 0,
        nullField: i % 3 === 0 ? null : "not-null",
        deeplyNested: {
          level1: {
            level2: {
              level3: `nested-value-${i}`
            }
          }
        },
        nested: {
          field1: `nested-value-${i}`,
          field2: i * 100
        },
        tags: [`tag-${i}`, "test", i % 3 === 0 ? "special" : "normal"],
        numericArray: [i, i*2, i*3],
        mixedArray: [i, `string-${i}`, i % 2 === 0, { nestedInArray: i }],
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
    // Create document with special characters and edge cases
    await db.collection(testCollection).doc("special-doc").set({
      name: "Document with, special \"characters\" in it",
      description: "Line 1\nLine 2\nLine 3",
      tags: ["comma,tag", "quotes\"tag", "newline\ntag"],
      emptyArray: [],
      emptyObject: {},
      zeroValue: 0,
      falseValue: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });
  
  after(async function() {
    // Clean up test data
    try {
      await db.recursiveDelete(db.collection(testCollection));
      
      // Delete any exported files
      const [files] = await bucket.getFiles({ prefix: exportPrefix });
      for (const file of files) {
        await file.delete();
      }
    } catch (error) {
      console.error("Cleanup error:", error);
    }
  });
  
  it("should export a collection to CSV with selected fields", async function() {
    const task = new JobTask({
      service: "firestore",
      command: "export-collection-csv",
      input: {
        collectionPath: `firestore/(default)/data/${testCollection}`,
        bucketPathPrefix: exportPrefix,
        fields: [
          { source: "_id_", header: "Document ID" },
          { source: "name", header: "Document Name" },
          { source: "value", header: "Value" },
          { source: "isActive", header: "Is Active" },
          { source: "nested.field1", header: "Nested Field 1" },
          { source: "tags", header: "Tags" }
        ]
      }
    });
    
    // Execute the handler
    const context = createMockJobContext();
    const result = await handleExportCollectionCSV(task, context);
    
    // Verify response structure
    expect(result.collectionPath).to.equal(`firestore/(default)/data/${testCollection}`);
    expect(result.exportedTo).to.include(exportPrefix);
    expect(result.exportedTo).to.include(".csv");
    expect(result.documentsProcessed).to.be.at.least(numDocs); // At least numDocs including the special doc
    expect(result.fields).to.deep.equal(task.input?.fields);
    
    // Verify the file exists in storage
    // Extract path from gs:// URL (result.exportedTo is "gs://bucket/path", we need just "path")
    const filePath = result.exportedTo.replace(/^gs:\/\/[^\/]+\//, '');
    const [exists] = await bucket.file(filePath).exists();
    expect(exists).to.be.true;
    
    // Download the file and verify its contents
    const tempFilePath = `/tmp/export-csv-test-${Date.now()}.csv`;
    await bucket.file(filePath).download({ destination: tempFilePath });
    
    // Verify file contents (basic check)
    const fileContent = fs.readFileSync(tempFilePath, "utf8");
    
    // Verify header
    expect(fileContent).to.include("Document ID,Document Name,Value,Is Active,Nested Field 1,Tags");
    
    // Parse the CSV and perform detailed validation
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true
    });
    
    // Verify we have the right number of records
    expect(records.length).to.be.at.least(numDocs);
    
    // Check content of records
    for (let i = 0; i < numDocs; i++) {
      const docRecord = records.find((r: any) => r["Document ID"] === `doc-${i}`);
      expect(docRecord).to.exist;
      expect(docRecord["Document Name"]).to.equal(`Document ${i}`);
      expect(docRecord["Value"]).to.equal(`${i * 10}`); // CSV converts to string
      expect(docRecord["Is Active"]).to.equal((i % 2 === 0).toString());
      expect(docRecord["Nested Field 1"]).to.equal(`nested-value-${i}`);
      // Tags are serialized to JSON
      expect(docRecord["Tags"]).to.include(`tag-${i}`);
      expect(docRecord["Tags"]).to.include("test");
    }
    
    // Check special character handling for the special document
    const specialRecord = records.find((r: any) => r["Document ID"] === "special-doc");
    expect(specialRecord).to.exist;
    expect(specialRecord["Document Name"]).to.include('special "characters"');
    
    // Clean up temp file
    fs.unlinkSync(tempFilePath);
  });
  
  it("should export with custom delimiter", async function() {
    const task = new JobTask({
      service: "firestore",
      command: "export-collection-csv",
      input: {
        collectionPath: `firestore/(default)/data/${testCollection}`,
        bucketPathPrefix: exportPrefix,
        fields: [
          { source: "_id_", header: "ID" },
          { source: "name", header: "Name" }
        ],
        delimiter: ";"
      }
    });
    
    // Execute the handler
    const context = createMockJobContext();
    const result = await handleExportCollectionCSV(task, context);
    
    // Download the file
    const tempFilePath = `/tmp/export-csv-delim-${Date.now()}.csv`;
    // Extract path from gs:// URL (result.exportedTo is "gs://bucket/path", we need just "path")
    const filePath = result.exportedTo.replace(/^gs:\/\/[^\/]+\//, '');
    await bucket.file(filePath).download({ destination: tempFilePath });
    
    // Verify content uses semicolon delimiter
    const fileContent = fs.readFileSync(tempFilePath, "utf8");
    expect(fileContent).to.include("ID;Name");
    
    // Parse with correct delimiter
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      delimiter: ";"
    });
    
    // Verify correct number of records
    expect(records.length).to.be.at.least(numDocs);
    
    // Clean up
    fs.unlinkSync(tempFilePath);
  });
  
  it("should export a collection with limit and ordering", async function() {
    const task = new JobTask({
      service: "firestore",
      command: "export-collection-csv",
      input: {
        collectionPath: `firestore/(default)/data/${testCollection}`,
        bucketPathPrefix: exportPrefix,
        fields: [
          { source: "name", header: "Name" },
          { source: "value", header: "Value" },
          { source: "isActive", header: "Is Active" }
        ],
        limit: 3,
        orderByField: "value",
        orderByDirection: "desc"
      }
    });
    
    // Execute the handler
    const context = createMockJobContext();
    const result = await handleExportCollectionCSV(task, context);
    
    // Verify response structure
    expect(result.collectionPath).to.equal(`firestore/(default)/data/${testCollection}`);
    expect(result.exportedTo).to.include(exportPrefix);
    expect(result.exportedTo).to.include(".csv");
    expect(result.documentsProcessed).to.equal(3); // Should match the limit
    
    // Verify the file exists in storage
    // Extract path from gs:// URL (result.exportedTo is "gs://bucket/path", we need just "path")
    const filePath = result.exportedTo.replace(/^gs:\/\/[^\/]+\//, '');
    const [exists] = await bucket.file(filePath).exists();
    expect(exists).to.be.true;
    
    // Download the file and verify its contents
    const tempFilePath = `/tmp/export-csv-limit-test-${Date.now()}.csv`;
    await bucket.file(filePath).download({ destination: tempFilePath });
    
    // Read and parse CSV
    const fileContent = fs.readFileSync(tempFilePath, "utf8");
    const rows = fileContent.trim().split("\n");
    
    // Header row + 3 data rows (due to limit)
    expect(rows.length).to.equal(4); // Header + 3 data rows
    
    // Verify ordering (descending by value)
    const dataRows = rows.slice(1); // Skip header
    const values = dataRows.map(row => {
      const columns = row.split(",");
      return parseInt(columns[1]); // Value is the second column
    });
    
    // Check that values are in descending order
    for (let i = 0; i < values.length - 1; i++) {
      expect(values[i]).to.be.greaterThan(values[i + 1]);
    }
    
    // Clean up temp file
    fs.unlinkSync(tempFilePath);
  });
  
  it("should handle deeply nested fields and special paths", async function() {
    const task = new JobTask({
      service: "firestore",
      command: "export-collection-csv",
      input: {
        collectionPath: `firestore/(default)/data/${testCollection}`,
        bucketPathPrefix: exportPrefix,
        fields: [
          { source: "_id_", header: "ID" },
          { source: "deeplyNested.level1.level2.level3", header: "Deep Field" },
          { source: "nullField", header: "Null Field" },
          { source: "emptyArray", header: "Empty Array" },
          { source: "emptyObject", header: "Empty Object" },
          { source: "zeroValue", header: "Zero" },
          { source: "falseValue", header: "False" }
        ]
      }
    });
    
    // Execute the handler
    const context = createMockJobContext();
    const result = await handleExportCollectionCSV(task, context);
    
    // Download the file
    const tempFilePath = `/tmp/export-csv-nested-${Date.now()}.csv`;
    // Extract path from gs:// URL (result.exportedTo is "gs://bucket/path", we need just "path")
    const filePath = result.exportedTo.replace(/^gs:\/\/[^\/]+\//, '');
    await bucket.file(filePath).download({ destination: tempFilePath });
    
    // Parse the CSV
    const records = parse(fs.readFileSync(tempFilePath, "utf8"), {
      columns: true,
      skip_empty_lines: true
    });
    
    // Check deep nesting works
    for (let i = 0; i < numDocs; i++) {
      const record = records.find((r: any) => r.ID === `doc-${i}`);
      expect(record).to.exist;
      expect(record["Deep Field"]).to.equal(`nested-value-${i}`);
    }
    
    // Check special document with edge cases
    const specialRecord = records.find((r: any) => r.ID === "special-doc");
    expect(specialRecord).to.exist;
    expect(specialRecord["Empty Array"]).to.equal("[]");
    expect(specialRecord["Empty Object"]).to.equal("{}");
    expect(specialRecord["Zero"]).to.equal("0");
    expect(specialRecord["False"]).to.equal("false");
    
    // Clean up
    fs.unlinkSync(tempFilePath);
  });
  
  it("should throw error with missing parameters", async function() {
    // Missing collectionPath
    const task1 = new JobTask({
      service: "firestore",
      command: "export-collection-csv",
      input: {
        bucketPathPrefix: exportPrefix,
        fields: [{ source: "name" }]
      }
    });
    
    try {
      const context = createMockJobContext();
      await handleExportCollectionCSV(task1, context);
      expect.fail("Expected an error for missing collectionPath");
    } catch (error) {
      expect((error as Error).message).to.include("collectionPath, bucketPathPrefix, and fields are required");
    }
    
    // Missing bucketPathPrefix
    const task2 = new JobTask({
      service: "firestore",
      command: "export-collection-csv",
      input: {
        collectionPath: `firestore/(default)/data/${testCollection}`,
        fields: [{ source: "name" }]
      }
    });
    
    try {
      const context = createMockJobContext();
      await handleExportCollectionCSV(task2, context);
      expect.fail("Expected an error for missing bucketPathPrefix");
    } catch (error) {
      expect((error as Error).message).to.include("collectionPath, bucketPathPrefix, and fields are required");
    }
    
    // Missing fields
    const task3 = new JobTask({
      service: "firestore",
      command: "export-collection-csv",
      input: {
        collectionPath: `firestore/(default)/data/${testCollection}`,
        bucketPathPrefix: exportPrefix
      }
    });
    
    try {
      const context = createMockJobContext();
      await handleExportCollectionCSV(task3, context);
      expect.fail("Expected an error for missing fields");
    } catch (error) {
      expect((error as Error).message).to.include("collectionPath, bucketPathPrefix, and fields are required");
    }
    
    // Empty fields array
    const task4 = new JobTask({
      service: "firestore",
      command: "export-collection-csv",
      input: {
        collectionPath: `firestore/(default)/data/${testCollection}`,
        bucketPathPrefix: exportPrefix,
        fields: []
      }
    });
    
    try {
      const context = createMockJobContext();
      await handleExportCollectionCSV(task4, context);
      expect.fail("Expected an error for empty fields array");
    } catch (error) {
      expect((error as Error).message).to.include("fields are required");
    }
  });
});