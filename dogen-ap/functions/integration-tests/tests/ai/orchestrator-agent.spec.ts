/**
 * Integration tests for Orchestrator Agent (Phase 1 of 3-Phase Orchestration)
 *
 * Tests the orchestrator's ability to decompose user prompts into service-level tasks
 * with proper service selection, task breakdown, and dependency planning.
 */

import { expect } from "chai";
import { VertexAI } from "@google-cloud/vertexai";
import { JobTask } from "../../../src/job/jobTask";
import { createMockJobContext } from "../../helpers/jobContextHelper";
import { handleOrchestratorAgent } from "../../../src/job/handlers/ai/orchestrator-agent/handler";

describe("Orchestrator Agent (Phase 1) - Service Selection & Task Decomposition", () => {
  let originalGetGenerativeModel: any;

  beforeEach(() => {
    // Save original method
    originalGetGenerativeModel = VertexAI.prototype.getGenerativeModel;
  });

  afterEach(() => {
    // Restore original method
    VertexAI.prototype.getGenerativeModel = originalGetGenerativeModel;
  });

  describe("Service Selection", () => {
    it("should select single service for simple operations", async function() {
      this.timeout(10000);

      // Mock AI response for firestore-only operation
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      subtasks: [{
                        id: "task-0",
                        service: "firestore",
                        prompt: "Create a document in the 'restaurants' collection with name field set to 'Pizza Joes'",
                        dependsOn: []
                      }],
                      reasoning: "Single document creation requires only Firestore service"
                    })
                  }]
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

      const task = new JobTask({
        id: "orchestrator-0",
        service: "ai",
        command: "orchestratorAgent",
        input: {
          prompt: "Create a restaurant document named 'Pizza Joes'"
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleOrchestratorAgent(task, context);

      expect(result).to.exist;
      expect(result.output).to.exist;
      expect(result.childTasks).to.exist;
      expect(result.childTasks).to.have.lengthOf(1);
      expect(result.childTasks[0].service).to.equal("ai");
      expect(result.childTasks[0].command).to.equal("service-agent");
      expect(result.childTasks[0].input?.service).to.equal("firestore");
      // Check that ID has -service suffix
      expect(result.childTasks[0].id).to.equal("orchestrator-0-task-0-service");
    });

    it("should select multiple services for multi-service operations", async function() {
      this.timeout(10000);

      // Mock AI response for authentication + firestore operation
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      subtasks: [
                        {
                          id: "create-user",
                          service: "authentication",
                          prompt: "Create user account with email admin@pizzajoes.com",
                          dependsOn: []
                        },
                        {
                          id: "create-restaurant",
                          service: "firestore",
                          prompt: "Create restaurant document owned by the created user",
                          dependsOn: ["create-user"]
                        }
                      ],
                      reasoning: "Need authentication for user creation and firestore for document"
                    })
                  }]
                }
              }],
              usageMetadata: {
                promptTokenCount: 120,
                candidatesTokenCount: 60,
                totalTokenCount: 180
              }
            }
          })
        };
      } as any;

      const task = new JobTask({
        id: "orchestrator-0",
        service: "ai",
        command: "orchestratorAgent",
        input: {
          prompt: "Create admin user admin@pizzajoes.com and a restaurant document owned by that user"
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleOrchestratorAgent(task, context);

      expect(result.childTasks).to.have.lengthOf(2);
      expect(result.childTasks[0].input?.service).to.equal("authentication");
      expect(result.childTasks[1].input?.service).to.equal("firestore");
      // Check scoped IDs with -service suffix
      expect(result.childTasks[0].id).to.equal("orchestrator-0-create-user-service");
      expect(result.childTasks[1].id).to.equal("orchestrator-0-create-restaurant-service");
      // Check dependencies are scoped
      expect(result.childTasks[1].dependsOn).to.include("orchestrator-0-create-user-service");
    });

    it("should reject invalid service names", async function() {
      this.timeout(10000);

      // Mock AI response with invalid service
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      subtasks: [{
                        id: "task-0",
                        service: "invalid-service",
                        prompt: "Do something",
                        dependsOn: []
                      }]
                    })
                  }]
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

      const task = new JobTask({
        id: "orchestrator-0",
        service: "ai",
        command: "orchestratorAgent",
        input: {
          prompt: "Test invalid service",
          maxRetries: 1
        },
        depth: 0
      });

      const context = createMockJobContext();

      let errorThrown = false;
      try {
        await handleOrchestratorAgent(task, context);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("Failed after 1 attempts");
      }

      expect(errorThrown).to.be.true;
    });
  });

  describe("Task Decomposition", () => {
    it("should decompose simple request into single task", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      subtasks: [{
                        id: "export",
                        service: "firestore",
                        prompt: "Export users collection to JSON",
                        dependsOn: []
                      }]
                    })
                  }]
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

      const task = new JobTask({
        id: "orchestrator-0",
        service: "ai",
        command: "orchestratorAgent",
        input: {
          prompt: "Export users collection to JSON"
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleOrchestratorAgent(task, context);

      expect(result.childTasks).to.have.lengthOf(1);
      expect(result.childTasks[0].input?.id).to.equal("export-service");
      expect(result.childTasks[0].id).to.equal("orchestrator-0-export-service");
    });

    it("should decompose complex request into multiple sequential tasks", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      subtasks: [
                        {
                          id: "backup",
                          service: "firestore",
                          prompt: "Copy users collection to users_backup",
                          dependsOn: []
                        },
                        {
                          id: "export",
                          service: "firestore",
                          prompt: "Export users_backup to JSON",
                          dependsOn: ["backup"]
                        }
                      ]
                    })
                  }]
                }
              }],
              usageMetadata: {
                promptTokenCount: 120,
                candidatesTokenCount: 60,
                totalTokenCount: 180
              }
            }
          })
        };
      } as any;

      const task = new JobTask({
        id: "orchestrator-0",
        service: "ai",
        command: "orchestratorAgent",
        input: {
          prompt: "Backup users collection and export the backup to JSON"
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleOrchestratorAgent(task, context);

      expect(result.childTasks).to.have.lengthOf(2);
      expect(result.childTasks[0].input?.id).to.equal("backup-service");
      expect(result.childTasks[1].input?.id).to.equal("export-service");
      expect(result.childTasks[1].dependsOn).to.include("orchestrator-0-backup-service");
    });

    it("should decompose parallel operations correctly", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      subtasks: [
                        {
                          id: "export-users",
                          service: "firestore",
                          prompt: "Export users collection to JSON",
                          dependsOn: []
                        },
                        {
                          id: "export-restaurants",
                          service: "firestore",
                          prompt: "Export restaurants collection to JSON",
                          dependsOn: []
                        }
                      ]
                    })
                  }]
                }
              }],
              usageMetadata: {
                promptTokenCount: 120,
                candidatesTokenCount: 60,
                totalTokenCount: 180
              }
            }
          })
        };
      } as any;

      const task = new JobTask({
        id: "orchestrator-0",
        service: "ai",
        command: "orchestratorAgent",
        input: {
          prompt: "Export both users and restaurants collections to JSON"
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleOrchestratorAgent(task, context);

      expect(result.childTasks).to.have.lengthOf(2);
      expect(result.childTasks[0].dependsOn).to.satisfy((val: any) => val === undefined || val.length === 0);
      expect(result.childTasks[1].dependsOn).to.satisfy((val: any) => val === undefined || val.length === 0);
    });
  });

  describe("Dependency Planning", () => {
    it("should create proper dependency chains", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      subtasks: [
                        {
                          id: "create",
                          service: "authentication",
                          prompt: "Create user",
                          dependsOn: []
                        },
                        {
                          id: "set-claims",
                          service: "authentication",
                          prompt: "Set admin claims on created user",
                          dependsOn: ["create"]
                        },
                        {
                          id: "export",
                          service: "firestore",
                          prompt: "Export updated users list",
                          dependsOn: ["set-claims"]
                        }
                      ]
                    })
                  }]
                }
              }],
              usageMetadata: {
                promptTokenCount: 120,
                candidatesTokenCount: 60,
                totalTokenCount: 180
              }
            }
          })
        };
      } as any;

      const task = new JobTask({
        id: "orchestrator-0",
        service: "ai",
        command: "orchestratorAgent",
        input: {
          prompt: "Create admin user, set their claims, then export users list"
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleOrchestratorAgent(task, context);

      expect(result.childTasks).to.have.lengthOf(3);
      expect(result.childTasks[0].dependsOn).to.satisfy((val: any) => val === undefined || val.length === 0);
      expect(result.childTasks[1].dependsOn).to.include("orchestrator-0-create-service");
      expect(result.childTasks[2].dependsOn).to.include("orchestrator-0-set-claims-service");
    });

    it("should detect circular dependencies", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      subtasks: [
                        {
                          id: "task-a",
                          service: "firestore",
                          prompt: "Task A",
                          dependsOn: ["task-b"]
                        },
                        {
                          id: "task-b",
                          service: "firestore",
                          prompt: "Task B",
                          dependsOn: ["task-a"]
                        }
                      ]
                    })
                  }]
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

      const task = new JobTask({
        id: "orchestrator-0",
        service: "ai",
        command: "orchestratorAgent",
        input: {
          prompt: "Test circular dependencies",
          maxRetries: 1
        },
        depth: 0
      });

      const context = createMockJobContext();

      let errorThrown = false;
      try {
        await handleOrchestratorAgent(task, context);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("Failed after 1 attempts");
      }

      expect(errorThrown).to.be.true;
    });

    it("should handle fan-out pattern (one task → many dependents)", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      subtasks: [
                        {
                          id: "backup",
                          service: "firestore",
                          prompt: "Backup users collection",
                          dependsOn: []
                        },
                        {
                          id: "export-json",
                          service: "firestore",
                          prompt: "Export backup to JSON",
                          dependsOn: ["backup"]
                        },
                        {
                          id: "export-csv",
                          service: "firestore",
                          prompt: "Export backup to CSV",
                          dependsOn: ["backup"]
                        }
                      ]
                    })
                  }]
                }
              }],
              usageMetadata: {
                promptTokenCount: 120,
                candidatesTokenCount: 60,
                totalTokenCount: 180
              }
            }
          })
        };
      } as any;

      const task = new JobTask({
        id: "orchestrator-0",
        service: "ai",
        command: "orchestratorAgent",
        input: {
          prompt: "Backup users and export to both JSON and CSV"
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleOrchestratorAgent(task, context);

      expect(result.childTasks).to.have.lengthOf(3);
      expect(result.childTasks[0].dependsOn).to.satisfy((val: any) => val === undefined || val.length === 0);
      expect(result.childTasks[1].dependsOn).to.include("orchestrator-0-backup-service");
      expect(result.childTasks[2].dependsOn).to.include("orchestrator-0-backup-service");
    });
  });

  describe("Validation & Safety Limits", () => {
    it("should enforce maxChildTasks limit", async function() {
      this.timeout(10000);

      // Mock AI to return 3 tasks
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      subtasks: [
                        { id: "task-1", service: "firestore", prompt: "Task 1", dependsOn: [] },
                        { id: "task-2", service: "firestore", prompt: "Task 2", dependsOn: [] },
                        { id: "task-3", service: "firestore", prompt: "Task 3", dependsOn: [] }
                      ]
                    })
                  }]
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

      const task = new JobTask({
        id: "orchestrator-0",
        service: "ai",
        command: "orchestratorAgent",
        input: {
          prompt: "Create multiple tasks",
          maxChildTasks: 2,  // Limit to 2 but AI will return 3
          maxRetries: 1
        },
        depth: 0
      });

      const context = createMockJobContext();

      let errorThrown = false;
      try {
        await handleOrchestratorAgent(task, context);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("Failed after 1 attempts");
      }

      expect(errorThrown).to.be.true;
    });

    it("should enforce depth limits", async function() {
      this.timeout(5000);

      const task = new JobTask({
        id: "orchestrator-at-limit",
        service: "ai",
        command: "orchestratorAgent",
        input: {
          prompt: "Test depth limit",
          maxDepth: 10
        },
        depth: 10  // Already at max depth
      });

      const context = createMockJobContext();

      let errorThrown = false;
      try {
        await handleOrchestratorAgent(task, context);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("Cannot orchestrate at depth 10");
        expect(error.message).to.include("Maximum depth is 10");
      }

      expect(errorThrown).to.be.true;
    });

    it("should handle empty task arrays", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      subtasks: [],
                      reasoning: "No tasks needed"
                    })
                  }]
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

      const task = new JobTask({
        id: "orchestrator-0",
        service: "ai",
        command: "orchestratorAgent",
        input: {
          prompt: "Do nothing",
          maxRetries: 1
        },
        depth: 0
      });

      const context = createMockJobContext();

      let errorThrown = false;
      try {
        await handleOrchestratorAgent(task, context);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("Failed after 1 attempts");
      }

      expect(errorThrown).to.be.true;
    });
  });

  describe("ID Generation & Scoping", () => {
    it("should apply hierarchical ID scoping with -service suffix", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      subtasks: [{
                        id: "custom-backup-task",
                        service: "firestore",
                        prompt: "Backup users collection",
                        dependsOn: []
                      }]
                    })
                  }]
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

      const task = new JobTask({
        id: "orchestrator-0",
        service: "ai",
        command: "orchestratorAgent",
        input: {
          prompt: "Backup users"
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleOrchestratorAgent(task, context);

      // Child task ID should be: parentId-customId-service
      expect(result.childTasks[0].id).to.equal("orchestrator-0-custom-backup-task-service");
      expect(result.childTasks[0].input?.id).to.equal("custom-backup-task-service");
    });

    it("should handle dependency scoping correctly", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      subtasks: [
                        {
                          id: "first-task",
                          service: "firestore",
                          prompt: "Task 1",
                          dependsOn: []
                        },
                        {
                          id: "second-task",
                          service: "firestore",
                          prompt: "Task 2",
                          dependsOn: ["first-task"]
                        }
                      ]
                    })
                  }]
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

      const task = new JobTask({
        id: "parent",
        service: "ai",
        command: "orchestratorAgent",
        input: {
          prompt: "Create two tasks"
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleOrchestratorAgent(task, context);

      expect(result.childTasks[0].id).to.equal("parent-first-task-service");
      expect(result.childTasks[1].id).to.equal("parent-second-task-service");
      expect(result.childTasks[1].dependsOn).to.deep.equal(["parent-first-task-service"]);
      expect(result.childTasks[1].input?.dependsOn).to.deep.equal(["parent-first-task-service"]);
    });

    it("should require IDs from AI (no auto-generation)", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      subtasks: [
                        { service: "firestore", prompt: "Task 1", dependsOn: [] },
                        { service: "firestore", prompt: "Task 2", dependsOn: [] }
                      ]
                    })
                  }]
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

      const task = new JobTask({
        id: "orchestrator-0",
        service: "ai",
        command: "orchestratorAgent",
        input: {
          prompt: "Create two tasks",
          maxRetries: 1
        },
        depth: 0
      });

      const context = createMockJobContext();

      // Schema requires ID field, so this should fail validation
      let errorThrown = false;
      try {
        await handleOrchestratorAgent(task, context);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("Failed after 1 attempts");
      }

      expect(errorThrown).to.be.true;
    });
  });

  describe("Retry Logic", () => {
    it("should retry on validation failure and succeed", async function() {
      this.timeout(10000);

      let attemptCount = 0;

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => {
            attemptCount++;

            // First attempt: invalid service
            if (attemptCount === 1) {
              return {
                response: {
                  candidates: [{
                    content: {
                      parts: [{
                        text: JSON.stringify({
                          subtasks: [{
                            id: "task-0",
                            service: "invalid-service",
                            prompt: "Test",
                            dependsOn: []
                          }]
                        })
                      }]
                    }
                  }],
                  usageMetadata: {
                    promptTokenCount: 100,
                    candidatesTokenCount: 50,
                    totalTokenCount: 150
                  }
                }
              };
            }

            // Second attempt: valid
            return {
              response: {
                candidates: [{
                  content: {
                    parts: [{
                      text: JSON.stringify({
                        subtasks: [{
                          id: "task-0",
                          service: "firestore",
                          prompt: "Test",
                          dependsOn: []
                        }]
                      })
                    }]
                  }
                }],
                usageMetadata: {
                  promptTokenCount: 100,
                  candidatesTokenCount: 50,
                  totalTokenCount: 150
                }
              }
            };
          }
        };
      } as any;

      const task = new JobTask({
        id: "orchestrator-0",
        service: "ai",
        command: "orchestratorAgent",
        input: {
          prompt: "Test retry",
          maxRetries: 3
        },
        depth: 0
      });

      const context = createMockJobContext({ enableTracing: true });
      const result = await handleOrchestratorAgent(task, context);

      expect(result).to.exist;
      expect(result.trace).to.exist;
      expect(result.trace!.retriesUsed).to.equal(2);
      expect(result.childTasks[0].input?.service).to.equal("firestore");
    });
  });

  describe("Child Task Generation", () => {
    it("should generate child tasks for service agents with correct structure", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      subtasks: [
                        {
                          id: "task-0",
                          service: "firestore",
                          prompt: "Create document",
                          dependsOn: []
                        },
                        {
                          id: "task-1",
                          service: "authentication",
                          prompt: "Create user",
                          dependsOn: ["task-0"]
                        }
                      ]
                    })
                  }]
                }
              }],
              usageMetadata: {
                promptTokenCount: 120,
                candidatesTokenCount: 60,
                totalTokenCount: 180
              }
            }
          })
        };
      } as any;

      const task = new JobTask({
        id: "orchestrator-0",
        service: "ai",
        command: "orchestratorAgent",
        input: {
          prompt: "Create document and user"
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleOrchestratorAgent(task, context);

      expect(result.childTasks).to.exist;
      expect(result.childTasks).to.have.lengthOf(2);
      expect(result.childTasks[0].service).to.equal("ai");
      expect(result.childTasks[0].command).to.equal("service-agent");
      expect(result.childTasks[1].service).to.equal("ai");
      expect(result.childTasks[1].command).to.equal("service-agent");

      // Check input structure
      expect(result.childTasks[0].input).to.have.property("id");
      expect(result.childTasks[0].input).to.have.property("service");
      expect(result.childTasks[0].input).to.have.property("prompt");
      expect(result.childTasks[0].input).to.have.property("dependsOn");
    });
  });

  describe("Output Structure", () => {
    it("should return correct output structure with validation report", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      subtasks: [{
                        id: "task-0",
                        service: "firestore",
                        prompt: "Test task",
                        dependsOn: []
                      }],
                      reasoning: "Test reasoning"
                    })
                  }]
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

      const task = new JobTask({
        id: "orchestrator-0",
        service: "ai",
        command: "orchestratorAgent",
        input: {
          prompt: "Test output structure"
        },
        depth: 0
      });

      const context = createMockJobContext({ enableTracing: true });
      const result = await handleOrchestratorAgent(task, context);

      // Check output structure - orchestrator has no actionable output, only trace (when enableTracing is enabled)
      expect(result.output).to.exist;
      expect(result.trace).to.exist;
      expect(result.trace!.reasoning).to.equal("Test reasoning");
      expect(result.trace!.retriesUsed).to.be.a("number");
      expect(result.trace!.validationReport).to.exist;
      expect(result.trace!.validationReport.isValid).to.be.true;
      expect(result.trace!.validationReport.errors).to.be.an("array");
      expect(result.trace!.validationReport.warnings).to.be.an("array");
      expect(result.trace!.validationReport.tasksValidated).to.equal(1);
      expect(result.trace!.childTaskIds).to.deep.equal(["orchestrator-0-task-0-service"]);
    });

    it("should include trace information when enableTracing is enabled", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      subtasks: [{
                        id: "task-0",
                        service: "firestore",
                        prompt: "Test task",
                        dependsOn: []
                      }]
                    })
                  }]
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

      const task = new JobTask({
        id: "orchestrator-0",
        service: "ai",
        command: "orchestratorAgent",
        input: {
          prompt: "Test trace"
        },
        depth: 0
      });

      const context = createMockJobContext({ enableTracing: true });
      const result = await handleOrchestratorAgent(task, context);

      expect(result.trace).to.exist;
      expect(result.trace?.systemInstruction).to.be.a("string");
      expect(result.trace?.userPrompt).to.be.a("string");
      expect(result.trace?.aiResponse).to.be.a("string");
    });
  });

  describe("Context and Configuration", () => {
    it("should respect custom configuration parameters", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      subtasks: [{
                        id: "task-0",
                        service: "firestore",
                        prompt: "Test task",
                        dependsOn: []
                      }]
                    })
                  }]
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

      const task = new JobTask({
        id: "orchestrator-0",
        service: "ai",
        command: "orchestratorAgent",
        input: {
          prompt: "Test config",
          temperature: 0.5,
          maxChildTasks: 50,
          maxDepth: 5,
          verbose: true,
          model: "gemini-2.5-pro"
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleOrchestratorAgent(task, context);

      expect(result).to.exist;
      expect(result.childTasks).to.have.lengthOf(1);
    });

    it("should pass additional context to AI", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      subtasks: [{
                        id: "task-0",
                        service: "firestore",
                        prompt: "Test task with context",
                        dependsOn: []
                      }]
                    })
                  }]
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

      const task = new JobTask({
        id: "orchestrator-0",
        service: "ai",
        command: "orchestratorAgent",
        input: {
          prompt: "Test with context",
          context: {
            userId: "user123",
            environment: "production"
          }
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleOrchestratorAgent(task, context);

      expect(result).to.exist;
      expect(result.childTasks).to.have.lengthOf(1);
    });
  });
});
