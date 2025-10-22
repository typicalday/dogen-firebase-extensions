/**
 * Service Catalog for Phase 1: Orchestrator
 *
 * Provides high-level descriptions of available services.
 * This is the ONLY context given to the orchestrator AI to keep token count minimal (~500 tokens).
 *
 * No command details, no schemas, no examples at this level.
 */

export interface ServiceInfo {
  name: string;
  description: string;
}

/**
 * High-level service catalog for orchestrator phase
 * Maps service names to high-level descriptions
 */
export const SERVICE_CATALOG: Record<string, string> = {
  ai: "AI inference, content generation, embeddings, and intelligent task orchestration.",

  authentication: "User account lifecycle (create, read, update, delete), custom claims management, and user queries.",

  firestore: "Firestore document/collection CRUD, data import/export (JSON/CSV), batch operations, and path management.",

  storage: "Cloud Storage file operations, path-based cleanup, and bucket management."
};

/**
 * Get list of available services for orchestrator
 */
export function getAvailableServices(): string[] {
  return Object.keys(SERVICE_CATALOG);
}

/**
 * Get service information for orchestrator
 */
export function getServiceInfo(service: string): string | undefined {
  return SERVICE_CATALOG[service];
}

/**
 * Get all service information as array
 */
export function getAllServiceInfo(): ServiceInfo[] {
  return Object.entries(SERVICE_CATALOG).map(([name, description]) => ({
    name,
    description
  }));
}

/**
 * Validate if a service exists
 */
export function isValidService(service: string): boolean {
  return service in SERVICE_CATALOG;
}
