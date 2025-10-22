/**
 * JSON Schema for Phase 2: Service Agent AI Response
 *
 * This schema is used with Vertex AI structured output to ensure the service agent
 * returns data in the correct format.
 */

import { SchemaType } from '@google-cloud/vertexai';

/**
 * AI response structure for Phase 2 Service Agent
 * The AI only returns the command selection and refined prompt
 */
export interface ServiceAgentAIResponse {
  /** Selected command name within the service */
  command: string;

  /** Refined prompt for command agent with parameter-specific details */
  prompt: string;

  /** Optional reasoning for command selection */
  reasoning?: string;
}

/**
 * JSON Schema for Phase 2 Service Agent response
 * Used for Vertex AI structured output validation
 */
export const PHASE2_RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    command: {
      type: SchemaType.STRING,
      description: "Selected command name within the service"
    },
    prompt: {
      type: SchemaType.STRING,
      description: "Refined prompt for command agent with parameter-specific details"
    },
    reasoning: {
      type: SchemaType.STRING,
      description: "Optional reasoning for command selection"
    }
  },
  required: ["command", "prompt"]
};

/**
 * Type guard to check if response matches ServiceAgentAIResponse shape
 */
export function isServiceAgentAIResponse(obj: any): obj is ServiceAgentAIResponse {
  if (typeof obj !== 'object' || obj === null) return false;
  if (typeof obj.command !== 'string') return false;
  if (typeof obj.prompt !== 'string') return false;
  if (obj.reasoning !== undefined && typeof obj.reasoning !== 'string') return false;

  return true;
}

/**
 * Validation result for service agent AI response
 */
export interface ServiceAgentValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validate service agent AI response
 */
export function validateServiceAgentAIResponse(
  response: ServiceAgentAIResponse,
  service: string,
  availableCommands: string[]
): ServiceAgentValidationResult {
  const errors: string[] = [];

  // Validate command is not empty
  if (!response.command || response.command.trim() === '') {
    errors.push("Command is empty");
  } else if (!availableCommands.includes(response.command)) {
    errors.push(`Invalid command '${response.command}' for service '${service}'. Available commands: ${availableCommands.join(', ')}`);
  }

  // Validate prompt is not empty
  if (!response.prompt || response.prompt.trim() === '') {
    errors.push("Prompt is empty");
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}
