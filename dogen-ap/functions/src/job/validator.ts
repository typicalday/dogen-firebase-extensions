/**
 * Task Validation Module - Validates tasks using the centralized handler registry
 *
 * This module performs comprehensive validation of tasks and task plans:
 * - Service/command existence checks against registry
 * - Input parameter validation using JSON Schema
 * - Required parameter validation
 * - Type validation using Ajv
 */

import Ajv from 'ajv';
import { ChildTaskSpec } from './types';
import { getHandlerDefinition, hasHandler } from './handlers/registry';

// Create Ajv instance (singleton) for JSON Schema validation
const ajv = new Ajv({
  allErrors: true,  // Collect all errors, not just first
  verbose: true,     // Include details in errors
  strict: false      // Allow additional schema keywords
});

/**
 * Validation report for task plan validation
 */
export interface ValidationReport {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  tasksValidated: number;
  timestamp: string;
}

/**
 * Validates a single task's input against its handler definition
 * Returns array of validation error messages (empty if valid)
 *
 * This function can be used for both orchestrator validation and
 * runtime validation before task execution.
 *
 * @param service - Service name (e.g., "firestore", "ai")
 * @param command - Command name (e.g., "copy-collection")
 * @param input - Task input object to validate
 * @returns Array of error messages (empty if valid)
 */
export function validateTaskInput(
  service: string,
  command: string,
  input: Record<string, any>
): string[] {
  const errors: string[] = [];

  // Check if handler exists
  if (!hasHandler(service, command)) {
    return [`Unknown service/command: ${service}/${command}`];
  }

  // Get handler definition from registry
  const definition = getHandlerDefinition(service, command);

  if (!definition) {
    return [`No definition found for service/command: ${service}/${command}`];
  }

  // Validate against JSON schema if defined (includes required params validation)
  if (definition.inputSchema) {
    const schemaErrors = validateAgainstSchema(
      input,
      definition.inputSchema,
      service,
      command,
      'Input'
    );
    errors.push(...schemaErrors);
  } else {
    // Fallback to manual required parameter validation for handlers without schemas
    for (const requiredParam of definition.requiredParams) {
      if (!(requiredParam in input)) {
        errors.push(`Missing required parameter: ${requiredParam}`);
      }
    }
  }

  return errors;
}

/**
 * Validates task input against its handler definition using Ajv library.
 * Uses Ajv's native error messages for simplicity and consistency.
 *
 * @param data - Input data to validate
 * @param schema - JSON Schema to validate against
 * @param service - Service name for error messages
 * @param command - Command name for error messages
 * @param taskLabel - Task label for error messages
 * @returns Array of validation error messages (empty if valid)
 */
export function validateAgainstSchema(
  data: Record<string, any>,
  schema: any,
  service: string,
  command: string,
  taskLabel: string
): string[] {
  const errors: string[] = [];
  const prefix = `${taskLabel} (${service}/${command})`;

  // Validate using Ajv
  const validate = ajv.compile(schema);
  const valid = validate(data);

  if (!valid && validate.errors) {
    for (const error of validate.errors) {
      // Format: "prefix: /path: message" or "prefix: message" if no path
      const path = error.instancePath || '';
      const message = error.message || 'validation failed';

      if (path) {
        errors.push(`${prefix}: ${path} ${message}`);
      } else {
        errors.push(`${prefix}: ${message}`);
      }
    }
  }

  return errors;
}

/**
 * Validates an array of ChildTaskSpec objects
 *
 * @param childTasks - Array of child task specifications to validate
 * @param parentId - ID of the parent task (for context in error messages)
 * @returns Validation report with errors and warnings
 */
export function validateChildTasks(
  childTasks: ChildTaskSpec[],
  parentId: string
): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  let tasksValidated = 0;

  // Check if childTasks is valid array
  if (!Array.isArray(childTasks)) {
    return {
      isValid: false,
      errors: ['childTasks must be an array'],
      warnings,
      tasksValidated: 0,
      timestamp: new Date().toISOString()
    };
  }

  // Validate each child task
  for (let i = 0; i < childTasks.length; i++) {
    const childSpec = childTasks[i];
    const childLabel = `Child task ${i} of ${parentId}`;

    // Check required fields
    if (!childSpec.service || typeof childSpec.service !== 'string') {
      errors.push(`${childLabel}: Missing or invalid 'service' field`);
      continue;
    }

    if (!childSpec.command || typeof childSpec.command !== 'string') {
      errors.push(`${childLabel}: Missing or invalid 'command' field`);
      continue;
    }

    // Check if service/command exists
    if (!hasHandler(childSpec.service, childSpec.command)) {
      errors.push(
        `${childLabel}: Invalid service/command combination: ${childSpec.service}/${childSpec.command}`
      );
      continue;
    }

    // Validate input parameters
    const inputErrors = validateTaskInput(
      childSpec.service,
      childSpec.command,
      childSpec.input || {}
    );

    if (inputErrors.length > 0) {
      errors.push(...inputErrors.map(err => `${childLabel}: ${err}`));
      continue;
    }

    // Check dependsOn is array if present
    if (childSpec.dependsOn !== undefined) {
      if (!Array.isArray(childSpec.dependsOn)) {
        errors.push(`${childLabel}: 'dependsOn' must be an array`);
        continue;
      }

      for (const dep of childSpec.dependsOn) {
        if (typeof dep !== 'string') {
          errors.push(`${childLabel}: dependency IDs must be strings`);
        }
      }
    }

    tasksValidated++;
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    tasksValidated,
    timestamp: new Date().toISOString()
  };
}
