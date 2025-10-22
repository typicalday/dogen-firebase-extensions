/**
 * Schema Catalog for Phase 3: Command Agent
 *
 * Provides full schema details for specific commands.
 * Command agents see ONLY the schema for their specific command (~2,000 tokens per command).
 *
 * Includes full JSON schemas, examples, validation rules, and format requirements.
 */

import { InputSchema } from '../../../registry';

export interface CommandSchemaInfo {
  service: string;
  command: string;
  description: string;
  requiredParams: string[];
  optionalParams: string[];
  inputSchema: InputSchema;
  examples: Array<{
    input: Record<string, any>;
    description: string;
  }>;
}

/**
 * Get full schema information for a specific command
 * This is extracted from HANDLER_REGISTRY at runtime
 */
export function getCommandSchema(service: string, command: string): CommandSchemaInfo | undefined {
  // Will be implemented by catalog-generator
  return undefined;
}

/**
 * Format schema information for AI prompt
 * Converts schema object into readable markdown format
 */
export function formatSchemaForPrompt(schemaInfo: CommandSchemaInfo): string {
  let prompt = `## ${schemaInfo.service}/${schemaInfo.command}\n\n`;

  prompt += `### Description\n${schemaInfo.description}\n\n`;

  if (schemaInfo.requiredParams.length > 0) {
    prompt += `### Required Parameters\n`;
    schemaInfo.requiredParams.forEach(param => {
      const propInfo = schemaInfo.inputSchema.properties[param];
      if (propInfo) {
        prompt += `- **${param}** (${propInfo.type})`;
        if (propInfo.description) {
          prompt += `: ${propInfo.description}`;
        }
        prompt += `\n`;
      }
    });
    prompt += `\n`;
  }

  if (schemaInfo.optionalParams && schemaInfo.optionalParams.length > 0) {
    prompt += `### Optional Parameters\n`;
    schemaInfo.optionalParams.forEach(param => {
      const propInfo = schemaInfo.inputSchema.properties[param];
      if (propInfo) {
        prompt += `- **${param}** (${propInfo.type})`;
        if (propInfo.description) {
          prompt += `: ${propInfo.description}`;
        }
        prompt += `\n`;
      }
    });
    prompt += `\n`;
  }

  prompt += `### JSON Schema\n\`\`\`json\n${JSON.stringify(schemaInfo.inputSchema, null, 2)}\n\`\`\`\n\n`;

  if (schemaInfo.examples && schemaInfo.examples.length > 0) {
    prompt += `### Examples\n\n`;
    schemaInfo.examples.forEach((example, index) => {
      prompt += `Example ${index + 1}: ${example.description}\n`;
      prompt += `\`\`\`json\n${JSON.stringify(example.input, null, 2)}\n\`\`\`\n\n`;
    });
  }

  return prompt;
}
