/**
 * JSON Schema for Phase 1: Orchestrator AI Response
 *
 * This schema is used with Vertex AI structured output to ensure the orchestrator
 * returns data in the correct format.
 */

import { OrchestratorOutput } from './types';

/**
 * JSON Schema for Phase 1 Orchestrator response
 * Used for Vertex AI structured output validation
 */
export const PHASE1_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    subtasks: {
      type: "array",
      description: "Array of service-level sub-tasks to execute",
      items: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Unique identifier for this sub-task (e.g., 'task-0', 'create-admin')"
          },
          service: {
            type: "string",
            description: "Service name that will handle this sub-task",
            enum: ["ai", "authentication", "firestore", "storage"]
          },
          prompt: {
            type: "string",
            description: "Refined prompt for the service agent describing what to do"
          },
          dependsOn: {
            type: "array",
            description: "Array of task IDs this task depends on (empty array if no dependencies)",
            items: {
              type: "string"
            }
          }
        },
        required: ["id", "service", "prompt", "dependsOn"]
      },
      minItems: 1
    },
    reasoning: {
      type: "string",
      description: "Optional explanation of the orchestration strategy and task breakdown"
    }
  },
  required: ["subtasks"]
} as const;

/**
 * Type guard to check if response matches OrchestratorOutput shape
 */
export function isOrchestratorOutput(obj: any): obj is OrchestratorOutput {
  if (typeof obj !== 'object' || obj === null) return false;
  if (!Array.isArray(obj.subtasks)) return false;
  if (obj.subtasks.length === 0) return false;

  // Validate each subtask
  for (const subtask of obj.subtasks) {
    if (typeof subtask !== 'object' || subtask === null) return false;
    if (typeof subtask.id !== 'string') return false;
    if (typeof subtask.service !== 'string') return false;
    if (typeof subtask.prompt !== 'string') return false;
    if (!Array.isArray(subtask.dependsOn)) return false;

    // Validate service is one of the allowed values
    if (!['ai', 'authentication', 'firestore', 'storage'].includes(subtask.service)) {
      return false;
    }

    // Validate dependsOn array contains only strings
    for (const dep of subtask.dependsOn) {
      if (typeof dep !== 'string') return false;
    }
  }

  // Reasoning is optional but must be string if present
  if (obj.reasoning !== undefined && typeof obj.reasoning !== 'string') {
    return false;
  }

  return true;
}
