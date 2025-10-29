/**
 * Integration tests for Service Agent (Phase 2 of 3-Phase Orchestration)
 *
 * Tests the service agent's ability to select appropriate commands within a service,
 * refine prompts for command agents, and validate command selection.
 */

import { expect } from "chai";
import { VertexAI } from "@google-cloud/vertexai";
import { JobTask, FirebaseTaskStatus } from "../../../src/job/jobTask";
import { createMockJobContext, createMockJobContextWithTasks } from "../../helpers/jobContextHelper";
import { handleServiceAgent } from "../../../src/job/handlers/ai/service-agent/handler";

describe("Service Agent (Phase 2) - Command Selection & Prompt Refinement", () => {
  let originalGetGenerativeModel: any;

  beforeEach(() => {
    // Save original method
    originalGetGenerativeModel = VertexAI.prototype.getGenerativeModel;
  });

  afterEach(() => {
    // Restore original method
    VertexAI.prototype.getGenerativeModel = originalGetGenerativeModel;
  });

  describe("Command Selection", () => {
    it("should select appropriate firestore command", async function() {
      this.timeout(10000);

      // Mock AI response for firestore command selection
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      id: "task-0-service",
                      service: "firestore",
                      command: "create-document",
                      prompt: "Create a document at path 'restaurants/{docId}' with documentData containing field name='Pizza Palace'",
                      dependsOn: []
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
        id: "task-0-service",
        service: "ai",
        command: "service-agent",
        input: {
          id: "task-0-service",
          service: "firestore",
          prompt: "Create a restaurant document named 'Pizza Palace'",
          dependsOn: []
        },
        depth: 0
      });

      const context = createMockJobContext({ enableTracing: true });
      const result = await handleServiceAgent(task, context);

      expect(result).to.exist;
      expect(result.output).to.exist;
      expect(result.childTasks).to.exist;
      expect(result.childTasks).to.have.lengthOf(1);

      // Check child task structure
      expect(result.childTasks[0].service).to.equal("ai");
      expect(result.childTasks[0].command).to.equal("command-agent");
      expect(result.childTasks[0].input.command).to.equal("create-document");
      expect(result.childTasks[0].input.service).to.equal("firestore");
      expect(result.childTasks[0].id).to.equal("task-0-command");

      // Check output structure - service-agent has no actionable output, only trace (when enableTracing is enabled)
      expect(result.output).to.exist;
      expect(result.trace).to.exist;
      expect(result.trace!.childTaskIds).to.deep.equal(["task-0-command"]);
    });

    it("should select appropriate authentication command", async function() {
      this.timeout(10000);

      // Mock AI response for authentication command selection
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      id: "task-1-service",
                      service: "authentication",
                      command: "create-user",
                      prompt: "Create a user with email admin@example.com and password",
                      dependsOn: []
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
        id: "task-1-service",
        service: "ai",
        command: "service-agent",
        input: {
          id: "task-1-service",
          service: "authentication",
          prompt: "Create an admin user with email admin@example.com",
          dependsOn: []
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleServiceAgent(task, context);

      expect(result.childTasks[0].input.command).to.equal("create-user");
      expect(result.childTasks[0].input.service).to.equal("authentication");
    });

    it("should select appropriate storage command", async function() {
      this.timeout(10000);

      // Mock AI response for storage command selection
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      id: "task-2-service",
                      service: "storage",
                      command: "delete-path",
                      prompt: "Delete all files in the 'temp' folder",
                      dependsOn: []
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
        id: "task-2-service",
        service: "ai",
        command: "service-agent",
        input: {
          id: "task-2-service",
          service: "storage",
          prompt: "Delete temp folder",
          dependsOn: []
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleServiceAgent(task, context);

      expect(result.childTasks[0].input.command).to.equal("delete-path");
      expect(result.childTasks[0].input.service).to.equal("storage");
    });

    it("should reject invalid commands for service", async function() {
      this.timeout(10000);

      // Mock AI response with invalid command
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      id: "task-0-service",
                      service: "firestore",
                      command: "invalid-command",
                      prompt: "Do something",
                      dependsOn: []
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
        id: "task-0-service",
        service: "ai",
        command: "service-agent",
        input: {
          id: "task-0-service",
          service: "firestore",
          prompt: "Do something invalid",
          dependsOn: [],
          maxRetries: 1
        },
        depth: 0
      });

      const context = createMockJobContext();

      let errorThrown = false;
      try {
        await handleServiceAgent(task, context);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("Invalid command");
      }

      expect(errorThrown).to.be.true;
    });
  });

  describe("Prompt Refinement", () => {
    it("should refine prompt with parameter hints", async function() {
      this.timeout(10000);

      // Mock AI response with refined prompt
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      id: "task-0-service",
                      service: "firestore",
                      command: "create-document",
                      prompt: "Create a document at path 'users/{userId}' with documentData containing fields: email, name, createdAt",
                      dependsOn: []
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
        id: "task-0-service",
        service: "ai",
        command: "service-agent",
        input: {
          id: "task-0-service",
          service: "firestore",
          prompt: "Create a user document with email and name",
          dependsOn: []
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleServiceAgent(task, context);

      expect(result.childTasks[0].input.prompt).to.exist;
      expect(result.childTasks[0].input.prompt).to.be.a("string");
      expect(result.childTasks[0].input.prompt.length).to.be.greaterThan(10);
    });

    it("should include command-specific details in refined prompt", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      id: "task-0-service",
                      service: "firestore",
                      command: "export-collection-json",
                      prompt: "Export the 'users' collection to JSON format with all fields included",
                      dependsOn: []
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
        id: "task-0-service",
        service: "ai",
        command: "service-agent",
        input: {
          id: "task-0-service",
          service: "firestore",
          prompt: "Export users collection",
          dependsOn: []
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleServiceAgent(task, context);

      expect(result.childTasks[0].input.prompt).to.include("users");
      expect(result.childTasks[0].input.command).to.equal("export-collection-json");
    });
  });

  describe("Dependency Passthrough", () => {
    it("should preserve dependencies from input", async function() {
      this.timeout(10000);

      // Mock AI response preserving dependencies
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      id: "task-1-service",
                      service: "firestore",
                      command: "create-document",
                      prompt: "Create document using data from task-0",
                      dependsOn: ["task-0-service"]
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
        id: "task-1-service",
        service: "ai",
        command: "service-agent",
        input: {
          id: "task-1-service",
          service: "firestore",
          prompt: "Create document based on previous task",
          dependsOn: ["task-0-service"]
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleServiceAgent(task, context);

      // Dependencies are transformed: -service → -command
      expect(result.childTasks[0].input.dependsOn).to.deep.equal(["task-0-command"]);
      expect(result.childTasks[0].dependsOn).to.deep.equal(["task-0-command"]);
    });

    it("should handle empty dependencies", async function() {
      this.timeout(10000);

      // Mock AI response with no dependencies
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      id: "task-0-service",
                      service: "firestore",
                      command: "create-document",
                      prompt: "Create independent document",
                      dependsOn: []
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
        id: "task-0-service",
        service: "ai",
        command: "service-agent",
        input: {
          id: "task-0-service",
          service: "firestore",
          prompt: "Create a standalone document",
          dependsOn: []
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleServiceAgent(task, context);

      expect(result.childTasks[0].input.dependsOn).to.be.an("array");
      expect(result.childTasks[0].input.dependsOn).to.be.empty;
    });

    it("should use task.dependsOn for dependency outputs (with propagation)", async function() {
      this.timeout(10000);

      // Create mock completed tasks with outputs
      const completedTaskA = new JobTask({
        id: "task-a",
        service: "firestore",
        command: "create-document",
        input: {},
        depth: 0,
        status: FirebaseTaskStatus.Succeeded,
        output: { result: { documentId: "doc-123" } }
      });

      const completedTaskA1 = new JobTask({
        id: "task-a-1",
        service: "firestore",
        command: "update-document",
        input: {},
        depth: 1,
        status: FirebaseTaskStatus.Succeeded,
        output: { result: { updated: true } }
      });

      // Mock AI response
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      id: "task-b-service",
                      service: "firestore",
                      command: "create-document",
                      prompt: "Create document using outputs from task-a and task-a-1",
                      dependsOn: ["task-a", "task-a-1"]
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
        id: "task-b-service",
        service: "ai",
        command: "service-agent",
        input: {
          id: "task-b-service",
          service: "firestore",
          prompt: "Create document based on previous tasks",
          dependsOn: ["task-a"]  // Original only had task-a
        },
        depth: 0
      });

      // Set task.dependsOn to include propagated dependency
      task.dependsOn = ["task-a", "task-a-1"];  // Propagation added task-a-1

      const context = createMockJobContextWithTasks([completedTaskA, completedTaskA1]);
      const result = await handleServiceAgent(task, context);

      // Service agent should access both dependency outputs
      expect(result).to.exist;
    });
  });

  describe("Validation", () => {
    it("should validate required fields in input", async function() {
      this.timeout(5000);

      const task = new JobTask({
        id: "task-0-service",
        service: "ai",
        command: "service-agent",
        input: {
          // Missing required fields
          id: "task-0-service"
        },
        depth: 0
      });

      const context = createMockJobContext();

      let errorThrown = false;
      try {
        await handleServiceAgent(task, context);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("required");
      }

      expect(errorThrown).to.be.true;
    });

    it("should validate AI response structure", async function() {
      this.timeout(10000);

      // Mock AI response with invalid structure
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      // Missing required fields
                      id: "task-0-service"
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
        id: "task-0-service",
        service: "ai",
        command: "service-agent",
        input: {
          id: "task-0-service",
          service: "firestore",
          prompt: "Create a document",
          dependsOn: [],
          maxRetries: 1
        },
        depth: 0
      });

      const context = createMockJobContext();

      let errorThrown = false;
      try {
        await handleServiceAgent(task, context);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("does not match expected schema");
      }

      expect(errorThrown).to.be.true;
    });

    it("should validate command exists in service catalog", async function() {
      this.timeout(10000);

      // Mock AI response with command not in catalog
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      id: "task-0-service",
                      service: "firestore",
                      command: "nonexistent-command",
                      prompt: "Do something",
                      dependsOn: []
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
        id: "task-0-service",
        service: "ai",
        command: "service-agent",
        input: {
          id: "task-0-service",
          service: "firestore",
          prompt: "Do something",
          dependsOn: [],
          maxRetries: 1
        },
        depth: 0
      });

      const context = createMockJobContext();

      let errorThrown = false;
      try {
        await handleServiceAgent(task, context);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("Invalid command");
      }

      expect(errorThrown).to.be.true;
    });
  });

  describe("Retry Logic", () => {
    it("should retry on validation failure and succeed", async function() {
      this.timeout(10000);

      let attemptCount = 0;

      // Mock AI response that fails first, then succeeds
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => {
            attemptCount++;

            if (attemptCount === 1) {
              // First attempt: invalid response
              return {
                response: {
                  candidates: [{
                    content: {
                      parts: [{
                        text: JSON.stringify({
                          id: "task-0-service"
                          // Missing required fields
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
            } else {
              // Second attempt: valid response
              return {
                response: {
                  candidates: [{
                    content: {
                      parts: [{
                        text: JSON.stringify({
                          id: "task-0-service",
                          service: "firestore",
                          command: "create-document",
                          prompt: "Create document",
                          dependsOn: []
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
          }
        };
      } as any;

      const task = new JobTask({
        id: "task-0-service",
        service: "ai",
        command: "service-agent",
        input: {
          id: "task-0-service",
          service: "firestore",
          prompt: "Create a document",
          dependsOn: [],
          maxRetries: 3
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleServiceAgent(task, context);

      expect(result.childTasks[0].input.command).to.equal("create-document");
      expect(attemptCount).to.equal(2);
    });

    it("should fail after max retries exhausted", async function() {
      this.timeout(10000);

      // Mock AI response that always fails
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      id: "task-0-service"
                      // Missing required fields
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
        id: "task-0-service",
        service: "ai",
        command: "service-agent",
        input: {
          id: "task-0-service",
          service: "firestore",
          prompt: "Create a document",
          dependsOn: [],
          maxRetries: 2
        },
        depth: 0
      });

      const context = createMockJobContext();

      let errorThrown = false;
      try {
        await handleServiceAgent(task, context);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("Failed after 2 attempts");
      }

      expect(errorThrown).to.be.true;
    });
  });

  describe("Child Task Generation", () => {
    it("should generate command-agent child task with correct structure", async function() {
      this.timeout(10000);

      // Mock AI response
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      id: "task-0-service",
                      service: "firestore",
                      command: "create-document",
                      prompt: "Create a document at path 'users/user123'",
                      dependsOn: []
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
        id: "task-0-service",
        service: "ai",
        command: "service-agent",
        input: {
          id: "task-0-service",
          service: "firestore",
          prompt: "Create a user document",
          dependsOn: []
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleServiceAgent(task, context);

      expect(result.childTasks).to.exist;
      expect(result.childTasks).to.have.lengthOf(1);
      expect(result.childTasks[0].service).to.equal("ai");
      expect(result.childTasks[0].command).to.equal("command-agent");
      expect(result.childTasks[0].input).to.exist;
      expect(result.childTasks[0].input.service).to.equal("firestore");
      expect(result.childTasks[0].input.command).to.equal("create-document");
      expect(result.childTasks[0].id).to.equal("task-0-command");
    });

    it("should transform -service suffix to -command suffix", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      id: "orchestrator-0-task-0-service",
                      service: "firestore",
                      command: "create-document",
                      prompt: "Create document",
                      dependsOn: []
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
        id: "orchestrator-0-task-0-service",
        service: "ai",
        command: "service-agent",
        input: {
          id: "orchestrator-0-task-0-service",
          service: "firestore",
          prompt: "Create a document",
          dependsOn: []
        },
        depth: 1
      });

      const context = createMockJobContext();
      const result = await handleServiceAgent(task, context);

      expect(result.childTasks[0].id).to.equal("orchestrator-0-task-0-command");
      expect(result.childTasks[0].input.id).to.equal("orchestrator-0-task-0-command");
    });
  });

  describe("Output Structure", () => {
    it("should return correct output structure", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      id: "task-0-service",
                      service: "firestore",
                      command: "create-document",
                      prompt: "Test task",
                      dependsOn: []
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
        id: "task-0-service",
        service: "ai",
        command: "service-agent",
        input: {
          id: "task-0-service",
          service: "firestore",
          prompt: "Test output structure",
          dependsOn: []
        },
        depth: 0
      });

      const context = createMockJobContext({ enableTracing: true });
      const result = await handleServiceAgent(task, context);

      // Check output structure - service-agent has no actionable output, only trace (when enableTracing is enabled)
      expect(result.output).to.exist;
      expect(result.trace).to.exist;
      expect(result.trace!.childTaskIds).to.deep.equal(["task-0-command"]);
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
                      id: "task-0-service",
                      service: "firestore",
                      command: "create-document",
                      prompt: "Test task",
                      dependsOn: []
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
        id: "task-0-service",
        service: "ai",
        command: "service-agent",
        input: {
          id: "task-0-service",
          service: "firestore",
          prompt: "Test trace",
          dependsOn: []
        },
        depth: 0
      });

      const context = createMockJobContext({ enableTracing: true });
      const result = await handleServiceAgent(task, context);

      expect(result.trace).to.exist;
      expect(result.trace?.selectedCommand).to.equal("create-document");
      expect(result.trace?.refinedPrompt).to.be.a("string");
      expect(result.trace?.systemInstruction).to.be.a("string");
      expect(result.trace?.userPrompt).to.be.a("string");
      expect(result.trace?.aiResponse).to.be.a("string");
    });
  });

  describe("Service Coverage", () => {
    it("should handle all available services", async function() {
      this.timeout(30000);

      const services = ["firestore", "authentication", "storage"];

      for (const service of services) {
        VertexAI.prototype.getGenerativeModel = function() {
          return {
            generateContent: async () => ({
              response: {
                candidates: [{
                  content: {
                    parts: [{
                      text: JSON.stringify({
                        id: `${service}-task-service`,
                        service: service,
                        command: service === "firestore" ? "create-document" :
                                service === "authentication" ? "create-user" : "delete-path",
                        prompt: `Test ${service} command`,
                        dependsOn: []
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
          id: `${service}-task-service`,
          service: "ai",
          command: "service-agent",
          input: {
            id: `${service}-task-service`,
            service: service,
            prompt: `Test ${service}`,
            dependsOn: []
          },
          depth: 0
        });

        const context = createMockJobContext();
        const result = await handleServiceAgent(task, context);

        expect(result.childTasks[0].input.service).to.equal(service);
      }
    });
  });
});
