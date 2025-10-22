# Orchestrator Agent Architecture (Phase 1)

## System Overview

Phase 1 performs high-level service selection using a lightweight catalog (~500 tokens). It decomposes user requests into service-level tasks without knowing command details.

### 3-Phase Architecture

```
User Request
    ↓
Phase 1: Orchestrator Agent (This Module)
    ├─ Service Catalog (~500 tokens)
    ├─ Task Decomposition
    └─ Dependency Planning
    ↓
Output: ai:serviceAgent childTasks
    ↓
Job System → Phase 2 & 3
```

## Components

### 1. Handler (`handler.ts`)

**Purpose**: Phase 1 entry point and service selection orchestration

**Input**:
```typescript
interface OrchestratorInput {
  prompt: string;           // User's natural language request
  maxChildTasks?: number;   // Optional limit (default: 100)
  maxDepth?: number;        // Optional depth limit (default: 10)
}
```

**Output**:
```typescript
interface OrchestratorOutput {
  childTasks: Array<{
    service: "ai";
    command: "serviceAgent";
    input: {
      id: string;
      service: string;      // firestore, authentication, etc.
      prompt: string;       // Refined prompt for this service
      dependencies: string[];
    }
  }>;
}
```

**Flow**:
1. Pre-validation (depth check)
2. Build prompt with service catalog
3. Call AI for service selection
4. Validate response (services, dependencies)
5. Convert to serviceAgent child tasks
6. Return for job system execution

### 2. Validator (`validator.ts`)

**Purpose**: Lightweight service-level validation

**Validation Layers**:

**Layer 1: Structural**
- Empty task array check
- Task count limit (1-1000, default 100)

**Layer 2: Service**
- Service name validation against catalog
- Only validates: ai, authentication, firestore, storage

**Layer 3: Dependency**
- Reference validation (all deps exist)
- Circular dependency detection (DFS cycle detection)
- ID normalization (`task-0` → `orchestrate-task-0`)

**Time Complexity**: O(n + e) where n = tasks, e = edges
- No schema compilation overhead
- ~1-5ms validation (vs ~10-50ms with full schemas)

**Error Examples**:
```
Task limit exceeded: 150 > 100
Task 0: Unknown service 'filesystem'. Available: ai, authentication, firestore, storage
Task 1 depends on non-existent task task-999
Cycle detected: orchestrate-task-0 → orchestrate-task-1 → orchestrate-task-0
```

### 3. Prompt Builder (`promptBuilder.ts`)

**Purpose**: Constructs lightweight service-focused prompts

**System Instruction Structure**:
```markdown
You are a service selection AI. Analyze user requests and determine which services are needed.

Available Services:
- ai: AI inference and orchestration capabilities
- authentication: Firebase Auth user management operations
- firestore: Firestore database read/write/export operations
- storage: Cloud Storage file management operations

Output Format:
{
  "tasks": [
    {
      "service": "service-name",
      "prompt": "refined request for this service",
      "dependencies": ["task-0"]  // optional
    }
  ],
  "reasoning": "planning rationale"
}

Dependency Guidelines:
- Independent tasks run in parallel
- Dependent tasks wait for prerequisites
- No circular dependencies allowed
```

**Token Budget**: ~700 tokens
- Service catalog: ~500 tokens
- Instructions: ~200 tokens

### 4. Service Catalog (`catalog.ts`)

**Purpose**: Lightweight service registry

**Structure**:
```typescript
interface ServiceCatalogEntry {
  service: string;
  description: string;
}

const SERVICE_CATALOG: ServiceCatalogEntry[] = [
  { service: "ai", description: "AI inference and orchestration" },
  { service: "authentication", description: "Firebase Auth operations" },
  { service: "firestore", description: "Firestore database operations" },
  { service: "storage", description: "Cloud Storage operations" }
];
```

**API**:
- `getServiceCatalog()`: Returns full catalog array
- `isValidService(service)`: Validates service name
- `getServiceNames()`: Returns ["ai", "authentication", "firestore", "storage"]

**What's NOT Included**:
- ❌ Command names
- ❌ Parameter schemas
- ❌ Usage examples
- ❌ Validation rules

## Data Flow

```
1. User Request
   "Copy users to backup and export to CSV"

2. Pre-Validation
   - Check depth < maxDepth
   - Fail fast if limit exceeded

3. Prompt Building
   - Load service catalog (~500 tokens)
   - Build system instruction (~200 tokens)
   - Pass user prompt unchanged

4. AI Processing
   - Service selection
   - Task decomposition
   - Dependency planning

5. AI Response
   {
     tasks: [
       { service: "firestore", prompt: "Copy users to backup", dependencies: [] },
       { service: "firestore", prompt: "Export backup to CSV", dependencies: ["task-0"] }
     ]
   }

6. Validation
   - Check services exist ✅
   - Check dependencies valid ✅
   - Check no cycles ✅
   - (No command/schema validation)

7. Output Conversion
   childTasks: [
     { service: "ai", command: "serviceAgent", input: {...} },
     { service: "ai", command: "serviceAgent", input: {...} }
   ]

8. Job System
   - Spawns serviceAgent tasks (Phase 2)
   - Phase 2 selects commands
   - Phase 3 constructs parameters
```

## Safety & Limits

### 1. Task Count Limit
- **Default**: 100 tasks
- **Range**: 1-1000
- **Purpose**: Prevent runaway AI task generation
- **Validation**: Pre-response check

### 2. Depth Limit
- **Default**: 10 levels
- **Range**: 0-100
- **Purpose**: Prevent infinite recursion
- **Validation**: Pre-AI call (fail fast, save tokens)

### 3. Service Validation
- **Valid Services**: ["ai", "authentication", "firestore", "storage"]
- **Purpose**: Ensure only registered services
- **Validation**: Post-response check

### 4. Dependency Graph
- **Checks**: Valid references, no cycles, no self-deps
- **Algorithm**: DFS cycle detection O(n + e)
- **Purpose**: Ensure executable task graph

## Performance Characteristics

**Token Usage**:
```
Service catalog:      ~500 tokens
System instruction:   ~200 tokens
User prompt:         ~100-200 tokens
Total:               ~800-900 tokens

Legacy (single-phase): ~9K tokens
Savings:              ~90% reduction
```

**Validation Speed**:
```
Structural:  O(1)
Service:     O(n)
Dependency:  O(n + e)
Total:       O(n + e)

Time:        ~1-5ms (vs ~10-50ms with schemas)
Speedup:     5-10x faster
```

## Design Patterns

### 1. Progressive Refinement
- **Phase 1**: High-level service selection (lightweight)
- **Phase 2**: Command selection within service (medium)
- **Phase 3**: Parameter construction (heavyweight)

**Benefit**: Each phase adds detail, optimizing token usage per stage

### 2. Token Optimization
- Phase 1 sees 4 services (~500 tokens)
- Avoids loading 30+ commands (~8K tokens)
- 94% token reduction enables scalability

### 3. Separation of Concerns
- **Phase 1**: Strategic planning (which services?)
- **Phase 2**: Tactical planning (which commands?)
- **Phase 3**: Execution planning (which parameters?)

**Benefit**: Clear boundaries, independent evolution

## Integration Points

### Job Orchestration System

**Child Task Spawning**:
```typescript
// Phase 1 returns serviceAgent tasks
{
  childTasks: [
    {
      service: "ai",
      command: "serviceAgent",
      input: {
        service: "firestore",
        prompt: "Copy users to backup",
        dependencies: []
      }
    }
  ]
}

// Job system executes Phase 2/3 for each child
```

### Depth Tracking

```typescript
// Phase 1 checks depth before AI call
if ((task.depth ?? 0) >= maxDepth) {
  throw new Error("Depth limit exceeded");
}

// Children inherit depth + 1
childTask.depth = (parentTask.depth ?? 0) + 1;
```

## Security Considerations

**Input Validation**:
- Service names validated against catalog
- Dependency structure validated (no cycles)
- Task count limits enforced

**Reduced Attack Surface**:
- Phase 1 doesn't see command schemas
- Parameter validation deferred to Phase 3
- Simpler validation = fewer vulnerabilities

## Extensibility

### Adding New Services

1. Add entry to `SERVICE_CATALOG`:
```typescript
{
  service: "messaging",
  description: "Cloud Messaging push notification operations"
}
```

2. Auto-available in Phase 1 (no other changes needed)

### Phase System Benefits
- Add Phase 2/3 handlers independently
- Modify validation without affecting planning
- Easy A/B testing of phase strategies
- Progressive complexity management

## Key Differences from Legacy

| Aspect | Legacy Orchestrator | Phase 1 Orchestrator |
|--------|-------------------|---------------------|
| Approach | Single-phase | Multi-phase (1 of 3) |
| Catalog | Full commands (~8K tokens) | Services only (~500 tokens) |
| Validation | Commands + parameters | Services only |
| Retry Loop | Yes (with validation feedback) | No (simple validation) |
| Token Usage | ~9K per request | ~900 per request |
| Complexity | High (all-in-one) | Low (focused) |
| Speed | ~10-50ms validation | ~1-5ms validation |

## Summary

**Phase 1 is Intentionally Minimal**:
- Focuses on strategic service selection
- Uses lightweight catalog (~500 tokens)
- Defers details to Phase 2/3
- Fast validation (~1-5ms)
- 90% token savings vs legacy
- Enables progressive refinement architecture
