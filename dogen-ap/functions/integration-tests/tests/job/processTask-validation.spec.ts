/**
 * Tests for processTask input validation
 *
 * Tests that ALL task inputs are validated before execution using validateTaskInput(),
 * not just orchestrator-generated tasks.
 */

import { describe, it } from "mocha";
import { expect } from "chai";
import { validateTaskInput } from "../../../src/job/handlers/ai/orchestrate/validator";

describe("processTask Input Validation (via validateTaskInput)", () => {
  describe("Schema Validation - Invalid Input Format", () => {
    it("should reject task with invalid path format for firestore/copy-collection", () => {
      const errors = validateTaskInput(
        "firestore",
        "copy-collection",
        {
          sourcePath: "invalid-path", // Should match pattern firestore/{database}/data/{collection}
          destinationPath: "firestore/(default)/data/dest",
        }
      );

      expect(errors).to.not.be.empty;
      expect(errors.join(" ")).to.include("must match pattern");
      expect(errors.join(" ")).to.include("sourcePath");
    });

    it("should reject task with invalid path format for firestore/create-document", () => {
      const errors = validateTaskInput(
        "firestore",
        "create-document",
        {
          documentPath: "not-a-firestore-path", // Should match pattern
          documentData: { name: "Test" },
        }
      );

      expect(errors).to.not.be.empty;
      expect(errors.join(" ")).to.include("must match pattern");
      expect(errors.join(" ")).to.include("documentPath");
    });

    it("should reject task with wrong data type", () => {
      const errors = validateTaskInput(
        "firestore",
        "create-document",
        {
          documentPath: "firestore/(default)/data/test/doc1",
          documentData: "not-an-object", // Should be object
        }
      );

      expect(errors).to.not.be.empty;
      expect(errors.join(" ")).to.include("must be object");
      expect(errors.join(" ")).to.include("documentData");
    });

    it("should reject task with out-of-range temperature", () => {
      const errors = validateTaskInput(
        "ai",
        "orchestrate",
        {
          prompt: "Test prompt",
          temperature: 2.5, // Should be 0.0-1.0
        }
      );

      expect(errors).to.not.be.empty;
      expect(errors.join(" ")).to.include("must be <=");
      expect(errors.join(" ")).to.include("temperature");
    });

    it("should reject task with invalid email format", () => {
      const errors = validateTaskInput(
        "authentication",
        "create-user",
        {
          userRecord: {
            email: "not-an-email", // Invalid email format
            password: "password123",
          }
        }
      );

      expect(errors).to.not.be.empty;
      expect(errors.join(" ")).to.include("must match pattern");
      expect(errors.join(" ")).to.include("email");
    });

    it("should reject task with unexpected parameters", () => {
      const errors = validateTaskInput(
        "firestore",
        "copy-collection",
        {
          sourcePath: "firestore/(default)/data/users",
          destinationPath: "firestore/(default)/data/users_backup",
          unexpectedParam: "should not be here", // Not in schema
        }
      );

      expect(errors).to.not.be.empty;
      expect(errors.join(" ")).to.include("must NOT have additional properties");
    });
  });

  describe("Required Parameters Validation", () => {
    it("should reject task with missing required parameter", () => {
      const errors = validateTaskInput(
        "firestore",
        "copy-collection",
        {
          sourcePath: "firestore/(default)/data/users",
          // Missing destinationPath
        }
      );

      expect(errors).to.not.be.empty;
      expect(errors.join(" ")).to.include("must have required property");
      expect(errors.join(" ")).to.include("destinationPath");
    });

    it("should reject task with multiple missing parameters", () => {
      const errors = validateTaskInput(
        "firestore",
        "copy-collection",
        {
          // Missing both sourcePath and destinationPath
        }
      );

      expect(errors).to.not.be.empty;
      expect(errors.join(" ")).to.include("must have required property");
      expect(errors.join(" ")).to.include("sourcePath");
      expect(errors.join(" ")).to.include("destinationPath");
    });

    it("should reject task with missing prompt for orchestrate", () => {
      const errors = validateTaskInput(
        "ai",
        "orchestrate",
        {
          // Missing prompt
          temperature: 0.5,
        }
      );

      expect(errors).to.not.be.empty;
      expect(errors.join(" ")).to.include("must have required property");
      expect(errors.join(" ")).to.include("prompt");
    });

    it("should reject task with missing email for create-user", () => {
      const errors = validateTaskInput(
        "authentication",
        "create-user",
        {
          userRecord: {
            password: "password123",
            // Missing email
          }
        }
      );

      expect(errors).to.not.be.empty;
      expect(errors.join(" ")).to.include("must have required property");
      expect(errors.join(" ")).to.include("email");
    });

    it("should reject task with missing password for create-user", () => {
      const errors = validateTaskInput(
        "authentication",
        "create-user",
        {
          userRecord: {
            email: "test@example.com",
            // Missing password
          }
        }
      );

      expect(errors).to.not.be.empty;
      expect(errors.join(" ")).to.include("must have required property");
      expect(errors.join(" ")).to.include("password");
    });
  });

  describe("Valid Input - Should Pass Validation", () => {
    it("should accept task with valid firestore/copy-collection input", () => {
      const errors = validateTaskInput(
        "firestore",
        "copy-collection",
        {
          sourcePath: "firestore/(default)/data/users",
          destinationPath: "firestore/(default)/data/users_backup",
        }
      );

      expect(errors).to.be.empty;
    });

    it("should accept task with valid authentication/create-user input", () => {
      const errors = validateTaskInput(
        "authentication",
        "create-user",
        {
          userRecord: {
            email: "testuser@example.com",
            password: "securePassword123",
          }
        }
      );

      expect(errors).to.be.empty;
    });

    it("should accept handler without schema (storage/delete-path)", () => {
      const errors = validateTaskInput(
        "storage",
        "delete-path",
        {
          path: "gs://test-bucket/temp/",
        }
      );

      expect(errors).to.be.empty;
    });

    it("should accept task with optional parameters", () => {
      const errors = validateTaskInput(
        "ai",
        "orchestrate",
        {
          prompt: "Test prompt",
          temperature: 0.7,
          maxRetries: 3,
          maxChildTasks: 10,
        }
      );

      expect(errors).to.be.empty;
    });

    it("should accept task with valid firestore/create-document input", () => {
      const errors = validateTaskInput(
        "firestore",
        "create-document",
        {
          documentPath: "firestore/(default)/data/test/doc1",
          documentData: { name: "Test", value: 123 },
        }
      );

      expect(errors).to.be.empty;
    });

    it("should accept authentication/create-user with optional displayName", () => {
      const errors = validateTaskInput(
        "authentication",
        "create-user",
        {
          userRecord: {
            email: "test@example.com",
            password: "password123",
            displayName: "Test User",
          }
        }
      );

      expect(errors).to.be.empty;
    });
  });

  describe("Edge Cases", () => {
    it("should reject unknown service/command", () => {
      const errors = validateTaskInput(
        "unknown-service",
        "unknown-command",
        {}
      );

      expect(errors).to.not.be.empty;
      expect(errors[0]).to.include("Unknown service/command");
      expect(errors[0]).to.include("unknown-service/unknown-command");
    });

    it("should handle empty input object", () => {
      const errors = validateTaskInput(
        "firestore",
        "list-collections",
        {}
      );

      // list-collections has no required parameters
      expect(errors).to.be.empty;
    });

    it("should validate number minimum constraint", () => {
      const errors = validateTaskInput(
        "ai",
        "orchestrate",
        {
          prompt: "Test",
          maxRetries: -1, // Should be >= 0
        }
      );

      expect(errors).to.not.be.empty;
      expect(errors.join(" ")).to.include("must be >=");
      expect(errors.join(" ")).to.include("maxRetries");
    });

    it("should validate number maximum constraint", () => {
      const errors = validateTaskInput(
        "ai",
        "orchestrate",
        {
          prompt: "Test",
          timeout: 500000, // Should be <= 300000
        }
      );

      expect(errors).to.not.be.empty;
      expect(errors.join(" ")).to.include("must be <=");
      expect(errors.join(" ")).to.include("timeout");
    });

    it("should report multiple validation errors", () => {
      const errors = validateTaskInput(
        "firestore",
        "copy-collection",
        {
          sourcePath: "invalid-source",
          destinationPath: "invalid-dest",
          unexpectedParam: "not allowed",
        }
      );

      expect(errors.length).to.be.greaterThan(1);
      expect(errors.join(" ")).to.include("must match pattern");
      expect(errors.join(" ")).to.include("must NOT have additional properties");
    });

    it("should accept both required and optional parameters", () => {
      const errors = validateTaskInput(
        "authentication",
        "create-user",
        {
          userRecord: {
            email: "test@example.com",
            password: "password123",
            displayName: "Test User",
            disabled: false,
          }
        }
      );

      expect(errors).to.be.empty;
    });

    it("should validate path patterns correctly", () => {
      const errors = validateTaskInput(
        "firestore",
        "copy-collection",
        {
          sourcePath: "firestore/(custom-db)/data/collection",
          destinationPath: "firestore/(default)/data/dest",
        }
      );

      expect(errors).to.be.empty;
    });

    it("should validate email patterns strictly", () => {
      const invalidEmails = [
        "notanemail",
        "@example.com",
        "test@",
        "test space@example.com",
      ];

      invalidEmails.forEach(email => {
        const errors = validateTaskInput(
          "authentication",
          "create-user",
          {
            userRecord: {
              email: email,
              password: "password123",
            }
          }
        );

        expect(errors).to.not.be.empty;
        expect(errors.join(" ")).to.include("must match pattern");
      });
    });

    it("should accept valid email patterns", () => {
      const validEmails = [
        "test@example.com",
        "user.name@domain.co.uk",
        "first+last@example.com",
      ];

      validEmails.forEach(email => {
        const errors = validateTaskInput(
          "authentication",
          "create-user",
          {
            userRecord: {
              email: email,
              password: "password123",
            }
          }
        );

        expect(errors).to.be.empty;
      });
    });
  });

  describe("Schema Coverage", () => {
    it("should validate firestore/copy-collection schema", () => {
      // Valid input
      expect(validateTaskInput("firestore", "copy-collection", {
        sourcePath: "firestore/(default)/data/src",
        destinationPath: "firestore/(default)/data/dest",
      })).to.be.empty;

      // Invalid - wrong pattern
      expect(validateTaskInput("firestore", "copy-collection", {
        sourcePath: "invalid",
        destinationPath: "firestore/(default)/data/dest",
      })).to.not.be.empty;
    });

    it("should validate firestore/create-document schema", () => {
      // Valid input
      expect(validateTaskInput("firestore", "create-document", {
        documentPath: "firestore/(default)/data/test/doc1",
        documentData: { key: "value" },
      })).to.be.empty;

      // Invalid - wrong type for data
      expect(validateTaskInput("firestore", "create-document", {
        documentPath: "firestore/(default)/data/test/doc1",
        documentData: "not an object",
      })).to.not.be.empty;
    });

    it("should validate ai/orchestrate schema", () => {
      // Valid input with all optional params
      expect(validateTaskInput("ai", "orchestrate", {
        prompt: "Test",
        maxRetries: 3,
        temperature: 0.5,
        maxChildTasks: 100,
        timeout: 60000,
        maxDepth: 10,
      })).to.be.empty;

      // Invalid - out of range
      expect(validateTaskInput("ai", "orchestrate", {
        prompt: "Test",
        temperature: 2.0, // > 1.0
      })).to.not.be.empty;
    });

    it("should validate authentication/create-user schema", () => {
      // Valid input
      expect(validateTaskInput("authentication", "create-user", {
        userRecord: {
          email: "test@example.com",
          password: "password123",
          displayName: "Test",
          disabled: false,
        }
      })).to.be.empty;

      // Invalid - bad email
      expect(validateTaskInput("authentication", "create-user", {
        userRecord: {
          email: "invalid-email",
          password: "password123",
        }
      })).to.not.be.empty;
    });
  });
});
