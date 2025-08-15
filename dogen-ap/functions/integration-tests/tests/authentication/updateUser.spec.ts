import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { admin } from "../../setup";
import { JobTask } from "../../../src/job/jobTask";
import { handleUpdateUser } from "../../../src/job/handlers/authentication/updateUser";

describe("Firebase Admin Authentication Update User Test", function() {
  this.timeout(10000);
  
  let testUserUid: string;
  
  before(async function() {
    // Create a test user
    const userRecord = await admin.auth().createUser({
      email: "test-update@example.com",
      password: "initialPassword123!",
      displayName: "Initial Name",
      emailVerified: false,
      disabled: false
    });
    testUserUid = userRecord.uid;
  });
  
  after(async function() {
    // Clean up test user
    try {
      await admin.auth().deleteUser(testUserUid);
    } catch (error) {
      console.error("Cleanup error:", error);
    }
  });
  
  it("should update user email", async function() {
    const updateRequest = {
      email: "updated-email@example.com"
    };
    
    const task = new JobTask({
      service: "authentication",
      command: "update-user",
      input: {
        uid: testUserUid,
        updateRequest: updateRequest
      }
    });
    
    const result = await handleUpdateUser(task);
    
    expect(result.uid).to.equal(testUserUid);
    expect(result.email).to.equal("updated-email@example.com");
  });
  
  it("should update user display name and photo URL", async function() {
    const updateRequest = {
      displayName: "Updated Name",
      photoURL: "https://example.com/photo.jpg"
    };
    
    const task = new JobTask({
      service: "authentication",
      command: "update-user",
      input: {
        uid: testUserUid,
        updateRequest: updateRequest
      }
    });
    
    const result = await handleUpdateUser(task);
    
    expect(result.uid).to.equal(testUserUid);
    expect(result.displayName).to.equal("Updated Name");
    expect(result.photoURL).to.equal("https://example.com/photo.jpg");
  });
  
  it("should update user phone number", async function() {
    const updateRequest = {
      phoneNumber: "+1234567892"
    };
    
    const task = new JobTask({
      service: "authentication",
      command: "update-user",
      input: {
        uid: testUserUid,
        updateRequest: updateRequest
      }
    });
    
    const result = await handleUpdateUser(task);
    
    expect(result.uid).to.equal(testUserUid);
    expect(result.phoneNumber).to.equal("+1234567892");
  });
  
  it("should update user email verification status", async function() {
    const updateRequest = {
      emailVerified: true
    };
    
    const task = new JobTask({
      service: "authentication",
      command: "update-user",
      input: {
        uid: testUserUid,
        updateRequest: updateRequest
      }
    });
    
    const result = await handleUpdateUser(task);
    
    expect(result.uid).to.equal(testUserUid);
    expect(result.emailVerified).to.equal(true);
  });
  
  it("should disable user account", async function() {
    const updateRequest = {
      disabled: true
    };
    
    const task = new JobTask({
      service: "authentication",
      command: "update-user",
      input: {
        uid: testUserUid,
        updateRequest: updateRequest
      }
    });
    
    const result = await handleUpdateUser(task);
    
    expect(result.uid).to.equal(testUserUid);
    expect(result.disabled).to.equal(true);
  });
  
  it("should update user password", async function() {
    const updateRequest = {
      password: "newSecurePassword456!"
    };
    
    const task = new JobTask({
      service: "authentication",
      command: "update-user",
      input: {
        uid: testUserUid,
        updateRequest: updateRequest
      }
    });
    
    const result = await handleUpdateUser(task);
    
    expect(result.uid).to.equal(testUserUid);
    // Password is not returned in the result, so we just verify the update succeeded
  });
  
  it("should update user with custom claims", async function() {
    const updateRequest = {
      displayName: "User with Claims"
    };
    
    const customClaims = {
      role: "editor",
      level: 3,
      permissions: ["read", "write"]
    };
    
    const task = new JobTask({
      service: "authentication",
      command: "update-user",
      input: {
        uid: testUserUid,
        updateRequest: updateRequest,
        customClaims: customClaims
      }
    });
    
    const result = await handleUpdateUser(task);
    
    expect(result.uid).to.equal(testUserUid);
    expect(result.displayName).to.equal("User with Claims");
    expect(result.customClaims).to.deep.equal(customClaims);
    
    // Verify claims by fetching user directly from Firebase Auth SDK
    const userFromAuth = await admin.auth().getUser(testUserUid);
    expect(userFromAuth.customClaims).to.deep.equal(customClaims);
  });
  
  it("should update only custom claims without other changes", async function() {
    const customClaims = {
      role: "viewer",
      level: 1
    };
    
    const task = new JobTask({
      service: "authentication",
      command: "update-user",
      input: {
        uid: testUserUid,
        updateRequest: {}, // Empty update request
        customClaims: customClaims
      }
    });
    
    const result = await handleUpdateUser(task);
    
    expect(result.uid).to.equal(testUserUid);
    expect(result.customClaims).to.deep.equal(customClaims);
    
    // Verify claims by fetching user directly from Firebase Auth SDK
    const userFromAuth = await admin.auth().getUser(testUserUid);
    expect(userFromAuth.customClaims).to.deep.equal(customClaims);
  });
  
  it("should clear custom claims when null is provided", async function() {
    const updateRequest = {
      displayName: "User with Cleared Claims"
    };
    
    const task = new JobTask({
      service: "authentication",
      command: "update-user",
      input: {
        uid: testUserUid,
        updateRequest: updateRequest,
        customClaims: null
      }
    });
    
    const result = await handleUpdateUser(task);
    
    expect(result.uid).to.equal(testUserUid);
    expect(result.displayName).to.equal("User with Cleared Claims");
    expect(result.customClaims).to.be.undefined;
    
    // Verify claims are cleared by fetching user directly from Firebase Auth SDK
    const userFromAuth = await admin.auth().getUser(testUserUid);
    // Firebase returns empty object when claims are cleared
    expect(userFromAuth.customClaims).to.satisfy((claims: any) => 
      claims === undefined || (typeof claims === 'object' && Object.keys(claims).length === 0)
    );
  });
  
  it("should throw error when uid is missing", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "update-user",
      input: {
        updateRequest: { displayName: "Test" }
      }
    });
    
    try {
      await handleUpdateUser(task);
      throw new Error("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).to.equal("Invalid input: uid is required");
    }
  });
  
  it("should throw error when updateRequest is missing", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "update-user",
      input: {
        uid: testUserUid
      }
    });
    
    try {
      await handleUpdateUser(task);
      throw new Error("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).to.equal("Invalid input: updateRequest is required");
    }
  });
  
  it("should throw error when updating non-existent user", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "update-user",
      input: {
        uid: "non-existent-uid",
        updateRequest: { displayName: "Test" }
      }
    });
    
    try {
      await handleUpdateUser(task);
      throw new Error("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).to.include("no user record");
    }
  });
});