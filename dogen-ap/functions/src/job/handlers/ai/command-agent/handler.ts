/**
 * AI Command Agent Handler (Phase 3 of 3-Phase Orchestration)
 *
 * Responsibilities:
 * - Parameter construction: Build complete, valid parameters for the selected command
 * - Format enforcement: Ensure parameters match the command schema
 * - Schema validation: Validate parameters against command-specific schema using Ajv
 * - Optional parameters: Handle optional parameters correctly
 * - Type conversion: Convert string values to appropriate types (numbers, booleans, etc.)
 * - Dependency resolution: Support {{taskId.output.field}} syntax for inter-task dependencies
 * - Constraint adherence: Follow all schema constraints (min, max, enum, pattern, etc.)
 * - Error prevention: Catch parameter errors before spawning actual command
 *
 * Flow:
 * 1. Receives: {id, service, command, prompt, dependsOn} from service agent (Phase 2)
 * 2. AI sees: Full schema with examples for the SPECIFIC command
 * 3. AI constructs: Complete parameters matching schema
 * 4. Returns: Actual command childTask (firestore:createDocument, etc.)
 *
 * Plan Mode Behavior:
 * - ALL commands are spawned as child tasks (parameters are validated and tasks are created)
 * - Commands with allowInPlanMode=true will execute with status "Pending" (AI agents, read-only operations)
 * - Commands with allowInPlanMode=false will be created with status "Planned" for user review
 * - Tasks with status "Planned" will not execute until user approves and re-submits the job
 * - This allows AI orchestration to plan resource-modifying operations without executing them
 * - The allowInPlanMode flag is defined in the handler registry for each command
 */

import { JobTask } from '../../../jobTask';
import { JobContext } from '../../../jobContext';
import { VertexAI } from "@google-cloud/vertexai";
import config from "../../../../config";
import Ajv from 'ajv';
import { CommandAgentInput, CommandAgentOutput } from './types';
import { buildCommandAgentPrompts } from './prompts';
import { buildPhase3ResponseSchema } from './schema';
import { getHandlerDefinition } from '../../registry';

/**
 * Default configuration
 */
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_TIMEOUT = 60000;

/**
 * Initialize Ajv for schema validation
 */
const ajv = new Ajv({ allErrors: true, verbose: true });

/**
 * Handles command agent requests (Phase 3)
 *
 * @param task - The command agent task with service, command, and refined prompt
 * @param context - Job context
 * @returns Command agent output with constructed parameters
 */
export async function handleCommandAgent(task: JobTask, context: JobContext): Promise<{ output: CommandAgentOutput; audit?: any; childTasks?: any[] }> {
  const input = task.input as CommandAgentInput;

  // Validate input
  if (!input?.id || !input?.service || !input?.command || !input?.prompt) {
    throw new Error("Invalid input: id, service, command, and prompt are required");
  }

  const verbose = context.verbose;
  const temperature = DEFAULT_TEMPERATURE;
  const timeout = DEFAULT_TIMEOUT;
  const maxRetries = input.maxRetries ?? 3;
  const model = input.model ?? "gemini-2.5-flash";

  if (verbose) {
    console.log(`[CommandAgent] Processing task ${input.id} for command: ${input.service}/${input.command}`);
    console.log(`[CommandAgent] Prompt: ${input.prompt}`);
    console.log(`[CommandAgent] Model: ${model}`);
    console.log(`[CommandAgent] Max retries: ${maxRetries}`);
    if (task.dependsOn && task.dependsOn.length > 0) {
      console.log(`[CommandAgent] Dependencies (with propagation): ${task.dependsOn.join(', ')}`);
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

  // Store the original input (never changes across retries)
  const originalInput = input;
  let previousResponse: any | undefined;
  let validationErrors: string[] = [];

  // Track retry history for audit trail
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
      console.log(`[CommandAgent] Retry attempt ${attempt}/${maxRetries}`);
      console.log(`[CommandAgent] Previous validation errors:`, validationErrors);
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
            dependencyOutputs[depId] = depOutput.result ?? depOutput;
          }
        }
      }

      // Build prompts with retry context and dependency outputs
      const { systemInstruction, userPrompt, commandSchema } = buildCommandAgentPrompts(
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
        console.log(`[CommandAgent] Attempt ${attempt} - Calling AI to construct parameters for ${input.service}/${input.command}`);
        console.log(`[CommandAgent] Attempt ${attempt} - User prompt length:`, userPrompt.length);
      }

      // Create generative model with structured output
      const generativeModel = vertexAI.getGenerativeModel({
        model: model,
        generationConfig: {
          temperature,
          responseSchema: buildPhase3ResponseSchema(input.service, input.command),
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

      let aiParameters: Record<string, any>;
      try {
        aiParameters = JSON.parse(responseText);
      } catch (parseError: any) {
        validationErrors = [`Failed to parse AI response as JSON: ${parseError.message}`];
        previousResponse = responseText;
        // Capture failed attempt for audit
        if (context.aiAuditing && attempt < maxRetries) {
          retryHistory.push({
            attempt,
            timestamp: new Date().toISOString(),
            validationErrors: [...validationErrors],
            aiResponse: responseText,
            previousResponse: responseText
          });
        }
        if (attempt === maxRetries) {
          throw new Error(`[CommandAgent] Failed after ${maxRetries} attempts. Last error: ${validationErrors.join('; ')}`);
        }
        continue;
      }

      // Store response for next iteration if needed
      previousResponse = aiParameters;

      // Validate that we got an object
      if (typeof aiParameters !== 'object' || aiParameters === null || Array.isArray(aiParameters)) {
        validationErrors = ["AI response must be a JSON object with the command parameters"];
        // Capture failed attempt for audit
        if (context.aiAuditing && attempt < maxRetries) {
          retryHistory.push({
            attempt,
            timestamp: new Date().toISOString(),
            validationErrors: [...validationErrors],
            aiResponse: responseText,
            previousResponse: aiParameters
          });
        }
        if (attempt === maxRetries) {
          throw new Error(`[CommandAgent] Failed after ${maxRetries} attempts. Last error: ${validationErrors.join('; ')}`);
        }
        continue;
      }

      // Validate parameters against command schema using Ajv
      if (commandSchema) {
        const validate = ajv.compile(commandSchema);
        const valid = validate(aiParameters);

        if (!valid) {
          validationErrors = validate.errors?.map(err => `${err.instancePath} ${err.message}`) || ["Unknown validation error"];
          if (verbose) {
            console.log(`[CommandAgent] Attempt ${attempt} - Parameter validation failed:`, validationErrors);
          }
          // Capture failed attempt for audit
          if (context.aiAuditing && attempt < maxRetries) {
            retryHistory.push({
              attempt,
              timestamp: new Date().toISOString(),
              validationErrors: [...validationErrors],
              aiResponse: responseText,
              previousResponse: aiParameters
            });
          }
          if (attempt === maxRetries) {
            throw new Error(`[CommandAgent] Failed after ${maxRetries} attempts. Parameter validation errors: ${validationErrors.join('; ')}`);
          }
          continue;
        }
      }

      // Success!
      if (verbose) {
        console.log(`[CommandAgent] Successfully constructed parameters for ${input.service}/${input.command} on attempt ${attempt}`);
      }

      // In aiPlanning mode:
      // - Commands with allowInPlanMode=true will execute normally (AI agents, read-only operations)
      // - Commands with allowInPlanMode=false will be spawned with status "Planned" for user review
      // - All commands are always spawned as child tasks (status determined in processJob.ts)
      const handlerDefinition = getHandlerDefinition(input.service, input.command);
      const allowInPlanMode = handlerDefinition?.allowInPlanMode ?? false;

      if (context.aiPlanning && !allowInPlanMode && verbose) {
        console.log(`[CommandAgent] Plan mode: Spawning resource-modifying command ${input.service}/${input.command} with status "Planned"`);
        console.log(`[CommandAgent] Command will be created with parameters:`, JSON.stringify(aiParameters, null, 2));
      }

      // Create actual command childTask
      // Replace "-command" suffix with "-run" to indicate execution phase
      // ID is already fully scoped (includes parent prefix), so no need to call scopeChildTasks
      const runId = task.id.endsWith('-command')
        ? task.id.replace(/-command$/, '-run')
        : `${task.id}-run`;

      // Update dependencies: replace "-command" with "-run"
      const runDependencies = input.dependsOn.map(dep =>
        dep.endsWith('-command') ? dep.replace(/-command$/, '-run') : dep
      );

      const childTask = {
        id: runId,  // Already fully scoped, no need for scopeChildTasks
        service: input.service,
        command: input.command,
        input: aiParameters,
        dependsOn: runDependencies.length > 0 ? runDependencies : undefined
      };

      if (verbose) {
        console.log(`[CommandAgent] Spawning ${input.service}:${input.command} childTask with ID: ${childTask.id}`);
      }

      // Construct command agent output
      // Command-agent is a task-spawning agent with no actionable output
      // Metadata is stored in audit field only when aiAuditing is enabled
      const commandAgentOutput: CommandAgentOutput = {};

      const auditData = context.aiAuditing ? {
        input,
        constructedParameters: aiParameters,
        childTaskIds: [childTask.id], // Store just the child task ID, full specs are in task registry
        systemInstruction,
        userPrompt,
        aiResponse: responseText,
        // Include retry history if there were any retries
        ...(retryHistory.length > 0 && {
          retryHistory,
          retriesUsed: attempt
        })
      } : undefined;

      return {
        output: commandAgentOutput,
        audit: auditData,
        childTasks: [childTask]
      };

    } catch (error: any) {
      // Only re-throw on last attempt
      if (attempt === maxRetries) {
        throw error;
      }
      // Otherwise log and continue to next attempt
      if (verbose) {
        console.log(`[CommandAgent] Attempt ${attempt} failed with error:`, error.message);
      }
      validationErrors = [error.message];
      // Capture failed attempt for audit
      if (context.aiAuditing && attempt < maxRetries) {
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
  throw new Error(`[CommandAgent] Failed after ${maxRetries} attempts`);
}
