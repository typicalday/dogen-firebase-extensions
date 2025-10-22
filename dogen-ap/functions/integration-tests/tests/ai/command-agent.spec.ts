/**
 * Integration tests for Command Agent (Phase 3 of 3-Phase Orchestration)
 *
 * Tests the command agent's ability to construct valid parameters for commands,
 * enforce schema validation, handle type conversion, and spawn executable tasks.
 */

import { expect } from "chai";
import { VertexAI } from "@google-cloud/vertexai";
import { JobTask } from "../../../src/job/jobTask";
import { createMockJobContext } from "../../helpers/jobContextHelper";
import { handleCommandAgent } from "../../../src/job/handlers/ai/command-agent/handler";

describe("Command Agent (Phase 3) - Parameter Construction & Schema Validation", () => {
  let originalGetGenerativeModel: any;

  beforeEach(() => {
    // Save original method
    originalGetGenerativeModel = VertexAI.prototype.getGenerativeModel;
  });

  afterEach(() => {
    // Restore original method
    VertexAI.prototype.getGenerativeModel = originalGetGenerativeModel;
  });

  describe("Parameter Construction", () => {
    it("should construct valid parameters for firestore create-document", async function() {
      this.timeout(10000);

      // Mock AI response with valid create-document parameters
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      documentPath: "firestore/default/data/restaurants/pizza-palace",
                      documentData: {
                        name: "Pizza Palace",
                        cuisine: "Italian",
                        rating: 4.5
                      }
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
        id: "command-agent-0",
        service: "ai",
        command: "command-agent",
        input: {
          id: "task-0",
          service: "firestore",
          command: "create-document",
          prompt: "Create a restaurant document for Pizza Palace with Italian cuisine and 4.5 rating",
          dependsOn: []
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleCommandAgent(task, context);

      expect(result).to.exist;
      expect(result.output).to.exist;
      expect(result.childTasks).to.exist;
      expect(result.childTasks).to.have.lengthOf(1);
      expect(result.childTasks![0].input.documentPath).to.equal("firestore/default/data/restaurants/pizza-palace");
      expect(result.childTasks![0].input.documentData).to.deep.equal({
        name: "Pizza Palace",
        cuisine: "Italian",
        rating: 4.5
      });
    });

    it("should construct valid parameters for authentication create-user", async function() {
      this.timeout(10000);

      // Mock AI response with valid create-user parameters
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      userRecord: {
                        email: "admin@example.com",
                        password: "SecurePass123!",
                        displayName: "Admin User"
                      }
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
        id: "command-agent-1",
        service: "ai",
        command: "command-agent",
        input: {
          id: "task-1",
          service: "authentication",
          command: "create-user",
          prompt: "Create an admin user with email admin@example.com",
          dependsOn: []
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleCommandAgent(task, context);

      expect(result.childTasks).to.exist;
      expect(result.childTasks).to.have.lengthOf(1);
      expect(result.childTasks![0].input.userRecord).to.exist;
      expect(result.childTasks![0].input.userRecord.email).to.equal("admin@example.com");
      expect(result.childTasks![0].input.userRecord.password).to.exist;
      expect(result.childTasks![0].input.userRecord.displayName).to.equal("Admin User");
    });

    it("should handle complex nested object parameters", async function() {
      this.timeout(10000);

      // Mock AI response with nested documentData
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      documentPath: "firestore/default/data/users/user123",
                      documentData: {
                        profile: {
                          firstName: "John",
                          lastName: "Doe"
                        },
                        settings: {
                          notifications: true,
                          theme: "dark"
                        },
                        tags: ["premium", "verified"]
                      }
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
        id: "command-agent-2",
        service: "ai",
        command: "command-agent",
        input: {
          id: "task-2",
          service: "firestore",
          command: "create-document",
          prompt: "Create a user with nested profile and settings",
          dependsOn: []
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleCommandAgent(task, context);

      expect(result.childTasks).to.exist;
      expect(result.childTasks).to.have.lengthOf(1);
      expect(result.childTasks![0].input.documentData.profile).to.deep.equal({
        firstName: "John",
        lastName: "Doe"
      });
      expect(result.childTasks![0].input.documentData.settings).to.exist;
      expect(result.childTasks![0].input.documentData.tags).to.be.an("array");
    });
  });

  describe("Schema Validation", () => {
    it("should validate parameters against command schema", async function() {
      this.timeout(10000);

      // Mock AI response with valid schema-compliant parameters
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      documentPath: "firestore/default/data/products/prod123",
                      documentData: {
                        name: "Product",
                        price: 99.99
                      }
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
        id: "command-agent-0",
        service: "ai",
        command: "command-agent",
        input: {
          id: "task-0",
          service: "firestore",
          command: "create-document",
          prompt: "Create a product document",
          dependsOn: []
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleCommandAgent(task, context);

      expect(result.childTasks).to.exist;
      expect(result.childTasks).to.have.lengthOf(1);
      expect(result.childTasks![0].input.documentPath).to.match(/^firestore\/[^/]+\/data\/.+/);
      expect(result.childTasks![0].input.documentData).to.be.an("object");
    });

    it("should reject parameters missing required fields", async function() {
      this.timeout(10000);

      // Mock AI response missing required documentData field
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      documentPath: "firestore/default/data/products/prod123"
                      // Missing documentData
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
        id: "command-agent-0",
        service: "ai",
        command: "command-agent",
        input: {
          id: "task-0",
          service: "firestore",
          command: "create-document",
          prompt: "Create a product",
          dependsOn: [],
          maxRetries: 1
        },
        depth: 0
      });

      const context = createMockJobContext();

      let errorThrown = false;
      try {
        await handleCommandAgent(task, context);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("Parameter validation errors");
      }

      expect(errorThrown).to.be.true;
    });

    it("should reject parameters with invalid path format", async function() {
      this.timeout(10000);

      const { handleCommandAgent } = await import("../../../src/job/handlers/ai/command-agent/handler");

      // Mock AI response with invalid path (missing firestore prefix)
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      documentPath: "default/data/products/prod123", // Invalid - missing firestore/ prefix
                      documentData: {
                        name: "Product"
                      }
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
        id: "command-agent-0",
        service: "ai",
        command: "command-agent",
        input: {
          id: "task-0",
          service: "firestore",
          command: "create-document",
          prompt: "Create a product",
          dependsOn: [],
          maxRetries: 1
        },
        depth: 0
      });

      const context = createMockJobContext();

      let errorThrown = false;
      try {
        await handleCommandAgent(task, context);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("Parameter validation errors");
      }

      expect(errorThrown).to.be.true;
    });
  });

  describe("Type Conversion & Handling", () => {
    it("should handle string parameters correctly", async function() {
      this.timeout(10000);

      const { handleCommandAgent } = await import("../../../src/job/handlers/ai/command-agent/handler");

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      sourcePath: "firestore/default/data/users/user1",
                      destinationPath: "firestore/default/data/users_backup/user1"
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
        id: "command-agent-0",
        service: "ai",
        command: "command-agent",
        input: {
          id: "task-0",
          service: "firestore",
          command: "copy-document",
          prompt: "Copy user1 to backup",
          dependsOn: []
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleCommandAgent(task, context);

      expect(result.childTasks).to.exist;
      expect(result.childTasks).to.have.lengthOf(1);
      expect(result.childTasks![0].input.sourcePath).to.be.a("string");
      expect(result.childTasks![0].input.destinationPath).to.be.a("string");
    });

    it("should handle object parameters correctly", async function() {
      this.timeout(10000);

      const { handleCommandAgent } = await import("../../../src/job/handlers/ai/command-agent/handler");

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      documentPath: "firestore/default/data/config/settings",
                      documentData: {
                        theme: "dark",
                        language: "en",
                        features: {
                          beta: true,
                          experimental: false
                        }
                      }
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
        id: "command-agent-0",
        service: "ai",
        command: "command-agent",
        input: {
          id: "task-0",
          service: "firestore",
          command: "create-document",
          prompt: "Create settings document",
          dependsOn: []
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleCommandAgent(task, context);

      expect(result.childTasks).to.exist;
      expect(result.childTasks).to.have.lengthOf(1);
      expect(result.childTasks![0].input.documentData).to.be.an("object");
      expect(result.childTasks![0].input.documentData.features).to.be.an("object");
    });
  });

  describe("Dependency Handling", () => {
    it("should preserve dependencies from input", async function() {
      this.timeout(10000);

      const { handleCommandAgent } = await import("../../../src/job/handlers/ai/command-agent/handler");

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      documentPath: "firestore/default/data/orders/order123",
                      documentData: {
                        userId: "user456",
                        status: "pending"
                      }
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
        id: "command-agent-1",
        service: "ai",
        command: "command-agent",
        input: {
          id: "task-1",
          service: "firestore",
          command: "create-document",
          prompt: "Create order using user from task-0",
          dependsOn: ["task-0"]
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleCommandAgent(task, context);

      expect(result.childTasks).to.exist;
      expect(result.childTasks).to.have.lengthOf(1);
      // Dependencies should be preserved in child task (not transformed since they don't end with -command)
      expect(result.childTasks![0].dependsOn).to.deep.equal(["task-0"]);
    });

    it("should handle empty dependencies", async function() {
      this.timeout(10000);

      const { handleCommandAgent } = await import("../../../src/job/handlers/ai/command-agent/handler");

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      documentPath: "firestore/default/data/items/item1",
                      documentData: {
                        name: "Item"
                      }
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
        id: "command-agent-0",
        service: "ai",
        command: "command-agent",
        input: {
          id: "task-0",
          service: "firestore",
          command: "create-document",
          prompt: "Create independent item",
          dependsOn: []
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleCommandAgent(task, context);

      expect(result.childTasks).to.exist;
      expect(result.childTasks).to.have.lengthOf(1);
      // No dependencies should result in undefined (not an empty array)
      expect(result.childTasks![0].dependsOn).to.be.undefined;
    });
  });

  describe("Validation & Input Checking", () => {
    it("should validate required input fields", async function() {
      this.timeout(5000);

      const { handleCommandAgent } = await import("../../../src/job/handlers/ai/command-agent/handler");

      const task = new JobTask({
        id: "command-agent-0",
        service: "ai",
        command: "command-agent",
        input: {
          // Missing required fields
          id: "task-0"
        },
        depth: 0
      });

      const context = createMockJobContext();

      let errorThrown = false;
      try {
        await handleCommandAgent(task, context);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("required");
      }

      expect(errorThrown).to.be.true;
    });

    it("should validate AI response is valid JSON", async function() {
      this.timeout(10000);

      // Mock AI response with invalid JSON
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: "This is not valid JSON"
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
        id: "command-agent-0",
        service: "ai",
        command: "command-agent",
        input: {
          id: "task-0",
          service: "firestore",
          command: "create-document",
          prompt: "Create a document",
          dependsOn: [],
          maxRetries: 1
        },
        depth: 0
      });

      const context = createMockJobContext();

      let errorThrown = false;
      try {
        await handleCommandAgent(task, context);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("Failed to parse AI response as JSON");
      }

      expect(errorThrown).to.be.true;
    });

    it("should validate AI response is an object", async function() {
      this.timeout(10000);

      const { handleCommandAgent } = await import("../../../src/job/handlers/ai/command-agent/handler");

      // Mock AI response with array instead of object
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify([
                      { field: "value" }
                    ])
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
        id: "command-agent-0",
        service: "ai",
        command: "command-agent",
        input: {
          id: "task-0",
          service: "firestore",
          command: "create-document",
          prompt: "Create a document",
          dependsOn: [],
          maxRetries: 1
        },
        depth: 0
      });

      const context = createMockJobContext();

      let errorThrown = false;
      try {
        await handleCommandAgent(task, context);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("AI response must be a JSON object");
      }

      expect(errorThrown).to.be.true;
    });
  });

  describe("Retry Logic", () => {
    it("should retry on validation failure and succeed", async function() {
      this.timeout(10000);

      const { handleCommandAgent } = await import("../../../src/job/handlers/ai/command-agent/handler");

      let attemptCount = 0;

      // Mock AI response that fails first, then succeeds
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => {
            attemptCount++;

            if (attemptCount === 1) {
              // First attempt: missing required field
              return {
                response: {
                  candidates: [{
                    content: {
                      parts: [{
                        text: JSON.stringify({
                          documentPath: "firestore/default/data/test/doc1"
                          // Missing documentData
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
                          documentPath: "firestore/default/data/test/doc1",
                          documentData: {
                            field: "value"
                          }
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
        id: "command-agent-0",
        service: "ai",
        command: "command-agent",
        input: {
          id: "task-0",
          service: "firestore",
          command: "create-document",
          prompt: "Create a document",
          dependsOn: [],
          maxRetries: 3
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleCommandAgent(task, context);

      expect(result.childTasks).to.exist;
      expect(result.childTasks).to.have.lengthOf(1);
      expect(result.childTasks![0].input.documentData).to.exist;
      expect(attemptCount).to.equal(2);
    });

    it("should fail after max retries", async function() {
      this.timeout(10000);

      const { handleCommandAgent } = await import("../../../src/job/handlers/ai/command-agent/handler");

      // Mock AI response that always fails
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      documentPath: "firestore/default/data/test/doc1"
                      // Always missing documentData
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
        id: "command-agent-0",
        service: "ai",
        command: "command-agent",
        input: {
          id: "task-0",
          service: "firestore",
          command: "create-document",
          prompt: "Create a document",
          dependsOn: [],
          maxRetries: 2
        },
        depth: 0
      });

      const context = createMockJobContext();

      let errorThrown = false;
      try {
        await handleCommandAgent(task, context);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("Failed after 2 attempts");
      }

      expect(errorThrown).to.be.true;
    });
  });

  describe("Child Task Generation", () => {
    it("should spawn actual service task as child", async function() {
      this.timeout(10000);

      const { handleCommandAgent } = await import("../../../src/job/handlers/ai/command-agent/handler");

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      documentPath: "firestore/default/data/products/prod1",
                      documentData: {
                        name: "Product 1",
                        price: 19.99
                      }
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
        id: "command-agent-0",
        service: "ai",
        command: "command-agent",
        input: {
          id: "task-0",
          service: "firestore",
          command: "create-document",
          prompt: "Create a product document",
          dependsOn: []
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleCommandAgent(task, context);

      expect(result.childTasks).to.exist;
      expect(result.childTasks).to.have.lengthOf(1);
      // Child task ID should be transformed: task.id ends with nothing, so becomes task.id-run
      expect(result.childTasks![0].id).to.equal("command-agent-0-run");
      expect(result.childTasks![0].service).to.equal("firestore");
      expect(result.childTasks![0].command).to.equal("create-document");
      expect(result.childTasks![0].input).to.deep.equal({
        documentPath: "firestore/default/data/products/prod1",
        documentData: {
          name: "Product 1",
          price: 19.99
        }
      });
    });

    it("should include dependencies in child task when present", async function() {
      this.timeout(10000);

      const { handleCommandAgent } = await import("../../../src/job/handlers/ai/command-agent/handler");

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      documentPath: "firestore/default/data/orders/order1",
                      documentData: {
                        userId: "user123"
                      }
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
        id: "command-agent-1",
        service: "ai",
        command: "command-agent",
        input: {
          id: "task-1",
          service: "firestore",
          command: "create-document",
          prompt: "Create order for user from task-0",
          dependsOn: ["task-0"]
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleCommandAgent(task, context);

      expect(result.childTasks).to.exist;
      expect(result.childTasks).to.have.lengthOf(1);
      // Dependencies should be preserved (not transformed since they don't end with -command)
      expect(result.childTasks![0].dependsOn).to.deep.equal(["task-0"]);
    });

    it("should not include dependsOn in child task when empty", async function() {
      this.timeout(10000);
      
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      documentPath: "firestore/default/data/items/item1",
                      documentData: {
                        name: "Item"
                      }
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
        id: "command-agent-0",
        service: "ai",
        command: "command-agent",
        input: {
          id: "task-0",
          service: "firestore",
          command: "create-document",
          prompt: "Create independent item",
          dependsOn: []
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleCommandAgent(task, context);

      expect(result.childTasks).to.exist;
      expect(result.childTasks).to.have.lengthOf(1);
      expect(result.childTasks![0].dependsOn).to.be.undefined;
    });

    it("should transform -command suffix to -run in child task ID", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      documentPath: "firestore/default/data/items/item1",
                      documentData: {
                        name: "Item"
                      }
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

      // Task ID ends with -command, should be transformed to -run
      const task = new JobTask({
        id: "orchestrator-0-task-0-command",
        service: "ai",
        command: "command-agent",
        input: {
          id: "task-0-command",
          service: "firestore",
          command: "create-document",
          prompt: "Create item",
          dependsOn: []
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleCommandAgent(task, context);

      expect(result.childTasks).to.exist;
      expect(result.childTasks).to.have.lengthOf(1);
      // Should transform -command to -run
      expect(result.childTasks![0].id).to.equal("orchestrator-0-task-0-run");
    });

    it("should transform -command suffix to -run in dependencies", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      documentPath: "firestore/default/data/orders/order1",
                      documentData: {
                        userId: "user123"
                      }
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
        id: "orchestrator-0-task-1-command",
        service: "ai",
        command: "command-agent",
        input: {
          id: "task-1-command",
          service: "firestore",
          command: "create-document",
          prompt: "Create order depending on task-0-command",
          dependsOn: ["task-0-command", "task-0a"]  // Mix of -command and non-command dependencies
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleCommandAgent(task, context);

      expect(result.childTasks).to.exist;
      expect(result.childTasks).to.have.lengthOf(1);
      // Dependencies should be transformed: -command → -run, others preserved
      expect(result.childTasks![0].dependsOn).to.deep.equal(["task-0-run", "task-0a"]);
    });
  });

  describe("Plan Mode", () => {
    it("should not spawn child tasks in plan mode", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      documentPath: "firestore/default/data/test/doc1",
                      documentData: {
                        field: "value"
                      }
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
        id: "command-agent-0",
        service: "ai",
        command: "command-agent",
        input: {
          id: "task-0",
          service: "firestore",
          command: "create-document",
          prompt: "Create a document",
          dependsOn: []
        },
        depth: 0
      });

      const context = createMockJobContext({ aiPlanning: true });
      const result = await handleCommandAgent(task, context);

      expect(result.output).to.exist;
      expect(result.output.result).to.deep.equal({});
      expect(result.output.childTaskIds).to.deep.equal([]);
      expect(result.childTasks).to.be.an("array");
      expect(result.childTasks).to.be.empty;
    });

    it("should still construct and validate parameters in plan mode", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      documentPath: "firestore/default/data/users/user1",
                      documentData: {
                        name: "User",
                        email: "user@example.com"
                      }
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
        id: "command-agent-0",
        service: "ai",
        command: "command-agent",
        input: {
          id: "task-0",
          service: "firestore",
          command: "create-document",
          prompt: "Create a user document",
          dependsOn: []
        },
        depth: 0
      });

      const context = createMockJobContext({ aiPlanning: true, aiAuditing: true });
      const result = await handleCommandAgent(task, context);

      // In plan mode, parameters are validated but not spawned as childTasks
      // We can verify they were constructed by checking the audit trail
      expect(result.output.audit).to.exist;
      expect(result.output.audit!.constructedParameters).to.exist;
      expect(result.output.audit!.constructedParameters.documentPath).to.exist;
      expect(result.output.audit!.constructedParameters.documentData).to.exist;
      expect(result.output.audit!.constructedParameters.documentData.name).to.equal("User");
      expect(result.childTasks).to.be.empty;
    });
  });

  describe("AI Auditing", () => {
    it("should include audit trail when aiAuditing is enabled", async function() {
      this.timeout(10000);

      const { handleCommandAgent } = await import("../../../src/job/handlers/ai/command-agent/handler");

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      documentPath: "firestore/default/data/audit/test1",
                      documentData: {
                        field: "value"
                      }
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
        id: "command-agent-0",
        service: "ai",
        command: "command-agent",
        input: {
          id: "task-0",
          service: "firestore",
          command: "create-document",
          prompt: "Create an audit document",
          dependsOn: []
        },
        depth: 0
      });

      const context = createMockJobContext({ aiAuditing: true });
      const result = await handleCommandAgent(task, context);

      expect(result.output.audit).to.exist;
      expect(result.output.audit!.constructedParameters).to.exist;
      expect(result.output.audit!.systemInstruction).to.be.a("string");
      expect(result.output.audit!.userPrompt).to.be.a("string");
      expect(result.output.audit!.aiResponse).to.be.a("string");
    });

    it("should not include audit trail when aiAuditing is disabled", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({
                      documentPath: "firestore/default/data/test/doc1",
                      documentData: {
                        field: "value"
                      }
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
        id: "command-agent-0",
        service: "ai",
        command: "command-agent",
        input: {
          id: "task-0",
          service: "firestore",
          command: "create-document",
          prompt: "Create a document",
          dependsOn: []
        },
        depth: 0
      });

      const context = createMockJobContext({ aiAuditing: false });
      const result = await handleCommandAgent(task, context);

      expect(result.output.audit).to.be.undefined;
    });
  });
});
