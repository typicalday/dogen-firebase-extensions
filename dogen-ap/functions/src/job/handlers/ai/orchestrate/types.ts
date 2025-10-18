/**
 * Type definitions for AI Task Orchestration system
 */

/**
 * Input specification for orchestrate task handler
 */
export interface OrchestrateInput {
  /** Natural language prompt describing what needs to be done */
  prompt: string;

  /**
   * Dry run mode for human-in-the-loop workflows (default: true)
   * - true: Returns planned tasks for review without executing them
   * - false: Executes the generated tasks automatically
   */
  dryRun?: boolean;

  /** Maximum number of retry attempts on validation failure (default: 3) */
  maxRetries?: number;

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

  /** Log AI responses to console for debugging (default: false) */
  logAiResponses?: boolean;

  /** Verbose mode - enables detailed logging throughout orchestration (default: false) */
  verbose?: boolean;
}

/**
 * Output from orchestrate task handler
 */
export interface OrchestrateOutput {
  /** Original user prompt */
  prompt: string;

  /** AI-generated task plan */
  plan: AITaskPlan;

  /** AI's reasoning for the plan (if provided) */
  reasoning?: string;

  /** Whether this was a dry run (human-in-the-loop mode) */
  dryRun: boolean;

  /**
   * Child tasks to be spawned and executed automatically
   * Only present when dryRun: false
   */
  childTasks?: ChildTaskSpec[];

  /**
   * Planned tasks returned for human review
   * Only present when dryRun: true
   */
  plannedTasks?: ChildTaskSpec[];

  /** Number of retry attempts used */
  retriesUsed: number;

  /** Validation report with details */
  validationReport: ValidationReport;

  /** Token usage statistics */
  usage?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
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
