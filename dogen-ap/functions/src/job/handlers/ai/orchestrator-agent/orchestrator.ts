/**
 * Phase 1: Orchestrator Agent
 *
 * Responsible for:
 * - Intent analysis
 * - Task decomposition into service-level sub-tasks
 * - Service selection
 * - Dependency planning between tasks
 * - ID assignment
 * - Workflow strategy determination
 *
 * Context provided: Only 4 high-level service descriptions (~500 tokens)
 * Output: Array of service-level sub-tasks with IDs, services, prompts, and dependencies
 */

import { VertexAI } from "@google-cloud/vertexai";
import { buildOrchestratorPrompts } from './promptBuilder';
import { PHASE1_RESPONSE_SCHEMA, isOrchestratorOutput } from './schema';
import {
  OrchestratorInput,
  OrchestratorOutput,
  OrchestratorValidationResult
} from './types';
import { isValidService } from '../service-agent/catalogs/service-catalog';

const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TASKS = 100;
const DEFAULT_MODEL = "gemini-2.5-pro";

/**
 * Validate Phase 1 orchestrator output
 */
export function validateOrchestratorOutput(
  output: OrchestratorOutput,
  maxTasks: number
): OrchestratorValidationResult {
  const errors: string[] = [];

  // Validate task count
  if (output.subtasks.length === 0) {
    errors.push("Subtasks array is empty");
  }

  if (output.subtasks.length > maxTasks) {
    errors.push(
      `Task count (${output.subtasks.length}) exceeds maximum (${maxTasks})`
    );
  }

  // Collect all task IDs for dependency validation
  const taskIds = new Set<string>();
  const duplicateIds = new Set<string>();

  // First pass: collect IDs and check for duplicates
  for (const subtask of output.subtasks) {
    if (taskIds.has(subtask.id)) {
      duplicateIds.add(subtask.id);
    }
    taskIds.add(subtask.id);
  }

  // Report duplicate IDs
  if (duplicateIds.size > 0) {
    errors.push(`Duplicate task IDs found: ${Array.from(duplicateIds).join(', ')}`);
  }

  // Second pass: validate each subtask
  output.subtasks.forEach((subtask, index) => {
    const prefix = `Subtask ${index} (${subtask.id})`;

    // Validate ID
    if (!subtask.id || subtask.id.trim() === '') {
      errors.push(`${prefix}: ID is empty`);
    }

    // Validate service
    if (!isValidService(subtask.service)) {
      errors.push(`${prefix}: Invalid service '${subtask.service}'`);
    }

    // Validate prompt
    if (!subtask.prompt || subtask.prompt.trim() === '') {
      errors.push(`${prefix}: Prompt is empty`);
    }

    // Validate dependencies
    if (!Array.isArray(subtask.dependsOn)) {
      errors.push(`${prefix}: dependsOn must be an array`);
    } else {
      // Check for self-dependency
      if (subtask.dependsOn.includes(subtask.id)) {
        errors.push(`${prefix}: Task cannot depend on itself`);
      }

      // Check for non-existent dependencies
      for (const depId of subtask.dependsOn) {
        if (!taskIds.has(depId)) {
          errors.push(`${prefix}: Depends on non-existent task '${depId}'`);
        }
      }
    }
  });

  // Detect circular dependencies
  const circularErrors = detectCircularDependencies(output.subtasks);
  errors.push(...circularErrors);

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Detect circular dependencies in task graph
 */
function detectCircularDependencies(subtasks: OrchestratorOutput['subtasks']): string[] {
  const errors: string[] = [];
  const taskMap = new Map(subtasks.map(t => [t.id, t]));

  // DFS to detect cycles
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function hasCycle(taskId: string, path: string[]): boolean {
    if (recursionStack.has(taskId)) {
      const cycle = [...path, taskId];
      errors.push(`Circular dependency detected: ${cycle.join(' → ')}`);
      return true;
    }

    if (visited.has(taskId)) {
      return false;
    }

    visited.add(taskId);
    recursionStack.add(taskId);

    const task = taskMap.get(taskId);
    if (task) {
      for (const depId of task.dependsOn) {
        if (hasCycle(depId, [...path, taskId])) {
          return true;
        }
      }
    }

    recursionStack.delete(taskId);
    return false;
  }

  // Check for cycles starting from each task
  for (const subtask of subtasks) {
    if (!visited.has(subtask.id)) {
      hasCycle(subtask.id, []);
    }
  }

  return errors;
}

/**
 * Run Phase 1: Orchestrator
 */
export async function runOrchestratorPhase(
  input: OrchestratorInput,
  vertexAI: VertexAI,
  options: {
    maxTasks?: number;
    temperature?: number;
    timeout?: number;
    verbose?: boolean;
    maxRetries?: number;
    model?: string;
    enableTracing?: boolean;
  } = {}
): Promise<{ output: OrchestratorOutput; retriesUsed: number; trace?: { systemInstruction: string; userPrompt: string; aiResponse: string } }> {
  const maxTasks = options.maxTasks ?? DEFAULT_MAX_TASKS;
  const temperature = options.temperature ?? DEFAULT_TEMPERATURE;
  const verbose = options.verbose ?? false;
  const maxRetries = options.maxRetries ?? 3;
  const modelName = options.model ?? DEFAULT_MODEL;
  const enableTracing = options.enableTracing ?? false;

  if (verbose) {
    console.log('[Phase 1: Orchestrator] Starting orchestration');
    console.log('[Phase 1: Orchestrator] Input:', JSON.stringify(input, null, 2));
    console.log(`[Phase 1: Orchestrator] Max retries: ${maxRetries}`);
  }

  // Store the original user prompt (never changes across retries)
  const originalPrompt = input.prompt;
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
      console.log(`[Phase 1: Orchestrator] Retry attempt ${attempt}/${maxRetries}`);
      console.log(`[Phase 1: Orchestrator] Previous validation errors:`, validationErrors);
    }

    try {
      // Build prompts with retry context
      const { systemInstruction, userPrompt } = buildOrchestratorPrompts(
        input,
        maxTasks,
        attempt > 1 ? {
          attempt,
          originalPrompt,
          previousResponse,
          validationErrors
        } : undefined
      );

      // Note: We don't need to store userPrompt since we keep the original

      if (verbose) {
        console.log(`[Phase 1: Orchestrator] Attempt ${attempt} - System instruction length:`, systemInstruction.length);
        console.log(`[Phase 1: Orchestrator] Attempt ${attempt} - User prompt length:`, userPrompt.length);
      }

      // Initialize Gemini model with structured output
      const model = vertexAI.getGenerativeModel({
        model: modelName,
        systemInstruction,
        generationConfig: {
          temperature,
          responseMimeType: "application/json",
          responseSchema: PHASE1_RESPONSE_SCHEMA as any,
        }
      });

      // Call AI
      const result = await model.generateContent({
        contents: [{
          role: 'user',
          parts: [{ text: userPrompt }]
        }]
      });

      const response = result.response;
      const candidate = response.candidates?.[0];

      if (!candidate || !candidate.content || !candidate.content.parts) {
        throw new Error("[Phase 1: Orchestrator] No response generated from AI");
      }

      // Extract and parse JSON response
      const responseText = candidate.content.parts
        .filter((part: any) => part.text)
        .map((part: any) => part.text)
        .join('');

      let orchestratorOutput: OrchestratorOutput;
      try {
        orchestratorOutput = JSON.parse(responseText);
      } catch (parseError: any) {
        validationErrors = [`Failed to parse AI response as JSON: ${parseError.message}`];
        previousResponse = responseText;
        // Capture failed attempt for trace
        if (enableTracing && attempt < maxRetries) {
          retryHistory.push({
            attempt,
            timestamp: new Date().toISOString(),
            validationErrors: [...validationErrors],
            aiResponse: responseText,
            previousResponse: responseText
          });
        }
        if (attempt === maxRetries) {
          throw new Error(`[Phase 1: Orchestrator] Failed after ${maxRetries} attempts. Last error: ${validationErrors.join('; ')}`);
        }
        continue;
      }

      // Store response for next iteration if needed
      previousResponse = orchestratorOutput;

      // Validate structure with type guard
      if (!isOrchestratorOutput(orchestratorOutput)) {
        validationErrors = ["AI response does not match expected schema structure"];
        // Capture failed attempt for trace
        if (enableTracing && attempt < maxRetries) {
          retryHistory.push({
            attempt,
            timestamp: new Date().toISOString(),
            validationErrors: [...validationErrors],
            aiResponse: responseText,
            previousResponse: orchestratorOutput
          });
        }
        if (attempt === maxRetries) {
          throw new Error(`[Phase 1: Orchestrator] Failed after ${maxRetries} attempts. Last error: ${validationErrors.join('; ')}`);
        }
        continue;
      }

      // Validate orchestrator output
      const validationResult = validateOrchestratorOutput(orchestratorOutput, maxTasks);
      if (!validationResult.isValid) {
        validationErrors = validationResult.errors;
        if (verbose) {
          console.log(`[Phase 1: Orchestrator] Attempt ${attempt} - Validation failed:`, validationErrors);
        }
        // Capture failed attempt for trace
        if (enableTracing && attempt < maxRetries) {
          retryHistory.push({
            attempt,
            timestamp: new Date().toISOString(),
            validationErrors: [...validationErrors],
            aiResponse: responseText,
            previousResponse: orchestratorOutput
          });
        }
        if (attempt === maxRetries) {
          throw new Error(
            `[Phase 1: Orchestrator] Failed after ${maxRetries} attempts. Validation errors: ${validationErrors.join('; ')}`
          );
        }
        continue;
      }

      // Success!
      if (verbose) {
        console.log(`[Phase 1: Orchestrator] Successfully generated ${orchestratorOutput.subtasks.length} sub-tasks on attempt ${attempt}`);
        if (orchestratorOutput.reasoning) {
          console.log('[Phase 1: Orchestrator] Reasoning:', orchestratorOutput.reasoning);
        }
      }

      const returnValue: { output: OrchestratorOutput; retriesUsed: number; trace?: { systemInstruction: string; userPrompt: string; aiResponse: string } } = {
        output: orchestratorOutput,
        retriesUsed: attempt
      };

      if (enableTracing) {
        returnValue.trace = {
          systemInstruction,
          userPrompt,
          aiResponse: responseText,
          // Include retry history if there were any retries
          ...(retryHistory.length > 0 && {
            retryHistory,
            retriesUsed: attempt
          })
        };
      }

      return returnValue;

    } catch (error: any) {
      // Only re-throw on last attempt
      if (attempt === maxRetries) {
        throw error;
      }
      // Otherwise log and continue to next attempt
      if (verbose) {
        console.log(`[Phase 1: Orchestrator] Attempt ${attempt} failed with error:`, error.message);
      }
      validationErrors = [error.message];
      // Capture failed attempt for trace
      if (enableTracing && attempt < maxRetries) {
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
  throw new Error(`[Phase 1: Orchestrator] Failed after ${maxRetries} attempts`);
}
