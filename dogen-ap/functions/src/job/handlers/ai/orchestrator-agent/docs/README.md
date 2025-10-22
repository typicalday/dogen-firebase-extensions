# Orchestrator Agent (Phase 1)

**Service-level task planner** - Decomposes user requests into service-level tasks for progressive refinement.

## Overview

The Orchestrator Agent is Phase 1 of a 3-phase progressive refinement system. It performs high-level service selection and task decomposition using a lightweight service catalog (~500 tokens).

### Position in Pipeline

```
Phase 1: Orchestrator Agent (orchestratorAgent) ← YOU ARE HERE
  ↓ Creates: ai:serviceAgent tasks
Phase 2: Service Agent (serviceAgent)
  ↓ Creates: ai:commandAgent tasks
Phase 3: Command Agent (commandAgent)
  ↓ Creates: Actual service tasks (firestore:createDocument, etc.)
```

## Quick Start

### Input

```typescript
{
  service: "ai",
  command: "orchestratorAgent",
  input: {
    prompt: "Copy users to backup and export to CSV"
  }
}
```

### Output

```typescript
{
  childTasks: [
    {
      service: "ai",
      command: "serviceAgent",
      input: {
        service: "firestore",
        prompt: "Copy users collection to backup",
        dependencies: []
      }
    },
    {
      service: "ai",
      command: "serviceAgent",
      input: {
        service: "firestore",
        prompt: "Export backup collection to CSV",
        dependencies: ["task-0"]
      }
    }
  ]
}
```

## Responsibilities

### What Phase 1 Does
- ✅ **Service Selection**: Determines which services are needed
- ✅ **Task Decomposition**: Breaks complex requests into service-level tasks
- ✅ **Dependency Planning**: Plans task execution order
- ✅ **Lightweight Validation**: Validates service names and dependency structure

### What Phase 1 Does NOT Do
- ❌ **Command Selection**: Service Agent handles this (Phase 2)
- ❌ **Parameter Construction**: Command Agent handles this (Phase 3)
- ❌ **Schema Validation**: Command Agent handles this (Phase 3)
- ❌ **Retry Loop**: Validation is simple, no retry needed

## Token Budget

**Phase 1 Context**: ~800-900 tokens
- Service catalog: ~500 tokens (4 services)
- System instruction: ~200 tokens
- User prompt: ~100-200 tokens

**Comparison to Legacy**: 94% token reduction (was ~9K tokens with full command catalog)

## Available Services

Phase 1 sees only service-level information:

- **ai**: AI inference and orchestration capabilities
- **authentication**: Firebase Auth user management
- **firestore**: Firestore database operations
- **storage**: Cloud Storage file operations

## Configuration

```typescript
// Default limits
const DEFAULT_MAX_CHILD_TASKS = 100;  // Max tasks per orchestration
const DEFAULT_MAX_DEPTH = 10;         // Max recursion depth

// AI Model
model: "gemini-2.5-pro"
temperature: 0.2  // Low temperature for precise planning
```

## Examples

### Simple Task
```
Input: "Copy users to backup"
Output: 1 firestore serviceAgent task
```

### Multi-Service
```
Input: "Create admin user and export users to CSV"
Output: 1 authentication + 1 firestore serviceAgent tasks
```

### Sequential
```
Input: "Copy users to backup, then export backup to JSON"
Output: 2 firestore serviceAgent tasks (task-1 depends on task-0)
```

### Parallel
```
Input: "Export users and products to JSON"
Output: 2 firestore serviceAgent tasks (no dependencies, parallel execution)
```

## Validation

Phase 1 performs lightweight validation:
- ✅ Task count limits (max 100 tasks)
- ✅ Service name validation (must be: ai, authentication, firestore, storage)
- ✅ Dependency graph structure (no cycles, valid references)
- ❌ NO command validation (Phase 2)
- ❌ NO parameter validation (Phase 3)

## Safety Limits

- **maxChildTasks**: 1-1000 (default: 100) - Prevents runaway task generation
- **maxDepth**: 0-100 (default: 10) - Prevents infinite recursion
- **Dependency Cycles**: DFS cycle detection prevents circular dependencies

## File Structure

```
orchestrator-agent/
├── handler.ts           # Phase 1 entry point
├── validator.ts         # Lightweight validation
├── promptBuilder.ts     # Service catalog prompts
├── catalog.ts          # Service registry
├── types.ts            # TypeScript interfaces
└── docs/
    ├── README.md       # This file
    ├── architecture.md # Detailed components and flow
    ├── examples.md     # Usage examples
    └── multi-phase-orchestration.md  # Complete 3-phase design
```

## Integration

### Called By
- Direct user requests via job system

### Calls
- Service Agent (Phase 2) via `ai:serviceAgent` child tasks

## Next Steps

- **Architecture**: See [architecture.md](./architecture.md) for detailed component descriptions
- **Examples**: See [examples.md](./examples.md) for complete usage examples
- **Design Doc**: See [multi-phase-orchestration.md](./multi-phase-orchestration.md) for 3-phase system design
- **Phase 2**: See service-agent docs for command selection
- **Phase 3**: See command-agent docs for parameter construction
