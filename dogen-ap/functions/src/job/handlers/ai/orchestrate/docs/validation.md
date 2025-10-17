# Validation System

## Overview

The AI Task Orchestration system employs a **defense-in-depth validation strategy** with multiple independent layers. Each layer validates different aspects of the AI-generated plan, ensuring correctness, safety, and executability.

## Validation Pipeline

```
AI Response
    ↓
Layer 1: Structural Validation (Basic format)
    ↓
Layer 2: Catalog Validation (Service/command exists)
    ↓
Layer 3: Schema Validation (Input correctness)
    ↓
Layer 4: Dependency Validation (References & cycles)
    ↓
Validated Plan
```

## Layer 1: Structural Validation

**Purpose**: Ensure basic plan structure is valid

**Location**: `validator.ts:19-44`

### Checks Performed

#### 1. Empty Task Array
```typescript
if (!plan.tasks || plan.tasks.length === 0) {
  return {
    isValid: false,
    errors: ["Task array is empty. Please provide at least one task."]
  };
}
```

**Rationale**: AI must generate at least one task to be useful

**Error Example**:
```json
{
  "tasks": [],
  "reasoning": "No tasks needed"
}
```

#### 2. Task Limit Enforcement
```typescript
if (plan.tasks.length > maxChildTasks) {
  return {
    isValid: false,
    errors: [
      `Task limit exceeded: AI attempted to create ${plan.tasks.length} tasks, ` +
      `but maxChildTasks limit is ${maxChildTasks}. ` +
      `Consider breaking down the request into smaller operations.`
    ]
  };
}
```

**Rationale**: Prevent resource exhaustion from runaway AI

**Default Limit**: 100 tasks (configurable 1-1000)

**Error Example**:
```json
{
  "tasks": [ /* 150 tasks */ ],
  "reasoning": "Creating 150 processing tasks"
}
```

### Layer 1 Output

- **Valid**: Proceed to Layer 2
- **Invalid**: Return errors immediately, trigger retry

---

## Layer 2: Catalog Validation

**Purpose**: Verify all tasks use valid service/command combinations

**Location**: `validator.ts:46-86`

### Checks Performed

#### 1. Service Existence
```typescript
const isValid = isValidServiceCommand(service, command);
if (!isValid) {
  errors.push(
    `Task ${taskId} (${service}/${command}): ` +
    `Unknown service/command combination`
  );
}
```

**Available Services**:
- `ai` - AI inference and orchestration
- `authentication` - Firebase Auth user management
- `firestore` - Firestore database operations
- `storage` - Cloud Storage operations

**Validation Logic**:
```typescript
export function isValidServiceCommand(
  service: string,
  command: string
): boolean {
  return HANDLER_REGISTRY[service]?.[command] !== undefined;
}
```

#### 2. Command Existence
If service exists but command doesn't:
```
"Task 0 (firestore/unknown): Unknown command 'unknown' for service 'firestore'.
 Available commands: copy-collection, copy-document, create-document, ..."
```

### Error Messages

#### Unknown Service
```
"Task 0 (unknown/command): Unknown service 'unknown'.
 Available services: ai, authentication, firestore, storage"
```

#### Unknown Command
```
"Task 1 (firestore/invalid): Unknown command 'invalid' for service 'firestore'.
 Available commands for firestore: copy-collection, copy-document, create-document,
 delete-path, delete-documents, export-collection-csv, export-collection-json,
 import-collection-csv, import-collection-json, list-collections"
```

### Layer 2 Output

- **Valid**: All service/command combinations exist → Proceed to Layer 3
- **Invalid**: Collect all errors → Return for retry with feedback

---

## Layer 3: Schema Validation

**Purpose**: Validate task inputs against JSON schemas

**Location**: `validator.ts:88-106` + `validator.ts:158-237`

### Schema Validation Process

#### 1. Retrieve Handler Schema
```typescript
const handlerDef = getHandlerDefinition(service, command);
if (!handlerDef?.inputSchema) {
  // No schema defined, skip validation
  continue;
}
```

#### 2. Compile and Validate with Ajv
```typescript
import Ajv from 'ajv';
const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(handlerDef.inputSchema);
const isValid = validate(task.input || {});
```

#### 3. Collect Validation Errors
```typescript
if (!isValid && validate.errors) {
  validate.errors.forEach(error => {
    errors.push(`Task ${taskId} (${service}/${command}): ${formatError(error)}`);
  });
}
```

### Schema Types

#### String Pattern Validation
```typescript
// Email validation
{
  type: 'string',
  pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
  description: 'Valid email address'
}

// Firestore path validation
{
  type: 'string',
  pattern: '^firestore/[^/]+/data/.+',
  description: 'Format: firestore/{database}/data/{collection}'
}

// Cloud Storage path validation
{
  type: 'string',
  pattern: '^gs://[^/]+/.+',
  description: 'Format: gs://{bucket}/{path}'
}

// Phone number validation (E.164)
{
  type: 'string',
  pattern: '^\\+[1-9]\\d{1,14}$',
  description: 'Phone in E.164 format (e.g., +15555551234)'
}
```

#### Number Range Validation
```typescript
// Temperature constraint
{
  type: 'number',
  minimum: 0.0,
  maximum: 1.0,
  description: 'AI temperature (0.0-1.0)'
}

// Timeout constraint
{
  type: 'number',
  minimum: 1000,
  maximum: 300000,
  description: 'Timeout in milliseconds (1s-5min)'
}
```

#### Object Validation with Required Fields
```typescript
// Nested object with required fields
{
  type: 'object',
  properties: {
    userRecord: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'
        },
        password: {
          type: 'string'
        }
      },
      required: ['email', 'password']  // Enforced by Ajv
    }
  },
  required: ['userRecord'],
  additionalProperties: false
}
```

### Common Validation Errors

#### Missing Required Parameter
```
"Task 0 (firestore/copy-collection): must have required property 'destinationPath'"
```

**Cause**: AI forgot to include a required field

**Fix**: Retry with error feedback, AI learns to include the field

#### Invalid Pattern
```
"Task 1 (authentication/create-user): /userRecord/email must match pattern
 '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'"
```

**Cause**: AI provided invalid email format (e.g., "not-an-email")

**Fix**: Retry with pattern explanation in feedback

#### Type Mismatch
```
"Task 2 (firestore/create-document): /documentData must be object"
```

**Cause**: AI provided string instead of object for document data

**Fix**: Retry with type requirement in feedback

#### Out of Range
```
"Task 3 (ai/orchestrate): /temperature must be <= 1"
```

**Cause**: AI used temperature value > 1.0 (e.g., 2.5)

**Fix**: Retry with range constraint in feedback

#### Additional Properties Not Allowed
```
"Task 4 (firestore/copy-collection): must NOT have additional properties"
```

**Cause**: AI included `unexpectedParam` not in schema

**Fix**: Retry with allowed parameters list

### Error Formatting

```typescript
function formatAjvError(error: ErrorObject): string {
  const path = error.instancePath || '/';
  const message = error.message || 'validation error';

  switch (error.keyword) {
    case 'required':
      return `must have required property '${error.params.missingProperty}'`;
    case 'pattern':
      return `${path} must match pattern "${error.params.pattern}"`;
    case 'type':
      return `${path} must be ${error.params.type}`;
    case 'minimum':
      return `${path} must be >= ${error.params.limit}`;
    case 'maximum':
      return `${path} must be <= ${error.params.limit}`;
    case 'additionalProperties':
      return `must NOT have additional properties`;
    default:
      return `${path} ${message}`;
  }
}
```

### Layer 3 Output

- **Valid**: All schemas pass → Proceed to Layer 4
- **Invalid**: Collect all schema errors → Return for retry with detailed feedback

---

## Layer 4: Dependency Validation

**Purpose**: Ensure task dependencies are valid and acyclic

**Location**: `validator.ts:108-155`

### Checks Performed

#### 1. ID Normalization
```typescript
// Normalize task IDs (add prefix if needed)
const taskId = normalizeId(task.id || `task-${index}`);
taskIds.add(taskId);
```

**ID Format**: `orchestrate-{originalId}` or auto-generated `orchestrate-task-{index}`

**Examples**:
- Input: `"task-0"` → Output: `"orchestrate-task-0"`
- Input: `"backup"` → Output: `"orchestrate-backup"`
- Input: `undefined` → Output: `"orchestrate-task-0"` (auto-generated)

#### 2. Dependency Reference Validation
```typescript
for (const depId of task.dependsOn || []) {
  const normalizedDepId = normalizeId(depId);

  if (!taskIds.has(normalizedDepId)) {
    errors.push(
      `Task ${taskId} depends on non-existent task ${depId}. ` +
      `Available tasks: ${Array.from(taskIds).join(', ')}`
    );
  }
}
```

**Invalid Dependency Example**:
```json
{
  "tasks": [
    {
      "id": "task-0",
      "service": "firestore",
      "command": "copy-collection",
      "input": { /* ... */ },
      "dependsOn": ["task-999"]  // ❌ Does not exist
    }
  ]
}
```

**Error Message**:
```
"Task orchestrate-task-0 depends on non-existent task task-999.
 Available tasks: orchestrate-task-0"
```

#### 3. Circular Dependency Detection
```typescript
function detectCycles(adjacencyList: Map<string, string[]>): string[] {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const cycles: string[] = [];

  function dfs(node: string, path: string[]): boolean {
    if (recursionStack.has(node)) {
      // Cycle detected
      const cycleStart = path.indexOf(node);
      const cycle = path.slice(cycleStart).concat(node);
      cycles.push(`Cycle: ${cycle.join(' → ')}`);
      return true;
    }

    if (visited.has(node)) {
      return false;
    }

    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const neighbors = adjacencyList.get(node) || [];
    for (const neighbor of neighbors) {
      if (dfs(neighbor, path)) {
        // Continue to find all cycles
      }
    }

    path.pop();
    recursionStack.delete(node);
    return false;
  }

  // Check all nodes for cycles
  for (const node of adjacencyList.keys()) {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  }

  return cycles;
}
```

**Circular Dependency Examples**:

##### Simple Cycle (Self-Dependency)
```json
{
  "tasks": [
    {
      "id": "task-0",
      "dependsOn": ["task-0"]  // ❌ Depends on itself
    }
  ]
}
```

**Error**: `"Cycle: orchestrate-task-0 → orchestrate-task-0"`

##### Two-Task Cycle
```json
{
  "tasks": [
    { "id": "task-0", "dependsOn": ["task-1"] },
    { "id": "task-1", "dependsOn": ["task-0"] }  // ❌ Mutual dependency
  ]
}
```

**Error**: `"Cycle: orchestrate-task-0 → orchestrate-task-1 → orchestrate-task-0"`

##### Three-Task Cycle
```json
{
  "tasks": [
    { "id": "task-0", "dependsOn": ["task-1"] },
    { "id": "task-1", "dependsOn": ["task-2"] },
    { "id": "task-2", "dependsOn": ["task-0"] }  // ❌ Circular chain
  ]
}
```

**Error**: `"Cycle: orchestrate-task-0 → orchestrate-task-1 → orchestrate-task-2 → orchestrate-task-0"`

### Valid Dependency Patterns

#### Sequential Chain
```json
{
  "tasks": [
    { "id": "fetch", "dependsOn": [] },
    { "id": "process", "dependsOn": ["fetch"] },
    { "id": "store", "dependsOn": ["process"] }
  ]
}
```
✅ Valid: `fetch → process → store`

#### Parallel Execution
```json
{
  "tasks": [
    { "id": "fetch", "dependsOn": [] },
    { "id": "process-1", "dependsOn": ["fetch"] },
    { "id": "process-2", "dependsOn": ["fetch"] }
  ]
}
```
✅ Valid: `fetch → [process-1, process-2]`

#### Fan-In Pattern
```json
{
  "tasks": [
    { "id": "source-1", "dependsOn": [] },
    { "id": "source-2", "dependsOn": [] },
    { "id": "aggregate", "dependsOn": ["source-1", "source-2"] }
  ]
}
```
✅ Valid: `[source-1, source-2] → aggregate`

#### Complex DAG
```json
{
  "tasks": [
    { "id": "fetch", "dependsOn": [] },
    { "id": "transform-1", "dependsOn": ["fetch"] },
    { "id": "transform-2", "dependsOn": ["fetch"] },
    { "id": "merge", "dependsOn": ["transform-1", "transform-2"] },
    { "id": "save", "dependsOn": ["merge"] }
  ]
}
```
✅ Valid: Diamond pattern with fan-out and fan-in

### Layer 4 Output

- **Valid**: No circular dependencies, all references exist → Return validated plan
- **Invalid**: Collect dependency errors → Return for retry with feedback

---

## Validation Result Format

### Success Response
```typescript
{
  isValid: true,
  errors: []
}
```

### Failure Response
```typescript
{
  isValid: false,
  errors: [
    "Task limit exceeded: AI attempted to create 150 tasks, but maxChildTasks limit is 100",
    "Task 0 (unknown/command): Unknown service 'unknown'",
    "Task 1 (firestore/copy-collection): must have required property 'destinationPath'",
    "Task 2 (authentication/create-user): /userRecord/email must match pattern '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'",
    "Task 3 depends on non-existent task task-999",
    "Cycle detected: task-4 → task-5 → task-4"
  ]
}
```

---

## Retry Mechanism with Validation Feedback

### Retry Flow

```
Attempt 1:
  AI generates plan
    ↓
  Validation fails with errors
    ↓
  Errors added to prompt

Attempt 2:
  AI sees previous errors
  AI generates improved plan
    ↓
  Validation fails with fewer errors
    ↓
  Errors added to prompt

Attempt 3:
  AI sees all previous errors
  AI generates corrected plan
    ↓
  Validation succeeds ✅
```

### Error Feedback Format

**Location**: `promptBuilder.ts:185-218`

```typescript
function formatValidationErrors(errors: string[]): string {
  const MAX_ERRORS_IN_FEEDBACK = 10;

  let feedback = "\n\n⚠️ VALIDATION ERRORS FROM PREVIOUS ATTEMPT:\n\n";
  feedback += "The previous plan had the following issues:\n\n";

  const displayErrors = errors.slice(0, MAX_ERRORS_IN_FEEDBACK);
  displayErrors.forEach((error, index) => {
    feedback += `${index + 1}. ${error}\n`;
  });

  if (errors.length > MAX_ERRORS_IN_FEEDBACK) {
    const remaining = errors.length - MAX_ERRORS_IN_FEEDBACK;
    feedback += `\n... and ${remaining} more error${remaining === 1 ? '' : 's'}\n`;
  }

  feedback += "\nPlease fix these issues and regenerate the plan.\n";

  return feedback;
}
```

### Example Feedback

```
⚠️ VALIDATION ERRORS FROM PREVIOUS ATTEMPT:

The previous plan had the following issues:

1. Task 0 (firestore/copy-collection): must have required property 'destinationPath'
2. Task 1 (authentication/create-user): /userRecord/email must match pattern '^[^\s@]+@[^\s@]+\.[^\s@]+$'
3. Task 2 (ai/orchestrate): /temperature must be <= 1

Please fix these issues and regenerate the plan.
```

### Incremental Improvement

**Attempt 1 - Invalid Plan**:
```json
{
  "tasks": [
    {
      "service": "firestore",
      "command": "copy-collection",
      "input": {
        "sourcePath": "firestore/(default)/data/users"
        // ❌ Missing destinationPath
      }
    }
  ]
}
```

**Attempt 2 - Improved Plan** (after seeing error feedback):
```json
{
  "tasks": [
    {
      "service": "firestore",
      "command": "copy-collection",
      "input": {
        "sourcePath": "firestore/(default)/data/users",
        "destinationPath": "firestore/(default)/data/users_backup"  // ✅ Fixed
      }
    }
  ]
}
```

---

## Validation Performance

### Complexity Analysis

- **Layer 1**: O(1) - Simple array length check
- **Layer 2**: O(n) - Catalog lookup for each task
- **Layer 3**: O(n × m) - Schema validation for n tasks with m fields
- **Layer 4**: O(n + e) - DFS for cycle detection with n tasks and e dependencies

**Overall**: O(n × m + e) where n = tasks, m = avg fields per task, e = dependencies

### Optimization Strategies

1. **Schema Compilation**: Ajv compiles schemas once, validates fast
2. **Early Exit**: Stop validation on first failure in each layer
3. **Parallel Validation**: Could validate tasks in parallel (currently sequential)
4. **Cache Catalog**: Catalog generated once, reused for all validations

### Performance Benchmarks

- **Small Plan** (1-5 tasks): ~10-20ms validation time
- **Medium Plan** (10-20 tasks): ~30-50ms validation time
- **Large Plan** (50-100 tasks): ~100-200ms validation time

**Note**: AI call time (1-5 seconds) dominates total orchestration time

---

## Error Recovery Strategies

### For Users

1. **Review Error Messages**: Validation errors are actionable
2. **Simplify Prompt**: Break complex requests into smaller operations
3. **Adjust Limits**: Increase `maxChildTasks` or `maxDepth` if needed
4. **Check Syntax**: Ensure proper path formats and data types

### For AI

1. **Read Error Feedback**: Previous errors included in retry prompt
2. **Fix Incrementally**: Address one error at a time
3. **Validate Format**: Ensure service/command combinations exist
4. **Check Dependencies**: Verify all referenced task IDs exist

### For Developers

1. **Add Schema Validation**: Define `inputSchema` for new handlers
2. **Update Catalog**: Ensure handler registry is complete
3. **Test Edge Cases**: Write tests for validation scenarios
4. **Monitor Retry Rates**: High retry rates indicate prompt or catalog issues

---

## Testing Validation Logic

### Test Coverage

**Layer 1 Tests**:
- Empty task array rejection
- Task limit enforcement
- Edge cases (1 task, max tasks)

**Layer 2 Tests**:
- Unknown service rejection
- Unknown command rejection
- Valid service/command acceptance

**Layer 3 Tests**:
- Missing required parameters
- Invalid patterns (email, path, phone)
- Type mismatches (string vs object)
- Out of range numbers
- Additional properties rejection
- Nested object validation

**Layer 4 Tests**:
- Non-existent dependency rejection
- Circular dependency detection (simple, two-task, three-task, complex)
- Valid dependency patterns (sequential, parallel, fan-in, DAG)
- ID normalization

### Test Files

- `orchestrate.spec.ts:18-63` - Catalog validation tests
- `orchestrate.spec.ts:65-91` - Schema validation tests
- `orchestrate.spec.ts:93-143` - Dependency validation tests
- `orchestrate.spec.ts:145-219` - Complex scenario tests
- `processTask-validation.spec.ts` - Input validation tests for all handlers

---

## Best Practices

### For Schema Design

1. **Be Specific**: Use patterns for structured data (paths, emails, phones)
2. **Set Limits**: Define min/max for numbers to prevent abuse
3. **Document Thoroughly**: Description field helps AI understand constraints
4. **Use Examples**: Handler registry examples guide AI behavior
5. **Require What's Needed**: Mark essential fields as required

### For Validation Logic

1. **Fail Fast**: Check cheap validations first (structure before schema)
2. **Provide Context**: Error messages should explain what's wrong and how to fix
3. **Batch Errors**: Collect all errors before returning (don't stop at first)
4. **Normalize IDs**: Handle different ID formats gracefully
5. **Test Thoroughly**: Cover all validation paths and edge cases
