/**
 * Task Catalog - Comprehensive registry of all available task capabilities
 *
 * This catalog provides the AI with detailed information about what tasks
 * it can orchestrate, including descriptions, parameters, and examples.
 */

import { TaskCapability } from './types';
import { HANDLER_REGISTRY } from '../../registry';

/**
 * Cached task catalog to avoid regenerating on every call
 */
let TASK_CATALOG_CACHE: TaskCapability[] | null = null;

/**
 * Builds the task catalog from the handler registry.
 * This is lazy-loaded to avoid circular dependency issues during module initialization.
 */
function buildTaskCatalog(): TaskCapability[] {
  const catalog: TaskCapability[] = [];

  // Generate catalog from handler registry
  for (const [service, commands] of Object.entries(HANDLER_REGISTRY)) {
    for (const [command, definition] of Object.entries(commands)) {
      catalog.push({
        service,
        command,
        description: definition.description,
        requiredParams: definition.requiredParams,
        optionalParams: definition.optionalParams || [],
        examples: definition.examples || [],
      });
    }
  }

  return catalog;
}

/**
 * Returns the complete task catalog (auto-generated from registry)
 * Uses lazy loading to avoid circular dependency issues during module initialization.
 */
export function getTaskCatalog(): TaskCapability[] {
  if (!TASK_CATALOG_CACHE) {
    TASK_CATALOG_CACHE = buildTaskCatalog();
  }
  return TASK_CATALOG_CACHE;
}

/**
 * Finds a task capability by service and command
 */
export function findTaskCapability(
  service: string,
  command: string
): TaskCapability | undefined {
  // Direct lookup in registry for better performance
  const definition = HANDLER_REGISTRY[service]?.[command];
  if (!definition) {
    return undefined;
  }

  return {
    service,
    command,
    description: definition.description,
    requiredParams: definition.requiredParams,
    optionalParams: definition.optionalParams || [],
    examples: definition.examples || [],
  };
}

/**
 * Validates if a service and command combination exists in the catalog
 */
export function isValidServiceCommand(
  service: string,
  command: string
): boolean {
  return HANDLER_REGISTRY[service]?.[command] !== undefined;
}

/**
 * Gets all available services
 */
export function getAvailableServices(): string[] {
  return Object.keys(HANDLER_REGISTRY).sort();
}

/**
 * Gets all available commands for a service
 */
export function getServiceCommands(service: string): string[] {
  const serviceHandlers = HANDLER_REGISTRY[service];
  if (!serviceHandlers) {
    return [];
  }
  return Object.keys(serviceHandlers).sort();
}
