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
 * Output from Service Agent
 * Service-agent is a task-spawning agent that has no actionable output.
 * The output object is empty - trace metadata is returned separately at handler level.
 */
export interface ServiceAgentOutput {
  // Empty - service-agent has no actionable output
}
