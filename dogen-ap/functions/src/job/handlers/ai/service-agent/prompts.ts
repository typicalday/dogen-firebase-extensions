/**
 * Prompt Builder for Phase 2: Service Agent
 *
 * Constructs AI prompts with:
 * - Command catalog for ONE specific service (~1,500 tokens)
 * - Output format requirements
 * - Sub-task context from Phase 1
 */

import { getServiceCommands } from './catalogs/command-catalogs';
import { initializeCatalogs } from '../helpers/catalogGenerator';
import { ServiceAgentInput } from './types';

/**
 * Build system instruction for Phase 2 service agent
 * This provides the AI with command-level context for a SPECIFIC service
 */
export function buildServiceAgentSystemInstruction(service: string): string {
  initializeCatalogs();
  let instruction = `You are a command selector for the ${service} service. Select the correct command and refine the prompt for parameter construction.

## Objectives

1. Match task to appropriate command
2. Identify required and optional parameters
3. Create parameter-focused prompt for next phase
4. Maintain task metadata (id, dependencies)

## ${service} Commands

`;

  // Add command catalog for this service
  const commands = getServiceCommands(service);

  if (commands.length === 0) {
    throw new Error(`No commands found for service: ${service}`);
  }

  commands.forEach(cmd => {
    instruction += `### ${cmd.command}\n\n`;
    instruction += `**Description**: ${cmd.description}\n\n`;

    if (cmd.requiredParams.length > 0) {
      instruction += `**Required Parameters**: ${cmd.requiredParams.join(', ')}\n\n`;
    }

    if (cmd.optionalParams.length > 0) {
      instruction += `**Optional Parameters**: ${cmd.optionalParams.join(', ')}\n\n`;
    }

    instruction += `---\n\n`;
  });

  instruction += `## Output Format

Respond with JSON only. No markdown.

\`\`\`json
{
  "id": "task-id-from-input",
  "service": "${service}",
  "command": "command-name",
  "prompt": "parameter-focused prompt for command agent",
  "dependsOn": ["array-from-input"]
}
\`\`\`

## Selection Criteria

**Operation Type**: create, read, update, delete, import, export, copy
**Scope**: single item vs. multiple items vs. collection
**Data Flow**: static values vs. dependent task outputs

**Prompt Requirements**:
- List required parameters by name
- Specify data sources (user input, task output, defaults)
- Include format hints (paths, IDs, field names)
- CRITICAL: When dependency outputs are available, EXTRACT and INCLUDE actual values in your refined prompt
- Do NOT just reference task IDs - provide the concrete data values
- Example with dependency: Instead of "displayName from task 'find-user'", write "displayName='John Doe'"
- Example without dependency: "Use UID from task 'create-admin'" (reference is OK when values aren't available yet)

## Rules

- Command must be from the list above
- Preserve id and dependsOn from input
- Refined prompt guides parameter construction with ACTUAL VALUES when available
- Extract all relevant data from dependency outputs and embed in prompt
- Be specific about parameter values and sources

## Examples

**Document Creation**:
\`\`\`json
Input:
{"id": "task-0", "service": "firestore", "prompt": "Create document in 'restaurant' collection with name='Pizza Joes'", "dependsOn": []}

Output:
{"id": "task-0", "service": "firestore", "command": "create-document", "prompt": "Create document at 'restaurant/{docId}' with documentData.name='Pizza Joes'", "dependsOn": []}
\`\`\`

**CSV Export**:
\`\`\`json
Input:
{"id": "export-backup", "service": "firestore", "prompt": "Export 'users_backup' collection to CSV with email and name fields", "dependsOn": ["backup-users"]}

Output:
{"id": "export-backup", "service": "firestore", "command": "export-collection-csv", "prompt": "Export collection 'users_backup' to CSV with fields=['email', 'name']", "dependsOn": ["backup-users"]}
\`\`\`

**User Creation**:
\`\`\`json
Input:
{"id": "create-admin", "service": "authentication", "prompt": "Create user with email 'admin@example.com' and password 'SecurePass123'", "dependsOn": []}

Output:
{"id": "create-admin", "service": "authentication", "command": "create-user", "prompt": "Create userRecord with email='admin@example.com', password='SecurePass123'", "dependsOn": []}
\`\`\`

**Using Dependency Outputs**:
\`\`\`json
Input:
{"id": "create-user-for-person", "service": "authentication", "prompt": "Create user with name from task 'find-person'", "dependsOn": ["find-person"]}

Dependency Outputs:
{"find-person-run": {"response": "John Doe"}}

Output:
{"id": "create-user-for-person", "service": "authentication", "command": "create-user", "prompt": "Create userRecord with displayName='John Doe', email='john.doe@example.com', password='TempPass123'", "dependsOn": ["find-person"]}
\`\`\`
`;

  return instruction;
}

/**
 * Build user prompt for Phase 2 service agent
 */
export function buildServiceAgentUserPrompt(
  input: ServiceAgentInput,
  dependencyOutputs: Record<string, any>,
  retryContext?: {
    attempt: number;
    originalInput?: ServiceAgentInput;
    previousResponse?: any;
    validationErrors?: string[];
  }
): string {
  if (retryContext && retryContext.attempt > 1) {
    let prompt = `RETRY ${retryContext.attempt} - Previous command selection failed validation.\n\n`;

    prompt += `Input:\n${JSON.stringify(retryContext.originalInput || input, null, 2)}\n\n`;

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
      prompt += `Previous (Invalid) Response:\n${JSON.stringify(retryContext.previousResponse, null, 2)}\n\n`;
    }

    if (retryContext.validationErrors && retryContext.validationErrors.length > 0) {
      prompt += `Errors:\n`;
      retryContext.validationErrors.forEach((error, index) => {
        prompt += `${index + 1}. ${error}\n`;
      });
      prompt += `\n`;
    }

    prompt += `Generate corrected response addressing all errors.`;
    return prompt;
  }

  // First attempt: include dependency outputs if available
  let prompt = JSON.stringify(input, null, 2);

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
 * Build complete prompts for Phase 2
 */
export function buildServiceAgentPrompts(
  input: ServiceAgentInput,
  dependencyOutputs: Record<string, any>,
  retryContext?: {
    attempt: number;
    originalInput?: ServiceAgentInput;
    previousResponse?: any;
    validationErrors?: string[];
  }
): {
  systemInstruction: string;
  userPrompt: string;
} {
  return {
    systemInstruction: buildServiceAgentSystemInstruction(input.service),
    userPrompt: buildServiceAgentUserPrompt(input, dependencyOutputs, retryContext)
  };
}
