/**
 * AI Task Orchestration Handler
 *
 * Phase 1 of 3-phase progressive refinement orchestration:
 * 1. Takes natural language prompts
 * 2. Calls Gemini AI to determine which services are needed
 * 3. Returns ai:serviceAgent childTasks for the job system to spawn
 * 4. Service agents (Phase 2) will determine commands
 * 5. Command agents (Phase 3) will construct parameters
 */

import { JobTask } from '../../../jobTask';
import { JobContext } from '../../../jobContext';
import { VertexAI } from "@google-cloud/vertexai";
import config from "../../../../config";
import {
  OrchestratorAgentInput,
  OrchestratorAgentOutput
} from './types';
import { runOrchestratorPhase } from './orchestrator';
import { scopeChildTasks } from '../../../helpers/scopeChildTasks';

/**
 * Default configuration for orchestration
 */
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_CHILD_TASKS = 100;
const DEFAULT_MAX_DEPTH = 10;

/**
 * Timeout for AI model API calls (60 seconds)
 * Prevents hung requests from blocking job execution indefinitely
 */
const AI_CALL_TIMEOUT = 60000;

/**
 * Handles AI task orchestration requests
 *
 * @param task - The orchestration task containing user prompt and parameters
 * @returns Orchestration output with validated child tasks
 */
export async function handleOrchestratorAgent(task: JobTask, context: JobContext): Promise<{ output: OrchestratorAgentOutput; audit?: any; childTasks: any[] }> {
  const input = task.input as OrchestratorAgentInput | undefined;

  // Validate input
  if (!input?.prompt) {
    throw new Error("Invalid input: prompt is required");
  }

  const temperature = input.temperature ?? DEFAULT_TEMPERATURE;
  const maxChildTasks = input.maxChildTasks ?? DEFAULT_MAX_CHILD_TASKS;
  const timeout = input.timeout ?? AI_CALL_TIMEOUT;
  const maxDepth = input.maxDepth ?? DEFAULT_MAX_DEPTH;
  const verbose = input.verbose ?? context.verbose;  // Use context.verbose if not explicitly set
  const maxRetries = input.maxRetries ?? 3;
  const model = input.model ?? "gemini-2.5-pro";

  if (verbose) {
    console.log(`[OrchestratorAgent] Starting orchestration for task ${task.id}`);
    console.log(`[OrchestratorAgent] Configuration:`, {
      model,
      temperature,
      maxChildTasks,
      timeout,
      maxDepth,
      maxRetries,
      verbose
    });
  }

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

  // Get project ID - use localProjectIdOverride if set (for local testing), otherwise use Firebase project
  const projectId = config.localProjectIdOverride ?? config.firebaseProjectId;

  if (!projectId) {
    throw new Error("Project ID not found");
  }

  // Initialize Vertex AI
  const vertexAI = new VertexAI({
    project: projectId,
    location: config.location || 'us-central1',
  });

  // ============================================================================
  // MULTI-PHASE ORCHESTRATION
  //
  // This orchestrator is Phase 1 of 3-phase progressive refinement:
  // - Phase 1 (THIS): Orchestrator determines which services are needed
  // - Phase 2: Service Agents (spawned as childTasks) determine which commands
  // - Phase 3: Command Agents (spawned by service agents) construct parameters
  //
  // The orchestrator returns ai:serviceAgent childTasks, which the job system
  // will spawn and execute. Each phase leverages the job graph for:
  // - Parallel execution
  // - Dependency management
  // - Plan mode support
  // ============================================================================

  if (verbose) {
    console.log(`[OrchestratorAgent] Phase 1: Determining services needed`);
  }

  try {
    // Execute Phase 1: Determine which service agents are needed
    const phase1Result = await runOrchestratorPhase(
      {
        prompt: input.prompt,
        context: input.context,
        maxTasks: maxChildTasks
      },
      vertexAI,
      {
        maxTasks: maxChildTasks,
        temperature,
        timeout,
        verbose,
        maxRetries,
        model,
        aiAuditing: context.aiAuditing
      }
    );

    const phase1Output = phase1Result.output;
    const retriesUsed = phase1Result.retriesUsed;
    const audit = phase1Result.audit;

    if (verbose) {
      console.log(`[OrchestratorAgent] Phase 1 completed on attempt ${retriesUsed}: ${phase1Output.subtasks.length} service agent(s) needed`);
      if (phase1Output.reasoning) {
        console.log(`[OrchestratorAgent] Reasoning: ${phase1Output.reasoning}`);
      }
      phase1Output.subtasks.forEach((subtask, index) => {
        console.log(`  ${index + 1}. [${subtask.id}] service:${subtask.service}${subtask.dependsOn.length > 0 ? ` (depends on: ${subtask.dependsOn.join(', ')})` : ''}`);
      });
    }

    // Convert orchestrator subtasks to ai:serviceAgent childTasks
    // Append "-service" suffix to indicate this is the service-agent phase
    const unscopedChildTasks = phase1Output.subtasks.map(subtask => ({
      id: `${subtask.id}-service`,  // Add phase suffix
      service: "ai",
      command: "service-agent",
      input: {
        id: `${subtask.id}-service`,  // Pass suffixed ID to service agent
        service: subtask.service,
        prompt: subtask.prompt,
        dependsOn: subtask.dependsOn.map(dep => `${dep}-service`)  // Dependencies also get -service suffix
      },
      dependsOn: subtask.dependsOn.length > 0 ? subtask.dependsOn.map(dep => `${dep}-service`) : undefined
    }));

    // Apply hierarchical ID scoping and resolve dependencies
    // This ensures output shows actual IDs that will be created
    const { scopedChildren: childTasks } = scopeChildTasks(task.id, unscopedChildTasks);

    if (verbose) {
      console.log(`[OrchestratorAgent] Returning ${childTasks.length} ai:serviceAgent childTask(s)`);
      console.log(`[OrchestratorAgent] Job graph will handle parallel execution and dependency resolution`);
    }

    // Build validation report
    const validationReport = {
      isValid: true,
      errors: [],
      warnings: [],
      tasksValidated: childTasks.length,
      timestamp: new Date().toISOString()
    };

    // Return orchestration result
    // Orchestrator is a task-spawning agent with no actionable output
    // Metadata is stored in audit field only when aiAuditing is enabled
    const output: OrchestratorAgentOutput = {};

    const auditData = context.aiAuditing ? {
      reasoning: phase1Output.reasoning,
      childTaskIds: childTasks.map(ct => ct.id!), // Store just the IDs, full specs are in task registry
      retriesUsed,
      validationReport,
      systemInstruction: audit?.systemInstruction || '',
      userPrompt: audit?.userPrompt || '',
      aiResponse: audit?.aiResponse || ''
    } : undefined;

    if (verbose) {
      console.log(`[OrchestratorAgent] Phase 1 orchestration completed successfully`);
    }

    return {
      output,
      audit: auditData,
      childTasks // Return childTasks separately for job system to spawn
    };

  } catch (error: any) {
    console.error(`[OrchestratorAgent] Phase 1 orchestration failed:`, error);
    throw new Error(`Phase 1 orchestration failed: ${error.message}`);
  }
}
