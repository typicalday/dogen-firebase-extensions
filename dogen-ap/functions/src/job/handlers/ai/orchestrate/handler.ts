/**
 * AI Task Orchestration Handler
 *
 * Main handler that:
 * 1. Takes natural language prompts
 * 2. Calls Gemini AI for task planning
 * 3. Validates the generated plan
 * 4. Returns validated child tasks for spawning
 * 5. Retries on validation failure
 */

import { JobTask } from '../../../jobTask';
import { VertexAI } from "@google-cloud/vertexai";
import * as admin from "firebase-admin";
import config from "../../../../config";
import {
  OrchestrateInput,
  OrchestrateOutput,
  AITaskPlan,
  RetryContext
} from './types';
import { AI_RESPONSE_SCHEMA, isAITaskPlan } from './schema';
import { validateTaskPlan, planToChildTasks } from './validator';
import { buildSystemPrompt, buildUserPrompt } from './promptBuilder';

/**
 * Default configuration for orchestration
 */
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MODEL = "gemini-2.5-pro";
const DEFAULT_MAX_CHILD_TASKS = 100;
const DEFAULT_MAX_DEPTH = 10;

/**
 * Timeout for AI model API calls (60 seconds)
 * Prevents hung requests from blocking job execution indefinitely
 */
const AI_CALL_TIMEOUT = 60000;

/**
 * Calls AI model with timeout protection
 * @param model - Vertex AI generative model
 * @param request - Generate content request
 * @param timeout - Timeout in milliseconds
 * @returns Promise resolving to the AI generation result
 * @throws Error if AI call exceeds timeout
 */
async function callAIWithTimeout(
  model: any,
  request: any,
  timeout: number
): Promise<any> {
  return Promise.race([
    model.generateContent(request),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`AI call timeout after ${timeout}ms`)),
        timeout
      )
    )
  ]);
}

/**
 * Handles AI task orchestration requests
 *
 * @param task - The orchestration task containing user prompt and parameters
 * @returns Orchestration output with validated child tasks
 */
export async function handleOrchestrate(task: JobTask): Promise<OrchestrateOutput> {
  const input = task.input as OrchestrateInput | undefined;

  // Validate input
  if (!input?.prompt) {
    throw new Error("Invalid input: prompt is required");
  }

  const maxRetries = input.maxRetries ?? DEFAULT_MAX_RETRIES;
  const temperature = input.temperature ?? DEFAULT_TEMPERATURE;
  const maxChildTasks = input.maxChildTasks ?? DEFAULT_MAX_CHILD_TASKS;
  const timeout = input.timeout ?? AI_CALL_TIMEOUT;
  const maxDepth = input.maxDepth ?? DEFAULT_MAX_DEPTH;

  // CRITICAL: Validate depth BEFORE expensive AI operations
  // If this task is already at or beyond maxDepth, spawning children will fail immediately
  // Better to fail fast here than waste tokens on AI calls that will be rejected during spawning
  const currentDepth = task.depth ?? 0;
  if (currentDepth >= maxDepth) {
    throw new Error(
      `Cannot orchestrate at depth ${currentDepth}: ` +
      `Maximum depth is ${maxDepth}. Child tasks would be at depth ${currentDepth + 1}, ` +
      `which exceeds the limit. Consider reducing task nesting or increasing maxDepth.`
    );
  }

  // Get project ID from Firebase Admin
  const projectId = admin.instanceId().app.options.projectId;
  if (!projectId) {
    throw new Error("Project ID not found");
  }

  // Initialize Vertex AI
  const vertexAI = new VertexAI({
    project: projectId,
    location: config.location || 'us-central1',
  });

  // Build system prompt (constant across retries)
  const systemInstruction = buildSystemPrompt();

  let retriesUsed = 0;
  let lastErrors: string[] | undefined;
  let lastResponse: AITaskPlan | undefined;

  // Retry loop
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    retriesUsed = attempt;

    try {
      // Build user prompt with retry context
      const retryContext: RetryContext | undefined = attempt > 1 ? {
        attempt,
        previousErrors: lastErrors,
        previousResponse: lastResponse
      } : undefined;

      const userPrompt = buildUserPrompt(
        input.prompt,
        input.context,
        retryContext
      );

      // Call Gemini with structured output
      const model = vertexAI.getGenerativeModel({
        model: DEFAULT_MODEL,
        systemInstruction,
        generationConfig: {
          temperature,
          responseMimeType: "application/json",
          responseSchema: AI_RESPONSE_SCHEMA as any,
        }
      });

      // Call AI with timeout protection to prevent hung requests
      const result = await callAIWithTimeout(
        model,
        {
          contents: [{
            role: 'user',
            parts: [{ text: userPrompt }]
          }]
        },
        timeout
      );

      const response = result.response;
      const candidate = response.candidates?.[0];

      if (!candidate || !candidate.content || !candidate.content.parts) {
        throw new Error("No response generated from AI");
      }

      // Extract and parse JSON response
      const responseText = candidate.content.parts
        .filter((part: any) => part.text)
        .map((part: any) => part.text)
        .join('');

      let aiPlan: AITaskPlan;
      try {
        aiPlan = JSON.parse(responseText);
      } catch (parseError: any) {
        throw new Error(`Failed to parse AI response as JSON: ${parseError.message}`);
      }

      // Validate structure with type guard
      if (!isAITaskPlan(aiPlan)) {
        throw new Error("AI response does not match expected schema structure");
      }

      // Validate task plan using graph validation
      const validationReport = await validateTaskPlan(aiPlan, task.id);

      if (!validationReport.isValid) {
        // Validation failed - prepare for retry
        lastErrors = validationReport.errors;
        lastResponse = aiPlan;

        const errorSummary = validationReport.errors.join('; ');
        console.warn(
          `Orchestration attempt ${attempt}/${maxRetries} failed validation:`,
          errorSummary
        );

        if (attempt < maxRetries) {
          // Will retry with error feedback
          continue;
        } else {
          // Max retries reached - fail the task
          throw new Error(
            `Task orchestration failed after ${maxRetries} attempts. ` +
            `Last validation errors: ${errorSummary}`
          );
        }
      }

      // Check maxChildTasks limit
      if (aiPlan.tasks.length > maxChildTasks) {
        throw new Error(
          `Task limit exceeded: AI attempted to create ${aiPlan.tasks.length} tasks, ` +
          `but maxChildTasks limit is ${maxChildTasks}. ` +
          `This orchestrator can spawn at most ${maxChildTasks} child tasks. ` +
          `Consider breaking down the request into smaller operations or increasing maxChildTasks.`
        );
      }

      // Validation successful - convert to child tasks
      const childTasks = planToChildTasks(aiPlan, task.id);

      // Return successful orchestration output
      return {
        prompt: input.prompt,
        plan: aiPlan,
        reasoning: aiPlan.reasoning,
        childTasks,
        retriesUsed,
        validationReport,
        usage: response.usageMetadata ? {
          promptTokenCount: response.usageMetadata.promptTokenCount,
          candidatesTokenCount: response.usageMetadata.candidatesTokenCount,
          totalTokenCount: response.usageMetadata.totalTokenCount,
        } : undefined
      };

    } catch (error: any) {
      console.error(`Orchestration attempt ${attempt}/${maxRetries} error:`, error);

      if (attempt < maxRetries) {
        // Retry on error - store as single-element array for consistency
        lastErrors = [error.message];
        continue;
      } else {
        // Max retries reached - throw error
        throw new Error(
          `Task orchestration failed after ${maxRetries} attempts: ${error.message}`
        );
      }
    }
  }

  // Should never reach here, but TypeScript needs this
  throw new Error("Unexpected end of retry loop");
}
