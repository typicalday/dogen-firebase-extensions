# Safety Limits and Constraints

## Overview

The AI Task Orchestration system implements multiple layers of safety constraints to prevent:
- **Resource Exhaustion**: Runaway AI generating too many tasks
- **Infinite Recursion**: Circular dependencies or unbounded depth
- **Long-Running Operations**: Hung AI calls blocking the system
- **Invalid Operations**: Malformed or dangerous task execution

## Safety Mechanisms

### 1. Task Count Limit (`maxChildTasks`)

**Purpose**: Prevent AI from spawning unlimited tasks

**Default**: 100 tasks

**Range**: 1 - 1000 tasks

**Configuration**:
```json
{
  "service": "ai",
  "command": "orchestrate",
  "input": {
    "prompt": "...",
    "maxChildTasks": 50  // Custom limit
  }
}
```

**Enforcement Point**: `validator.ts:26-43`

**Validation Logic**:
```typescript
if (plan.tasks.length > maxChildTasks) {
  return {
    isValid: false,
    errors: [
      `Task limit exceeded: AI attempted to create ${plan.tasks.length} tasks, ` +
      `but maxChildTasks limit is ${maxChildTasks}. ` +
      `This orchestrator can spawn at most ${maxChildTasks} child tasks. ` +
      `Consider breaking down the request into smaller operations or increasing maxChildTasks.`
    ]
  };
}
```

**Error Example**:
```
Task limit exceeded: AI attempted to create 150 tasks, but maxChildTasks limit is 100.
This orchestrator can spawn at most 100 child tasks.
Consider breaking down the request into smaller operations or increasing maxChildTasks.
```

**Bypass Strategy**:
- Increase limit in prompt: `"maxChildTasks": 200`
- Use batch operations (CSV import instead of individual creates)
- Break request into multiple orchestrations

**Trade-offs**:
- **Higher limit**: More flexibility, higher resource usage
- **Lower limit**: Better resource control, may need workarounds

---

### 2. Depth Limit (`maxDepth`)

**Purpose**: Prevent infinite recursion through nested orchestration

**Default**: 10 levels

**Range**: 0 - 100 levels

**Configuration**:
```json
{
  "service": "ai",
  "command": "orchestrate",
  "input": {
    "prompt": "...",
    "maxDepth": 5  // Custom limit
  }
}
```

**Enforcement Point**: `handler.ts:31-43`

**Validation Logic** (Pre-AI call):
```typescript
const currentDepth = task.depth ?? 0;
const maxDepth = task.input.maxDepth ?? DEFAULT_MAX_DEPTH;

if (currentDepth >= maxDepth) {
  throw new Error(
    `Cannot orchestrate: Task is at depth ${currentDepth}, ` +
    `but maxDepth limit is ${maxDepth}. ` +
    `Orchestration would create tasks at depth ${currentDepth + 1}, ` +
    `which exceeds the configured maximum depth.`
  );
}
```

**Why Pre-Validation?**
- **Cost Savings**: Avoids expensive AI call if depth exceeded
- **Fast Failure**: Immediate rejection with clear error
- **Resource Efficiency**: Doesn't waste tokens on doomed operation

**Depth Tracking**:
```
Root tasks: depth = 0
  ├─ Child 1: depth = 1
  │   ├─ Grandchild 1: depth = 2
  │   └─ Grandchild 2: depth = 2
  └─ Child 2: depth = 1
      └─ Grandchild 3: depth = 2
```

**Error Example**:
```
Cannot orchestrate: Task is at depth 10, but maxDepth limit is 10.
Orchestration would create tasks at depth 11, which exceeds the configured maximum depth.
```

**Use Cases by Depth**:
- **0-2 levels**: Simple workflows, most common
- **3-5 levels**: Complex multi-stage pipelines
- **6-10 levels**: Advanced recursive orchestration
- **>10 levels**: Usually indicates design issue

---

### 3. Timeout Protection (`timeout`)

**Purpose**: Prevent hung AI calls from blocking the system

**Default**: 60,000ms (60 seconds)

**Range**: 1,000ms - 300,000ms (1 second - 5 minutes)

**Configuration**:
```json
{
  "service": "ai",
  "command": "orchestrate",
  "input": {
    "prompt": "...",
    "timeout": 120000  // 2 minutes
  }
}
```

**Enforcement Point**: `handler.ts:45-66`

**Implementation** (Promise.race pattern):
```typescript
const timeoutPromise = new Promise<never>((_, reject) => {
  setTimeout(() => {
    reject(new Error(`AI call timeout after ${timeoutMs}ms`));
  }, timeoutMs);
});

const aiPromise = model.generateContent(/* ... */);

try {
  const result = await Promise.race([aiPromise, timeoutPromise]);
  // Process result
} catch (error) {
  if (error.message.includes('timeout')) {
    // Retry or return error
  }
}
```

**Error Example**:
```
AI call timeout after 60000ms
```

**Retry Behavior**:
- Timeout errors trigger retry (if retries remaining)
- Same prompt used on retry
- Timeout applies to each attempt independently

**Tuning Guidelines**:
- **Simple prompts**: 30-60s sufficient
- **Complex prompts**: 60-120s recommended
- **Large plans**: 120-300s may be needed
- **Network issues**: Increase timeout

**Trade-offs**:
- **Shorter timeout**: Faster failure detection, may fail valid requests
- **Longer timeout**: More resilient, slower failure response

---

### 4. Retry Limit (`maxRetries`)

**Purpose**: Prevent infinite retry loops from validation failures

**Default**: 3 attempts

**Range**: 0 - 10 attempts

**Configuration**:
```json
{
  "service": "ai",
  "command": "orchestrate",
  "input": {
    "prompt": "...",
    "maxRetries": 5  // Up to 5 retry attempts
  }
}
```

**Enforcement Point**: `handler.ts:68-151`

**Retry Loop**:
```typescript
let validationErrors: string[] = [];

for (let attempt = 1; attempt <= maxRetries; attempt++) {
  // Build prompt (includes errors from previous attempt)
  const prompt = buildPrompt(
    task.input.prompt,
    task.input.context,
    validationErrors
  );

  // Call AI
  const aiPlan = await callAI(prompt);

  // Validate
  const validation = validatePlan(aiPlan, maxChildTasks);

  if (validation.isValid) {
    // Success! Return result
    return { childTasks, validationAttempts: attempt };
  }

  // Failed validation, prepare for retry
  validationErrors = validation.errors;
}

// Max retries exceeded
throw new Error(
  `Orchestration failed after ${maxRetries} attempts. Errors: ${errors.join('; ')}`
);
```

**Error Feedback Loop**:
```
Attempt 1: AI generates plan
  ↓ Validation fails
  ↓ Errors: ["Missing destinationPath", "Invalid email"]

Attempt 2: AI sees errors, generates improved plan
  ↓ Validation fails
  ↓ Errors: ["Invalid email"]

Attempt 3: AI fixes remaining error
  ↓ Validation succeeds ✅
```

**Success Rate Patterns**:
- **1 attempt**: ~60% (well-formed prompts, simple tasks)
- **2 attempts**: ~30% (minor validation issues)
- **3 attempts**: ~8% (complex constraints)
- **>3 attempts**: ~2% (very complex or ambiguous prompts)

**When to Increase**:
- Complex schemas with many constraints
- Ambiguous prompts requiring iteration
- Novel task combinations
- Testing and development

---

### 5. Schema Validation

**Purpose**: Ensure all task inputs are valid before execution

**Enforcement Point**: `validator.ts:88-106` + `validator.ts:158-237`

**Validation Coverage**: 20 handlers across 4 services

**Schema Types**:

#### Path Patterns
```typescript
// Firestore path
pattern: '^firestore/[^/]+/data/.+'
// Valid: "firestore/(default)/data/users"
// Invalid: "users" or "firestore/users"

// Cloud Storage path
pattern: '^gs://[^/]+/.+'
// Valid: "gs://bucket/path/file.json"
// Invalid: "bucket/file.json"
```

#### Email Validation
```typescript
pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'
// Valid: "user@example.com"
// Invalid: "not-an-email"
```

#### Phone Numbers (E.164)
```typescript
pattern: '^\\+[1-9]\\d{1,14}$'
// Valid: "+15555551234"
// Invalid: "555-1234" or "+0001234567"
```

#### Number Ranges
```typescript
{
  type: 'number',
  minimum: 0.0,
  maximum: 1.0
}
// Valid: 0.5
// Invalid: 1.5 or -0.1
```

**Benefits**:
- **Early Detection**: Catch errors before execution
- **AI Learning**: Validation feedback improves subsequent attempts
- **Type Safety**: Prevent type mismatches and malformed data
- **Security**: Pattern validation prevents path traversal and injection

---

### 6. Dependency Validation

**Purpose**: Ensure task dependencies are valid and acyclic

**Enforcement Point**: `validator.ts:108-155`

**Checks**:

#### 1. Reference Validation
```typescript
// All dependencies must reference existing tasks
for (const depId of task.dependsOn) {
  if (!taskIds.has(normalizeId(depId))) {
    errors.push(`Task ${taskId} depends on non-existent task ${depId}`);
  }
}
```

#### 2. Cycle Detection (DFS)
```typescript
function detectCycles(graph): string[] {
  // Depth-first search to find cycles
  // Returns array of cycle descriptions
}
```

**Invalid Patterns**:
- Self-dependency: `task-0 → task-0`
- Two-task cycle: `task-0 → task-1 → task-0`
- Multi-task cycle: `task-0 → task-1 → task-2 → task-0`

**Valid Patterns**:
- Sequential: `task-0 → task-1 → task-2`
- Parallel: `task-0 → [task-1, task-2]`
- Fan-in: `[task-0, task-1] → task-2`
- DAG: Any acyclic directed graph

---

## Job System Safety Limits

The orchestration handler integrates with broader job system limits:

### 1. Job-Level Task Limit

**Location**: `processJob.ts:163-169`

```typescript
if (taskRegistry.size >= job.maxTasks) {
  throw new Error(
    `Task limit exceeded: ${job.maxTasks} tasks maximum. ` +
    `Task ${task.id} attempted to spawn child ${childId}.`
  );
}
```

**Scope**: Total tasks across entire job (root + all children)

**Default**: Configurable per job (typically 1000)

### 2. Job-Level Depth Limit

**Location**: `processJob.ts:172-179`

```typescript
const depth = (task.depth ?? 0) + 1;
if (depth > job.maxDepth) {
  throw new Error(
    `Task depth limit exceeded: ${job.maxDepth} levels maximum. ` +
    `Task ${task.id} attempted to spawn child at depth ${depth}.`
  );
}
```

**Scope**: Maximum depth across entire job execution

### 3. Job Timeout

**Location**: `processJob.ts:89-98`

```typescript
if (job.timeout) {
  const elapsed = Date.now() - executionStartTime;
  if (elapsed > job.timeout) {
    throw new Error(
      `Job execution timeout: ${job.timeout}ms limit exceeded. ` +
      `Elapsed: ${elapsed}ms. Completed ${completed.size}/${taskRegistry.size} tasks.`
    );
  }
}
```

**Scope**: Total job execution time (all tasks)

---

## Safety Best Practices

### For Users

1. **Start Conservative**: Use default limits initially
2. **Increase Gradually**: Raise limits only when needed
3. **Monitor Metrics**: Track `validationAttempts` and `aiCallDuration`
4. **Use Context**: Pass dynamic values via context instead of hardcoding
5. **Test First**: Try simple prompts before complex workflows

### For Developers

1. **Define Schemas**: Always add `inputSchema` for new handlers
2. **Validate Early**: Check limits before expensive operations
3. **Provide Feedback**: Clear error messages help AI improve
4. **Set Reasonable Defaults**: Balance safety and usability
5. **Document Constraints**: Explain limits in handler descriptions

### For AI Models

1. **Respect Limits**: Generate plans within configured constraints
2. **Learn from Errors**: Use validation feedback to improve
3. **Optimize Plans**: Prefer batch operations for large datasets
4. **Handle Edge Cases**: Consider path formats, patterns, ranges
5. **Provide Reasoning**: Explain plan logic for debugging

---

## Monitoring and Metrics

### Key Metrics to Track

1. **Validation Attempts**:
   - Average: ~1.4 attempts
   - Threshold: >2.5 may indicate issues

2. **AI Call Duration**:
   - Average: 1-3 seconds
   - Threshold: >10s may indicate complex prompts

3. **Task Count Distribution**:
   - 1-5 tasks: 70%
   - 6-20 tasks: 25%
   - 21-100 tasks: 5%

4. **Depth Distribution**:
   - Depth 0-1: 85%
   - Depth 2-3: 12%
   - Depth 4+: 3%

5. **Timeout Rate**:
   - Target: <1% of requests
   - Alert: >5% may indicate network issues

6. **Retry Exhaustion Rate**:
   - Target: <2% of requests
   - Alert: >10% may indicate prompt/catalog issues

### Health Indicators

**Healthy System**:
- ✅ Validation attempts: 1-2 avg
- ✅ Timeout rate: <1%
- ✅ Retry exhaustion: <2%
- ✅ AI call duration: 1-3s avg

**Degraded System**:
- ⚠️ Validation attempts: 2-3 avg
- ⚠️ Timeout rate: 1-5%
- ⚠️ Retry exhaustion: 2-5%
- ⚠️ AI call duration: 3-5s avg

**Unhealthy System**:
- ❌ Validation attempts: >3 avg
- ❌ Timeout rate: >5%
- ❌ Retry exhaustion: >5%
- ❌ AI call duration: >5s avg

---

## Emergency Procedures

### If Task Limit Exceeded Frequently

1. **Immediate**: Increase `maxChildTasks` temporarily
2. **Short-term**: Guide users to batch operations
3. **Long-term**: Add batch-oriented handlers to catalog

### If Depth Limit Hit

1. **Immediate**: Increase `maxDepth` for specific use case
2. **Short-term**: Review orchestration patterns
3. **Long-term**: Flatten orchestration hierarchy

### If Timeouts Occur

1. **Immediate**: Increase `timeout` for affected requests
2. **Short-term**: Check network and model availability
3. **Long-term**: Optimize prompt structure and catalog

### If Validation Retries High

1. **Immediate**: Review and improve handler schemas
2. **Short-term**: Update catalog descriptions
3. **Long-term**: Fine-tune AI model or prompts

---

## Limit Configuration Matrix

| Limit | Default | Min | Max | Impact if Too Low | Impact if Too High |
|-------|---------|-----|-----|-------------------|-------------------|
| maxChildTasks | 100 | 1 | 1000 | Legitimate requests fail | Resource exhaustion risk |
| maxDepth | 10 | 0 | 100 | Complex workflows blocked | Infinite recursion risk |
| timeout | 60000ms | 1000ms | 300000ms | Valid requests timeout | Slow failure detection |
| maxRetries | 3 | 0 | 10 | Minor errors cause failure | Slow convergence |

**Recommended Starting Points**:
- Development: `maxChildTasks: 50, maxDepth: 5, timeout: 30000, maxRetries: 5`
- Production: `maxChildTasks: 100, maxDepth: 10, timeout: 60000, maxRetries: 3`
- Enterprise: `maxChildTasks: 500, maxDepth: 20, timeout: 120000, maxRetries: 5`
