/**
 * Type definitions for AI Task Orchestration system
 */

/**
 * Phase 1: Orchestrator Types
 *
 * The orchestrator is responsible for:
 * - Intent analysis
 * - Task decomposition
 * - Service selection
 * - Dependency planning
 * - ID assignment
 * - Workflow strategy determination
 */

/**
 * Input to Phase 1: Orchestrator
 */
export interface OrchestratorInput {
  /** User's natural language request */
  prompt: string;

  /** Optional additional context */
  context?: Record<string, any>;

  /** Maximum number of sub-tasks allowed */
  maxTasks?: number;
}

/**
 * Single sub-task output from orchestrator
 */
export interface OrchestratorSubtask {
  /** Unique identifier assigned by orchestrator (e.g., "task-0", "create-admin") */
  id: string;

  /** Service name (one of: ai, authentication, firestore, storage) */
  service: string;

  /** Refined prompt for service agent */
  prompt: string;

  /** Array of task IDs this task depends on */
  dependsOn: string[];
}

/**
 * Output from Phase 1: Orchestrator
 * This is what the AI returns and what gets passed to Phase 2
 */
export interface OrchestratorOutput {
  /** Array of service-level sub-tasks */
  subtasks: OrchestratorSubtask[];

  /** Optional explanation of the orchestration plan */
  reasoning?: string;
}

/**
 * Validation result for orchestrator output
 */
export interface OrchestratorValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Handler Types
 */

/**
 * Input specification for orchestrator-agent task handler
 */
export interface OrchestratorAgentInput {
  /** Natural language prompt describing what needs to be done */
  prompt: string;

  /** AI temperature for creativity control (default: 0.2, range: 0.0-1.0) */
  temperature?: number;

  /** Additional context to help AI understand the request */
  context?: Record<string, any>;

  /** Maximum child tasks this orchestrator can spawn (default: 100) */
  maxChildTasks?: number;

  /** Timeout for AI API call in milliseconds (default: 60000) */
  timeout?: number;

  /** Maximum depth limit for task hierarchy (default: 10) */
  maxDepth?: number;

  /** Verbose mode - enables detailed logging throughout orchestration (default: false) */
  verbose?: boolean;

  /** Maximum number of retry attempts if validation fails (default: 3) */
  maxRetries?: number;

  /** Vertex AI model to use (default: "gemini-2.5-pro") */
  model?: string;
}

/**
 * Output from orchestrator-agent task handler
 * Orchestrator is a task-spawning agent that has no actionable output.
 * The output object is empty - audit metadata is returned separately at handler level.
 */
export interface OrchestratorAgentOutput {
  // Empty - orchestrator has no actionable output
}

/**
 * AI-generated task plan structure
 */
export interface AITaskPlan {
  /** Array of tasks to execute */
  tasks: AITaskSpec[];

  /** Optional reasoning explaining the plan */
  reasoning?: string;
}

/**
 * Task specification from AI (before validation)
 */
export interface AITaskSpec {
  /** Optional task ID (will be prefixed if provided) */
  id?: string;

  /** Service name (e.g., "firestore", "storage", "ai", "authentication") */
  service: string;

  /** Command name (e.g., "copy-collection", "create-document") */
  command: string;

  /** Input parameters for the task */
  input: Record<string, any>;

  /** Optional dependencies on other task IDs */
  dependsOn?: string[];
}

/**
 * Child task specification for spawning (after validation)
 */
export interface ChildTaskSpec {
  /** Service name */
  service: string;

  /** Command name */
  command: string;

  /** Input parameters */
  input?: Record<string, any>;

  /** Task dependencies */
  dependsOn?: string[];
}

/**
 * Task capability information for catalog
 */
export interface TaskCapability {
  /** Service name */
  service: string;

  /** Command name */
  command: string;

  /** Human-readable description of what the task does */
  description: string;

  /** Required input parameters */
  requiredParams: string[];

  /** Optional input parameters */
  optionalParams: string[];

  /** Example usage with descriptions */
  examples: Array<{
    /** Example input data */
    input: Record<string, any>;

    /** Description of what this example does */
    description: string;
  }>;
}

/**
 * Validation report from task plan validation
 */
export interface ValidationReport {
  /** Whether the plan is valid and ready to execute */
  isValid: boolean;

  /** Critical errors that prevent execution */
  errors: string[];

  /** Non-critical warnings */
  warnings: string[];

  /** Number of tasks that were validated */
  tasksValidated: number;

  /** Validation timestamp */
  timestamp: string;
}

/**
 * Internal retry context for orchestration loop
 */
export interface RetryContext {
  /** Current attempt number (1-indexed) */
  attempt: number;

  /** Errors from previous attempt */
  previousErrors?: string[];

  /** Previous AI response that failed validation */
  previousResponse?: AITaskPlan;
}

/**
 * Information about a dependency task to include in AI prompt
 */
export interface DependencyTaskInfo {
  /** Task ID */
  id: string;

  /** Service name (e.g., "firestore", "storage") */
  service: string;

  /** Command name (e.g., "copy-collection") */
  command: string;

  /** Task output/result */
  output?: Record<string, any>;
}
