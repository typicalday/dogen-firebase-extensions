# Command Agent (Phase 3 of 3-Phase Orchestration)

## Overview

The Command Agent is the final phase of AI-driven task orchestration, responsible for **parameter construction and validation** for individual commands. It receives a command routing from the Service Agent and constructs complete, schema-valid input parameters.

## Phase 3 Responsibilities

### What Command Agent Does
1. **Parameter Construction**: Builds complete input objects with all required fields
2. **Format Enforcement**: Applies proper formatting (paths, emails, phone numbers, etc.)
3. **Schema Validation**: Validates parameters against command-specific JSON schema using Ajv
4. **Type Conversion**: Converts values to correct types (strings, numbers, booleans, arrays, objects)
5. **Dependency Resolution**: Handles `{{taskId.output.field}}` syntax for inter-task dependencies
6. **Constraint Adherence**: Follows all schema constraints (min/max, enum, pattern, etc.)
7. **Error Prevention**: Catches parameter errors before spawning actual command

### What Command Agent Receives
```typescript
{
  id: "task-0",
  service: "firestore",
  command: "createDocument",
  prompt: "Create a user document for John Doe with email john@example.com",
  dependsOn: []
}
```

### What Command Agent Sees (AI Context)
- Full JSON schema for the SPECIFIC command (~2K tokens)
- Command-specific examples and validation rules
- Required vs optional parameters
- Format requirements and constraints

### What Command Agent Returns
```typescript
{
  id: "task-0",
  service: "firestore",
  command: "createDocument",
  input: {
    path: "firestore/(default)/data/users",
    documentId: "user-john-doe",
    data: {
      name: "John Doe",
      email: "john@example.com",
      createdAt: "2024-01-01T00:00:00Z"
    }
  },
  dependsOn: []
}
```

## Plan Mode Behavior

The Command Agent respects `context.planMode`:

- **Plan Mode (true)**:
  - Validates parameters against schema
  - Returns CommandAgentOutput
  - Does NOT spawn child tasks
  - Logs what WOULD be executed

- **Execution Mode (false)**:
  - Validates parameters against schema
  - Returns CommandAgentOutput
  - Spawns actual command as child task
  - Command executes immediately (if no dependencies)

## Quick Start

### Input Structure
```typescript
interface CommandAgentInput {
  id: string;           // Task ID
  service: string;      // Service name (firestore, authentication, storage)
  command: string;      // Command name (createDocument, createUser, uploadFile)
  prompt: string;       // User prompt with parameter details
  dependsOn: string[];  // Task IDs this command depends on
}
```

### Output Structure
```typescript
interface CommandAgentOutput {
  id: string;                    // Task ID (passthrough)
  service: string;               // Service name (passthrough)
  command: string;               // Command name (passthrough)
  input: Record<string, any>;    // Fully constructed, schema-valid parameters
  dependsOn: string[];           // Dependencies (passthrough)
  reasoning?: string;            // Optional reasoning for parameter construction
}
```

## Key Features

### 1. Ajv Schema Validation
```typescript
// Validate parameters against command schema
const validate = ajv.compile(commandSchema);
const valid = validate(commandAgentOutput.input);

if (!valid) {
  const errors = validate.errors
    ?.map(err => `${err.instancePath} ${err.message}`)
    .join('; ');
  throw new Error(`Parameter validation failed: ${errors}`);
}
```

### 2. Dependency Resolution
Command Agent handles output references from dependent tasks:

```typescript
// Task with dependency
{
  id: "task-1",
  service: "authentication",
  command: "updateUser",
  prompt: "Update the user created in task-0 to set admin role",
  dependsOn: ["task-0"]
}

// AI constructs parameters with reference
{
  input: {
    uid: "{{task-0.output.uid}}",  // References output from task-0
    claims: {
      admin: true
    }
  }
}
```

### 3. Dynamic Schema Loading
The Command Agent retrieves the full schema for the specific command at runtime:

```typescript
const schemaInfo = getCommandSchemaFromRegistry(service, command);
// Returns full InputSchema with properties, types, constraints, examples
```

## Architecture Integration

### Phase Flow
```
Phase 1: Orchestrator Agent
  ↓ (task graph + command routings)
Phase 2: Service Agent
  ↓ (refined command routing)
Phase 3: Command Agent ← YOU ARE HERE
  ↓ (schema-valid child task)
Command Execution
```

### Handler Registration
Command Agent works with commands registered in `HANDLER_REGISTRY`:

```typescript
export const HANDLER_REGISTRY: Record<string, HandlerInfo> = {
  'firestore:createDocument': {
    description: 'Create a Firestore document',
    inputSchema: { /* JSON Schema */ },
    outputSchema: { /* JSON Schema */ },
    handler: async (task, context) => { /* implementation */ }
  }
  // ... more handlers
};
```

## Error Handling

Command Agent catches parameter errors before spawning commands:

```typescript
try {
  // Construct parameters with AI
  // Validate against schema with Ajv
  // Return child task
} catch (error) {
  console.error(`[CommandAgent] Failed for task ${input.id}:`, error);
  throw new Error(`Command agent failed: ${error.message}`);
}
```

Common validation errors:
- Missing required parameters
- Invalid parameter types
- Format validation failures (email, phone, path patterns)
- Enum constraint violations
- Min/max constraint violations

## Configuration

### Default Settings
```typescript
const DEFAULT_TEMPERATURE = 0.2;  // Low temperature for precise parameter construction
const DEFAULT_TIMEOUT = 60000;     // 60 second timeout for AI calls
```

### AI Model
- Model: `gemini-2.5-pro`
- Response Format: Structured JSON with command-specific schema
- System Instruction: ~2K tokens with full schema details

## Next Steps

- See [architecture.md](./architecture.md) for detailed handler flow and validation
- See [examples.md](./examples.md) for real-world parameter construction examples
- See handler registry in `src/job/registry.ts` for available commands
