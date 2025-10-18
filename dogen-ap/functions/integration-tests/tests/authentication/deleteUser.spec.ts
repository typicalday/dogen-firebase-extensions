import { describe, it } from "mocha";
import { expect } from "chai";
import { admin } from "../../setup";
import { JobTask } from "../../../src/job/jobTask";
import { handleDeleteUser } from "../../../src/job/handlers/authentication/deleteUser";
import { createMockJobContext } from "../../helpers/jobContextHelper";

describe("Firebase Admin Authentication Delete User Test", function() {
  this.timeout(10000);
  
  it("should delete an existing user", async function() {
    // First create a user to delete
    const userRecord = await admin.auth().createUser({
      email: "test-delete@example.com",
      password: "securePassword123!",
      displayName: "Delete Test User"
    });
    
    const task = new JobTask({
      service: "authentication",
      command: "delete-user",
      input: {
        uid: userRecord.uid
      }
    });
    
    const context = createMockJobContext();
    const result = await handleDeleteUser(task, context);
    
    expect(result.deletedUid).to.equal(userRecord.uid);
    expect(result.deletedEmail).to.equal("test-delete@example.com");
    expect(result.success).to.equal(true);
    expect(result.deletedAt).to.be.a("string");
    
    // Verify user was actually deleted
    try {
      await admin.auth().getUser(userRecord.uid);
      throw new Error("User should have been deleted");
    } catch (error: any) {
      expect(error.message).to.include("no user record");
    }
  });
  
  it("should handle deletion of user without email", async function() {
    // Create a user with phone number only
    const userRecord = await admin.auth().createUser({
      phoneNumber: "+1234567893",
      displayName: "Phone Only User"
    });
    
    const task = new JobTask({
      service: "authentication",
      command: "delete-user",
      input: {
        uid: userRecord.uid
      }
    });
    
    const context = createMockJobContext();
    const result = await handleDeleteUser(task, context);
    
    expect(result.deletedUid).to.equal(userRecord.uid);
    expect(result.deletedEmail).to.be.undefined;
    expect(result.success).to.equal(true);
  });
  
  it("should throw error when uid is missing", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "delete-user",
      input: {}
    });

    const context = createMockJobContext();
    try {
      await handleDeleteUser(task, context);
      throw new Error("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).to.equal("Invalid input: uid is required");
    }
  });
  
  it("should throw error when deleting non-existent user", async function() {
    const task = new JobTask({
      service: "authentication",
      command: "delete-user",
      input: {
        uid: "non-existent-uid"
      }
    });

    const context = createMockJobContext();
    try {
      await handleDeleteUser(task, context);
      throw new Error("Should have thrown an error");
    } catch (error: any) {
      expect(error.message).to.include("no user record");
    }
  });
});