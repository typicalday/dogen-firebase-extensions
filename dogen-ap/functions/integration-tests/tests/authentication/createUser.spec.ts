import { describe, it, after } from "mocha";
import { expect } from "chai";
import { admin } from "../../setup";
import { JobTask } from "../../../src/job/jobTask";
import { handleCreateUser } from "../../../src/job/handlers/authentication/createUser";
import { createMockJobContext } from "../../helpers/jobContextHelper";

describe("Firebase Admin Authentication Create User Test", function() {
  this.timeout(10000);
  
  const testUsers: string[] = [];
  
  after(async function() {
    // Clean up test users
    for (const uid of testUsers) {
      try {
        await admin.auth().deleteUser(uid);
      } catch (error) {
        console.error(`Cleanup error for user ${uid}:`, error);
      }
    }
  });
  
  it("should create a user with email and password", async function() {
    const userRecord = {
      email: "test-create@example.com",
      password: "securePassword123!",
      displayName: "Test User",
      emailVerified: false,
      disabled: false
    };

    const task = new JobTask({
      service: "authentication",
      command: "create-user",
      input: {
        userRecord: userRecord
      }
    });

    const context = createMockJobContext();
    const result = await handleCreateUser(task, context);
    
    expect(result).to.have.property("uid");
    expect(result.email).to.equal(userRecord.email);
    expect(result.emailVerified).to.equal(false);
    expect(result.disabled).to.equal(false);
    expect(result.creationTime).to.be.a("string");
    
    testUsers.push(result.uid);
  });
  
  it("should create a user with phone number", async function() {
    const userRecord = {
      phoneNumber: "+1234567890",
      displayName: "Phone User"
    };
    
    const task = new JobTask({
      service: "authentication",
      command: "create-user",
      input: {
        userRecord: userRecord
      }
    });
    
    const context = createMockJobContext();
    const result = await handleCreateUser(task, context);
    
    expect(result).to.have.property("uid");
    expect(result.phoneNumber).to.equal(userRecord.phoneNumber);
    expect(result.creationTime).to.be.a("string");
    
    testUsers.push(result.uid);
  });
  
  it("should create a user with custom claims", async function() {
    const userRecord = {
      email: "test-claims@example.com",
      password: "securePassword123!"
    };
    
    const customClaims = {
      role: "admin",
      level: 5
    };
    
    const task = new JobTask({
      service: "authentication",
      command: "create-user",
      input: {
        userRecord: userRecord,
        customClaims: customClaims
      }
    });
    
    const context = createMockJobContext();
    const result = await handleCreateUser(task, context);
    
    expect(result).to.have.property("uid");
    expect(result.customClaims).to.deep.equal(customClaims);
    
    // Verify claims by fetching user directly from Firebase Auth SDK
    const userFromAuth = await admin.auth().getUser(result.uid);
    expect(userFromAuth.customClaims).to.deep.equal(customClaims);
    
    testUsers.push(result.uid);
  });
  
  it("should create a user without custom claims when none provided", async function() {
    const userRecord = {
      email: "test-no-claims@example.com",
      password: "securePassword123!"
    };
    
    const task = new JobTask({
      service: "authentication",
      command: "create-user",
      input: {
        userRecord: userRecord
        // No customClaims provided
      }
    });
    
    const context = createMockJobContext();
    const result = await handleCreateUser(task, context);
    
    expect(result).to.have.property("uid");
    expect(result.customClaims).to.be.undefined;
    
    // Verify no claims by fetching user directly from Firebase Auth SDK
    const userFromAuth = await admin.auth().getUser(result.uid);
    expect(userFromAuth.customClaims).to.be.undefined;
    
    testUsers.push(result.uid);
  });
  
  it("should throw error when userRecord is missing", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "create-user",
      input: {}
    });

    const context = createMockJobContext();

    try {
      await handleCreateUser(task, context);
      throw new Error("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).to.equal("Invalid input: userRecord is required");
    }
  });
  
  it("should throw error when creating duplicate email", async function() {
    const userRecord = {
      email: "duplicate@example.com",
      password: "securePassword123!"
    };
    
    const task1 = new JobTask({
      service: "authentication",
      command: "create-user",
      input: {
        userRecord: userRecord
      }
    });

    const context = createMockJobContext();

    const result1 = await handleCreateUser(task1, context);
    testUsers.push(result1.uid);

    const task2 = new JobTask({
      service: "authentication",
      command: "create-user",
      input: {
        userRecord: userRecord
      }
    });

    try {
      await handleCreateUser(task2, context);
      throw new Error("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).to.include("already in use");
    }
  });
});