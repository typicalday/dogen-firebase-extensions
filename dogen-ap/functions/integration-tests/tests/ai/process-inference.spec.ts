/**
 * Integration tests for AI Process Inference Handler
 *
 * Tests the AI inference handler's ability to process prompts, handle various
 * generation config options, validate inputs, and return responses with metadata.
 */

import { expect } from "chai";
import { VertexAI } from "@google-cloud/vertexai";
import { JobTask } from "../../../src/job/jobTask";
import { createMockJobContext } from "../../helpers/jobContextHelper";
import { handleProcessInference } from "../../../src/job/handlers/ai/processInference";

describe("AI Process Inference Handler", () => {
  let originalGetGenerativeModel: any;

  beforeEach(() => {
    // Save original method
    originalGetGenerativeModel = VertexAI.prototype.getGenerativeModel;
  });

  afterEach(() => {
    // Restore original method
    VertexAI.prototype.getGenerativeModel = originalGetGenerativeModel;
  });

  describe("Basic Inference", () => {
    it("should process simple text prompt", async function() {
      this.timeout(10000);

      // Mock AI response
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: "This is a test response from the AI model."
                  }]
                }
              }],
              usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 15,
                totalTokenCount: 25
              }
            }
          })
        };
      } as any;

      const task = new JobTask({
        id: "inference-0",
        service: "ai",
        command: "process-inference",
        input: {
          model: "gemini-1.5-flash",
          prompt: "What is the capital of France?"
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleProcessInference(task, context);

      expect(result).to.exist;
      expect(result.output).to.exist;
      expect(result.output.response).to.equal("This is a test response from the AI model.");
      // Without enableTracing, these fields should not be present
      expect(result.trace).to.be.undefined;
    });

    it("should include usage metadata when enableTracing is enabled", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: "Response with usage metadata"
                  }]
                }
              }],
              usageMetadata: {
                promptTokenCount: 50,
                candidatesTokenCount: 100,
                totalTokenCount: 150
              }
            }
          })
        };
      } as any;

      const task = new JobTask({
        id: "inference-1",
        service: "ai",
        command: "process-inference",
        input: {
          model: "gemini-1.5-pro",
          prompt: "Explain quantum computing"
        },
        depth: 0
      });

      const context = createMockJobContext({ enableTracing: true });
      const result = await handleProcessInference(task, context);

      expect(result.trace).to.exist;
      expect(result.trace!.usage).to.exist;
      expect(result.trace!.usage!.promptTokenCount).to.equal(50);
      expect(result.trace!.usage!.candidatesTokenCount).to.equal(100);
      expect(result.trace!.usage!.totalTokenCount).to.equal(150);
    });

    it("should handle multi-part text responses", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [
                    { text: "Part 1: " },
                    { text: "Part 2: " },
                    { text: "Part 3" }
                  ]
                }
              }],
              usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 20,
                totalTokenCount: 30
              }
            }
          })
        };
      } as any;

      const task = new JobTask({
        id: "inference-2",
        service: "ai",
        command: "process-inference",
        input: {
          model: "gemini-1.5-flash",
          prompt: "Generate a multi-part response"
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleProcessInference(task, context);

      expect(result.output.response).to.equal("Part 1: Part 2: Part 3");
    });
  });

  describe("System Instructions", () => {
    it("should process inference with system instruction", async function() {
      this.timeout(10000);

      let capturedSystemInstruction: string | undefined;

      VertexAI.prototype.getGenerativeModel = function(config: any) {
        capturedSystemInstruction = config.systemInstruction;
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: "Response following system instruction"
                  }]
                }
              }],
              usageMetadata: {
                promptTokenCount: 20,
                candidatesTokenCount: 10,
                totalTokenCount: 30
              }
            }
          })
        };
      } as any;

      const task = new JobTask({
        id: "inference-3",
        service: "ai",
        command: "process-inference",
        input: {
          model: "gemini-1.5-pro",
          prompt: "What is 2+2?",
          systemInstruction: "You are a helpful math tutor. Explain your answers step by step."
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleProcessInference(task, context);

      expect(result.output.response).to.exist;
      expect(capturedSystemInstruction).to.equal("You are a helpful math tutor. Explain your answers step by step.");
    });
  });

  describe("Generation Config", () => {
    it("should apply temperature setting", async function() {
      this.timeout(10000);

      let capturedConfig: any;

      VertexAI.prototype.getGenerativeModel = function(config: any) {
        capturedConfig = config.generationConfig;
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: "Creative response"
                  }]
                }
              }],
              usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 10,
                totalTokenCount: 20
              }
            }
          })
        };
      } as any;

      const task = new JobTask({
        id: "inference-4",
        service: "ai",
        command: "process-inference",
        input: {
          model: "gemini-1.5-flash",
          prompt: "Be creative",
          temperature: 1.5
        },
        depth: 0
      });

      const context = createMockJobContext();
      await handleProcessInference(task, context);

      expect(capturedConfig.temperature).to.equal(1.5);
    });

    it("should apply multiple generation config options", async function() {
      this.timeout(10000);

      let capturedConfig: any;

      VertexAI.prototype.getGenerativeModel = function(config: any) {
        capturedConfig = config.generationConfig;
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: "Configured response"
                  }]
                }
              }],
              usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 10,
                totalTokenCount: 20
              }
            }
          })
        };
      } as any;

      const task = new JobTask({
        id: "inference-5",
        service: "ai",
        command: "process-inference",
        input: {
          model: "gemini-1.5-pro",
          prompt: "Generate something",
          temperature: 0.7,
          topP: 0.9,
          topK: 40,
          maxOutputTokens: 1024
        },
        depth: 0
      });

      const context = createMockJobContext();
      await handleProcessInference(task, context);

      expect(capturedConfig.temperature).to.equal(0.7);
      expect(capturedConfig.topP).to.equal(0.9);
      expect(capturedConfig.topK).to.equal(40);
      expect(capturedConfig.maxOutputTokens).to.equal(1024);
    });

    it("should apply JSON response schema", async function() {
      this.timeout(10000);

      let capturedConfig: any;

      VertexAI.prototype.getGenerativeModel = function(config: any) {
        capturedConfig = config.generationConfig;
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: JSON.stringify({ name: "John", age: 30 })
                  }]
                }
              }],
              usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 10,
                totalTokenCount: 20
              }
            }
          })
        };
      } as any;

      const task = new JobTask({
        id: "inference-6",
        service: "ai",
        command: "process-inference",
        input: {
          model: "gemini-1.5-pro",
          prompt: "Generate user data",
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              name: { type: "string" },
              age: { type: "number" }
            }
          }
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleProcessInference(task, context);

      expect(capturedConfig.responseMimeType).to.equal("application/json");
      expect(capturedConfig.responseSchema).to.exist;
      expect(result.output.response).to.be.a("string");
    });

    it("should apply stop sequences", async function() {
      this.timeout(10000);

      let capturedConfig: any;

      VertexAI.prototype.getGenerativeModel = function(config: any) {
        capturedConfig = config.generationConfig;
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: "Response stopped at sequence"
                  }]
                }
              }],
              usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 10,
                totalTokenCount: 20
              }
            }
          })
        };
      } as any;

      const task = new JobTask({
        id: "inference-7",
        service: "ai",
        command: "process-inference",
        input: {
          model: "gemini-1.5-flash",
          prompt: "Generate text",
          stopSequences: ["STOP", "END"]
        },
        depth: 0
      });

      const context = createMockJobContext();
      await handleProcessInference(task, context);

      expect(capturedConfig.stopSequences).to.deep.equal(["STOP", "END"]);
    });

    it("should apply candidateCount parameter", async function() {
      this.timeout(10000);

      let capturedConfig: any;

      VertexAI.prototype.getGenerativeModel = function(config: any) {
        capturedConfig = config.generationConfig;
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: "Response with candidate count"
                  }]
                }
              }],
              usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 10,
                totalTokenCount: 20
              }
            }
          })
        };
      } as any;

      const task = new JobTask({
        id: "inference-7a",
        service: "ai",
        command: "process-inference",
        input: {
          model: "gemini-1.5-pro",
          prompt: "Generate multiple candidates",
          candidateCount: 3
        },
        depth: 0
      });

      const context = createMockJobContext();
      await handleProcessInference(task, context);

      expect(capturedConfig.candidateCount).to.equal(3);
    });
  });

  describe("Input Validation", () => {
    it("should use default model when not provided", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: "Response with default model"
                  }]
                }
              }],
              usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 10,
                totalTokenCount: 20
              }
            }
          })
        };
      } as any;

      const task = new JobTask({
        id: "inference-8",
        service: "ai",
        command: "process-inference",
        input: {
          // Model not provided - should default to gemini-2.5-pro
          prompt: "Test prompt"
        },
        depth: 0
      });

      const context = createMockJobContext({ enableTracing: true });
      const result = await handleProcessInference(task, context);

      expect(result.trace).to.exist;
      expect(result.output.response).to.equal("Response with default model");
    });

    it("should require prompt parameter", async function() {
      this.timeout(5000);

      const task = new JobTask({
        id: "inference-9",
        service: "ai",
        command: "process-inference",
        input: {
          model: "gemini-1.5-flash"
          // Missing prompt
        },
        depth: 0
      });

      const context = createMockJobContext();

      let errorThrown = false;
      try {
        await handleProcessInference(task, context);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("prompt is required");
      }

      expect(errorThrown).to.be.true;
    });

    it("should handle empty input", async function() {
      this.timeout(5000);

      const task = new JobTask({
        id: "inference-10",
        service: "ai",
        command: "process-inference",
        input: {},
        depth: 0
      });

      const context = createMockJobContext();

      let errorThrown = false;
      try {
        await handleProcessInference(task, context);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("prompt is required");
      }

      expect(errorThrown).to.be.true;
    });
  });

  describe("Error Handling", () => {
    it("should handle AI generation errors", async function() {
      this.timeout(10000);

      const { handleProcessInference } = await import("../../../src/job/handlers/ai/processInference");

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => {
            throw new Error("AI service unavailable");
          }
        };
      } as any;

      const task = new JobTask({
        id: "inference-11",
        service: "ai",
        command: "process-inference",
        input: {
          model: "gemini-1.5-flash",
          prompt: "Test prompt"
        },
        depth: 0
      });

      const context = createMockJobContext();

      let errorThrown = false;
      try {
        await handleProcessInference(task, context);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("Inference processing failed");
        expect(error.message).to.include("AI service unavailable");
      }

      expect(errorThrown).to.be.true;
    });

    it("should handle missing response candidates", async function() {
      this.timeout(10000);

      const { handleProcessInference } = await import("../../../src/job/handlers/ai/processInference");

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: []
            }
          })
        };
      } as any;

      const task = new JobTask({
        id: "inference-12",
        service: "ai",
        command: "process-inference",
        input: {
          model: "gemini-1.5-flash",
          prompt: "Test prompt"
        },
        depth: 0
      });

      const context = createMockJobContext();

      let errorThrown = false;
      try {
        await handleProcessInference(task, context);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("No response generated");
      }

      expect(errorThrown).to.be.true;
    });

    it("should handle malformed response structure", async function() {
      this.timeout(10000);

      const { handleProcessInference } = await import("../../../src/job/handlers/ai/processInference");

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  // Missing parts
                }
              }]
            }
          })
        };
      } as any;

      const task = new JobTask({
        id: "inference-13",
        service: "ai",
        command: "process-inference",
        input: {
          model: "gemini-1.5-flash",
          prompt: "Test prompt"
        },
        depth: 0
      });

      const context = createMockJobContext();

      let errorThrown = false;
      try {
        await handleProcessInference(task, context);
      } catch (error: any) {
        errorThrown = true;
        expect(error.message).to.include("No response generated");
      }

      expect(errorThrown).to.be.true;
    });
  });

  describe("AI Tracing", () => {
    it("should include trace trail when enableTracing is enabled", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: "Trace test response"
                  }]
                }
              }],
              usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 10,
                totalTokenCount: 20
              }
            }
          })
        };
      } as any;

      const task = new JobTask({
        id: "inference-14",
        service: "ai",
        command: "process-inference",
        input: {
          model: "gemini-1.5-pro",
          prompt: "Test trace prompt",
          systemInstruction: "Test system instruction",
          temperature: 0.8
        },
        depth: 0
      });

      const context = createMockJobContext({ enableTracing: true });
      const result = await handleProcessInference(task, context);

      expect(result.trace).to.exist;
      expect(result.trace!.generationConfig).to.exist;
      expect(result.trace!.generationConfig.temperature).to.equal(0.8);
      // The actual response is in output.response, not duplicated in trace
      expect(result.output.response).to.equal("Trace test response");
    });

    it("should not include trace trail when enableTracing is disabled", async function() {
      this.timeout(10000);

      const { handleProcessInference } = await import("../../../src/job/handlers/ai/processInference");

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: "No trace response"
                  }]
                }
              }],
              usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 10,
                totalTokenCount: 20
              }
            }
          })
        };
      } as any;

      const task = new JobTask({
        id: "inference-15",
        service: "ai",
        command: "process-inference",
        input: {
          model: "gemini-1.5-flash",
          prompt: "Test prompt",
          systemInstruction: "System instruction"
        },
        depth: 0
      });

      const context = createMockJobContext({ enableTracing: false });
      const result = await handleProcessInference(task, context);

      expect(result.trace).to.be.undefined;
    });
  });

  describe("Response Metadata", () => {
    it("should include result field for downstream tasks", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: "Test response for result field"
                  }]
                }
              }],
              usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 10,
                totalTokenCount: 20
              }
            }
          })
        };
      } as any;

      const task = new JobTask({
        id: "inference-15a",
        service: "ai",
        command: "process-inference",
        input: {
          model: "gemini-1.5-flash",
          prompt: "Test result field"
        },
        depth: 0
      });

      const context = createMockJobContext();
      const result = await handleProcessInference(task, context);

      // Verify output field exists and contains the response (for downstream tasks)
      expect(result.output).to.exist;
      expect(result.output.response).to.equal("Test response for result field");
      // Without enableTracing, no other fields should be present
      expect(result.trace).to.be.undefined;
    });

    it("should handle response without usage metadata when enableTracing is enabled", async function() {
      this.timeout(10000);

      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: "Response without usage"
                  }]
                }
              }]
              // No usageMetadata
            }
          })
        };
      } as any;

      const task = new JobTask({
        id: "inference-17",
        service: "ai",
        command: "process-inference",
        input: {
          model: "gemini-1.5-flash",
          prompt: "Test"
        },
        depth: 0
      });

      const context = createMockJobContext({ enableTracing: true });
      const result = await handleProcessInference(task, context);

      expect(result.trace).to.exist;
      expect(result.trace!.usage).to.be.undefined;
      // The actual response is in output.response, not duplicated in trace
      expect(result.output.response).to.equal("Response without usage");
    });
  });

  describe("Verbose Mode", () => {
    it("should log details in verbose mode", async function() {
      this.timeout(10000);
      
      VertexAI.prototype.getGenerativeModel = function() {
        return {
          generateContent: async () => ({
            response: {
              candidates: [{
                content: {
                  parts: [{
                    text: "Verbose response"
                  }]
                }
              }],
              usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 10,
                totalTokenCount: 20
              }
            }
          })
        };
      } as any;

      const task = new JobTask({
        id: "inference-18",
        service: "ai",
        command: "process-inference",
        input: {
          model: "gemini-1.5-pro",
          prompt: "Test verbose mode",
          systemInstruction: "Be verbose"
        },
        depth: 0
      });

      const context = createMockJobContext({ verbose: true });
      const result = await handleProcessInference(task, context);

      expect(result.output.response).to.equal("Verbose response");
      // In verbose mode, logs are printed but we just verify it doesn't error
    });
  });
});
