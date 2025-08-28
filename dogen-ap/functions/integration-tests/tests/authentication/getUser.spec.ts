import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { admin } from "../../setup";
import { JobTask } from "../../../src/job/jobTask";
import { handleGetUser } from "../../../src/job/handlers/authentication/getUser";

describe("Firebase Admin Authentication Get User Test", function() {
  this.timeout(10000);
  
  let testUserUid: string;
  const testEmail = "test-read@example.com";
  const testPhoneNumber = "+1234567891";
  
  before(async function() {
    // Create a test user
    const userRecord = await admin.auth().createUser({
      email: testEmail,
      password: "securePassword123!",
      phoneNumber: testPhoneNumber,
      displayName: "Test Read User",
      emailVerified: true,
      disabled: false
    });
    testUserUid = userRecord.uid;
    
    // Set custom claims separately
    await admin.auth().setCustomUserClaims(testUserUid, {
      testClaim: "testValue"
    });
  });
  
  after(async function() {
    // Clean up test user
    try {
      await admin.auth().deleteUser(testUserUid);
    } catch (error) {
      console.error("Cleanup error:", error);
    }
  });
  
  it("should read a user by UID", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "get-user",
      input: {
        uid: testUserUid
      }
    });
    
    const result = await handleGetUser(task);
    
    expect(result.uid).to.equal(testUserUid);
    expect(result.email).to.equal(testEmail);
    expect(result.phoneNumber).to.equal(testPhoneNumber);
    expect(result.displayName).to.equal("Test Read User");
    expect(result.emailVerified).to.equal(true);
    expect(result.disabled).to.equal(false);
    expect(result.customClaims).to.deep.equal({ testClaim: "testValue" });
    expect(result.creationTime).to.be.a("string");
    expect(result.lastSignInTime).to.be.a("string");
  });
  
  it("should read a user by email", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "get-user",
      input: {
        email: testEmail
      }
    });
    
    const result = await handleGetUser(task);
    
    expect(result.uid).to.equal(testUserUid);
    expect(result.email).to.equal(testEmail);
    expect(result.phoneNumber).to.equal(testPhoneNumber);
  });
  
  it("should read a user by phone number", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "get-user",
      input: {
        phoneNumber: testPhoneNumber
      }
    });
    
    const result = await handleGetUser(task);
    
    expect(result.uid).to.equal(testUserUid);
    expect(result.email).to.equal(testEmail);
    expect(result.phoneNumber).to.equal(testPhoneNumber);
  });
  
  it("should throw error when no identifier is provided", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "get-user",
      input: {}
    });
    
    try {
      await handleGetUser(task);
      throw new Error("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).to.equal("Invalid input: uid, email, or phoneNumber is required");
    }
  });
  
  it("should throw error when user not found by UID", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "get-user",
      input: {
        uid: "non-existent-uid"
      }
    });
    
    try {
      await handleGetUser(task);
      throw new Error("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).to.include("no user record");
    }
  });
  
  it("should throw error when user not found by email", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "get-user",
      input: {
        email: "nonexistent@example.com"
      }
    });
    
    try {
      await handleGetUser(task);
      throw new Error("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).to.include("no user record");
    }
  });
});