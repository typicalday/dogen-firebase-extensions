/**
 * JSON Schema for Phase 3: Command Agent AI Response
 *
 * The schema for Phase 3 is DYNAMIC - it depends on the specific command being executed.
 * We build the response schema using the command's input schema from the handler registry.
 */

import { getCommandSchemaFromRegistry, initializeCatalogs } from '../helpers/catalogGenerator';

/**
 * Build Phase 3 response schema for a specific command
 * The AI should return ONLY the input parameters, not the wrapper
 */
export function buildPhase3ResponseSchema(service: string, command: string): any {
  // Initialize catalogs (lazy initialization to avoid circular dependencies)
  initializeCatalogs();

  const schemaInfo = getCommandSchemaFromRegistry(service, command);

  if (!schemaInfo || !schemaInfo.inputSchema) {
    throw new Error(`No schema found for command ${service}/${command}`);
  }

  // Return just the input schema - the handler will wrap it
  return schemaInfo.inputSchema;
}
