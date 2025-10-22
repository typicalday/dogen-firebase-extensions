/**
 * Prompt Builder for Phase 3: Command Agent
 *
 * Constructs AI prompts with:
 * - Full schema for ONE specific command (~2,000 tokens)
 * - Command-specific examples and validation rules
 * - Output format requirements
 * - Dependency resolution guidelines
 */

import { getCommandSchemaFromRegistry, initializeCatalogs } from '../helpers/catalogGenerator';
import { formatSchemaForPrompt } from './catalogs/schema-catalog';
import { CommandAgentInput } from './types';

/**
 * Build system instruction for Phase 3 command agent
 * This provides the AI with FULL schema details for a SPECIFIC command
 */
export function buildCommandAgentSystemInstruction(service: string, command: string): string {
  // Initialize catalogs (lazy initialization to avoid circular dependencies)
  initializeCatalogs();

  // Get full schema info from registry
  const schemaInfo = getCommandSchemaFromRegistry(service, command);

  if (!schemaInfo) {
    throw new Error(`No schema found for command ${service}/${command}`);
  }

  let instruction = `You are a parameter constructor for ${service}/${command}. Extract all data from the request and build schema-valid input parameters.

## Schema

`;

  instruction += formatSchemaForPrompt(schemaInfo);

  instruction += `## Construction Rules

**Required**:
- All required parameters must be present
- Extract ALL mentioned data (fields, values, properties)
- Match exact type requirements (string, number, boolean, object, array)
- Follow format patterns precisely

**Type Formatting**:
- string: "value"
- number: 123
- boolean: true/false
- array: []
- object: {}

**Format Patterns**:
- Paths: firestore/{database}/data/{collection}/{docId}
- Dates: ISO 8601 (YYYY-MM-DDTHH:MM:SSZ)
- Emails: user@domain.com
- Phone: E.164 format (+12345678900)

**Dependency Resolution**:
- CRITICAL: When dependency outputs are provided in "Dependency Outputs" section, use ACTUAL VALUES directly
- Do NOT use template syntax like "{{task-id.output.field}}" when actual values are available
- Extract values from the dependency outputs and use them directly in parameters
- Only use template syntax if dependency outputs are NOT provided (rare case)
- Example with outputs available: Use "displayName": "John Doe" (NOT "{{find-user.output.name}}")
- Example without outputs: Use "uid": "{{create-admin.output.uid}}" (template OK when waiting for execution)

## Output

JSON only. No wrapper. No markdown.

\`\`\`json
{
  "parameter": "value",
  "nested": {
    "field": "value"
  }
}
\`\`\`
`;

  return instruction;
}

/**
 * Build user prompt for Phase 3 command agent
 */
export function buildCommandAgentUserPrompt(
  input: CommandAgentInput,
  dependencyOutputs: Record<string, any>,
  retryContext?: {
    attempt: number;
    originalInput?: CommandAgentInput;
    previousResponse?: any;
    validationErrors?: string[];
  }
): string {
  if (retryContext && retryContext.attempt > 1) {
    let prompt = `RETRY ${retryContext.attempt} - Previous parameters failed schema validation.\n\n`;

    prompt += `Task:\n${retryContext.originalInput?.prompt || input.prompt}\n\n`;

    // Filter out null, undefined, or empty object values
    const validOutputs = Object.fromEntries(
      Object.entries(dependencyOutputs).filter(([_, value]) => {
        return value != null && (typeof value !== 'object' || Object.keys(value).length > 0);
      })
    );

    // Include dependency outputs if available
    if (Object.keys(validOutputs).length > 0) {
      prompt += `Dependency Outputs:\n${JSON.stringify(validOutputs, null, 2)}\n\n`;
    }

    if (retryContext.previousResponse) {
      prompt += `Previous (Invalid) Parameters:\n${JSON.stringify(retryContext.previousResponse, null, 2)}\n\n`;
    }

    if (retryContext.validationErrors && retryContext.validationErrors.length > 0) {
      prompt += `Schema Violations:\n`;
      retryContext.validationErrors.forEach((error, index) => {
        prompt += `${index + 1}. ${error}\n`;
      });
      prompt += `\n`;
    }

    prompt += `Generate corrected parameters matching schema requirements.`;
    return prompt;
  }

  // First attempt: include dependency outputs if available
  let prompt = input.prompt;

  // Filter out null, undefined, or empty object values
  const validOutputs = Object.fromEntries(
    Object.entries(dependencyOutputs).filter(([_, value]) => {
      return value != null && (typeof value !== 'object' || Object.keys(value).length > 0);
    })
  );

  if (Object.keys(validOutputs).length > 0) {
    prompt += `\n\nDependency Outputs:\n${JSON.stringify(validOutputs, null, 2)}`;
  }

  return prompt;
}

/**
 * Build complete prompts for Phase 3
 */
export function buildCommandAgentPrompts(
  input: CommandAgentInput,
  dependencyOutputs: Record<string, any>,
  retryContext?: {
    attempt: number;
    originalInput?: CommandAgentInput;
    previousResponse?: any;
    validationErrors?: string[];
  }
): {
  systemInstruction: string;
  userPrompt: string;
  commandSchema: any;
} {
  const schemaInfo = getCommandSchemaFromRegistry(input.service, input.command);

  return {
    systemInstruction: buildCommandAgentSystemInstruction(input.service, input.command),
    userPrompt: buildCommandAgentUserPrompt(input, dependencyOutputs, retryContext),
    commandSchema: schemaInfo?.inputSchema
  };
}
