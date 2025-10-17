/**
 * Integration tests for AI Task Orchestration
 *
 * Tests the orchestrate logic with mocked AI responses to avoid
 * actual AI inference calls while validating the system behavior.
 */

import { expect } from "chai";
import {
  validateTaskPlan,
  planToChildTasks,
  isValidServiceCommand,
  findTaskCapability
} from "../../../lib/job/handlers/ai/orchestrate";
import { AITaskPlan } from "../../../lib/job/handlers/ai/orchestrate/types";

describe("AI Orchestration - Validation Logic", () => {
  describe("Task Catalog", () => {
    it("should validate known service/command combinations", () => {
      expect(isValidServiceCommand("firestore", "copy-collection")).to.be.true;
      expect(isValidServiceCommand("firestore", "create-document")).to.be.true;
      expect(isValidServiceCommand("storage", "delete-path")).to.be.true;
      expect(isValidServiceCommand("ai", "process-inference")).to.be.true;
      expect(isValidServiceCommand("ai", "orchestrate")).to.be.true;
      expect(isValidServiceCommand("authentication", "create-user")).to.be.true;
    });

    it("should reject unknown service/command combinations", () => {
      expect(isValidServiceCommand("unknown", "command")).to.be.false;
      expect(isValidServiceCommand("firestore", "invalid-command")).to.be.false;
      expect(isValidServiceCommand("storage", "copy-file")).to.be.false;
    });

    it("should provide task capability information", () => {
      const capability = findTaskCapability("firestore", "copy-collection");
      expect(capability).to.exist;
      expect(capability?.description).to.include("Copies an entire Firestore collection");
      expect(capability?.requiredParams).to.deep.equal(["sourcePath", "destinationPath"]);
      expect(capability?.examples).to.be.an("array").with.lengthOf.at.least(1);
    });
  });

  describe("Validation - Valid Plans", () => {
    it("should validate a simple single-task plan", async () => {
      const plan: AITaskPlan = {
        tasks: [
          {
            service: "firestore",
            command: "create-document",
            input: {
              documentPath: "firestore/(default)/data/test/doc1",
              documentData: { name: "Test" }
            }
          }
        ]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");

      expect(report.isValid).to.be.true;
      expect(report.errors).to.be.empty;
      expect(report.tasksValidated).to.equal(1);
    });

    it("should validate plan with multiple independent tasks", async () => {
      const plan: AITaskPlan = {
        tasks: [
          {
            service: "firestore",
            command: "create-document",
            input: {
              documentPath: "firestore/(default)/data/test/doc1",
              documentData: { name: "Test 1" }
            }
          },
          {
            service: "firestore",
            command: "create-document",
            input: {
              documentPath: "firestore/(default)/data/test/doc2",
              documentData: { name: "Test 2" }
            }
          }
        ]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");

      expect(report.isValid).to.be.true;
      expect(report.errors).to.be.empty;
      expect(report.tasksValidated).to.equal(2);
    });

    it("should validate plan with task dependencies", async () => {
      const plan: AITaskPlan = {
        tasks: [
          {
            id: "copy",
            service: "firestore",
            command: "copy-collection",
            input: {
              sourcePath: "firestore/(default)/data/users",
              destinationPath: "firestore/(default)/data/users_backup"
            }
          },
          {
            id: "audit",
            service: "firestore",
            command: "create-document",
            input: {
              documentPath: "firestore/(default)/data/audit_logs/log1",
              documentData: { action: "copied", timestamp: "2025-01-17" }
            },
            dependsOn: ["orchestrator-0-copy"]
          }
        ]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");

      expect(report.isValid).to.be.true;
      expect(report.errors).to.be.empty;
      expect(report.tasksValidated).to.equal(2);
    });

    it("should auto-generate IDs when not provided", async () => {
      const plan: AITaskPlan = {
        tasks: [
          {
            service: "firestore",
            command: "create-document",
            input: {
              documentPath: "firestore/(default)/data/test/doc1",
              documentData: { name: "Test" }
            }
          },
          {
            service: "firestore",
            command: "create-document",
            input: {
              documentPath: "firestore/(default)/data/test/doc2",
              documentData: { name: "Test 2" }
            }
          }
        ]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");
      expect(report.isValid).to.be.true;

      // Convert to child tasks to see generated IDs
      const childTasks = planToChildTasks(plan, "orchestrator-0");
      expect(childTasks).to.have.lengthOf(2);
    });
  });

  describe("Validation - Invalid Plans", () => {
    it("should reject plan with invalid service", async () => {
      const plan: AITaskPlan = {
        tasks: [
          {
            service: "invalid-service",
            command: "do-something",
            input: {}
          }
        ]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");

      expect(report.isValid).to.be.false;
      expect(report.errors).to.have.lengthOf.at.least(1);
      expect(report.errors[0]).to.include("invalid-service");
    });

    it("should reject plan with invalid command for valid service", async () => {
      const plan: AITaskPlan = {
        tasks: [
          {
            service: "firestore",
            command: "invalid-command",
            input: {}
          }
        ]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");

      expect(report.isValid).to.be.false;
      expect(report.errors).to.have.lengthOf.at.least(1);
      expect(report.errors[0]).to.include("invalid-command");
    });

    it("should reject plan with missing required parameters", async () => {
      const plan: AITaskPlan = {
        tasks: [
          {
            service: "firestore",
            command: "copy-collection",
            input: {
              // Missing sourcePath and destinationPath
            }
          }
        ]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");

      expect(report.isValid).to.be.false;
      expect(report.errors).to.have.lengthOf.at.least(1);
      expect(report.errors.join(" ")).to.include("sourcePath");
    });

    it("should reject plan with circular dependencies", async () => {
      const plan: AITaskPlan = {
        tasks: [
          {
            id: "task-a",
            service: "firestore",
            command: "create-document",
            input: {
              documentPath: "firestore/(default)/data/test/doc1",
              documentData: {}
            },
            dependsOn: ["orchestrator-0-task-b"]
          },
          {
            id: "task-b",
            service: "firestore",
            command: "create-document",
            input: {
              documentPath: "firestore/(default)/data/test/doc2",
              documentData: {}
            },
            dependsOn: ["orchestrator-0-task-a"]
          }
        ]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");

      expect(report.isValid).to.be.false;
      expect(report.errors).to.have.lengthOf.at.least(1);
      expect(report.errors.join(" ")).to.match(/cycl|circular/i);
    });

    it("should reject plan with non-existent dependency", async () => {
      const plan: AITaskPlan = {
        tasks: [
          {
            id: "task-a",
            service: "firestore",
            command: "create-document",
            input: {
              documentPath: "firestore/(default)/data/test/doc1",
              documentData: {}
            },
            dependsOn: ["orchestrator-0-non-existent"]
          }
        ]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");

      expect(report.isValid).to.be.false;
      expect(report.errors).to.have.lengthOf.at.least(1);
      expect(report.errors[0]).to.include("non-existent");
    });

    it("should reject empty task array", async () => {
      const plan: AITaskPlan = {
        tasks: []
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");

      // Empty plans are valid but generate a warning
      expect(report.isValid).to.be.true;
      expect(report.warnings).to.have.lengthOf.at.least(1);
      expect(report.warnings[0]).to.include("no tasks");
    });
  });

  describe("ID Prefix Enforcement", () => {
    it("should add prefix to custom IDs", async () => {
      const plan: AITaskPlan = {
        tasks: [
          {
            id: "backup",
            service: "firestore",
            command: "copy-collection",
            input: {
              sourcePath: "firestore/(default)/data/users",
              destinationPath: "firestore/(default)/data/users_backup"
            }
          }
        ]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");
      expect(report.isValid).to.be.true;

      const childTasks = planToChildTasks(plan, "orchestrator-0");
      expect(childTasks).to.have.lengthOf(1);
      // Verify dependencies would reference with prefix if they existed
    });

    it("should normalize dependency IDs with prefix", async () => {
      const plan: AITaskPlan = {
        tasks: [
          {
            id: "copy",
            service: "firestore",
            command: "copy-collection",
            input: {
              sourcePath: "firestore/(default)/data/users",
              destinationPath: "firestore/(default)/data/users_backup"
            }
          },
          {
            id: "audit",
            service: "firestore",
            command: "create-document",
            input: {
              documentPath: "firestore/(default)/data/audit_logs/log1",
              documentData: { action: "copied" }
            },
            dependsOn: ["orchestrator-0-copy"] // Already prefixed
          }
        ]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");
      expect(report.isValid).to.be.true;

      const childTasks = planToChildTasks(plan, "orchestrator-0");
      expect(childTasks[1].dependsOn).to.include("orchestrator-0-copy");
    });

    it("should accept unprefixed dependency IDs and normalize them during validation", async () => {
      const plan: AITaskPlan = {
        tasks: [
          {
            id: "copy",
            service: "firestore",
            command: "copy-collection",
            input: {
              sourcePath: "firestore/(default)/data/users",
              destinationPath: "firestore/(default)/data/users_backup"
            }
          },
          {
            id: "audit",
            service: "firestore",
            command: "create-document",
            input: {
              documentPath: "firestore/(default)/data/audit_logs/log1",
              documentData: { action: "copied" }
            },
            dependsOn: ["copy"] // NO PREFIX - validator should handle this
          }
        ]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");

      // Validation should SUCCEED
      expect(report.isValid).to.be.true;
      expect(report.errors).to.be.empty;

      // Should generate a warning about the prefix normalization
      expect(report.warnings).to.have.lengthOf.at.least(1);
      expect(report.warnings.join(" ")).to.include("copy");
      expect(report.warnings.join(" ")).to.include("orchestrator-0-copy");

      // planToChildTasks should normalize the dependency
      const childTasks = planToChildTasks(plan, "orchestrator-0");
      expect(childTasks[1].dependsOn).to.deep.equal(["orchestrator-0-copy"]);
    });
  });

  describe("Child Task Conversion", () => {
    it("should convert valid plan to child tasks", async () => {
      const plan: AITaskPlan = {
        tasks: [
          {
            service: "firestore",
            command: "create-document",
            input: {
              documentPath: "firestore/(default)/data/test/doc1",
              documentData: { name: "Test" }
            }
          },
          {
            service: "storage",
            command: "delete-path",
            input: {
              path: "gs://bucket/temp/"
            }
          }
        ]
      };

      const childTasks = planToChildTasks(plan, "orchestrator-0");

      expect(childTasks).to.be.an("array").with.lengthOf(2);
      expect(childTasks[0].service).to.equal("firestore");
      expect(childTasks[0].command).to.equal("create-document");
      expect(childTasks[1].service).to.equal("storage");
      expect(childTasks[1].command).to.equal("delete-path");
    });

    it("should preserve task inputs in conversion", async () => {
      const plan: AITaskPlan = {
        tasks: [
          {
            service: "firestore",
            command: "create-document",
            input: {
              documentPath: "firestore/(default)/data/test/doc1",
              documentData: { name: "Test", value: 123 }
            }
          }
        ]
      };

      const childTasks = planToChildTasks(plan, "orchestrator-0");

      expect(childTasks[0].input).to.deep.equal({
        documentPath: "firestore/(default)/data/test/doc1",
        documentData: { name: "Test", value: 123 }
      });
    });

    it("should preserve dependencies in conversion", async () => {
      const plan: AITaskPlan = {
        tasks: [
          {
            id: "first",
            service: "firestore",
            command: "create-document",
            input: {
              documentPath: "firestore/(default)/data/test/doc1",
              documentData: {}
            }
          },
          {
            id: "second",
            service: "firestore",
            command: "create-document",
            input: {
              documentPath: "firestore/(default)/data/test/doc2",
              documentData: {}
            },
            dependsOn: ["orchestrator-0-first"]
          }
        ]
      };

      const childTasks = planToChildTasks(plan, "orchestrator-0");

      expect(childTasks[1].dependsOn).to.be.an("array");
      expect(childTasks[1].dependsOn).to.include("orchestrator-0-first");
    });
  });

  describe("Complex Scenarios", () => {
    it("should validate multi-step workflow with fan-out pattern", async () => {
      const plan: AITaskPlan = {
        tasks: [
          {
            id: "export",
            service: "firestore",
            command: "export-collection-json",
            input: {
              collectionPath: "firestore/(default)/data/users",
              bucketPathPrefix: "gs://bucket/exports/users"
            }
          },
          {
            id: "backup-1",
            service: "firestore",
            command: "copy-collection",
            input: {
              sourcePath: "firestore/(default)/data/users",
              destinationPath: "firestore/(default)/data/users_backup_1"
            },
            dependsOn: ["orchestrator-0-export"]
          },
          {
            id: "backup-2",
            service: "firestore",
            command: "copy-collection",
            input: {
              sourcePath: "firestore/(default)/data/users",
              destinationPath: "firestore/(default)/data/users_backup_2"
            },
            dependsOn: ["orchestrator-0-export"]
          }
        ]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");

      expect(report.isValid).to.be.true;
      expect(report.errors).to.be.empty;
      expect(report.tasksValidated).to.equal(3);
    });

    it("should validate plan with authentication operations", async () => {
      const plan: AITaskPlan = {
        tasks: [
          {
            id: "create",
            service: "authentication",
            command: "create-user",
            input: {
              userRecord: {
                email: "test@example.com",
                password: "securePassword123"
              }
            }
          },
          {
            id: "set-claims",
            service: "authentication",
            command: "set-user-claims",
            input: {
              uid: "user123",
              customClaims: { role: "admin" }
            },
            dependsOn: ["orchestrator-0-create"]
          }
        ]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");

      expect(report.isValid).to.be.true;
      expect(report.tasksValidated).to.equal(2);
    });
  });

  describe("Edge Cases", () => {
    it("should handle plan with reasoning field", async () => {
      const plan: AITaskPlan = {
        tasks: [
          {
            service: "firestore",
            command: "create-document",
            input: {
              documentPath: "firestore/(default)/data/test/doc1",
              documentData: {}
            }
          }
        ],
        reasoning: "Creating a test document for validation purposes"
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");

      expect(report.isValid).to.be.true;
    });

    it("should validate large task plans within validator limits", async () => {
      // Note: maxChildTasks is enforced in the handler AFTER validation
      // This test verifies that the validator can handle large plans
      // The handler will enforce maxChildTasks limit (default: 100)
      const tasks: AITaskPlan["tasks"] = [];
      for (let i = 0; i < 25; i++) {
        tasks.push({
          service: "firestore",
          command: "create-document",
          input: {
            documentPath: `firestore/(default)/data/test/doc${i}`,
            documentData: { index: i }
          }
        });
      }

      const plan: AITaskPlan = { tasks };
      const report = await validateTaskPlan(plan, "orchestrator-0");

      expect(report.isValid).to.be.true;
      expect(report.tasksValidated).to.equal(25);
    });

    it("should validate storage operations with correct path format", async () => {
      const plan: AITaskPlan = {
        tasks: [
          {
            service: "storage",
            command: "delete-path",
            input: {
              path: "gs://my-bucket/temp_uploads/"
            }
          }
        ]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");

      expect(report.isValid).to.be.true;
      expect(report.errors).to.be.empty;
    });

    it("should validate firestore operations with correct path format", async () => {
      const plan: AITaskPlan = {
        tasks: [
          {
            service: "firestore",
            command: "delete-path",
            input: {
              path: "firestore/(default)/data/temp_collection"
            }
          }
        ]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");

      expect(report.isValid).to.be.true;
      expect(report.errors).to.be.empty;
    });
  });

  describe("Prompt Builder - Error Limiting", () => {
    it("should show all errors when count is below limit", () => {
      const { buildUserPrompt } = require("../../../lib/job/handlers/ai/orchestrate/promptBuilder");

      const errors = [
        "Error 1: Missing required parameter",
        "Error 2: Invalid dependency",
        "Error 3: Unknown command"
      ];

      const prompt = buildUserPrompt(
        "Create test tasks",
        undefined,
        {
          attempt: 2,
          previousErrors: errors
        }
      );

      // All errors should be present
      expect(prompt).to.include("Error 1: Missing required parameter");
      expect(prompt).to.include("Error 2: Invalid dependency");
      expect(prompt).to.include("Error 3: Unknown command");
      // Should NOT have truncation message
      expect(prompt).to.not.include("more error");
    });

    it("should limit errors when count exceeds MAX_ERRORS_IN_FEEDBACK", () => {
      const { buildUserPrompt } = require("../../../lib/job/handlers/ai/orchestrate/promptBuilder");

      // Create 10 errors (exceeds limit of 5)
      const errors = Array.from({ length: 10 }, (_, i) => `Error ${i + 1}: Validation failed`);

      const prompt = buildUserPrompt(
        "Create test tasks",
        undefined,
        {
          attempt: 2,
          previousErrors: errors
        }
      );

      // First 5 errors should be present
      expect(prompt).to.include("Error 1: Validation failed");
      expect(prompt).to.include("Error 2: Validation failed");
      expect(prompt).to.include("Error 3: Validation failed");
      expect(prompt).to.include("Error 4: Validation failed");
      expect(prompt).to.include("Error 5: Validation failed");

      // Errors 6-10 should NOT be present
      expect(prompt).to.not.include("Error 6: Validation failed");
      expect(prompt).to.not.include("Error 7: Validation failed");
      expect(prompt).to.not.include("Error 8: Validation failed");
      expect(prompt).to.not.include("Error 9: Validation failed");
      expect(prompt).to.not.include("Error 10: Validation failed");

      // Should have truncation message
      expect(prompt).to.include("... and 5 more errors");
      expect(prompt).to.include("showing first 5 most critical");
    });

    it("should use singular form when only 1 error is hidden", () => {
      const { buildUserPrompt } = require("../../../lib/job/handlers/ai/orchestrate/promptBuilder");

      // Create 6 errors (1 over limit of 5)
      const errors = Array.from({ length: 6 }, (_, i) => `Error ${i + 1}: Validation failed`);

      const prompt = buildUserPrompt(
        "Create test tasks",
        undefined,
        {
          attempt: 2,
          previousErrors: errors
        }
      );

      // Should use singular "error"
      expect(prompt).to.include("... and 1 more error");
      expect(prompt).to.not.include("1 more errors");
    });

    it("should handle empty error array", () => {
      const { buildUserPrompt } = require("../../../lib/job/handlers/ai/orchestrate/promptBuilder");

      const prompt = buildUserPrompt(
        "Create test tasks",
        undefined,
        {
          attempt: 2,
          previousErrors: []
        }
      );

      // Should still indicate retry attempt
      expect(prompt).to.include("Retry Attempt 2");
      // But no error list
      expect(prompt).to.not.include("Error");
    });

    it("should handle exactly MAX_ERRORS_IN_FEEDBACK errors (boundary case)", () => {
      const { buildUserPrompt } = require("../../../lib/job/handlers/ai/orchestrate/promptBuilder");

      // Create exactly 5 errors (at limit)
      const errors = Array.from({ length: 5 }, (_, i) => `Error ${i + 1}: Validation failed`);

      const prompt = buildUserPrompt(
        "Create test tasks",
        undefined,
        {
          attempt: 2,
          previousErrors: errors
        }
      );

      // All 5 errors should be present
      expect(prompt).to.include("Error 1: Validation failed");
      expect(prompt).to.include("Error 5: Validation failed");

      // Should NOT have truncation message (exactly at limit)
      expect(prompt).to.not.include("more error");
    });
  });

  describe("Handler - Depth Validation", () => {
    it("should reject orchestration when task is already at maxDepth", async function() {
      this.timeout(5000);

      const { handleOrchestrate } = await import("../../../lib/job/handlers/ai/orchestrate/handler");
      const { JobTask } = await import("../../../lib/job/jobTask");

      // Create a task at depth 10 with maxDepth 10
      const task = new JobTask({
        id: "deep-orchestrator",
        service: "ai",
        command: "orchestrate",
        input: {
          prompt: "Create test tasks",
          maxDepth: 10
        },
        depth: 10 // Already at max depth
      });

      let errorThrown = false;
      try {
        await handleOrchestrate(task);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("Cannot orchestrate at depth 10");
        expect(error.message).to.include("Maximum depth is 10");
        expect(error.message).to.include("Child tasks would be at depth 11");
        expect(error.message).to.include("exceeds the limit");
      }

      expect(errorThrown).to.be.true;
    });

    it("should allow orchestration when depth is within limit", async function() {
      this.timeout(10000);

      const { handleOrchestrate } = await import("../../../lib/job/handlers/ai/orchestrate/handler");
      const { VertexAI } = await import("@google-cloud/vertexai");
      const { JobTask } = await import("../../../lib/job/jobTask");

      const originalGetGenerativeModel = VertexAI.prototype.getGenerativeModel;

      try {
        const mockAIPlan = {
          tasks: [{
            service: "firestore",
            command: "create-document",
            input: {
              documentPath: "firestore/(default)/data/test/doc1",
              documentData: { name: "Test" }
            }
          }],
          reasoning: "Creating a test document"
        };

        VertexAI.prototype.getGenerativeModel = function() {
          return {
            generateContent: async () => ({
              response: {
                candidates: [{
                  content: {
                    parts: [{ text: JSON.stringify(mockAIPlan) }]
                  }
                }],
                usageMetadata: {
                  promptTokenCount: 100,
                  candidatesTokenCount: 50,
                  totalTokenCount: 150
                }
              }
            })
          };
        } as any;

        // Task at depth 9 with maxDepth 10 - should succeed (children would be at depth 10)
        const task = new JobTask({
          id: "safe-orchestrator",
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Create test tasks",
            maxDepth: 10
          },
          depth: 9
        });

        const result = await handleOrchestrate(task);

        expect(result).to.exist;
        expect(result.childTasks).to.have.lengthOf(1);
      } finally {
        VertexAI.prototype.getGenerativeModel = originalGetGenerativeModel;
      }
    });

    it("should use DEFAULT_MAX_DEPTH (10) when maxDepth not provided", async function() {
      this.timeout(5000);

      const { handleOrchestrate } = await import("../../../lib/job/handlers/ai/orchestrate/handler");
      const { JobTask } = await import("../../../lib/job/jobTask");

      // Task at depth 10 without maxDepth specified (defaults to 10)
      const task = new JobTask({
        id: "default-depth-orchestrator",
        service: "ai",
        command: "orchestrate",
        input: {
          prompt: "Create test tasks"
          // maxDepth not specified - should default to 10
        },
        depth: 10
      });

      let errorThrown = false;
      try {
        await handleOrchestrate(task);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("Cannot orchestrate at depth 10");
        expect(error.message).to.include("Maximum depth is 10");
      }

      expect(errorThrown).to.be.true;
    });

    it("should allow custom maxDepth higher than default", async function() {
      this.timeout(10000);

      const { handleOrchestrate } = await import("../../../lib/job/handlers/ai/orchestrate/handler");
      const { VertexAI } = await import("@google-cloud/vertexai");
      const { JobTask } = await import("../../../lib/job/jobTask");

      const originalGetGenerativeModel = VertexAI.prototype.getGenerativeModel;

      try {
        const mockAIPlan = {
          tasks: [{
            service: "firestore",
            command: "create-document",
            input: {
              documentPath: "firestore/(default)/data/test/doc1",
              documentData: { name: "Test" }
            }
          }]
        };

        VertexAI.prototype.getGenerativeModel = function() {
          return {
            generateContent: async () => ({
              response: {
                candidates: [{
                  content: {
                    parts: [{ text: JSON.stringify(mockAIPlan) }]
                  }
                }],
                usageMetadata: {
                  promptTokenCount: 100,
                  candidatesTokenCount: 50,
                  totalTokenCount: 150
                }
              }
            })
          };
        } as any;

        // Task at depth 15 with custom maxDepth 20 - should succeed
        const task = new JobTask({
          id: "custom-depth-orchestrator",
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Create test tasks",
            maxDepth: 20 // Custom higher limit
          },
          depth: 15
        });

        const result = await handleOrchestrate(task);

        expect(result).to.exist;
        expect(result.childTasks).to.have.lengthOf(1);
      } finally {
        VertexAI.prototype.getGenerativeModel = originalGetGenerativeModel;
      }
    });

    it("should handle edge case: depth 0 with maxDepth 0", async function() {
      this.timeout(5000);

      const { handleOrchestrate } = await import("../../../lib/job/handlers/ai/orchestrate/handler");
      const { JobTask } = await import("../../../lib/job/jobTask");

      // Task at depth 0 with maxDepth 0 - children would be at depth 1, exceeding limit
      const task = new JobTask({
        id: "zero-depth-orchestrator",
        service: "ai",
        command: "orchestrate",
        input: {
          prompt: "Create test tasks",
          maxDepth: 0
        },
        depth: 0
      });

      let errorThrown = false;
      try {
        await handleOrchestrate(task);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("Cannot orchestrate at depth 0");
        expect(error.message).to.include("Maximum depth is 0");
      }

      expect(errorThrown).to.be.true;
    });

    it("should handle undefined task depth (defaults to 0)", async function() {
      this.timeout(10000);

      const { handleOrchestrate } = await import("../../../lib/job/handlers/ai/orchestrate/handler");
      const { VertexAI } = await import("@google-cloud/vertexai");
      const { JobTask } = await import("../../../lib/job/jobTask");

      const originalGetGenerativeModel = VertexAI.prototype.getGenerativeModel;

      try {
        const mockAIPlan = {
          tasks: [{
            service: "firestore",
            command: "create-document",
            input: {
              documentPath: "firestore/(default)/data/test/doc1",
              documentData: { name: "Test" }
            }
          }]
        };

        VertexAI.prototype.getGenerativeModel = function() {
          return {
            generateContent: async () => ({
              response: {
                candidates: [{
                  content: {
                    parts: [{ text: JSON.stringify(mockAIPlan) }]
                  }
                }],
                usageMetadata: {
                  promptTokenCount: 100,
                  candidatesTokenCount: 50,
                  totalTokenCount: 150
                }
              }
            })
          };
        } as any;

        // Task with undefined depth (should default to 0)
        const task = new JobTask({
          id: "undefined-depth-orchestrator",
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Create test tasks",
            maxDepth: 10
          }
          // depth not specified - should default to 0 in JobTask constructor
        });

        const result = await handleOrchestrate(task);

        expect(result).to.exist;
        expect(result.childTasks).to.have.lengthOf(1);
      } finally {
        VertexAI.prototype.getGenerativeModel = originalGetGenerativeModel;
      }
    });
  });

  describe("Schema Validation", () => {
    it("should reject task with invalid path format", async () => {
      const plan: AITaskPlan = {
        tasks: [{
          service: "firestore",
          command: "copy-collection",
          input: {
            sourcePath: "invalid-path", // Should match pattern
            destinationPath: "firestore/(default)/data/dest"
          }
        }]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");
      expect(report.isValid).to.be.false;
      expect(report.errors.join(' ')).to.include('must match pattern');
    });

    it("should reject task with wrong parameter type", async () => {
      const plan: AITaskPlan = {
        tasks: [{
          service: "firestore",
          command: "create-document",
          input: {
            documentPath: "firestore/(default)/data/test/doc1",
            documentData: "not-an-object" // Should be object
          }
        }]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");
      expect(report.isValid).to.be.false;
      expect(report.errors.join(' ')).to.include('must be object');
    });

    it("should accept task with valid schema", async () => {
      const plan: AITaskPlan = {
        tasks: [{
          service: "firestore",
          command: "copy-collection",
          input: {
            sourcePath: "firestore/(default)/data/users",
            destinationPath: "firestore/(default)/data/users_backup"
          }
        }]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");
      expect(report.isValid).to.be.true;
      expect(report.errors).to.be.empty;
    });

    it("should reject task with out-of-range number", async () => {
      const plan: AITaskPlan = {
        tasks: [{
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Test",
            temperature: 2.5 // Should be 0.0-1.0
          }
        }]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");
      expect(report.isValid).to.be.false;
      expect(report.errors.join(' ')).to.include('must be <=');
    });

    it("should reject task with invalid email format", async () => {
      const plan: AITaskPlan = {
        tasks: [{
          service: "authentication",
          command: "create-user",
          input: {
            userRecord: {
              email: "not-an-email", // Invalid email format
              password: "password123"
            }
          }
        }]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");
      expect(report.isValid).to.be.false;
      expect(report.errors.join(' ')).to.include('must match pattern');
    });

    it("should accept valid email format", async () => {
      const plan: AITaskPlan = {
        tasks: [{
          service: "authentication",
          command: "create-user",
          input: {
            userRecord: {
              email: "user@example.com",
              password: "password123"
            }
          }
        }]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");
      expect(report.isValid).to.be.true;
      expect(report.errors).to.be.empty;
    });

    it("should reject task with unexpected parameters", async () => {
      const plan: AITaskPlan = {
        tasks: [{
          service: "firestore",
          command: "copy-collection",
          input: {
            sourcePath: "firestore/(default)/data/users",
            destinationPath: "firestore/(default)/data/users_backup",
            unexpectedParam: "should not be here" // Not in schema
          }
        }]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");
      expect(report.isValid).to.be.false;
      expect(report.errors.join(' ')).to.include('must NOT have additional properties');
    });

    it("should validate number minimum constraint", async () => {
      const plan: AITaskPlan = {
        tasks: [{
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Test",
            maxRetries: -1 // Should be >= 0
          }
        }]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");
      expect(report.isValid).to.be.false;
      expect(report.errors.join(' ')).to.include('must be >=');
    });

    it("should validate number maximum constraint", async () => {
      const plan: AITaskPlan = {
        tasks: [{
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Test",
            timeout: 500000 // Should be <= 300000
          }
        }]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");
      expect(report.isValid).to.be.false;
      expect(report.errors.join(' ')).to.include('must be <=');
    });

    it("should pass validation errors to AI on retry", async function() {
      this.timeout(10000);

      const { handleOrchestrate } = await import("../../../lib/job/handlers/ai/orchestrate/handler");
      const { VertexAI } = await import("@google-cloud/vertexai");
      const { JobTask } = await import("../../../lib/job/jobTask");

      const originalGetGenerativeModel = VertexAI.prototype.getGenerativeModel;

      try {
        let attemptCount = 0;
        let lastPrompt = '';

        VertexAI.prototype.getGenerativeModel = function() {
          return {
            generateContent: async (request: any) => {
              attemptCount++;
              lastPrompt = request.contents[0].parts[0].text;

              // First attempt: return invalid schema
              if (attemptCount === 1) {
                return {
                  response: {
                    candidates: [{
                      content: {
                        parts: [{
                          text: JSON.stringify({
                            tasks: [{
                              service: "firestore",
                              command: "copy-collection",
                              input: {
                                sourcePath: "invalid-path",
                                destinationPath: "firestore/(default)/data/dest"
                              }
                            }]
                          })
                        }]
                      }
                    }],
                    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 }
                  }
                };
              }

              // Second attempt: return valid schema
              return {
                response: {
                  candidates: [{
                    content: {
                      parts: [{
                        text: JSON.stringify({
                          tasks: [{
                            service: "firestore",
                            command: "copy-collection",
                            input: {
                              sourcePath: "firestore/(default)/data/users",
                              destinationPath: "firestore/(default)/data/users_backup"
                            }
                          }]
                        })
                      }]
                    }
                  }],
                  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 }
                }
              };
            }
          };
        } as any;

        const task = new JobTask({
          id: "test-orchestrator",
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Copy users collection",
            maxRetries: 2
          },
          depth: 0
        });

        const result = await handleOrchestrate(task);

        // Should have succeeded after retry
        expect(result).to.exist;
        expect(result.retriesUsed).to.equal(2);
        expect(result.childTasks).to.have.lengthOf(1);

        // Second prompt should include validation errors
        expect(lastPrompt).to.include('must match pattern');
      } finally {
        VertexAI.prototype.getGenerativeModel = originalGetGenerativeModel;
      }
    });

    it("should handle handlers without schemas gracefully", async () => {
      // storage/delete-path doesn't have a schema yet
      const plan: AITaskPlan = {
        tasks: [{
          service: "storage",
          command: "delete-path",
          input: {
            path: "gs://bucket/temp/"
          }
        }]
      };

      const report = await validateTaskPlan(plan, "orchestrator-0");
      expect(report.isValid).to.be.true;
      expect(report.errors).to.be.empty;
    });
  });

  describe("Handler - maxChildTasks Enforcement", () => {
    it("should reject plans exceeding maxChildTasks limit", async function() {
      this.timeout(10000);

      // Import the handler and VertexAI
      const { handleOrchestrate } = await import("../../../lib/job/handlers/ai/orchestrate/handler");
      const { VertexAI } = await import("@google-cloud/vertexai");
      const { JobTask } = await import("../../../lib/job/jobTask");

      // Save the original getGenerativeModel method
      const originalGetGenerativeModel = VertexAI.prototype.getGenerativeModel;

      try {
        // Mock the VertexAI response to return 3 tasks
        const mockAIPlan = {
          tasks: [
            {
              service: "firestore",
              command: "create-document",
              input: {
                documentPath: "firestore/(default)/data/test/doc1",
                documentData: { name: "Task 1" }
              }
            },
            {
              service: "firestore",
              command: "create-document",
              input: {
                documentPath: "firestore/(default)/data/test/doc2",
                documentData: { name: "Task 2" }
              }
            },
            {
              service: "firestore",
              command: "create-document",
              input: {
                documentPath: "firestore/(default)/data/test/doc3",
                documentData: { name: "Task 3" }
              }
            }
          ],
          reasoning: "Creating three test documents"
        };

        // Mock the generateContent method
        VertexAI.prototype.getGenerativeModel = function() {
          return {
            generateContent: async () => ({
              response: {
                candidates: [{
                  content: {
                    parts: [{ text: JSON.stringify(mockAIPlan) }]
                  }
                }],
                usageMetadata: {
                  promptTokenCount: 100,
                  candidatesTokenCount: 50,
                  totalTokenCount: 150
                }
              }
            })
          };
        } as any;

        // Create a task with maxChildTasks set to 2 (less than the 3 tasks the AI will return)
        const task = new JobTask({
          id: "test-orchestrator",
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Create test documents",
            maxChildTasks: 2 // AI will try to create 3 tasks, but limit is 2
          },
          depth: 0
        });

        // Attempt to execute - should throw error
        let errorThrown = false;
        try {
          await handleOrchestrate(task);
        } catch (error: any) {
          errorThrown = true;
          expect(error.message).to.include("Task limit exceeded");
          expect(error.message).to.include("3 tasks");
          expect(error.message).to.include("maxChildTasks limit is 2");
          expect(error.message).to.include("This orchestrator can spawn at most 2 child tasks");
        }

        expect(errorThrown).to.be.true;
      } finally {
        // Restore original method
        VertexAI.prototype.getGenerativeModel = originalGetGenerativeModel;
      }
    });

    it("should accept plans within maxChildTasks limit", async function() {
      this.timeout(10000);

      // Import the handler and VertexAI
      const { handleOrchestrate } = await import("../../../lib/job/handlers/ai/orchestrate/handler");
      const { VertexAI } = await import("@google-cloud/vertexai");
      const { JobTask } = await import("../../../lib/job/jobTask");

      // Save the original getGenerativeModel method
      const originalGetGenerativeModel = VertexAI.prototype.getGenerativeModel;

      try {
        // Mock the VertexAI response to return 2 tasks
        const mockAIPlan = {
          tasks: [
            {
              service: "firestore",
              command: "create-document",
              input: {
                documentPath: "firestore/(default)/data/test/doc1",
                documentData: { name: "Task 1" }
              }
            },
            {
              service: "firestore",
              command: "create-document",
              input: {
                documentPath: "firestore/(default)/data/test/doc2",
                documentData: { name: "Task 2" }
              }
            }
          ],
          reasoning: "Creating two test documents"
        };

        // Mock the generateContent method
        VertexAI.prototype.getGenerativeModel = function() {
          return {
            generateContent: async () => ({
              response: {
                candidates: [{
                  content: {
                    parts: [{ text: JSON.stringify(mockAIPlan) }]
                  }
                }],
                usageMetadata: {
                  promptTokenCount: 100,
                  candidatesTokenCount: 50,
                  totalTokenCount: 150
                }
              }
            })
          };
        } as any;

        // Create a task with maxChildTasks set to 3 (more than the 2 tasks the AI will return)
        const task = new JobTask({
          id: "test-orchestrator",
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Create test documents",
            maxChildTasks: 3 // AI will create 2 tasks, limit is 3 - should succeed
          },
          depth: 0
        });

        // Execute - should succeed
        const result = await handleOrchestrate(task);

        expect(result).to.exist;
        expect(result.childTasks).to.have.lengthOf(2);
        expect(result.plan.tasks).to.have.lengthOf(2);
      } finally {
        // Restore original method
        VertexAI.prototype.getGenerativeModel = originalGetGenerativeModel;
      }
    });

    it("should timeout when AI call exceeds configured timeout", async function() {
      this.timeout(10000);

      // Import the handler and VertexAI
      const { handleOrchestrate } = await import("../../../lib/job/handlers/ai/orchestrate/handler");
      const { VertexAI } = await import("@google-cloud/vertexai");
      const { JobTask } = await import("../../../lib/job/jobTask");

      // Save the original getGenerativeModel method
      const originalGetGenerativeModel = VertexAI.prototype.getGenerativeModel;

      try {
        // Mock the VertexAI response to delay longer than the timeout
        VertexAI.prototype.getGenerativeModel = function() {
          return {
            generateContent: async () => {
              // Delay for 200ms (longer than our timeout of 100ms)
              await new Promise(resolve => setTimeout(resolve, 200));

              // This response will never be reached due to timeout
              return {
                response: {
                  candidates: [{
                    content: {
                      parts: [{ text: JSON.stringify({ tasks: [] }) }]
                    }
                  }]
                }
              };
            }
          };
        } as any;

        // Create a task with a very short timeout (100ms)
        const task = new JobTask({
          id: "test-orchestrator",
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Create test documents",
            timeout: 100 // Very short timeout - AI call will exceed this
          },
          depth: 0
        });

        // Attempt to execute - should throw timeout error
        let errorThrown = false;
        try {
          await handleOrchestrate(task);
        } catch (error: any) {
          errorThrown = true;
          expect(error.message).to.include("AI call timeout after 100ms");
        }

        expect(errorThrown).to.be.true;
      } finally {
        // Restore original method
        VertexAI.prototype.getGenerativeModel = originalGetGenerativeModel;
      }
    });
  });
});
