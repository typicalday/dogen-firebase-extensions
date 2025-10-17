# AI Task Orchestration Documentation

## Overview

The AI Task Orchestration system enables natural language-driven task planning and execution. It uses AI to analyze prompts, generate validated task plans, and execute them through the job orchestration system with dependency management and safety limits.

## Key Features

- **Human-in-the-Loop by Default**: Dry run mode (default) returns plans for review before execution
- **Natural Language Input**: Describe tasks in plain English
- **Intelligent Planning**: AI generates optimized task plans with dependencies
- **Comprehensive Validation**: Multi-layer validation ensures task correctness
- **Safety Limits**: Built-in constraints prevent runaway AI and resource exhaustion
- **Task Catalog Integration**: AI has access to 20+ handler capabilities across 4 services
- **Depth Protection**: Prevents infinite recursion with configurable depth limits
- **Schema Validation**: JSON Schema validation for all task inputs before execution

## Quick Start

### Basic Usage (Dry Run - Default)

By default, orchestration runs in **dry run mode** for safety. This returns a plan for human review without executing:

```typescript
{
  service: "ai",
  command: "orchestrate",
  input: {
    prompt: "Copy the users collection to users_backup",
    // dryRun defaults to true - returns plannedTasks for review
    temperature: 0.2,
    maxRetries: 3
  }
}
```

**Output**: Contains `plannedTasks` array for human review. No tasks are executed.

### Human-in-the-Loop Workflow

1. **Preview Phase**: Run orchestration with `dryRun: true` (or omit for default)
2. **Review**: Examine the `plannedTasks` in the output to verify the AI's plan
3. **Execute Phase**: If approved, create a new job with `dryRun: false` to execute
4. **Monitor**: Track execution through the job system

```typescript
// Step 1: Preview what AI will do
{
  service: "ai",
  command: "orchestrate",
  input: {
    prompt: "Export products to JSON and create a backup in Firestore",
    dryRun: true  // Explicitly enable preview mode
  }
}

// Step 2: After reviewing plannedTasks, execute if approved
{
  service: "ai",
  command: "orchestrate",
  input: {
    prompt: "Export products to JSON and create a backup in Firestore",
    dryRun: false,  // Execute the plan
    context: {
      reason: "monthly backup",
      requestedBy: "admin",
      approvedAt: "2025-01-17T10:30:00Z"
    }
  }
}
```

### Automatic Execution (Skip Human Review)

For trusted operations, use `dryRun: false` to execute immediately:

```typescript
{
  service: "ai",
  command: "orchestrate",
  input: {
    prompt: "Create daily backup of users collection",
    dryRun: false,  // Execute without preview
    maxChildTasks: 10,
    timeout: 120000
  }
}
```

**Output**: Contains `childTasks` array that will be automatically executed.

## Architecture

The orchestration system consists of several key components:

1. **Handler** (`handler.ts`) - Main entry point, coordinates AI calls and validation
2. **Validator** (`validator.ts`) - Multi-layer validation of AI-generated plans
3. **Prompt Builder** (`promptBuilder.ts`) - Constructs AI prompts with catalog and context
4. **Task Catalog** (`catalog.ts`) - Registry of available task capabilities
5. **Schema Definitions** (`schema.ts`) - JSON schemas for validation
6. **Type Definitions** (`types.ts`) - TypeScript interfaces

See [Architecture Documentation](./architecture.md) for detailed component descriptions.

## Documentation Structure

- **[Architecture](./architecture.md)** - System design and component interactions
- **[Validation](./validation.md)** - Validation layers and error handling
- **[Prompt System](./prompt-system.md)** - How AI prompts are constructed
- **[Task Catalog](./catalog.md)** - Available handlers and capabilities
- **[Examples](./examples.md)** - Real-world usage examples
- **[Safety Limits](./safety-limits.md)** - Constraints and protection mechanisms

## Configuration Options

### Required Parameters

- `prompt` (string) - Natural language description of tasks to orchestrate

### Optional Parameters

- `dryRun` (boolean) - Human-in-the-loop mode control (default: true)
  - **true** (default): Returns `plannedTasks` for human review without executing
  - **false**: Returns `childTasks` for automatic execution
  - Use dry run mode to preview AI-generated plans before execution
- `maxRetries` (number, 0-10) - Maximum retry attempts for validation failures (default: 3)
- `temperature` (number, 0.0-1.0) - AI temperature for response generation (default: 0.2)
- `context` (object) - Additional context information for the AI
- `maxChildTasks` (number, 1-1000) - Maximum child tasks to spawn (default: 100)
- `timeout` (number, 1000-300000ms) - Timeout for AI call (default: 60000)
- `maxDepth` (number, 0-100) - Maximum task depth allowed (default: 10)

## Safety Features

### Built-in Protections

1. **Human-in-the-Loop by Default** - Dry run mode (dryRun: true) prevents automatic execution without human approval
2. **Task Limit Enforcement** - Prevents spawning too many tasks (default: 100)
3. **Depth Validation** - Blocks orchestration when at max depth (default: 10)
4. **Timeout Protection** - AI calls timeout after configured period (default: 60s)
5. **Schema Validation** - All task inputs validated before execution
6. **Dependency Validation** - Circular dependencies and invalid references rejected
7. **Retry Logic** - Automatic retry with feedback for validation failures (max: 3)

See [Safety Limits Documentation](./safety-limits.md) for detailed information.

## Output Format

### Successful Orchestration (Dry Run Mode - Default)

When `dryRun: true` (default), the output contains `plannedTasks` for human review:

```json
{
  "prompt": "Copy the users collection to users_backup",
  "plan": {
    "tasks": [
      {
        "service": "firestore",
        "command": "copy-collection",
        "input": {
          "sourcePath": "firestore/(default)/data/users",
          "destinationPath": "firestore/(default)/data/users_backup"
        }
      }
    ],
    "reasoning": "Creating a backup copy of the users collection"
  },
  "reasoning": "Creating a backup copy of the users collection",
  "dryRun": true,
  "plannedTasks": [
    {
      "service": "firestore",
      "command": "copy-collection",
      "input": {
        "sourcePath": "firestore/(default)/data/users",
        "destinationPath": "firestore/(default)/data/users_backup"
      },
      "dependsOn": []
    }
  ],
  "retriesUsed": 1,
  "validationReport": {
    "isValid": true,
    "errors": [],
    "warnings": [],
    "tasksValidated": 1,
    "timestamp": "2025-01-17T10:30:00Z"
  },
  "usage": {
    "promptTokenCount": 500,
    "candidatesTokenCount": 200,
    "totalTokenCount": 700
  }
}
```

### Successful Orchestration (Execute Mode)

When `dryRun: false`, the output contains `childTasks` for automatic execution:

```json
{
  "prompt": "Copy the users collection to users_backup",
  "plan": {
    "tasks": [
      {
        "service": "firestore",
        "command": "copy-collection",
        "input": {
          "sourcePath": "firestore/(default)/data/users",
          "destinationPath": "firestore/(default)/data/users_backup"
        }
      }
    ],
    "reasoning": "Creating a backup copy of the users collection"
  },
  "reasoning": "Creating a backup copy of the users collection",
  "dryRun": false,
  "childTasks": [
    {
      "service": "firestore",
      "command": "copy-collection",
      "input": {
        "sourcePath": "firestore/(default)/data/users",
        "destinationPath": "firestore/(default)/data/users_backup"
      },
      "dependsOn": []
    }
  ],
  "retriesUsed": 1,
  "validationReport": {
    "isValid": true,
    "errors": [],
    "warnings": [],
    "tasksValidated": 1,
    "timestamp": "2025-01-17T10:30:00Z"
  },
  "usage": {
    "promptTokenCount": 500,
    "candidatesTokenCount": 200,
    "totalTokenCount": 700
  }
}
```

### Error Response

```json
{
  "error": "Task validation failed: Invalid service 'unknown'",
  "validationErrors": [
    "Task 0: Unknown service 'unknown'. Available services: ai, authentication, firestore, storage"
  ],
  "validationAttempts": 3
}
```

## Integration with Job System

The orchestration handler integrates seamlessly with the job orchestration system:

1. **Task Spawning** - Returns `childTasks` array in output
2. **Dependency Management** - Child tasks can depend on each other and parent tasks
3. **Depth Tracking** - Maintains depth counter to prevent infinite recursion
4. **ID Generation** - Automatic hierarchical ID generation (`parent-id-0`, `parent-id-1`, etc.)

See `functions/src/job/processJob.ts` lines 149-231 for child task spawning logic.

## Related Files

### Core Files
- `handler.ts` - Main orchestration handler (src/job/handlers/ai/orchestrate/handler.ts:1)
- `validator.ts` - Validation logic (src/job/handlers/ai/orchestrate/validator.ts:1)
- `catalog.ts` - Task catalog (src/job/handlers/ai/orchestrate/catalog.ts:1)
- `promptBuilder.ts` - Prompt construction (src/job/handlers/ai/orchestrate/promptBuilder.ts:1)

### Registry Integration
- `registry.ts` - Handler registry (src/job/handlers/registry.ts:833-923)

### Job System Integration
- `processJob.ts` - Job execution (src/job/processJob.ts:313-338)
- `taskGraph.ts` - Dependency graph management

### Tests
- `orchestrate.spec.ts` - Integration tests (integration-tests/tests/ai/orchestrate.spec.ts:1)

## Version History

### Current Implementation
- Multi-layer validation (catalog, schema, dependencies, limits)
- Depth-aware orchestration with early validation
- Comprehensive error feedback to AI for retries
- Task catalog auto-generation from handler registry
- JSON Schema validation for all handlers
- Support for all Vertex AI models (not just enumerated list)
