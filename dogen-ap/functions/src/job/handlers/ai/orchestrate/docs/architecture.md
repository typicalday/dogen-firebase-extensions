# AI Orchestration Architecture

## System Overview

The AI Task Orchestration system follows a **pipeline architecture** with multiple stages of validation, processing, and execution. Each component has a single responsibility and interfaces are well-defined.

```
User Request
    ↓
Handler (Entry Point)
    ↓
Depth Validation (Pre-check)
    ↓
Prompt Builder (AI Preparation)
    ↓
AI Model Call (Vertex AI)
    ↓
Validator (Multi-layer)
    ↓
Child Task Conversion
    ↓
Job System (Execution)
```

## Component Architecture

### 1. Handler (`handler.ts`)

**Purpose**: Main entry point and orchestration coordinator

**Responsibilities**:
- Receive orchestration requests
- Perform pre-validation (depth check)
- Coordinate AI calls with timeout protection
- Manage retry logic with error feedback
- Convert validated plans to child tasks
- Return results to job system

**Key Functions**:
- `handleOrchestrate(task: JobTask)` - Main entry point (handler.ts:29)
- Timeout management with Promise.race pattern (handler.ts:45-66)
- Retry loop with validation feedback (handler.ts:68-151)
- Child task conversion (handler.ts:153-176)

**Error Handling**:
- Depth limit exceeded → Immediate rejection (handler.ts:31-43)
- AI timeout → Retry with same prompt
- Validation failure → Retry with error feedback
- Max retries exceeded → Return error with details

**Performance Considerations**:
- Early depth validation prevents expensive AI calls
- Timeout protection prevents hung requests
- Incremental retry with feedback improves success rate

### 2. Validator (`validator.ts`)

**Purpose**: Multi-layer validation of AI-generated plans

**Validation Layers**:

#### Layer 1: Structural Validation
```typescript
// Empty task array check
if (!plan.tasks || plan.tasks.length === 0) {
  return { isValid: false, errors: ["Task array is empty"] };
}

// Task limit enforcement
if (plan.tasks.length > maxChildTasks) {
  return { isValid: false, errors: [taskLimitError] };
}
```

#### Layer 2: Catalog Validation
```typescript
// Verify service/command exists
if (!isValidServiceCommand(service, command)) {
  errors.push(`Unknown service/command: ${service}/${command}`);
}
```

#### Layer 3: Schema Validation
```typescript
// Validate task input against JSON schema
const inputErrors = validateTaskInput(service, command, input);
if (inputErrors.length > 0) {
  errors.push(...inputErrors);
}
```

#### Layer 4: Dependency Validation
```typescript
// Check dependency references
for (const depId of task.dependsOn) {
  if (!taskIds.has(normalizeId(depId))) {
    errors.push(`Task ${taskId} depends on non-existent task ${depId}`);
  }
}

// Detect circular dependencies
const cycles = detectCycles(adjacencyList);
if (cycles.length > 0) {
  errors.push(`Circular dependencies detected`);
}
```

**Key Functions**:
- `validatePlan()` - Main validation orchestrator (validator.ts:17)
- `validateTaskInput()` - JSON Schema validation (validator.ts:158)
- `detectCycles()` - Circular dependency detection (validator.ts:250)
- `normalizeId()` - ID prefix normalization (validator.ts:321)

**Validation Flow**:
```
validatePlan()
  ├─> Check empty array
  ├─> Enforce task limit
  ├─> For each task:
  │     ├─> Normalize IDs
  │     ├─> Validate catalog
  │     ├─> Validate schema
  │     └─> Validate dependencies
  └─> Detect cycles
```

### 3. Prompt Builder (`promptBuilder.ts`)

**Purpose**: Construct AI prompts with catalog information and context

**Prompt Structure**:
```
System Instruction
    ├─> Task catalog (20 handlers)
    ├─> Output format requirements
    ├─> Dependency guidelines
    └─> Constraints

User Prompt
    ├─> User's natural language request
    ├─> Additional context (if provided)
    └─> Validation errors (on retry)
```

**Key Functions**:
- `buildPrompt()` - Main prompt construction (promptBuilder.ts:13)
- `buildSystemInstruction()` - System prompt with catalog (promptBuilder.ts:33)
- `buildUserPrompt()` - User request with context (promptBuilder.ts:157)
- `formatValidationErrors()` - Error feedback formatting (promptBuilder.ts:185)

**Catalog Integration**:
```typescript
// Auto-generated from handler registry
const catalog = getTaskCatalog();
catalog.forEach(capability => {
  prompt += `- ${capability.service}/${capability.command}\n`;
  prompt += `  Description: ${capability.description}\n`;
  prompt += `  Required: ${capability.requiredParams.join(', ')}\n`;
});
```

**Error Feedback Loop**:
```
First Attempt:
  prompt = systemInstruction + userPrompt

Retry Attempt:
  prompt = systemInstruction + userPrompt + validationErrors

  "The previous plan had these errors:
   - Task 0: Invalid path format for sourcePath
   - Task 1: Missing required parameter 'email'
   Please fix these issues and regenerate the plan."
```

### 4. Task Catalog (`catalog.ts`)

**Purpose**: Auto-generated registry of available task capabilities

**Data Source**: Derives from centralized handler registry

**Generation Process**:
```typescript
// Automatic catalog generation (catalog.ts:15-33)
const TASK_CATALOG: TaskCapability[] = (() => {
  const catalog: TaskCapability[] = [];

  for (const [service, commands] of Object.entries(HANDLER_REGISTRY)) {
    for (const [command, definition] of Object.entries(commands)) {
      catalog.push({
        service,
        command,
        description: definition.description,
        requiredParams: definition.requiredParams,
        optionalParams: definition.optionalParams || [],
        examples: definition.examples || []
      });
    }
  }

  return catalog;
})();
```

**Key Functions**:
- `getTaskCatalog()` - Returns complete catalog (catalog.ts:38)
- `findTaskCapability()` - Lookup by service/command (catalog.ts:45)
- `isValidServiceCommand()` - Validation check (catalog.ts:68)

**Benefits**:
- Single source of truth (HANDLER_REGISTRY)
- No manual synchronization needed
- Automatic updates when handlers added/removed
- Type-safe with full metadata

### 5. Schema Definitions (`schema.ts`)

**Purpose**: JSON Schema definitions for AI response validation

**Response Schema**:
```typescript
{
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          service: { type: 'string' },
          command: { type: 'string' },
          input: { type: 'object' },
          dependsOn: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        required: ['service', 'command', 'input']
      }
    },
    reasoning: { type: 'string' }
  },
  required: ['tasks']
}
```

**Input Schemas**: See `registry.ts` for comprehensive input schemas for all 20 handlers

### 6. Type Definitions (`types.ts`)

**Purpose**: TypeScript interfaces for type safety

**Key Types**:
```typescript
// AI response structure
export interface AITaskPlan {
  tasks: AITask[];
  reasoning?: string;
}

// Individual task in plan
export interface AITask {
  id?: string;
  service: string;
  command: string;
  input: Record<string, any>;
  dependsOn?: string[];
}

// Task capability metadata
export interface TaskCapability {
  service: string;
  command: string;
  description: string;
  requiredParams: string[];
  optionalParams: string[];
  examples: Array<{
    input: Record<string, any>;
    description: string;
  }>;
}

// Validation result
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}
```

## Data Flow

### Request Flow

```
1. Client Request
   {
     service: "ai",
     command: "orchestrate",
     input: {
       prompt: "Copy users to backup",
       maxRetries: 3,
       temperature: 0.2
     }
   }

2. Handler Entry
   - Extract parameters
   - Validate depth (task.depth < maxDepth)
   - Prepare for AI call

3. Prompt Construction
   - Build system instruction with catalog
   - Build user prompt with context
   - Combine into final prompt

4. AI Model Call (with timeout)
   - Call Vertex AI Gemini model
   - Parse JSON response
   - Handle timeout/errors

5. Validation Pipeline
   - Layer 1: Structural validation
   - Layer 2: Catalog validation
   - Layer 3: Schema validation
   - Layer 4: Dependency validation

6. On Validation Failure
   - If retries remaining:
     - Add error feedback to prompt
     - Retry from step 3
   - Else:
     - Return error with details

7. On Validation Success
   - Convert to child tasks
   - Add ID prefix
   - Normalize dependency IDs
   - Return to job system

8. Job System Execution
   - Spawn child tasks
   - Execute with dependencies
   - Return final results
```

### Retry Flow

```
Attempt 1:
  Prompt: System + User
  Result: Validation Error

Attempt 2:
  Prompt: System + User + "Previous errors: ..."
  Result: Validation Error

Attempt 3:
  Prompt: System + User + "Previous errors: ..."
  Result: Success

Return: Validated plan with metadata
```

## Integration Points

### Job Orchestration System

**Child Task Spawning** (processJob.ts:149-231):
```typescript
// Orchestrate handler returns childTasks
const output = await processTask(task);

// Job system spawns children
if (output.childTasks && Array.isArray(output.childTasks)) {
  for (let i = 0; i < output.childTasks.length; i++) {
    const childSpec = output.childTasks[i];
    const childId = `${task.id}-${i}`;

    // Safety checks: maxTasks, maxDepth, dependencies
    // Add to graph and registry
    // Execute when dependencies met
  }
}
```

**Depth Tracking**:
```typescript
// Root tasks have depth 0
const task = new JobTask({ depth: 0 });

// Children inherit parent depth + 1
const childTask = new JobTask({
  depth: (parentTask.depth ?? 0) + 1
});

// Orchestrate checks depth before AI call
if ((task.depth ?? 0) >= maxDepth) {
  throw new Error("Depth limit exceeded");
}
```

### Handler Registry

**Registration** (registry.ts:833-923):
```typescript
ai: {
  orchestrate: {
    handler: handleOrchestrate,
    description: "AI-powered task orchestration...",
    requiredParams: ["prompt"],
    optionalParams: ["maxRetries", "temperature", ...],
    inputSchema: { /* JSON Schema */ },
    examples: [ /* Usage examples */ ]
  }
}
```

**Catalog Generation**: Automatic from registry entries

### Vertex AI Integration

**Model Call**:
```typescript
const model = vertexAI.getGenerativeModel({
  model: "gemini-2.0-flash-thinking-exp-01-21",
  generationConfig: {
    temperature: 0.2,
    responseMimeType: "application/json",
    responseSchema: AI_TASK_PLAN_SCHEMA
  }
});

const result = await model.generateContent({
  contents: [{ role: "user", parts: [{ text: prompt }] }],
  systemInstruction: { parts: [{ text: systemInstruction }] }
});
```

## Design Patterns

### 1. Pipeline Pattern
- Sequential processing stages
- Each stage validates and transforms
- Clear interfaces between stages

### 2. Retry with Feedback
- Incremental improvement through error feedback
- AI learns from validation failures
- Graceful degradation on max retries

### 3. Fail Fast
- Early depth validation before expensive AI calls
- Immediate rejection of invalid states
- Resource-efficient error handling

### 4. Auto-Generation
- Task catalog generated from registry
- No manual synchronization
- Single source of truth

### 5. Defense in Depth
- Multiple validation layers
- Independent checks at each layer
- Comprehensive error detection

## Performance Characteristics

### Time Complexity
- Validation: O(n + e) where n = tasks, e = dependencies
- Cycle detection: O(n + e) using DFS
- Catalog lookup: O(1) with Map/Object access

### Space Complexity
- Task storage: O(n) for n tasks
- Dependency graph: O(n + e)
- Catalog cache: O(c) for c capabilities (constant, ~20)

### Optimization Strategies
1. **Early Validation**: Depth check before AI call
2. **Timeout Protection**: Prevents hung requests
3. **Incremental Retry**: Improves success rate without full restart
4. **Catalog Caching**: One-time generation, reused across calls
5. **Schema Compilation**: Ajv compiles schemas for fast validation

## Security Considerations

### Input Validation
- All task inputs validated against JSON schemas
- Path patterns prevent directory traversal
- Email/phone patterns prevent injection
- Parameter limits prevent resource exhaustion

### Resource Limits
- Task count limit (default: 100)
- Depth limit (default: 10)
- Timeout limit (default: 60s)
- Retry limit (default: 3)

### AI Safety
- Structured output with schema validation
- No arbitrary code execution
- Validated service/command combinations only
- Dependencies validated for correctness

## Extensibility

### Adding New Handlers
1. Create handler file: `handlers/{service}/{command}.ts`
2. Add to registry: `HANDLER_REGISTRY[service][command]`
3. Catalog auto-updates from registry
4. Validator uses registry schemas automatically

### Modifying Validation
- Add new validation layer in `validator.ts`
- Update `ValidationResult` if needed
- Ensure error messages are actionable for AI

### Customizing Prompts
- Modify `buildSystemInstruction()` for catalog format
- Update `buildUserPrompt()` for context handling
- Adjust `formatValidationErrors()` for error feedback

## Testing Strategy

### Unit Tests
- Validator logic (catalog, schema, dependencies, cycles)
- Prompt builder formatting
- ID normalization and prefixing

### Integration Tests (67 tests)
- End-to-end orchestration flows
- Multi-step workflows with dependencies
- Error handling and retry logic
- Safety limit enforcement
- Schema validation for all handlers

### Test Coverage
- Validation: ~95% coverage
- Handler: ~90% coverage
- Catalog: ~100% coverage (auto-generated)
- Prompt builder: ~85% coverage
