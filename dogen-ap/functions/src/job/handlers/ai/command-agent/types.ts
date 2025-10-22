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
 * Actionable result from command-agent (for downstream task consumption)
 * Command-agent is a task-spawning agent, so it has no actionable data to pass.
 * The result is the spawning of execution tasks, not data for other tasks to consume.
 */
export type CommandAgentResult = Record<string, never>; // Empty object {}

/**
 * Output from Phase 3: Command Agent
 * This is a fully constructed, schema-valid task ready for execution
 */
export interface CommandAgentOutput {
  /** Actionable result for downstream tasks - contains only essential data */
  result: CommandAgentResult;

  /**
   * IDs of child tasks that were spawned
   * The full task specifications are in the task registry, this just tracks which tasks were created
   */
  childTaskIds?: string[];

  /** AI audit trail: Full request/response details (only populated when context.aiAuditing is true) */
  audit?: {
    input: CommandAgentInput;
    constructedParameters: Record<string, any>;
    systemInstruction: string;
    userPrompt: string;
    aiResponse: string;
  };
}

/**
 * Validation result for command agent output
 */
export interface CommandAgentValidationResult {
  isValid: boolean;
  errors: string[];
}
