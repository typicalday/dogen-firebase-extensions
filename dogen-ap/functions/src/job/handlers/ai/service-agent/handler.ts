/**
 * AI Service Agent Handler (Phase 2 of 3-Phase Orchestration)
 *
 * Responsibilities:
 * - Command matching: Select the appropriate command within the specified service
 * - Parameter identification: Identify what parameters the command needs
 * - Prompt specification: Create a refined prompt for the command agent
 * - Validation: Ensure the selected command exists and is valid
 * - Edge case handling: Handle ambiguous or invalid command selections
 * - Dependency passthrough: Preserve dependency information for graph execution
 * - Context understanding: Interpret the refined prompt from orchestrator
 *
 * Flow:
 * 1. Receives: {id, service, prompt, dependsOn} from orchestrator (Phase 1)
 * 2. AI sees: Commands available for ONLY the specified service
 * 3. AI selects: The most appropriate command for the task
 * 4. Returns: Single ai:commandAgent childTask with selected command
 */

import { JobTask } from '../../../jobTask';
import { JobContext } from '../../../jobContext';
import { VertexAI } from "@google-cloud/vertexai";
import config from "../../../../config";
import { ServiceAgentInput, ServiceAgentOutput } from './types';
import { buildServiceAgentPrompts } from './prompts';
import { PHASE2_RESPONSE_SCHEMA, ServiceAgentAIResponse, isServiceAgentAIResponse, validateServiceAgentAIResponse } from './schema';
import { getServiceCommands } from './catalogs/command-catalogs';
import { initializeCatalogs } from '../helpers/catalogGenerator';

/**
 * Default configuration
 */
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_TIMEOUT = 60000;

/**
 * Handles service agent requests (Phase 2)
 *
 * @param task - The service agent task with service and refined prompt
 * @param context - Job context
 * @returns Service agent output with selected command and refined prompt for command agent
 */
export async function handleServiceAgent(task: JobTask, context: JobContext): Promise<{ output: ServiceAgentOutput; trace?: any; childTasks: any[] }> {
  const input = task.input as ServiceAgentInput;

  // Validate input
  if (!input?.id || !input?.service || !input?.prompt) {
    throw new Error("Invalid input: id, service, and prompt are required");
  }

  const verbose = context.verbose;
  const temperature = DEFAULT_TEMPERATURE;
  const timeout = DEFAULT_TIMEOUT;
  const maxRetries = input.maxRetries ?? 3;
  const model = input.model ?? "gemini-2.5-flash";

  if (verbose) {
    console.log(`[ServiceAgent] Processing task ${input.id} for service: ${input.service}`);
    console.log(`[ServiceAgent] Prompt: ${input.prompt}`);
    console.log(`[ServiceAgent] Model: ${model}`);
    console.log(`[ServiceAgent] Max retries: ${maxRetries}`);
    if (task.dependsOn && task.dependsOn.length > 0) {
      console.log(`[ServiceAgent] Dependencies (with propagation): ${task.dependsOn.join(', ')}`);
    }
  }

  // Get project ID
  const projectId = config.localProjectIdOverride ?? config.firebaseProjectId;
  if (!projectId) {
    throw new Error("Project ID not found");
  }

  // Initialize Vertex AI
  const vertexAI = new VertexAI({
    project: projectId,
    location: config.location || 'us-central1',
  });

  // Initialize catalogs (lazy initialization to avoid circular dependencies)
  initializeCatalogs();

  // Get available commands for validation
  const availableCommands = getServiceCommands(input.service).map(cmd => cmd.command);

  // Store the original input (never changes across retries)
  const originalInput = input;
  let previousResponse: any | undefined;
  let validationErrors: string[] = [];

  // Track retry history for trace trail
  const retryHistory: Array<{
    attempt: number;
    timestamp: string;
    validationErrors: string[];
    aiResponse?: string;
    previousResponse?: any;
  }> = [];

  // Retry loop
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (verbose && attempt > 1) {
      console.log(`[ServiceAgent] Retry attempt ${attempt}/${maxRetries}`);
      console.log(`[ServiceAgent] Previous validation errors:`, validationErrors);
    }

    try {
      // Gather dependency outputs for AI context
      // CRITICAL: Use task.dependsOn (which includes propagated descendants) not input.dependsOn (original only)
      // When A spawns A1,A2 and B depends on A, the propagation system adds A1,A2 to B's task.dependsOn
      const dependencyOutputs: Record<string, any> = {};
      const actualDependencies = task.dependsOn || [];

      if (actualDependencies.length > 0) {
        for (const depId of actualDependencies) {
          const depOutput = context.getTaskOutput(depId);
          if (depOutput) {
            // Only pass the result field if it exists, otherwise pass the full output
            // This ensures backward compatibility with tasks that don't have result field yet
            const result = depOutput.result ?? depOutput;
            dependencyOutputs[depId] = result;
          }
        }
      }

      // Build prompts with retry context and dependency outputs
      const { systemInstruction, userPrompt } = buildServiceAgentPrompts(
        input,
        dependencyOutputs,
        attempt > 1 ? {
          attempt,
          originalInput,
          previousResponse,
          validationErrors
        } : undefined
      );

      if (verbose) {
        console.log(`[ServiceAgent] Attempt ${attempt} - Calling AI to select command from ${input.service} service`);
        console.log(`[ServiceAgent] Attempt ${attempt} - User prompt length:`, userPrompt.length);
      }

      // Create generative model with structured output
      const generativeModel = vertexAI.getGenerativeModel({
        model: model,
        generationConfig: {
          temperature,
          responseSchema: PHASE2_RESPONSE_SCHEMA,
          responseMimeType: "application/json"
        },
        systemInstruction
      });

      // Call AI with timeout
      const response = await Promise.race([
        generativeModel.generateContent({
          contents: [{ role: "user", parts: [{ text: userPrompt }] }]
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`AI call timeout after ${timeout}ms`)), timeout)
        )
      ]) as any;

      // Extract and parse response
      const responseText = response.response.candidates[0].content.parts[0].text;

      let aiResponse: ServiceAgentAIResponse;
      try {
        aiResponse = JSON.parse(responseText);
      } catch (parseError: any) {
        validationErrors = [`Failed to parse AI response as JSON: ${parseError.message}`];
        previousResponse = responseText;
        // Capture failed attempt for trace
        if (context.enableTracing && attempt < maxRetries) {
          retryHistory.push({
            attempt,
            timestamp: new Date().toISOString(),
            validationErrors: [...validationErrors],
            aiResponse: responseText,
            previousResponse: responseText
          });
        }
        if (attempt === maxRetries) {
          throw new Error(`[ServiceAgent] Failed after ${maxRetries} attempts. Last error: ${validationErrors.join('; ')}`);
        }
        continue;
      }

      // Store response for next iteration if needed
      previousResponse = aiResponse;

      // Validate structure with type guard
      if (!isServiceAgentAIResponse(aiResponse)) {
        validationErrors = ["AI response does not match expected schema structure"];
        // Capture failed attempt for trace
        if (context.enableTracing && attempt < maxRetries) {
          retryHistory.push({
            attempt,
            timestamp: new Date().toISOString(),
            validationErrors: [...validationErrors],
            aiResponse: responseText,
            previousResponse: aiResponse
          });
        }
        if (attempt === maxRetries) {
          throw new Error(`[ServiceAgent] Failed after ${maxRetries} attempts. Last error: ${validationErrors.join('; ')}`);
        }
        continue;
      }

      // Validate service agent AI response
      const validationResult = validateServiceAgentAIResponse(aiResponse, input.service, availableCommands);
      if (!validationResult.isValid) {
        validationErrors = validationResult.errors;
        if (verbose) {
          console.log(`[ServiceAgent] Attempt ${attempt} - Validation failed:`, validationErrors);
        }
        // Capture failed attempt for trace
        if (context.enableTracing && attempt < maxRetries) {
          retryHistory.push({
            attempt,
            timestamp: new Date().toISOString(),
            validationErrors: [...validationErrors],
            aiResponse: responseText,
            previousResponse: aiResponse
          });
        }
        if (attempt === maxRetries) {
          throw new Error(
            `[ServiceAgent] Failed after ${maxRetries} attempts. Validation errors: ${validationErrors.join('; ')}`
          );
        }
        continue;
      }

      // Success!
      if (verbose) {
        console.log(`[ServiceAgent] Successfully selected command ${input.service}/${aiResponse.command} on attempt ${attempt}`);
        if (aiResponse.reasoning) {
          console.log(`[ServiceAgent] Reasoning: ${aiResponse.reasoning}`);
        }
      }

      // Create commandAgent childTask
      // Replace "-service" suffix with "-command" to indicate next phase
      // ID is already fully scoped (includes parent prefix), so no need to call scopeChildTasks
      const commandId = task.id.endsWith('-service')
        ? task.id.replace(/-service$/, '-command')
        : `${task.id}-command`;

      // Update dependencies: replace "-service" with "-command"
      const commandDependencies = input.dependsOn.map(dep =>
        dep.endsWith('-service') ? dep.replace(/-service$/, '-command') : dep
      );

      const childTask = {
        id: commandId,  // Already fully scoped, no need for scopeChildTasks
        service: "ai",
        command: "command-agent",
        input: {
          id: commandId,
          service: input.service,
          command: aiResponse.command,
          prompt: aiResponse.prompt,
          dependsOn: commandDependencies
        },
        dependsOn: commandDependencies.length > 0 ? commandDependencies : undefined
      };

      if (verbose) {
        console.log(`[ServiceAgent] Returning ai:commandAgent childTask with ID: ${childTask.id}`);
      }

      // Construct the service agent output
      // Service-agent is a task-spawning agent with no actionable output
      // Metadata is stored in trace field only when enableTracing is enabled
      const serviceAgentOutput: ServiceAgentOutput = {};

      const traceData = context.enableTracing ? {
        selectedCommand: aiResponse.command,
        refinedPrompt: aiResponse.prompt,
        childTaskIds: [childTask.id], // Store just the child task ID, full specs are in task registry
        systemInstruction,
        userPrompt,
        aiResponse: responseText,
        // Include retry count if there were any retries
        ...(attempt > 1 && { retriesUsed: attempt })
      } : undefined;

      return {
        output: serviceAgentOutput,
        trace: traceData,
        childTasks: [childTask]
      };

    } catch (error: any) {
      // Only re-throw on last attempt
      if (attempt === maxRetries) {
        throw error;
      }
      // Otherwise log and continue to next attempt
      if (verbose) {
        console.log(`[ServiceAgent] Attempt ${attempt} failed with error:`, error.message);
      }
      validationErrors = [error.message];
      // Capture failed attempt for trace
      if (context.enableTracing && attempt < maxRetries) {
        retryHistory.push({
          attempt,
          timestamp: new Date().toISOString(),
          validationErrors: [...validationErrors],
          previousResponse: previousResponse
        });
      }
    }
  }

  // This should never be reached due to the throw in the loop
  throw new Error(`[ServiceAgent] Failed after ${maxRetries} attempts`);
}
