import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { admin } from "../../setup";
import { JobTask } from "../../../src/job/jobTask";
import { handleSetUserClaims } from "../../../src/job/handlers/authentication/setUserClaims";

describe("Firebase Admin Authentication Set User Claims Test", function() {
  this.timeout(10000);
  
  let testUserUid: string;
  
  before(async function() {
    // Create a test user
    const userRecord = await admin.auth().createUser({
      email: "test-claims-set@example.com",
      password: "securePassword123!",
      displayName: "Test Set Claims User"
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
  
  it("should set custom claims for a user", async function() {
    const customClaims = {
      role: "editor",
      level: 3,
      permissions: ["read", "write"]
    };
    
    const task = new JobTask({
      service: "authentication",
      command: "set-user-claims",
      input: {
        uid: testUserUid,
        customClaims: customClaims
      }
    });
    
    const result = await handleSetUserClaims(task);
    
    expect(result.uid).to.equal(testUserUid);
    expect(result.email).to.equal("test-claims-set@example.com");
    expect(result.customClaims).to.deep.equal(customClaims);
    expect(result.success).to.equal(true);
    expect(result.claimsUpdatedAt).to.be.a("string");
    
    // Verify claims were actually set
    const user = await admin.auth().getUser(testUserUid);
    expect(user.customClaims).to.deep.equal(customClaims);
  });
  
  it("should update existing custom claims", async function() {
    const updatedClaims = {
      role: "admin",
      level: 10,
      permissions: ["read", "write", "delete", "manage"],
      newField: "newValue"
    };
    
    const task = new JobTask({
      service: "authentication",
      command: "set-user-claims",
      input: {
        uid: testUserUid,
        customClaims: updatedClaims
      }
    });
    
    const result = await handleSetUserClaims(task);
    
    expect(result.customClaims).to.deep.equal(updatedClaims);
    expect(result.success).to.equal(true);
    
    // Verify old claims were replaced, not merged
    const user = await admin.auth().getUser(testUserUid);
    expect(user.customClaims).to.deep.equal(updatedClaims);
    expect(user.customClaims).to.not.have.property("permissions", ["read", "write"]);
  });
  
  it("should clear custom claims when null is provided", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "set-user-claims",
      input: {
        uid: testUserUid,
        customClaims: null
      }
    });
    
    const result = await handleSetUserClaims(task);
    
    expect(result.uid).to.equal(testUserUid);
    expect(result.customClaims).to.deep.equal({});
    expect(result.success).to.equal(true);
    
    // Verify claims were cleared (Firebase returns empty object when claims are cleared)
    const user = await admin.auth().getUser(testUserUid);
    expect(user.customClaims).to.deep.equal({});
  });
  
  it("should set empty object as custom claims", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "set-user-claims",
      input: {
        uid: testUserUid,
        customClaims: {}
      }
    });
    
    const result = await handleSetUserClaims(task);
    
    expect(result.customClaims).to.deep.equal({});
    expect(result.success).to.equal(true);
  });
  
  it("should set complex nested custom claims", async function() {
    const complexClaims = {
      organization: {
        id: "org123",
        name: "Test Organization",
        roles: ["member", "contributor"]
      },
      settings: {
        theme: "dark",
        notifications: {
          email: true,
          push: false
        }
      },
      tags: ["beta", "premium", "verified"]
    };
    
    const task = new JobTask({
      service: "authentication",
      command: "set-user-claims",
      input: {
        uid: testUserUid,
        customClaims: complexClaims
      }
    });
    
    const result = await handleSetUserClaims(task);
    
    expect(result.customClaims).to.deep.equal(complexClaims);
    expect(result.success).to.equal(true);
    
    // Verify complex claims were set correctly
    const user = await admin.auth().getUser(testUserUid);
    expect(user.customClaims).to.deep.equal(complexClaims);
  });
  
  it("should throw error when uid is missing", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "set-user-claims",
      input: {
        customClaims: { role: "test" }
      }
    });
    
    try {
      await handleSetUserClaims(task);
      throw new Error("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).to.equal("Invalid input: uid is required");
    }
  });
  
  it("should throw error when customClaims is undefined", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "set-user-claims",
      input: {
        uid: testUserUid
      }
    });
    
    try {
      await handleSetUserClaims(task);
      throw new Error("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).to.equal("Invalid input: customClaims is required (can be null to clear claims)");
    }
  });
  
  it("should throw error when user not found", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "set-user-claims",
      input: {
        uid: "non-existent-uid",
        customClaims: { role: "test" }
      }
    });
    
    try {
      await handleSetUserClaims(task);
      throw new Error("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).to.include("no user record");
    }
  });
});