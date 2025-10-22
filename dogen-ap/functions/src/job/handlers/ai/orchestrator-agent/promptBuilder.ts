/**
 * Prompt Builder for Phase 1: Orchestrator
 *
 * Constructs AI prompts with:
 * - Service catalog (high-level only, ~500 tokens)
 * - Output format requirements
 * - Dependency guidelines
 * - User request
 */

import { getAllServiceInfo } from '../service-agent/catalogs/service-catalog';
import { OrchestratorInput } from './types';

/**
 * Build system instruction for Phase 1 orchestrator
 * This provides the AI with service-level context only
 */
export function buildOrchestratorSystemInstruction(maxTasks: number): string {
  let instruction = `You are a task orchestration specialist. Analyze user requests and decompose them into service-level sub-tasks with precise dependencies.

## Core Objectives

1. Parse user intent and identify required operations
2. Map operations to appropriate services
3. Define execution order and dependencies
4. Assign unique, descriptive task IDs
5. Create refined prompts for service agents

## Available Services

`;

  // Add service catalog
  const services = getAllServiceInfo();
  services.forEach(service => {
    instruction += `### ${service.name}\n${service.description}\n\n`;
  });

  instruction += `## Output Format

Respond with JSON only. No markdown, no explanation.

\`\`\`json
{
  "subtasks": [
    {
      "id": "descriptive-task-id",
      "service": "service-name",
      "prompt": "refined prompt for service agent",
      "dependsOn": []
    }
  ],
  "reasoning": "brief explanation"
}
\`\`\`

## Critical Rules

**Dependencies**:
- ✅ Sequential: task-0 → task-1 → task-2
- ✅ Parallel: [task-0, task-1] (empty dependsOn)
- ✅ Fan-in: [task-0, task-1] → task-2
- ❌ Circular: task-0 → task-1 → task-0
- ❌ Self-reference: task-0 → task-0
- ❌ Non-existent: task-0 → task-999

**Task IDs**:
- Use descriptive names: "create-admin", "export-users"
- Or sequential: "task-0", "task-1"
- Must be unique across all tasks

**Data Flow**:
- When task B needs output from task A, add A to dependsOn array
- CRITICAL: If dependency outputs are available (in context or from previous execution), EXTRACT and INCLUDE actual values in prompts
- Use concrete values when available: "Create user with displayName='John Doe'" instead of "Create user with name from task 'find-user'"
- Only use task references when actual values are NOT available yet: "Use UID from task 'create-admin'"
- This prevents expensive re-passing of dependency data through the pipeline

**Constraints**:
- Maximum ${maxTasks} sub-tasks
- One service per sub-task
- Only use services from the list above
- Keep prompts specific and actionable with ACTUAL VALUES when available

## Examples

**Single Task**:
Input: "Create a document in the restaurant collection named 'Pizza Joes'"
\`\`\`json
{
  "subtasks": [{
    "id": "task-0",
    "service": "firestore",
    "prompt": "Create document in 'restaurant' collection with field name='Pizza Joes'",
    "dependsOn": []
  }],
  "reasoning": "Single Firestore document creation"
}
\`\`\`

**Sequential with Dependency**:
Input: "Create user admin@example.com, then create restaurant owned by that user"
\`\`\`json
{
  "subtasks": [
    {
      "id": "create-admin",
      "service": "authentication",
      "prompt": "Create user with email 'admin@example.com'",
      "dependsOn": []
    },
    {
      "id": "create-restaurant",
      "service": "firestore",
      "prompt": "Create restaurant document with ownerId from task 'create-admin'",
      "dependsOn": ["create-admin"]
    }
  ],
  "reasoning": "User creation provides UID for restaurant ownership"
}
\`\`\`

**Parallel Operations**:
Input: "Export users and products collections to JSON"
\`\`\`json
{
  "subtasks": [
    {
      "id": "export-users",
      "service": "firestore",
      "prompt": "Export 'users' collection to JSON in Cloud Storage",
      "dependsOn": []
    },
    {
      "id": "export-products",
      "service": "firestore",
      "prompt": "Export 'products' collection to JSON in Cloud Storage",
      "dependsOn": []
    }
  ],
  "reasoning": "Independent exports, execute in parallel"
}
\`\`\`

**Using Available Context/Outputs**:
Input: "Find the CEO's name, then create a user account for them"
Context: {"ceo": {"name": "Jane Smith", "email": "jane@company.com"}}
\`\`\`json
{
  "subtasks": [
    {
      "id": "create-ceo-user",
      "service": "authentication",
      "prompt": "Create user with email='jane@company.com', displayName='Jane Smith', and a secure password",
      "dependsOn": []
    }
  ],
  "reasoning": "CEO information available in context - extracted and embedded actual values in prompt"
}
\`\`\`

**Dependency Without Available Data**:
Input: "Find the current US president, then create a user for them"
\`\`\`json
{
  "subtasks": [
    {
      "id": "find-president",
      "service": "ai",
      "prompt": "Who is the current US president? Respond with their full name.",
      "dependsOn": []
    },
    {
      "id": "create-president-user",
      "service": "authentication",
      "prompt": "Create user using the president's name from task 'find-president' to construct displayName and email with domain '@example.com'",
      "dependsOn": ["find-president"]
    }
  ],
  "reasoning": "President name not available yet - task reference is acceptable since data will be provided by execution pipeline"
}
\`\`\`
`;

  return instruction;
}

/**
 * Build user prompt for Phase 1 orchestrator
 */
export function buildOrchestratorUserPrompt(
  input: OrchestratorInput,
  retryContext?: {
    attempt: number;
    originalPrompt?: string;
    previousResponse?: any;
    validationErrors?: string[];
  }
): string {
  if (retryContext && retryContext.attempt > 1) {
    let prompt = `RETRY ${retryContext.attempt} - Previous response failed validation.\n\n`;

    prompt += `Original Request:\n${retryContext.originalPrompt || input.prompt}\n\n`;

    if (input.context && Object.keys(input.context).length > 0) {
      prompt += `Context:\n${JSON.stringify(input.context, null, 2)}\n\n`;
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

  // First attempt: simple prompt structure
  let prompt = input.prompt;

  // Add context if provided
  if (input.context && Object.keys(input.context).length > 0) {
    prompt += `\n\n**Additional Context**:\n${JSON.stringify(input.context, null, 2)}`;
  }

  return prompt;
}

/**
 * Build complete prompts for Phase 1
 */
export function buildOrchestratorPrompts(
  input: OrchestratorInput,
  maxTasks: number = 100,
  retryContext?: {
    attempt: number;
    originalPrompt?: string;
    previousResponse?: any;
    validationErrors?: string[];
  }
): {
  systemInstruction: string;
  userPrompt: string;
} {
  return {
    systemInstruction: buildOrchestratorSystemInstruction(maxTasks),
    userPrompt: buildOrchestratorUserPrompt(input, retryContext)
  };
}
