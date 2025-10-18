/**
 * Integration tests for AI Task Orchestration
 *
 * Tests the orchestrate logic with mocked AI responses to avoid
 * actual AI inference calls while validating the system behavior.
 */

import { expect } from "chai";
import {
  validateTaskPlan,
  planToChildTasks
} from "../../../lib/job/handlers/ai/orchestrate";
import {
  isValidServiceCommand,
  findTaskCapability
} from "../../../lib/job/handlers/ai/orchestrate/catalog";
import { AITaskPlan } from "../../../lib/job/handlers/ai/orchestrate/types";
import { createMockJobContext } from "../../helpers/jobContextHelper";
import { FirebaseTaskStatus } from "../../../src/job/jobTask";

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

      const context = createMockJobContext();
      let errorThrown = false;
      try {
        await handleOrchestrate(task, context);
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
            maxDepth: 10,
            dryRun: false  // Execute mode to test depth validation
          },
          depth: 9
        });

        const context = createMockJobContext();
        const result = await handleOrchestrate(task, context);

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

      const context = createMockJobContext();
      let errorThrown = false;
      try {
        await handleOrchestrate(task, context);
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
            maxDepth: 20, // Custom higher limit
            dryRun: false  // Execute mode to test depth validation
          },
          depth: 15
        });

        const context = createMockJobContext();
        const result = await handleOrchestrate(task, context);

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

      const context = createMockJobContext();
      let errorThrown = false;
      try {
        await handleOrchestrate(task, context);
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
            maxDepth: 10,
            dryRun: false  // Execute mode to test depth validation
          }
          // depth not specified - should default to 0 in JobTask constructor
        });

        const context = createMockJobContext();
        const result = await handleOrchestrate(task, context);

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
            maxRetries: 2,
            dryRun: false  // Need childTasks for test assertions
          },
          depth: 0
        });

        const context = createMockJobContext();
        const result = await handleOrchestrate(task, context);

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

  describe("Handler - DryRun Mode (Human-in-the-Loop)", () => {
    it("should return plannedTasks when dryRun=true (default)", async function() {
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
          reasoning: "Creating a test document for preview"
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

        // Test with dryRun explicitly set to true
        const task = new JobTask({
          id: "preview-orchestrator",
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Create test document",
            dryRun: true
          },
          depth: 0
        });

        const context = createMockJobContext();
        const result = await handleOrchestrate(task, context);

        // Should return plannedTasks for human review
        expect(result.dryRun).to.be.true;
        expect(result.plannedTasks).to.exist;
        expect(result.plannedTasks).to.have.lengthOf(1);
        expect(result.childTasks).to.be.undefined;
        expect(result.plannedTasks![0].service).to.equal("firestore");
        expect(result.plannedTasks![0].command).to.equal("create-document");
      } finally {
        VertexAI.prototype.getGenerativeModel = originalGetGenerativeModel;
      }
    });

    it("should return plannedTasks when dryRun not specified (default behavior)", async function() {
      this.timeout(10000);

      const { handleOrchestrate } = await import("../../../lib/job/handlers/ai/orchestrate/handler");
      const { VertexAI } = await import("@google-cloud/vertexai");
      const { JobTask } = await import("../../../lib/job/jobTask");

      const originalGetGenerativeModel = VertexAI.prototype.getGenerativeModel;

      try {
        const mockAIPlan = {
          tasks: [{
            service: "firestore",
            command: "copy-collection",
            input: {
              sourcePath: "firestore/(default)/data/users",
              destinationPath: "firestore/(default)/data/users_backup"
            }
          }],
          reasoning: "Backing up users collection"
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

        // Test without dryRun specified - should default to true
        const task = new JobTask({
          id: "default-orchestrator",
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Copy users to backup"
            // dryRun not specified - should default to true
          },
          depth: 0
        });

        const context = createMockJobContext();
        const result = await handleOrchestrate(task, context);

        // Should default to dryRun=true and return plannedTasks
        expect(result.dryRun).to.be.true;
        expect(result.plannedTasks).to.exist;
        expect(result.plannedTasks).to.have.lengthOf(1);
        expect(result.childTasks).to.be.undefined;
      } finally {
        VertexAI.prototype.getGenerativeModel = originalGetGenerativeModel;
      }
    });

    it("should return childTasks when dryRun=false (auto-execute mode)", async function() {
      this.timeout(10000);

      const { handleOrchestrate } = await import("../../../lib/job/handlers/ai/orchestrate/handler");
      const { VertexAI } = await import("@google-cloud/vertexai");
      const { JobTask } = await import("../../../lib/job/jobTask");

      const originalGetGenerativeModel = VertexAI.prototype.getGenerativeModel;

      try {
        const mockAIPlan = {
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
          ],
          reasoning: "Creating test documents automatically"
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

        // Test with dryRun explicitly set to false
        const task = new JobTask({
          id: "execute-orchestrator",
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Create test documents",
            dryRun: false
          },
          depth: 0
        });

        const context = createMockJobContext();
        const result = await handleOrchestrate(task, context);

        // Should return childTasks for automatic execution
        expect(result.dryRun).to.be.false;
        expect(result.childTasks).to.exist;
        expect(result.childTasks).to.have.lengthOf(2);
        expect(result.plannedTasks).to.be.undefined;
        expect(result.childTasks![0].service).to.equal("firestore");
        expect(result.childTasks![1].service).to.equal("firestore");
      } finally {
        VertexAI.prototype.getGenerativeModel = originalGetGenerativeModel;
      }
    });

    it("should preserve dryRun field in output for both modes", async function() {
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

        // Test dryRun=true output
        const dryRunTask = new JobTask({
          id: "dry-run-test",
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Test",
            dryRun: true
          },
          depth: 0
        });

        const context = createMockJobContext();
        const dryRunResult = await handleOrchestrate(dryRunTask, context);
        expect(dryRunResult.dryRun).to.equal(true);
        expect(dryRunResult.dryRun).to.be.a('boolean');

        // Test dryRun=false output
        const executeTask = new JobTask({
          id: "execute-test",
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Test",
            dryRun: false
          },
          depth: 0
        });

        const executeResult = await handleOrchestrate(executeTask, context);
        expect(executeResult.dryRun).to.equal(false);
        expect(executeResult.dryRun).to.be.a('boolean');
      } finally {
        VertexAI.prototype.getGenerativeModel = originalGetGenerativeModel;
      }
    });

    it("should validate tasks in both dryRun modes", async function() {
      this.timeout(10000);

      const { handleOrchestrate } = await import("../../../lib/job/handlers/ai/orchestrate/handler");
      const { VertexAI } = await import("@google-cloud/vertexai");
      const { JobTask } = await import("../../../lib/job/jobTask");

      const originalGetGenerativeModel = VertexAI.prototype.getGenerativeModel;

      try {
        // Mock AI to return invalid task (will fail validation)
        const mockInvalidPlan = {
          tasks: [{
            service: "invalid-service",
            command: "invalid-command",
            input: {}
          }]
        };

        VertexAI.prototype.getGenerativeModel = function() {
          return {
            generateContent: async () => ({
              response: {
                candidates: [{
                  content: {
                    parts: [{ text: JSON.stringify(mockInvalidPlan) }]
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

        // Test that validation happens in dryRun=true mode
        const dryRunTask = new JobTask({
          id: "validation-dry-run",
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Invalid task",
            dryRun: true,
            maxRetries: 1
          },
          depth: 0
        });

        const context = createMockJobContext();
        let dryRunError: any;
        try {
          await handleOrchestrate(dryRunTask, context);
        } catch (error) {
          dryRunError = error;
        }

        expect(dryRunError).to.exist;
        expect(dryRunError.message).to.include("orchestration failed");

        // Test that validation happens in dryRun=false mode
        const executeTask = new JobTask({
          id: "validation-execute",
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Invalid task",
            dryRun: false,
            maxRetries: 1
          },
          depth: 0
        });

        let executeError: any;
        try {
          await handleOrchestrate(executeTask, context);
        } catch (error) {
          executeError = error;
        }

        expect(executeError).to.exist;
        expect(executeError.message).to.include("orchestration failed");
      } finally {
        VertexAI.prototype.getGenerativeModel = originalGetGenerativeModel;
      }
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
        const context = createMockJobContext();
        let errorThrown = false;
        try {
          await handleOrchestrate(task, context);
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
            maxChildTasks: 3, // AI will create 2 tasks, limit is 3 - should succeed
            dryRun: false  // Need childTasks for test assertions
          },
          depth: 0
        });

        // Execute - should succeed
        const context = createMockJobContext();
        const result = await handleOrchestrate(task, context);

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
        const context = createMockJobContext();
        let errorThrown = false;
        try {
          await handleOrchestrate(task, context);
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

  describe("Handler - Dependency Context Passing", () => {
    it("should include single dependency task info in AI prompt", async function() {
      this.timeout(10000);

      const { handleOrchestrate } = await import("../../../lib/job/handlers/ai/orchestrate/handler");
      const { VertexAI } = await import("@google-cloud/vertexai");
      const { JobTask } = await import("../../../lib/job/jobTask");
      const { createMockJobContextWithTasks } = await import("../../helpers/jobContextHelper");

      const originalGetGenerativeModel = VertexAI.prototype.getGenerativeModel;

      try {
        let capturedPrompt = "";

        // Create a completed dependency task
        const dependencyTask = new JobTask({
          id: "dep-task-1",
          service: "firestore",
          command: "copy-collection",
          input: {
            sourcePath: "firestore/(default)/data/users",
            destinationPath: "firestore/(default)/data/users_backup"
          },
          status: FirebaseTaskStatus.Succeeded,
          output: {
            copiedCount: 100,
            targetPath: "firestore/(default)/data/users_backup"
          }
        });

        // Create context with the completed dependency task
        const context = createMockJobContextWithTasks([dependencyTask]);

        // Mock AI to capture the prompt
        VertexAI.prototype.getGenerativeModel = function() {
          return {
            generateContent: async (request: any) => {
              capturedPrompt = request.contents[0].parts[0].text;

              return {
                response: {
                  candidates: [{
                    content: {
                      parts: [{
                        text: JSON.stringify({
                          tasks: [{
                            service: "firestore",
                            command: "create-document",
                            input: {
                              documentPath: "firestore/(default)/data/audit/log1",
                              documentData: { action: "backup-completed" }
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

        // Create orchestrator task that depends on the dependency task
        const task = new JobTask({
          id: "test-orchestrator",
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Create audit log based on backup results",
            dryRun: false
          },
          dependsOn: ["dep-task-1"],
          depth: 0
        });

        await handleOrchestrate(task, context);

        // Verify dependency section is present
        expect(capturedPrompt).to.include("## Dependency Task Results");
        expect(capturedPrompt).to.include("The following tasks have completed");

        // Verify task details are included
        expect(capturedPrompt).to.include("### Task: dep-task-1");
        expect(capturedPrompt).to.include("**Service**: firestore");
        expect(capturedPrompt).to.include("**Command**: copy-collection");

        // Verify output is formatted as JSON
        expect(capturedPrompt).to.include("**Output**:");
        expect(capturedPrompt).to.include("```json");
        expect(capturedPrompt).to.include('"copiedCount": 100');
        expect(capturedPrompt).to.include('"targetPath": "firestore/(default)/data/users_backup"');
      } finally {
        VertexAI.prototype.getGenerativeModel = originalGetGenerativeModel;
      }
    });

    it("should include multiple dependency task info in AI prompt", async function() {
      this.timeout(10000);

      const { handleOrchestrate } = await import("../../../lib/job/handlers/ai/orchestrate/handler");
      const { VertexAI } = await import("@google-cloud/vertexai");
      const { JobTask } = await import("../../../lib/job/jobTask");
      const { createMockJobContextWithTasks } = await import("../../helpers/jobContextHelper");

      const originalGetGenerativeModel = VertexAI.prototype.getGenerativeModel;

      try {
        let capturedPrompt = "";

        // Create multiple completed dependency tasks
        const dep1 = new JobTask({
          id: "backup-task",
          service: "firestore",
          command: "copy-collection",
          input: { sourcePath: "firestore/(default)/data/users", destinationPath: "firestore/(default)/data/users_backup" },
          status: FirebaseTaskStatus.Succeeded,
          output: { copiedCount: 100 }
        });

        const dep2 = new JobTask({
          id: "export-task",
          service: "firestore",
          command: "export-collection-json",
          input: { collectionPath: "firestore/(default)/data/users", bucketPathPrefix: "gs://bucket/exports" },
          status: FirebaseTaskStatus.Succeeded,
          output: { exportedCount: 100, exportPath: "gs://bucket/exports/users.json" }
        });

        const context = createMockJobContextWithTasks([dep1, dep2]);

        // Mock AI to capture the prompt
        VertexAI.prototype.getGenerativeModel = function() {
          return {
            generateContent: async (request: any) => {
              capturedPrompt = request.contents[0].parts[0].text;

              return {
                response: {
                  candidates: [{
                    content: {
                      parts: [{
                        text: JSON.stringify({
                          tasks: [{
                            service: "firestore",
                            command: "create-document",
                            input: {
                              documentPath: "firestore/(default)/data/logs/completion",
                              documentData: { status: "complete" }
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

        // Create orchestrator task that depends on both tasks
        const task = new JobTask({
          id: "orchestrator",
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Create completion log",
            dryRun: false
          },
          dependsOn: ["backup-task", "export-task"],
          depth: 0
        });

        await handleOrchestrate(task, context);

        // Verify dependency section is present
        expect(capturedPrompt).to.include("## Dependency Task Results");

        // Verify both tasks are included
        expect(capturedPrompt).to.include("### Task: backup-task");
        expect(capturedPrompt).to.include("**Service**: firestore");
        expect(capturedPrompt).to.include("**Command**: copy-collection");
        expect(capturedPrompt).to.include('"copiedCount": 100');

        expect(capturedPrompt).to.include("### Task: export-task");
        expect(capturedPrompt).to.include("**Command**: export-collection-json");
        expect(capturedPrompt).to.include('"exportedCount": 100');
        expect(capturedPrompt).to.include('"exportPath": "gs://bucket/exports/users.json"');
      } finally {
        VertexAI.prototype.getGenerativeModel = originalGetGenerativeModel;
      }
    });

    it("should include dependency output in prompt when available", async function() {
      this.timeout(10000);

      const { handleOrchestrate } = await import("../../../lib/job/handlers/ai/orchestrate/handler");
      const { VertexAI } = await import("@google-cloud/vertexai");
      const { JobTask } = await import("../../../lib/job/jobTask");
      const { createMockJobContextWithTasks } = await import("../../helpers/jobContextHelper");

      const originalGetGenerativeModel = VertexAI.prototype.getGenerativeModel;

      try {
        let capturedPrompt = "";

        // Create dependency task with complex output
        const depTask = new JobTask({
          id: "data-task",
          service: "authentication",
          command: "create-user",
          input: { userRecord: { email: "test@example.com" } },
          status: FirebaseTaskStatus.Succeeded,
          output: {
            uid: "user-123",
            email: "test@example.com",
            createdAt: "2025-01-17T10:00:00Z",
            customClaims: { role: "admin", department: "engineering" }
          }
        });

        const context = createMockJobContextWithTasks([depTask]);

        VertexAI.prototype.getGenerativeModel = function() {
          return {
            generateContent: async (request: any) => {
              capturedPrompt = request.contents[0].parts[0].text;

              return {
                response: {
                  candidates: [{
                    content: {
                      parts: [{
                        text: JSON.stringify({
                          tasks: [{
                            service: "firestore",
                            command: "create-document",
                            input: { documentPath: "firestore/(default)/data/users/user-123", documentData: {} }
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
          id: "orchestrator",
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Create user profile",
            dryRun: false
          },
          dependsOn: ["data-task"],
          depth: 0
        });

        await handleOrchestrate(task, context);

        // Verify output structure and content
        expect(capturedPrompt).to.include("**Output**:");
        expect(capturedPrompt).to.include("```json");
        expect(capturedPrompt).to.include('"uid": "user-123"');
        expect(capturedPrompt).to.include('"email": "test@example.com"');
        expect(capturedPrompt).to.include('"createdAt": "2025-01-17T10:00:00Z"');
        expect(capturedPrompt).to.include('"customClaims"');
        expect(capturedPrompt).to.include('"role": "admin"');
        expect(capturedPrompt).to.include('"department": "engineering"');
      } finally {
        VertexAI.prototype.getGenerativeModel = originalGetGenerativeModel;
      }
    });

    it("should handle dependency task without output", async function() {
      this.timeout(10000);

      const { handleOrchestrate } = await import("../../../lib/job/handlers/ai/orchestrate/handler");
      const { VertexAI } = await import("@google-cloud/vertexai");
      const { JobTask } = await import("../../../lib/job/jobTask");
      const { createMockJobContextWithTasks } = await import("../../helpers/jobContextHelper");

      const originalGetGenerativeModel = VertexAI.prototype.getGenerativeModel;

      try {
        let capturedPrompt = "";

        // Create dependency task with no output
        const depTask = new JobTask({
          id: "cleanup-task",
          service: "storage",
          command: "delete-path",
          input: { path: "gs://bucket/temp/" },
          status: FirebaseTaskStatus.Succeeded
          // No output field
        });

        const context = createMockJobContextWithTasks([depTask]);

        VertexAI.prototype.getGenerativeModel = function() {
          return {
            generateContent: async (request: any) => {
              capturedPrompt = request.contents[0].parts[0].text;

              return {
                response: {
                  candidates: [{
                    content: {
                      parts: [{
                        text: JSON.stringify({
                          tasks: [{
                            service: "firestore",
                            command: "create-document",
                            input: { documentPath: "firestore/(default)/data/logs/cleanup", documentData: {} }
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
          id: "orchestrator",
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Log cleanup completion",
            dryRun: false
          },
          dependsOn: ["cleanup-task"],
          depth: 0
        });

        await handleOrchestrate(task, context);

        // Verify task is still included but with no output data note
        expect(capturedPrompt).to.include("### Task: cleanup-task");
        expect(capturedPrompt).to.include("**Service**: storage");
        expect(capturedPrompt).to.include("**Command**: delete-path");
        expect(capturedPrompt).to.include("**Output**: (no output data)");

        // Should not have JSON block for output
        const taskSection = capturedPrompt.substring(
          capturedPrompt.indexOf("### Task: cleanup-task"),
          capturedPrompt.indexOf("\n\n## ") !== -1 ? capturedPrompt.indexOf("\n\n## ") : capturedPrompt.length
        );
        expect(taskSection).to.not.include("```json");
      } finally {
        VertexAI.prototype.getGenerativeModel = originalGetGenerativeModel;
      }
    });

    it("should handle dependency task with empty output object", async function() {
      this.timeout(10000);

      const { handleOrchestrate } = await import("../../../lib/job/handlers/ai/orchestrate/handler");
      const { VertexAI } = await import("@google-cloud/vertexai");
      const { JobTask } = await import("../../../lib/job/jobTask");
      const { createMockJobContextWithTasks } = await import("../../helpers/jobContextHelper");

      const originalGetGenerativeModel = VertexAI.prototype.getGenerativeModel;

      try {
        let capturedPrompt = "";

        // Create dependency task with empty output object
        const depTask = new JobTask({
          id: "empty-output-task",
          service: "firestore",
          command: "delete-path",
          input: { path: "firestore/(default)/data/temp" },
          status: FirebaseTaskStatus.Succeeded,
          output: {} // Empty object
        });

        const context = createMockJobContextWithTasks([depTask]);

        VertexAI.prototype.getGenerativeModel = function() {
          return {
            generateContent: async (request: any) => {
              capturedPrompt = request.contents[0].parts[0].text;

              return {
                response: {
                  candidates: [{
                    content: {
                      parts: [{
                        text: JSON.stringify({
                          tasks: [{
                            service: "firestore",
                            command: "create-document",
                            input: { documentPath: "firestore/(default)/data/logs/delete", documentData: {} }
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
          id: "orchestrator",
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Log deletion",
            dryRun: false
          },
          dependsOn: ["empty-output-task"],
          depth: 0
        });

        await handleOrchestrate(task, context);

        // Verify empty output is handled correctly
        expect(capturedPrompt).to.include("### Task: empty-output-task");
        expect(capturedPrompt).to.include("**Output**: (no output data)");
      } finally {
        VertexAI.prototype.getGenerativeModel = originalGetGenerativeModel;
      }
    });

    it("should not include dependency section when no dependencies exist", async function() {
      this.timeout(10000);

      const { handleOrchestrate } = await import("../../../lib/job/handlers/ai/orchestrate/handler");
      const { VertexAI } = await import("@google-cloud/vertexai");
      const { JobTask } = await import("../../../lib/job/jobTask");
      const { createMockJobContext } = await import("../../helpers/jobContextHelper");

      const originalGetGenerativeModel = VertexAI.prototype.getGenerativeModel;

      try {
        let capturedPrompt = "";

        const context = createMockJobContext();

        VertexAI.prototype.getGenerativeModel = function() {
          return {
            generateContent: async (request: any) => {
              capturedPrompt = request.contents[0].parts[0].text;

              return {
                response: {
                  candidates: [{
                    content: {
                      parts: [{
                        text: JSON.stringify({
                          tasks: [{
                            service: "firestore",
                            command: "create-document",
                            input: { documentPath: "firestore/(default)/data/test/doc", documentData: {} }
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

        // Task with no dependencies
        const task = new JobTask({
          id: "orchestrator",
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Create a test document",
            dryRun: false
          },
          depth: 0
        });

        await handleOrchestrate(task, context);

        // Verify dependency section is NOT present
        expect(capturedPrompt).to.not.include("## Dependency Task Results");
        expect(capturedPrompt).to.not.include("The following tasks have completed");

        // But the user request should still be there
        expect(capturedPrompt).to.include("# User Request");
        expect(capturedPrompt).to.include("Create a test document");
      } finally {
        VertexAI.prototype.getGenerativeModel = originalGetGenerativeModel;
      }
    });

    it("should include dependency info with verbose mode enabled", async function() {
      this.timeout(10000);

      const { handleOrchestrate } = await import("../../../lib/job/handlers/ai/orchestrate/handler");
      const { VertexAI } = await import("@google-cloud/vertexai");
      const { JobTask } = await import("../../../lib/job/jobTask");
      const { createMockJobContextWithTasks } = await import("../../helpers/jobContextHelper");

      const originalGetGenerativeModel = VertexAI.prototype.getGenerativeModel;
      const originalLog = console.log;
      const logs: string[] = [];

      try {
        let capturedPrompt = "";

        // Capture console logs
        console.log = (...args: any[]) => {
          logs.push(args.join(" "));
        };

        const depTask = new JobTask({
          id: "verbose-dep",
          service: "firestore",
          command: "copy-collection",
          input: { sourcePath: "firestore/(default)/data/a", destinationPath: "firestore/(default)/data/b" },
          status: FirebaseTaskStatus.Succeeded,
          output: { result: "success" }
        });

        const context = createMockJobContextWithTasks([depTask], { verbose: true });

        VertexAI.prototype.getGenerativeModel = function() {
          return {
            generateContent: async (request: any) => {
              capturedPrompt = request.contents[0].parts[0].text;

              return {
                response: {
                  candidates: [{
                    content: {
                      parts: [{
                        text: JSON.stringify({
                          tasks: [{
                            service: "firestore",
                            command: "create-document",
                            input: { documentPath: "firestore/(default)/data/log/1", documentData: {} }
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
          id: "orchestrator",
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Create log",
            dryRun: false,
            verbose: true
          },
          dependsOn: ["verbose-dep"],
          depth: 0
        });

        await handleOrchestrate(task, context);

        // Verify dependency info is in prompt
        expect(capturedPrompt).to.include("### Task: verbose-dep");
        expect(capturedPrompt).to.include('"result": "success"');

        // Verify verbose logging happened
        const relevantLogs = logs.filter(log => log.includes("dependency"));
        expect(relevantLogs.length).to.be.greaterThan(0);

        const collectedLog = logs.find(log => log.includes("Collected") && log.includes("dependency task"));
        expect(collectedLog).to.exist;
        expect(collectedLog).to.include("1 dependency task(s)");
      } finally {
        VertexAI.prototype.getGenerativeModel = originalGetGenerativeModel;
        console.log = originalLog;
      }
    });

    it("should include dependency info without verbose mode", async function() {
      this.timeout(10000);

      const { handleOrchestrate } = await import("../../../lib/job/handlers/ai/orchestrate/handler");
      const { VertexAI } = await import("@google-cloud/vertexai");
      const { JobTask } = await import("../../../lib/job/jobTask");
      const { createMockJobContextWithTasks } = await import("../../helpers/jobContextHelper");

      const originalGetGenerativeModel = VertexAI.prototype.getGenerativeModel;

      try {
        let capturedPrompt = "";

        const depTask = new JobTask({
          id: "silent-dep",
          service: "storage",
          command: "delete-path",
          input: { path: "gs://bucket/old/" },
          status: FirebaseTaskStatus.Succeeded,
          output: { deletedFiles: 25 }
        });

        const context = createMockJobContextWithTasks([depTask], { verbose: false });

        VertexAI.prototype.getGenerativeModel = function() {
          return {
            generateContent: async (request: any) => {
              capturedPrompt = request.contents[0].parts[0].text;

              return {
                response: {
                  candidates: [{
                    content: {
                      parts: [{
                        text: JSON.stringify({
                          tasks: [{
                            service: "firestore",
                            command: "create-document",
                            input: { documentPath: "firestore/(default)/data/log/delete", documentData: {} }
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
          id: "orchestrator",
          service: "ai",
          command: "orchestrate",
          input: {
            prompt: "Log deletion",
            dryRun: false,
            verbose: false
          },
          dependsOn: ["silent-dep"],
          depth: 0
        });

        await handleOrchestrate(task, context);

        // Verify dependency info is still included even without verbose mode
        expect(capturedPrompt).to.include("## Dependency Task Results");
        expect(capturedPrompt).to.include("### Task: silent-dep");
        expect(capturedPrompt).to.include("**Service**: storage");
        expect(capturedPrompt).to.include("**Command**: delete-path");
        expect(capturedPrompt).to.include('"deletedFiles": 25');
      } finally {
        VertexAI.prototype.getGenerativeModel = originalGetGenerativeModel;
      }
    });
  });
});
