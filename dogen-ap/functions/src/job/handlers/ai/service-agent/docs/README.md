# Service Agent (Phase 2)

**AI Service Command Selector** - Matches commands within a specific service for task execution.

## Overview

The Service Agent is Phase 2 of the 3-phase orchestration system. It receives a service-specific sub-task from the orchestrator and selects the most appropriate command to execute within that service.

### Position in Pipeline

```
Phase 1: Orchestrator Agent (orchestrate)
  ↓ Creates: ai:serviceAgent tasks
Phase 2: Service Agent (serviceAgent) ← YOU ARE HERE
  ↓ Creates: ai:commandAgent tasks
Phase 3: Command Agent (commandAgent)
  ↓ Creates: Actual service tasks (firestore:create-document, etc.)
```

## Responsibilities

**What Phase 2 Does**:
- ✅ **Command Matching**: Select appropriate command within the specified service
- ✅ **Parameter Identification**: Determine which parameters the command needs
- ✅ **Prompt Refinement**: Create command-specific prompt with parameter hints
- ✅ **Validation**: Ensure selected command exists and can accomplish the goal
- ✅ **Dependency Passthrough**: Preserve dependency information for graph execution

**What Phase 2 Does NOT Do**:
- ❌ **Parameter Construction**: Command agent handles this (Phase 3)
- ❌ **Schema Validation**: Command agent handles this (Phase 3)
- ❌ **Service Selection**: Orchestrator handled this (Phase 1)
- ❌ **Task Decomposition**: Orchestrator handled this (Phase 1)

## Quick Start

### Input (from Phase 1)

```typescript
interface ServiceAgentInput {
  id: string;           // Task ID from orchestrator
  service: string;      // Service name (firestore, authentication, etc.)
  prompt: string;       // Refined prompt from orchestrator
  dependsOn: string[];  // Task dependencies
}
```

### Output (to Phase 3)

```typescript
interface ServiceAgentOutput {
  id: string;           // Preserved from input
  service: string;      // Preserved from input
  command: string;      // Selected command within service
  prompt: string;       // Refined prompt for command agent
  dependsOn: string[];  // Preserved from input
  reasoning?: string;   // Optional explanation
}
```

### Example Flow

**Input**:
```json
{
  "id": "task-0",
  "service": "firestore",
  "prompt": "Create a document in the 'restaurants' collection with field 'name' set to 'Pizza Palace'",
  "dependsOn": []
}
```

**What AI Sees**:
- System instruction with firestore commands ONLY (~1.5K tokens)
- Commands: create-document, create-documents-batch, get-document, update-document, etc.
- Each command with description, required params, optional params

**Output**:
```json
{
  "id": "task-0",
  "service": "firestore",
  "command": "create-document",
  "prompt": "Create a document at path 'restaurants/{docId}' with documentData containing field name='Pizza Palace'",
  "dependsOn": []
}
```

**Child Task Created**:
```json
{
  "id": "task-0",
  "service": "ai",
  "command": "commandAgent",
  "input": {
    "id": "task-0",
    "service": "firestore",
    "command": "create-document",
    "prompt": "Create a document at path 'restaurants/{docId}' with documentData containing field name='Pizza Palace'",
    "dependsOn": []
  }
}
```

## Token Budget

**Phase 2 Context Size**: ~1,500 tokens per service
- System instruction: ~1,200 tokens (command catalog for ONE service)
- User prompt: ~200 tokens (input JSON)
- Response: ~100 tokens (output JSON)

**Key Optimization**: Service agent only sees commands for ONE service, not all 30+ commands across all services.

## Configuration

```typescript
// Default configuration
const DEFAULT_TEMPERATURE = 0.2;  // Low temperature for precise command selection
const DEFAULT_TIMEOUT = 60000;    // 60 second timeout for AI call

// AI Model
model: "gemini-2.5-pro"
responseSchema: PHASE2_RESPONSE_SCHEMA
responseMimeType: "application/json"
```

## Edge Cases

### Multiple Valid Commands
Service agent chooses the most appropriate command based on:
- Single vs. batch operations
- Create vs. update semantics
- Required vs. optional parameters

**Example**: Firestore has both `create-document` and `create-documents-batch`
- Single document → `create-document`
- Multiple documents → `create-documents-batch`

### Ambiguous Operations
Service agent refines prompt to clarify:
```json
{
  "prompt": "Update the user's profile",
  // Refined to:
  "prompt": "Update user document at path 'users/{userId}' with documentData containing profile fields"
}
```

### Invalid Command Selection
If AI selects non-existent command:
- Type guard `isServiceAgentOutput` validates structure
- Command validation happens in Phase 3
- Error propagates to orchestrator

## File Structure

```
service-agent/
├── handler.ts      # Main handler logic
├── types.ts        # TypeScript interfaces
├── prompts.ts      # Prompt construction
├── schema.ts       # JSON schema for AI response
└── docs/
    ├── README.md   # This file
    └── architecture.md
```

## Integration

### Registration

```typescript
// In handler-registry.ts
{
  service: "ai",
  command: "serviceAgent",
  handler: handleServiceAgent
}
```

### Called By
- Orchestrator Agent (Phase 1) creates `ai:serviceAgent` tasks

### Calls
- Command Agent (Phase 3) via `ai:commandAgent` child tasks

## Next Steps

- **Phase 3 Documentation**: See command-agent docs for parameter construction
- **Architecture**: See architecture.md for detailed flow and prompt building
- **Examples**: See orchestrator-agent docs for end-to-end examples
