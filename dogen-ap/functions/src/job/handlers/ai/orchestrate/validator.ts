/**
 * Task Plan Validator - Validates AI-generated task plans using TaskGraph
 *
 * This module performs comprehensive validation of AI-generated task plans:
 * - Structure validation (correct JSON format)
 * - Service/command existence checks
 * - ID prefix enforcement and generation
 * - Graph-based dependency validation using TaskGraph
 * - Cycle detection
 * - Input parameter validation
 */

import Ajv from 'ajv';
import { AITaskPlan, ValidationReport, ChildTaskSpec } from './types';
import { isValidServiceCommand, findTaskCapability } from './catalog';
import { TaskGraph } from '../../../taskGraph';
import { JobTask } from '../../../jobTask';
import { getHandlerDefinition } from '../../registry';

// Create Ajv instance (singleton) for JSON Schema validation
const ajv = new Ajv({
  allErrors: true,  // Collect all errors, not just first
  verbose: true,     // Include details in errors
  strict: false      // Allow additional schema keywords
});

/**
 * Validates an AI-generated task plan and returns validated child tasks
 *
 * @param plan - AI-generated task plan to validate
 * @param orchestratorId - ID of the orchestrator task (for ID prefixing)
 * @returns Validation report with validated child tasks if successful
 */
export async function validateTaskPlan(
  plan: AITaskPlan,
  orchestratorId: string
): Promise<ValidationReport> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let tasksValidated = 0;

  // Step 1: Structure validation
  if (!plan || typeof plan !== 'object') {
    errors.push("Invalid plan structure: must be an object");
    return {
      isValid: false,
      errors,
      warnings,
      tasksValidated,
      timestamp: new Date().toISOString()
    };
  }

  if (!Array.isArray(plan.tasks)) {
    errors.push("Invalid plan structure: 'tasks' must be an array");
    return {
      isValid: false,
      errors,
      warnings,
      tasksValidated,
      timestamp: new Date().toISOString()
    };
  }

  if (plan.tasks.length === 0) {
    warnings.push("Plan contains no tasks");
    return {
      isValid: true,
      errors,
      warnings,
      tasksValidated: 0,
      timestamp: new Date().toISOString()
    };
  }

  // Step 2: Validate each task structure and service/command
  for (let i = 0; i < plan.tasks.length; i++) {
    const task = plan.tasks[i];
    const taskLabel = `Task ${i}`;

    // Check required fields
    if (!task.service || typeof task.service !== 'string') {
      errors.push(`${taskLabel}: Missing or invalid 'service' field`);
      continue;
    }

    if (!task.command || typeof task.command !== 'string') {
      errors.push(`${taskLabel}: Missing or invalid 'command' field`);
      continue;
    }

    if (!task.input || typeof task.input !== 'object' || Array.isArray(task.input)) {
      errors.push(`${taskLabel}: Missing or invalid 'input' field (must be object)`);
      continue;
    }

    // Check service/command combination exists
    if (!isValidServiceCommand(task.service, task.command)) {
      errors.push(
        `${taskLabel}: Invalid service/command combination: ${task.service}/${task.command}`
      );
      continue;
    }

    // JSON Schema validation if schema is defined (includes required params validation)
    const definition = getHandlerDefinition(task.service, task.command);
    if (definition?.inputSchema) {
      const schemaErrors = validateAgainstSchema(
        task.input,
        definition.inputSchema,
        task.service,
        task.command,
        taskLabel
      );
      errors.push(...schemaErrors);
    } else {
      // Fallback to manual required parameter validation for handlers without schemas
      const capability = findTaskCapability(task.service, task.command);
      if (capability) {
        for (const requiredParam of capability.requiredParams) {
          if (!(requiredParam in task.input)) {
            errors.push(
              `${taskLabel} (${task.service}/${task.command}): ` +
              `Missing required parameter '${requiredParam}'`
            );
          }
        }
      }
    }

    // Check dependsOn is array if present
    if (task.dependsOn !== undefined) {
      if (!Array.isArray(task.dependsOn)) {
        errors.push(`${taskLabel}: 'dependsOn' must be an array`);
        continue;
      }

      for (const dep of task.dependsOn) {
        if (typeof dep !== 'string') {
          errors.push(`${taskLabel}: dependency IDs must be strings`);
        }
      }
    }

    tasksValidated++;
  }

  // Return early if structure validation failed
  if (errors.length > 0) {
    return {
      isValid: false,
      errors,
      warnings,
      tasksValidated,
      timestamp: new Date().toISOString()
    };
  }

  // Step 3: Enforce ID prefixes and generate IDs if needed
  const idMap = new Map<number, string>(); // Maps task index to final ID
  const usedIds = new Set<string>();

  for (let i = 0; i < plan.tasks.length; i++) {
    const task = plan.tasks[i];
    let finalId: string;

    if (task.id) {
      // AI provided an ID - ensure it has the correct prefix
      if (!task.id.startsWith(`${orchestratorId}-`)) {
        finalId = `${orchestratorId}-${task.id}`;
        warnings.push(
          `Task ${i}: Added prefix to ID '${task.id}' → '${finalId}'`
        );
      } else {
        finalId = task.id;
      }
    } else {
      // Generate ID: orchestratorId-index
      finalId = `${orchestratorId}-${i}`;
    }

    // Check for duplicate IDs
    if (usedIds.has(finalId)) {
      errors.push(
        `Task ${i}: Duplicate ID '${finalId}'. Each task must have a unique ID.`
      );
    }

    idMap.set(i, finalId);
    usedIds.add(finalId);
  }

  // Return if ID validation failed
  if (errors.length > 0) {
    return {
      isValid: false,
      errors,
      warnings,
      tasksValidated,
      timestamp: new Date().toISOString()
    };
  }

  // Step 4: Graph-based validation using TaskGraph
  try {
    // Create a mock orchestrator task as the root
    const orchestratorTask = new JobTask({
      id: orchestratorId,
      service: "ai",
      command: "orchestrate",
      input: {},
      depth: 0
    });

    // Create temporary graph with orchestrator as root
    const tempGraph = new TaskGraph([orchestratorTask]);

    // Add all child tasks as nodes
    for (let i = 0; i < plan.tasks.length; i++) {
      const task = plan.tasks[i];
      const taskId = idMap.get(i)!;

      const childTask = new JobTask({
        id: taskId,
        service: task.service,
        command: task.command,
        input: task.input,
        dependsOn: task.dependsOn,
        depth: 1 // All children are at depth 1 from orchestrator
      });

      // This will throw if task ID already exists
      tempGraph.addNode(taskId, childTask);
    }

    // Add dependency edges and validate
    for (let i = 0; i < plan.tasks.length; i++) {
      const task = plan.tasks[i];
      const taskId = idMap.get(i)!;

      if (task.dependsOn && task.dependsOn.length > 0) {
        for (const depId of task.dependsOn) {
          // Check if dependency exists (either orchestrator or sibling)
          if (!tempGraph.hasNode(depId)) {
            // Check if it's a sibling reference that needs prefix
            const prefixedDepId = depId.startsWith(`${orchestratorId}-`)
              ? depId
              : `${orchestratorId}-${depId}`;

            if (tempGraph.hasNode(prefixedDepId)) {
              // Dependency found with prefix - update the plan
              warnings.push(
                `Task ${i}: Dependency '${depId}' referenced as '${prefixedDepId}'`
              );
              // Add edge with corrected ID
              tempGraph.addEdge(prefixedDepId, taskId);
            } else {
              errors.push(
                `Task ${i}: Dependency '${depId}' not found. ` +
                `Available task IDs: ${Array.from(usedIds).join(', ')}`
              );
            }
          } else {
            // Dependency exists - add edge (will throw on cycle)
            tempGraph.addEdge(depId, taskId);
          }
        }
      }
    }

    // Validate no cycles (explicit check, though addEdge already checks)
    tempGraph.validateNoCycles();

  } catch (error: any) {
    errors.push(`Graph validation failed: ${error.message}`);
    return {
      isValid: false,
      errors,
      warnings,
      tasksValidated,
      timestamp: new Date().toISOString()
    };
  }

  // Check if any errors were accumulated during graph validation
  if (errors.length > 0) {
    return {
      isValid: false,
      errors,
      warnings,
      tasksValidated,
      timestamp: new Date().toISOString()
    };
  }

  // Step 5: All validations passed - plan is valid
  return {
    isValid: true,
    errors,
    warnings,
    tasksValidated,
    timestamp: new Date().toISOString()
  };
}

/**
 * Converts a validated AI task plan to ChildTaskSpec array for spawning
 *
 * @param plan - Validated AI task plan
 * @param orchestratorId - ID of the orchestrator task
 * @returns Array of ChildTaskSpec ready for spawning
 */
export function planToChildTasks(
  plan: AITaskPlan,
  orchestratorId: string
): ChildTaskSpec[] {
  return plan.tasks.map((task, _index) => {
    // Normalize dependency IDs with prefix
    const dependsOn = task.dependsOn?.map(depId => {
      return depId.startsWith(`${orchestratorId}-`)
        ? depId
        : `${orchestratorId}-${depId}`;
    });

    return {
      service: task.service,
      command: task.command,
      input: task.input,
      dependsOn
    };
  });
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

  // Get handler definition from registry
  const definition = getHandlerDefinition(service, command);

  if (!definition) {
    return [`Unknown service/command: ${service}/${command}`];
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
