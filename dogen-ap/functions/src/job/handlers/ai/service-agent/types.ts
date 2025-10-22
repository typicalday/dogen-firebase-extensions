/**
 * Type definitions for Service Agent Handler (Phase 2)
 */

/**
 * Input to Service Agent (from Phase 1 Orchestrator)
 */
export interface ServiceAgentInput {
  /** Task ID assigned by orchestrator */
  id: string;

  /** Service name (authentication, firestore, storage, etc.) */
  service: string;

  /** Refined prompt from orchestrator */
  prompt: string;

  /** Task IDs this task depends on */
  dependsOn: string[];

  /** Maximum number of retry attempts if validation fails (default: 3) */
  maxRetries?: number;

  /** Vertex AI model to use (default: "gemini-2.5-pro") */
  model?: string;
}

/**
 * Actionable result from service-agent (for downstream task consumption)
 * Service-agent is a task-spawning agent, so it has no actionable data to pass.
 * The result is the spawning of command-agent tasks, not data for other tasks to consume.
 */
export type ServiceAgentResult = Record<string, never>; // Empty object {}

/**
 * Output from Service Agent
 */
export interface ServiceAgentOutput {
  /** Actionable result for downstream tasks - contains only essential data */
  result: ServiceAgentResult;

  /**
   * IDs of child tasks that were spawned
   * The full task specifications are in the task registry, this just tracks which tasks were created
   */
  childTaskIds?: string[];

  /** AI audit trail: Full request/response details (only populated when context.aiAuditing is true) */
  audit?: {
    input: ServiceAgentInput;
    selectedCommand: string;
    refinedPrompt: string;
    systemInstruction: string;
    userPrompt: string;
    aiResponse: string;
  };
}
