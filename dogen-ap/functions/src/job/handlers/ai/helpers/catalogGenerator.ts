/**
 * Catalog Generator
 *
 * Auto-generates catalogs from HANDLER_REGISTRY to ensure synchronization.
 * This is the single source of truth - all catalog data comes from the registry.
 */

import { HANDLER_REGISTRY, HandlerDefinition } from '../../registry';
import { COMMAND_CATALOGS, ServiceCommandCatalog } from '../service-agent/catalogs/command-catalogs';
import { CommandSchemaInfo } from '../command-agent/catalogs/schema-catalog';

/**
 * Track whether catalogs have been initialized
 */
let catalogsInitialized = false;

/**
 * Initialize all catalogs from the handler registry
 * This is called lazily on first use to avoid circular dependency issues
 */
export function initializeCatalogs(): void {
  if (catalogsInitialized) return;

  // Check if HANDLER_REGISTRY is defined
  if (!HANDLER_REGISTRY) {
    throw new Error('HANDLER_REGISTRY is undefined. This may indicate a circular dependency issue.');
  }

  generateCommandCatalogs();
  catalogsInitialized = true;
}

/**
 * Generate command catalogs for all services from HANDLER_REGISTRY
 */
function generateCommandCatalogs(): void {
  for (const [service, commands] of Object.entries(HANDLER_REGISTRY)) {
    const serviceCatalog: ServiceCommandCatalog = {};

    for (const [commandName, definition] of Object.entries(commands as Record<string, HandlerDefinition>)) {
      serviceCatalog[commandName] = {
        command: commandName,
        description: definition.description,
        requiredParams: definition.requiredParams,
        optionalParams: definition.optionalParams || []
      };
    }

    COMMAND_CATALOGS[service] = serviceCatalog;
  }
}

/**
 * Get full schema information for a specific command from registry
 */
export function getCommandSchemaFromRegistry(service: string, command: string): CommandSchemaInfo | undefined {
  const definition = HANDLER_REGISTRY[service]?.[command];
  if (!definition) return undefined;

  if (!definition.inputSchema) {
    throw new Error(`Command ${service}/${command} does not have an input schema defined`);
  }

  return {
    service,
    command,
    description: definition.description,
    requiredParams: definition.requiredParams,
    optionalParams: definition.optionalParams || [],
    inputSchema: definition.inputSchema,
    examples: definition.examples || []
  };
}

/**
 * Get list of all services from registry
 */
export function getAllServicesFromRegistry(): string[] {
  return Object.keys(HANDLER_REGISTRY);
}

/**
 * Get list of all commands for a service from registry
 */
export function getServiceCommandsFromRegistry(service: string): string[] {
  const commands = HANDLER_REGISTRY[service];
  return commands ? Object.keys(commands) : [];
}

/**
 * Validate if a service/command combination exists in registry
 */
export function isValidServiceCommand(service: string, command: string): boolean {
  return !!(HANDLER_REGISTRY[service]?.[command]);
}

// Note: Catalogs are initialized lazily on first use to avoid circular dependencies
// No automatic initialization here!
