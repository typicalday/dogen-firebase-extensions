/**
 * JSON Schema definitions for AI Task Orchestration
 *
 * These schemas are used with Gemini's responseSchema parameter to ensure
 * structured, validated JSON output from the AI model.
 */

/**
 * JSON Schema for AI response structure
 *
 * This schema enforces that the AI returns a valid task plan with:
 * - An array of tasks with required fields (service, command, input)
 * - Optional fields (id, dependsOn)
 * - Optional reasoning field explaining the plan
 */
export const AI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      description: "Array of tasks to execute in the job orchestration system",
      items: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Optional task identifier. If not provided, will be auto-generated."
          },
          service: {
            type: "string",
            description: "Service name (e.g., 'firestore', 'storage', 'ai', 'authentication')"
          },
          command: {
            type: "string",
            description: "Command name within the service (e.g., 'copy-collection', 'create-document')"
          },
          input: {
            type: "object",
            description: "Input parameters for the task. Structure depends on service and command."
          },
          dependsOn: {
            type: "array",
            description: "Optional array of task IDs this task depends on. Task will wait for dependencies to complete.",
            items: {
              type: "string"
            }
          }
        },
        required: ["service", "command", "input"]
      }
    },
    reasoning: {
      type: "string",
      description: "Optional explanation of the task plan and why these tasks were chosen"
    }
  },
  required: ["tasks"]
};

/**
 * Type guard to check if a value matches the AI response schema
 */
export function isAITaskPlan(value: unknown): value is { tasks: Array<{
  id?: string;
  service: string;
  command: string;
  input: Record<string, any>;
  dependsOn?: string[];
}>; reasoning?: string } {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const obj = value as any;

  // Check tasks array exists and is an array
  if (!Array.isArray(obj.tasks)) {
    return false;
  }

  // Check each task has required fields
  for (const task of obj.tasks) {
    if (!task || typeof task !== 'object') {
      return false;
    }

    if (typeof task.service !== 'string' ||
        typeof task.command !== 'string' ||
        typeof task.input !== 'object' ||
        task.input === null) {
      return false;
    }

    // Validate optional fields if present
    if (task.id !== undefined && typeof task.id !== 'string') {
      return false;
    }

    if (task.dependsOn !== undefined) {
      if (!Array.isArray(task.dependsOn)) {
        return false;
      }
      for (const dep of task.dependsOn) {
        if (typeof dep !== 'string') {
          return false;
        }
      }
    }
  }

  // Check reasoning is string if present
  if (obj.reasoning !== undefined && typeof obj.reasoning !== 'string') {
    return false;
  }

  return true;
}
