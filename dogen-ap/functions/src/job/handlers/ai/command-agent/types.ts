/**
 * Type Definitions for Phase 3: Command Agent
 *
 * The command agent is responsible for:
 * - Parameter construction with full schema validation
 * - Format enforcement
 * - Type conversion
 * - Dependency resolution ({{taskId.output.field}} syntax)
 * - Creating schema-valid executable tasks
 */

/**
 * Input to Phase 3: Command Agent
 * This is a single command routing from Phase 2
 */
export interface CommandAgentInput {
  /** Task ID from orchestrator */
  id: string;

  /** Service name (e.g., "firestore", "storage") */
  service: string;

  /** Selected command within the service */
  command: string;

  /** Refined prompt from service agent with parameter-specific details */
  prompt: string;

  /** Task dependencies */
  dependsOn: string[];

  /** Maximum number of retry attempts if validation fails (default: 3) */
  maxRetries?: number;

  /** Vertex AI model to use (default: "gemini-2.5-pro") */
  model?: string;
}

/**
 * Output from Phase 3: Command Agent
 * Command-agent is a task-spawning agent that has no actionable output.
 * The output object is empty - audit metadata is returned separately at handler level.
 */
export interface CommandAgentOutput {
  // Empty - command-agent has no actionable output
}

/**
 * Validation result for command agent output
 */
export interface CommandAgentValidationResult {
  isValid: boolean;
  errors: string[];
}
