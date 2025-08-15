import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { admin } from "../../setup";
import { JobTask } from "../../../src/job/jobTask";
import { handleGetUserClaims } from "../../../src/job/handlers/authentication/getUserClaims";

describe("Firebase Admin Authentication Get User Claims Test", function() {
  this.timeout(10000);
  
  let testUserUid: string;
  let userWithoutClaims: string;
  
  before(async function() {
    // Create a test user with custom claims
    const userRecord = await admin.auth().createUser({
      email: "test-claims-get@example.com",
      password: "securePassword123!",
      displayName: "Test Claims User"
    });
    
    // Set custom claims separately
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      role: "admin",
      level: 5,
      permissions: ["read", "write", "delete"],
      metadata: {
        department: "engineering",
        team: "backend"
      }
    });
    testUserUid = userRecord.uid;
    
    // Create a user without custom claims
    const userRecord2 = await admin.auth().createUser({
      email: "test-no-claims@example.com",
      password: "securePassword123!"
    });
    userWithoutClaims = userRecord2.uid;
  });
  
  after(async function() {
    // Clean up test users
    try {
      await admin.auth().deleteUser(testUserUid);
      await admin.auth().deleteUser(userWithoutClaims);
    } catch (error) {
      console.error("Cleanup error:", error);
    }
  });
  
  it("should get custom claims for a user with claims", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "get-user-claims",
      input: {
        uid: testUserUid
      }
    });
    
    const result = await handleGetUserClaims(task);
    
    expect(result.uid).to.equal(testUserUid);
    expect(result.email).to.equal("test-claims-get@example.com");
    expect(result.customClaims).to.deep.equal({
      role: "admin",
      level: 5,
      permissions: ["read", "write", "delete"],
      metadata: {
        department: "engineering",
        team: "backend"
      }
    });
    expect(result.claimsRetrievedAt).to.be.a("string");
  });
  
  it("should return empty object for user without claims", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "get-user-claims",
      input: {
        uid: userWithoutClaims
      }
    });
    
    const result = await handleGetUserClaims(task);
    
    expect(result.uid).to.equal(userWithoutClaims);
    expect(result.email).to.equal("test-no-claims@example.com");
    expect(result.customClaims).to.deep.equal({});
    expect(result.claimsRetrievedAt).to.be.a("string");
  });
  
  it("should throw error when uid is missing", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "get-user-claims",
      input: {}
    });
    
    try {
      await handleGetUserClaims(task);
      throw new Error("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).to.equal("Invalid input: uid is required");
    }
  });
  
  it("should throw error when user not found", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "get-user-claims",
      input: {
        uid: "non-existent-uid"
      }
    });
    
    try {
      await handleGetUserClaims(task);
      throw new Error("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).to.include("no user record");
    }
  });
});