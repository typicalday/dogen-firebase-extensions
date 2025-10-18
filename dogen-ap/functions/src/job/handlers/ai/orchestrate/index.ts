/**
 * AI Task Orchestration Module
 *
 * Exports the main handler and types for AI-powered task orchestration.
 */

export { handleOrchestrate } from './handler';
export * from './types';
// NOTE: catalog is NOT exported here to avoid circular dependency with registry.ts
// Import catalog directly from './catalog' if needed
export * from './validator';
export * from './promptBuilder';
export * from './schema';
