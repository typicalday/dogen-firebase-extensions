import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { admin } from "../../setup";
import { JobTask } from "../../../src/job/jobTask";
import { handleExportCollectionJSON } from "../../../src/job/handlers/firestore/exportCollectionJSON";
import { createMockJobContext } from "../../helpers/jobContextHelper";
import * as fs from "fs";

describe("Firebase Admin Firestore Export Collection JSON Test", function() {
  this.timeout(20000);
  
  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  const testCollection = "test-export-json-collection";
  const exportPrefix = "gs://demo-test.appspot.com/exports/json";
  const numDocs = 5;
  
  before(async function() {
    console.log("Setting up JSON export test data");
    
    // Create test collection with various data types
    for (let i = 0; i < numDocs; i++) {
      const docRef = db.collection(testCollection).doc(`doc-${i}`);
      
      await docRef.set({
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
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        // Add special Firestore types for testing
        geoPoint: new admin.firestore.GeoPoint(i + 40, i - 70),
        reference: db.doc(`${testCollection}/reference-doc-${i}`),
        bytes: Buffer.from(`test-bytes-${i}`, 'utf8')
      });
      
      // Add subcollections with multiple levels
      const subcollRef = docRef.collection("subcollection");
      
      // First level subcollection
      await subcollRef.doc(`subdoc-${i}-1`).set({
        subName: `Subdoc ${i}-1`,
        subValue: i * 100 + 1,
        subTimestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      
      await subcollRef.doc(`subdoc-${i}-2`).set({
        subName: `Subdoc ${i}-2`,
        subValue: i * 100 + 2,
        subTimestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // Second level subcollection (a subcollection of a subcollection)
      if (i % 2 === 0) {
        await subcollRef.doc(`subdoc-${i}-1`).collection("nestedSubcoll").doc("nestedDoc").set({
          nestedName: `Nested subcollection doc for ${i}`,
          nestedValue: i * 1000,
          nestedTimestamp: admin.firestore.FieldValue.serverTimestamp()
        });
      }
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
      geoPoint: new admin.firestore.GeoPoint(37.7749, -122.4194), // San Francisco coordinates
      reference: db.doc(`${testCollection}/doc-0`), // Document reference
      bytes: Buffer.from("Special bytes content", 'utf8'),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Create empty subcollection on special doc (collection with no documents)
    // Just create the reference, no need to store it
    db.collection(testCollection).doc("special-doc").collection("emptySubcoll");
    // We don't add any documents to this subcollection to test empty collection handling
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
  
  it("should export a collection to JSON without subcollections", async function() {
    const task = new JobTask({
      service: "firestore",
      command: "export-collection-json",
      input: {
        collectionPath: `firestore/(default)/data/${testCollection}`,
        bucketPathPrefix: exportPrefix,
        includeSubcollections: false
      }
    });
    
    // Execute the handler
    const context = createMockJobContext();
    const result = await handleExportCollectionJSON(task, context);
    
    // Verify response structure
    expect(result.collectionPath).to.equal(`firestore/(default)/data/${testCollection}`);
    expect(result.exportedTo).to.include(exportPrefix);
    expect(result.exportedTo).to.include(".json");
    expect(result.documentsProcessed).to.be.at.least(numDocs); // Including special doc
    expect(result.includesSubcollections).to.be.false;
    
    // Verify the file exists in storage
    // Extract path from gs:// URL (result.exportedTo is "gs://bucket/path", we need just "path")
    const filePath = result.exportedTo.replace(/^gs:\/\/[^\/]+\//, '');
    const [exists] = await bucket.file(filePath).exists();
    expect(exists).to.be.true;
    
    // Download the file and verify its contents
    const tempFilePath = `/tmp/export-json-test-${Date.now()}.json`;
    await bucket.file(filePath).download({ destination: tempFilePath });
    
    // Parse and verify JSON content
    const fileContent = fs.readFileSync(tempFilePath, "utf8");
    const jsonData = JSON.parse(fileContent);
    
    // Check overall structure
    expect(jsonData).to.have.property("documents");
    expect(jsonData).to.have.property("metadata");
    expect(Object.keys(jsonData.documents)).to.have.length.at.least(numDocs);
    
    // Check metadata field properties
    expect(jsonData.metadata).to.have.property("path", testCollection);
    expect(jsonData.metadata).to.have.property("exportedTo");
    expect(jsonData.metadata).to.have.property("exportedAt");
    expect(jsonData.metadata).to.have.property("totalDocuments");
    expect(jsonData.metadata).to.have.property("includesSubcollections", false);
    
    // Verify document data is included
    for (let i = 0; i < numDocs; i++) {
      const docId = `doc-${i}`;
      expect(jsonData.documents).to.have.property(docId);
      expect(jsonData.documents[docId].data).to.have.property("name", `Document ${i}`);
      expect(jsonData.documents[docId].data).to.have.property("value", i * 10);
      expect(jsonData.documents[docId].data).to.have.property("isActive", i % 2 === 0);
      expect(jsonData.documents[docId].data.nested).to.deep.include({
        field1: `nested-value-${i}`,
        field2: i * 100
      });
      
      // Verify deeply nested objects worked
      expect(jsonData.documents[docId].data.deeplyNested.level1.level2.level3).to.equal(`nested-value-${i}`);
      
      // Verify arrays are included
      expect(jsonData.documents[docId].data.numericArray).to.be.an("array").with.length(3);
      expect(jsonData.documents[docId].data.numericArray[0]).to.equal(i);
      
      // Verify mixed arrays work
      expect(jsonData.documents[docId].data.mixedArray).to.be.an("array").with.length(4);
      
      // Verify timestamps are serialized with _firestore_type
      expect(jsonData.documents[docId].data.createdAt).to.have.property("_firestore_type", "timestamp");
      expect(jsonData.documents[docId].data.createdAt).to.have.property("value");
      
      // Verify GeoPoint is serialized correctly
      expect(jsonData.documents[docId].data.geoPoint).to.have.property("_firestore_type", "geopoint");
      expect(jsonData.documents[docId].data.geoPoint).to.have.property("latitude", i + 40);
      expect(jsonData.documents[docId].data.geoPoint).to.have.property("longitude", i - 70);
      
      // Verify DocumentReference is serialized correctly
      expect(jsonData.documents[docId].data.reference).to.have.property("_firestore_type", "reference");
      expect(jsonData.documents[docId].data.reference).to.have.property("path");
      expect(jsonData.documents[docId].data.reference.path).to.include(`${testCollection}/reference-doc-${i}`);
      
      // Verify Bytes are serialized correctly
      expect(jsonData.documents[docId].data.bytes).to.have.property("_firestore_type", "bytes");
      expect(jsonData.documents[docId].data.bytes).to.have.property("base64");
    }
    
    // Check special document with edge cases
    expect(jsonData.documents).to.have.property("special-doc");
    const specialDocData = jsonData.documents["special-doc"].data;
    
    // Check special characters are preserved
    expect(specialDocData.name).to.equal("Document with, special \"characters\" in it");
    expect(specialDocData.description).to.equal("Line 1\nLine 2\nLine 3");
    
    // Check array with special characters
    expect(specialDocData.tags).to.include("comma,tag");
    expect(specialDocData.tags).to.include("quotes\"tag");
    expect(specialDocData.tags).to.include("newline\ntag");
    
    // Check empty structures
    expect(specialDocData.emptyArray).to.be.an("array").that.is.empty;
    expect(specialDocData.emptyObject).to.be.an("object").that.is.empty;
    
    // Check primitive values
    expect(specialDocData.zeroValue).to.equal(0);
    expect(specialDocData.falseValue).to.equal(false);
    
    // Check special field types (GeoPoint and DocumentReference)
    expect(specialDocData.geoPoint).to.have.property("_firestore_type", "geopoint");
    expect(specialDocData.geoPoint).to.have.property("latitude", 37.7749);
    expect(specialDocData.geoPoint).to.have.property("longitude", -122.4194);
    
    // Document reference should be serialized with type identifier
    expect(specialDocData.reference).to.have.property("_firestore_type", "reference");
    expect(specialDocData.reference).to.have.property("path");
    expect(specialDocData.reference.path).to.include(testCollection);
    
    // Bytes should be serialized with type identifier
    expect(specialDocData.bytes).to.have.property("_firestore_type", "bytes");
    expect(specialDocData.bytes).to.have.property("base64");
    
    // Clean up temp file
    fs.unlinkSync(tempFilePath);
  });
  
  it("should export a collection to JSON with subcollections", async function() {
    const task = new JobTask({
      service: "firestore",
      command: "export-collection-json",
      input: {
        collectionPath: `firestore/(default)/data/${testCollection}`,
        bucketPathPrefix: exportPrefix,
        includeSubcollections: true
      }
    });
    
    // Execute the handler
    const context = createMockJobContext();
    const result = await handleExportCollectionJSON(task, context);
    
    // Verify response includes subcollections flag
    expect(result.includesSubcollections).to.be.true;
    
    // Download and verify file
    const tempFilePath = `/tmp/export-json-with-subcoll-${Date.now()}.json`;
    // Extract path from gs:// URL (result.exportedTo is "gs://bucket/path", we need just "path")
    const filePath = result.exportedTo.replace(/^gs:\/\/[^\/]+\//, '');
    await bucket.file(filePath).download({ destination: tempFilePath });
    
    // Parse and verify JSON content
    const jsonData = JSON.parse(fs.readFileSync(tempFilePath, "utf8"));
    
    // Check correct metadata
    expect(jsonData.metadata.includesSubcollections).to.be.true;
    
    // Check that subcollections are included
    for (let i = 0; i < numDocs; i++) {
      const docId = `doc-${i}`;
      expect(jsonData.documents[docId]).to.have.property("subcollections");
      expect(jsonData.documents[docId].subcollections).to.have.property("subcollection");
      
      // Check first level subcollection documents
      const subdocs = jsonData.documents[docId].subcollections.subcollection.documents;
      expect(subdocs).to.have.property(`subdoc-${i}-1`);
      expect(subdocs).to.have.property(`subdoc-${i}-2`);
      expect(subdocs[`subdoc-${i}-1`].data).to.have.property("subName", `Subdoc ${i}-1`);
      expect(subdocs[`subdoc-${i}-1`].data).to.have.property("subValue", i * 100 + 1);
      
      // Check that timestamps in subcollections are properly serialized
      expect(subdocs[`subdoc-${i}-1`].data.subTimestamp).to.have.property("_firestore_type", "timestamp");
      expect(subdocs[`subdoc-${i}-1`].data.subTimestamp).to.have.property("value");
      
      // Check nested subcollections (for even numbered documents)
      if (i % 2 === 0) {
        expect(subdocs[`subdoc-${i}-1`]).to.have.property("subcollections");
        expect(subdocs[`subdoc-${i}-1`].subcollections).to.have.property("nestedSubcoll");
        
        const nestedSubdocs = subdocs[`subdoc-${i}-1`].subcollections.nestedSubcoll.documents;
        expect(nestedSubdocs).to.have.property("nestedDoc");
        expect(nestedSubdocs.nestedDoc.data).to.have.property("nestedName", `Nested subcollection doc for ${i}`);
        expect(nestedSubdocs.nestedDoc.data).to.have.property("nestedValue", i * 1000);
        
        // Check that timestamps in nested subcollections are properly serialized
        expect(nestedSubdocs.nestedDoc.data.nestedTimestamp).to.have.property("_firestore_type", "timestamp");
        expect(nestedSubdocs.nestedDoc.data.nestedTimestamp).to.have.property("value");
      }
    }
    
    // Check for special doc subcollections (if they exist)
    if (jsonData.documents["special-doc"] && 
        jsonData.documents["special-doc"].subcollections && 
        jsonData.documents["special-doc"].subcollections.emptySubcoll) {
      expect(jsonData.documents["special-doc"].subcollections.emptySubcoll).to.have.property("documents");
    }
    
    // Clean up temp file
    fs.unlinkSync(tempFilePath);
  });
  
  it("should throw error with missing parameters", async function() {
    // Missing collectionPath
    const task1 = new JobTask({
      service: "firestore",
      command: "export-collection-json",
      input: {
        bucketPathPrefix: exportPrefix
      }
    });
    
    try {
      const context = createMockJobContext();
      await handleExportCollectionJSON(task1, context);
      expect.fail("Expected an error for missing collectionPath");
    } catch (error) {
      expect((error as Error).message).to.include("collectionPath and bucketPathPrefix are required");
    }
    
    // Missing bucketPathPrefix
    const task2 = new JobTask({
      service: "firestore",
      command: "export-collection-json",
      input: {
        collectionPath: `firestore/(default)/data/${testCollection}`
      }
    });
    
    try {
      const context = createMockJobContext();
      await handleExportCollectionJSON(task2, context);
      expect.fail("Expected an error for missing bucketPathPrefix");
    } catch (error) {
      expect((error as Error).message).to.include("collectionPath and bucketPathPrefix are required");
    }
  });
});