/**
 * Prompt Builder - Constructs system and user prompts for AI orchestration
 *
 * This module builds comprehensive prompts that:
 * - Explain the AI's role as a task orchestrator
 * - Provide complete documentation of available tasks
 * - Define output format requirements
 * - Include retry feedback for validation failures
 */

import { TaskCapability, RetryContext } from './types';
import { getTaskCatalog } from './catalog';

/**
 * Maximum number of validation errors to include in retry feedback.
 *
 * Limits the error feedback to prevent token explosion when many validation
 * errors occur (e.g., complex plans with 50+ tasks and 30+ errors).
 * Shows the first N errors (most important/earliest) plus a summary message.
 *
 * Rationale for choosing 5:
 * - Provides sufficient context for AI to understand the problem pattern
 * - Prevents prompt bloat (5 errors × ~100 chars = ~500 bytes vs. potential 3KB+)
 * - Early errors often cascade, so first errors are most diagnostic
 * - Leaves room for system prompt (~10KB) + user context within token limits
 */
const MAX_ERRORS_IN_FEEDBACK = 5;

/**
 * Builds the system instruction for AI task orchestration
 *
 * This prompt explains:
 * - The AI's role as a task orchestrator
 * - All available task capabilities with examples
 * - Output format requirements
 * - Dependency rules and best practices
 */
export function buildSystemPrompt(): string {
  const catalog = getTaskCatalog();

  // Group tasks by service for better organization
  const serviceGroups = catalog.reduce((groups, task) => {
    if (!groups[task.service]) {
      groups[task.service] = [];
    }
    groups[task.service].push(task);
    return groups;
  }, {} as Record<string, TaskCapability[]>);

  let prompt = `# Task Orchestration AI

You are an AI task orchestrator for a Firebase Cloud Functions job system. Your role is to analyze user requests and generate validated task plans.

## Your Capabilities

You can orchestrate tasks across the following services:
`;

  // Document each service and its commands
  for (const [service, tasks] of Object.entries(serviceGroups)) {
    prompt += `\n### ${service.toUpperCase()} Service\n\n`;

    for (const task of tasks) {
      prompt += `**${task.command}**\n`;
      prompt += `${task.description}\n\n`;

      // Required parameters
      if (task.requiredParams.length > 0) {
        prompt += `Required: ${task.requiredParams.join(', ')}\n`;
      }

      // Optional parameters
      if (task.optionalParams.length > 0) {
        prompt += `Optional: ${task.optionalParams.join(', ')}\n`;
      }

      // Examples
      if (task.examples.length > 0) {
        prompt += `\nExamples:\n`;
        for (const example of task.examples) {
          prompt += `- ${example.description}\n`;
          prompt += `  \`\`\`json\n  ${JSON.stringify(example.input, null, 2)}\n  \`\`\`\n`;
        }
      }

      prompt += '\n';
    }
  }

  // Output format instructions
  prompt += `## Output Format

You must respond with a JSON object containing:

\`\`\`json
{
  "tasks": [
    {
      "id": "optional-task-id",
      "service": "service-name",
      "command": "command-name",
      "input": { /* command-specific parameters */ },
      "dependsOn": ["other-task-id"]  // optional
    }
  ],
  "reasoning": "Brief explanation of your plan"  // optional
}
\`\`\`

## Important Rules

### Task IDs
- IDs are optional - they will be auto-generated if not provided
- If you provide IDs, use simple names like "backup", "audit", "cleanup"
- DO NOT include the orchestrator prefix - it will be added automatically
- Example: Use "backup" not "0-backup"

### Dependencies
- Use the \`dependsOn\` array to specify task dependencies
- A task will wait for all its dependencies to complete before executing
- Reference tasks by their ID (without orchestrator prefix)
- Tasks without dependencies run immediately in parallel
- Dependencies can reference:
  - Sibling tasks being created in the same plan
  - The orchestrator task itself (rare)

### Dependency Examples
\`\`\`json
{
  "tasks": [
    {
      "id": "copy",
      "service": "firestore",
      "command": "copy-collection",
      "input": {...}
    },
    {
      "id": "audit",
      "service": "firestore",
      "command": "create-document",
      "input": {...},
      "dependsOn": ["copy"]  // Wait for copy to complete
    }
  ]
}
\`\`\`

### Best Practices
1. **Minimize tasks**: Combine operations when possible
2. **Use dependencies**: Ensure correct execution order
3. **Validate inputs**: Provide all required parameters
4. **Clear reasoning**: Explain your task plan briefly
5. **Error handling**: Consider what happens if a task fails
6. **Path formats**: Use format "(database)/collection/document" for Firestore paths

## Response Guidelines

- Analyze the user's request carefully
- Break down into the minimum necessary tasks
- Set up dependencies to ensure correct execution order
- Provide all required parameters for each task
- Use appropriate services and commands from the catalog
- Include brief reasoning to explain your approach
`;

  return prompt;
}

/**
 * Builds the user prompt based on request and context
 *
 * @param userPrompt - Natural language request from user
 * @param context - Additional context (optional)
 * @param retryContext - Retry information if this is a retry attempt (optional)
 */
export function buildUserPrompt(
  userPrompt: string,
  context?: Record<string, any>,
  retryContext?: RetryContext
): string {
  let prompt = `# User Request\n\n${userPrompt}\n`;

  // Add context if provided
  if (context && Object.keys(context).length > 0) {
    prompt += `\n## Additional Context\n\n`;
    prompt += `\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`\n`;
  }

  // Add retry feedback if this is a retry
  if (retryContext && retryContext.attempt > 1) {
    prompt += `\n## Retry Attempt ${retryContext.attempt}\n\n`;
    prompt += `Your previous response had validation errors. Please fix these issues:\n\n`;

    if (retryContext.previousErrors && retryContext.previousErrors.length > 0) {
      // Limit the number of errors shown to prevent token explosion
      const errorsToShow = retryContext.previousErrors.slice(0, MAX_ERRORS_IN_FEEDBACK);
      const hiddenCount = retryContext.previousErrors.length - errorsToShow.length;

      for (const error of errorsToShow) {
        prompt += `- ${error}\n`;
      }

      // Add summary message if errors were truncated
      if (hiddenCount > 0) {
        prompt += `\n... and ${hiddenCount} more error${hiddenCount > 1 ? 's' : ''} (showing first ${MAX_ERRORS_IN_FEEDBACK} most critical)\n`;
      }
    }

    if (retryContext.previousResponse) {
      prompt += `\n### Your Previous Response:\n`;
      prompt += `\`\`\`json\n${JSON.stringify(retryContext.previousResponse, null, 2)}\n\`\`\`\n`;
    }

    prompt += `\nPlease generate a corrected task plan that addresses these validation errors.\n`;
  }

  return prompt;
}

/**
 * Builds a complete prompt message for testing or logging
 */
export function buildCompletePrompt(
  userPrompt: string,
  context?: Record<string, any>,
  retryContext?: RetryContext
): { system: string; user: string } {
  return {
    system: buildSystemPrompt(),
    user: buildUserPrompt(userPrompt, context, retryContext)
  };
}
