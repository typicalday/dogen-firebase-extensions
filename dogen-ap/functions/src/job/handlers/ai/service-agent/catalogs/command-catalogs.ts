/**
 * Command Catalogs for Phase 2: Service Agent
 *
 * Provides command-level information for each service.
 * Service agents see ONLY commands for their specific service (~1,500 tokens per service).
 *
 * No full schemas or detailed examples at this level - just command descriptions and parameter lists.
 */

export interface CommandInfo {
  command: string;
  description: string;
  requiredParams: string[];
  optionalParams: string[];
}

export type ServiceCommandCatalog = Record<string, CommandInfo>;

/**
 * Command catalog per service
 * Auto-generated from HANDLER_REGISTRY to ensure sync
 * Populated lazily by catalog-generator on first access
 */
export const COMMAND_CATALOGS: Record<string, ServiceCommandCatalog> = {
  // Will be populated by catalog-generator from HANDLER_REGISTRY
};

/**
 * Get command catalog for a specific service
 */
export function getCommandCatalog(service: string): ServiceCommandCatalog | undefined {
  return COMMAND_CATALOGS[service];
}

/**
 * Get information about a specific command
 */
export function getCommandInfo(service: string, command: string): CommandInfo | undefined {
  const serviceCatalog = COMMAND_CATALOGS[service];
  if (!serviceCatalog) return undefined;
  return serviceCatalog[command];
}

/**
 * Get all commands for a service as array
 */
export function getServiceCommands(service: string): CommandInfo[] {
  const catalog = getCommandCatalog(service);
  if (!catalog) return [];

  return Object.entries(catalog).map(([_cmdName, info]) => info);
}

/**
 * Validate if a service/command combination exists
 */
export function isValidCommand(service: string, command: string): boolean {
  const catalog = COMMAND_CATALOGS[service];
  return catalog ? command in catalog : false;
}
