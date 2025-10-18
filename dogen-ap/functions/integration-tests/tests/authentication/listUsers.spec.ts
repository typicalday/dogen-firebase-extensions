import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { admin } from "../../setup";
import { JobTask } from "../../../src/job/jobTask";
import { handleListUsers } from "../../../src/job/handlers/authentication/listUsers";
import { createMockJobContext } from "../../helpers/jobContextHelper";

describe("Firebase Admin Authentication List Users Test", function() {
  this.timeout(10000);
  
  const testUsers: string[] = [];
  
  before(async function() {
    // Create multiple test users
    for (let i = 0; i < 5; i++) {
      const userRecord = await admin.auth().createUser({
        email: `test-list-${i}@example.com`,
        password: "securePassword123!",
        displayName: `Test List User ${i}`
      });
      
      // Set custom claims separately
      await admin.auth().setCustomUserClaims(userRecord.uid, {
        testUser: true,
        index: i
      });
      
      testUsers.push(userRecord.uid);
    }
  });
  
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
  
  it("should list all users with default parameters", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "list-users",
      input: {}
    });
    
    const context = createMockJobContext();
    const result = await handleListUsers(task, context);
    
    expect(result).to.have.property("users");
    expect(result.users).to.be.an("array");
    expect(result.userCount).to.be.at.least(5);
    expect(result).to.have.property("hasMoreUsers");
    
    // Verify test users are in the list
    const testUserEmails = testUsers.map((_, i) => `test-list-${i}@example.com`);
    const resultEmails = result.users.map((u: any) => u.email).filter((e: string) => e);
    
    for (const email of testUserEmails) {
      expect(resultEmails).to.include(email);
    }
  });
  
  it("should list users with custom maxResults", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "list-users",
      input: {
        maxResults: 3
      }
    });
    
    const context = createMockJobContext();
    const result = await handleListUsers(task, context);
    
    expect(result.users).to.have.length.at.most(3);
    expect(result.userCount).to.equal(result.users.length);
    
    // Each user should have expected properties
    for (const user of result.users) {
      expect(user).to.have.property("uid");
      expect(user.creationTime).to.be.a("string");
    }
  });
  
  it("should support pagination with pageToken", async function() {
    // First request
    const task1 = new JobTask({
      service: "authentication",
      command: "list-users",
      input: {
        maxResults: 2
      }
    });

    const context = createMockJobContext();
    const result1 = await handleListUsers(task1, context);

    expect(result1.users).to.have.length(2);

    if (result1.pageToken) {
      // Second request with pageToken
      const task2 = new JobTask({
        service: "authentication",
        command: "list-users",
        input: {
          maxResults: 2,
          pageToken: result1.pageToken
        }
      });

      const result2 = await handleListUsers(task2, context);

      expect(result2.users).to.have.length.at.least(1);

      // Verify we got different users
      const uids1 = result1.users.map((u: any) => u.uid);
      const uids2 = result2.users.map((u: any) => u.uid);

      for (const uid of uids2) {
        expect(uids1).to.not.include(uid);
      }
    }
  });
  
  it("should include user metadata and custom claims", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "list-users",
      input: {
        maxResults: 10
      }
    });
    
    const context = createMockJobContext();
    const result = await handleListUsers(task, context);
    
    // Find one of our test users
    const testUser = result.users.find((u: any) => 
      u.email && u.email.startsWith("test-list-")
    );
    
    expect(testUser).to.exist;
    expect(testUser.customClaims).to.have.property("testUser", true);
    expect(testUser.customClaims).to.have.property("index");
    expect(testUser.creationTime).to.be.a("string");
    expect(testUser.lastSignInTime).to.be.a("string");
    expect(testUser).to.have.property("providerData");
  });
  
  it("should handle empty pageToken correctly", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "list-users",
      input: {
        maxResults: 5,
        pageToken: undefined
      }
    });
    
    const context = createMockJobContext();
    const result = await handleListUsers(task, context);
    
    expect(result.users).to.be.an("array");
    expect(result.userCount).to.be.at.least(0);
  });
});