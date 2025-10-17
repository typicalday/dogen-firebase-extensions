# Safety Mechanisms and Limits

## Overview

The job orchestration system implements **defense-in-depth** security with multiple layers of validation and safety checks to prevent runaway execution, resource exhaustion, and invalid states.

## Safety Layers

```
Layer 1: Input Validation     → Reject malformed requests
Layer 2: Limit Enforcement     → Prevent resource exhaustion
Layer 3: Cycle Detection       → Ensure DAG integrity
Layer 4: Deadlock Detection    → Catch execution stalls
Layer 5: Race Protection       → Prevent concurrent corruption
Layer 6: Timeout Enforcement   → Limit execution time
```

## 1. Task Limit (maxTasks)

### Purpose
Prevent unbounded task creation from runaway AI or infinite loops.

### Default
`1000` tasks per job

### Configuration
```typescript
await processJob({
  name: "my-job",
  maxTasks: 500,  // Custom limit
  tasks: [...]
});
```

### Enforcement Location
`processJob.ts:155-166`

```typescript
// SAFETY CHECK 1: Total task limit
if (taskRegistry.size >= job.maxTasks) {
  throw new Error(
    `Task limit exceeded: ${job.maxTasks} tasks maximum. ` +
    `Task ${task.id} attempted to spawn child ${childId}. ` +
    `This may indicate a runaway AI or infinite loop.`
  );
}
```

### When It Triggers
- Parent spawns children that would exceed total task count
- Checked **before** creating each child task
- Count includes root tasks + all spawned descendants

### Example Scenario
```typescript
// Job with maxTasks=10
// Root tasks: 2
// Task 0 spawns 5 children → Total: 7 (OK)
// Child 0-0 spawns 4 children → Total would be 11 (FAIL)
// Error thrown before creating child 0-0-0
```

### Recommendations
- **Small jobs**: 10-50 tasks
- **Medium jobs**: 100-500 tasks
- **Large jobs**: 500-1000 tasks
- **Enterprise**: Consider batching instead of single large job

## 2. Depth Limit (maxDepth)

### Purpose
Prevent infinite recursion and deeply nested hierarchies that are hard to debug.

### Default
`10` levels

### Configuration
```typescript
await processJob({
  name: "my-job",
  maxDepth: 5,  // Custom limit
  tasks: [...]
});
```

### Enforcement Location
`processJob.ts:168-176`

```typescript
// SAFETY CHECK 2: Depth limit
const depth = (task.depth ?? 0) + 1;
if (depth > job.maxDepth) {
  throw new Error(
    `Task depth limit exceeded: ${job.maxDepth} levels maximum. ` +
    `Task ${task.id} attempted to spawn child at depth ${depth}. ` +
    `Child ID: ${childId}`
  );
}
```

### Depth Calculation
- **Explicit tracking**: Each task has `depth` field
- **Root tasks**: `depth = 0`
- **Children**: `depth = parent.depth + 1`
- **Independent of ID format**: Works with custom IDs

### When It Triggers
- Parent at depth N spawns child at depth N+1 where N+1 > maxDepth
- Checked **before** creating each child task

### Example Scenario
```
maxDepth = 3

Depth 0: Root task "0" ✓
Depth 1: Child "0-0" ✓
Depth 2: Grandchild "0-0-0" ✓
Depth 3: Great-grandchild "0-0-0-0" ✓
Depth 4: "0-0-0-0-0" ✗ BLOCKED
```

### Recommendations
- **Simple workflows**: maxDepth=3-5
- **Recursive processing**: maxDepth=5-7
- **Deep hierarchies**: maxDepth=8-10
- **Flatten if possible**: Prefer wide over deep

## 3. Execution Timeout

### Purpose
Prevent jobs from running indefinitely and exceeding Firebase function limits (~9-10 minutes).

### Default
No timeout (unlimited execution)

### Configuration
```typescript
await processJob({
  name: "my-job",
  timeout: 300000,  // 5 minutes in milliseconds
  tasks: [...]
});
```

### Enforcement Location
`processJob.ts:100-109`

```typescript
// Check timeout if specified
if (job.timeout) {
  const elapsed = Date.now() - executionStartTime;
  if (elapsed > job.timeout) {
    throw new functions.https.HttpsError(
      "deadline-exceeded",
      `Job execution timeout: ${job.timeout}ms limit exceeded. ` +
      `Elapsed: ${elapsed}ms. Completed ${completed.size}/${taskRegistry.size} tasks.`
    );
  }
}
```

### When It Triggers
- Checked at **beginning of each execution loop iteration**
- **Not** checked during individual task execution
- Includes elapsed time and progress in error

### Example Scenario
```
timeout = 60000 (1 minute)

0ms: Start execution
30s: Complete tasks 0, 1, 2 (3/10)
45s: Complete tasks 3, 4, 5 (6/10)
65s: Check timeout → EXCEEDED
Error: "Job execution timeout: 60000ms limit exceeded. Elapsed: 65000ms. Completed 6/10 tasks."
```

### Recommendations
- **Short jobs**: 30-60 seconds (30000-60000ms)
- **Medium jobs**: 2-5 minutes (120000-300000ms)
- **Long jobs**: 5-8 minutes (300000-480000ms)
- **Firebase limit**: Never exceed 540000ms (9 minutes)

### Best Practices
```typescript
// Conservative timeout (80% of expected time)
const expectedTime = 120000;  // 2 minutes
const timeout = expectedTime * 0.8;  // 96 seconds

// Always leave buffer for Firebase limit
const maxSafeTimeout = 540000;  // 9 minutes
const safeTimeout = Math.min(desiredTimeout, maxSafeTimeout);
```

## 4. Cycle Detection

### Purpose
Ensure graph remains a DAG (Directed Acyclic Graph) - no circular dependencies.

### Implementation
Uses `graphlib.alg.findCycles()` algorithm.

### Enforcement Locations

#### 4a. Initial Graph Construction
`taskGraph.ts:38-44`

```typescript
// Constructor validates cycles
const cycles = alg.findCycles(this.graph);
if (cycles.length > 0) {
  throw new Error(
    `Circular dependencies detected: ${JSON.stringify(cycles)}`
  );
}
```

#### 4b. Runtime Edge Addition
`taskGraph.ts:77-80`

```typescript
// addEdge() validates immediately after adding
this.graph.setEdge(fromId, toId);

// Validate no cycles after adding edge
this.validateNoCycles();
```

#### 4c. Child Spawning
`processJob.ts:214-216`

```typescript
// After adding all child edges
for (const depId of childTask.dependsOn) {
  graph.addEdge(depId, childId);
}

// CRITICAL: Validate no cycles were created
graph.validateNoCycles();
```

### When It Triggers
- Invalid initial task dependencies
- Children create cycle via `dependsOn`
- Any call to `graph.addEdge()`

### Example Scenarios

**Direct Cycle**:
```typescript
tasks: [
  { id: "A", dependsOn: ["B"] },
  { id: "B", dependsOn: ["A"] }  // Cycle: A→B→A
]
// Error: "Circular dependencies detected: [["A", "B"]]"
```

**Indirect Cycle**:
```typescript
tasks: [
  { id: "A", dependsOn: ["B"] },
  { id: "B", dependsOn: ["C"] },
  { id: "C", dependsOn: ["A"] }  // Cycle: A→B→C→A
]
// Error: "Circular dependencies detected: [["A", "B", "C"]]"
```

**Child-Created Cycle**:
```typescript
// Parent "0" depends on "1"
// Parent "1" spawns child "1-0" that depends on "0"
// Cycle: 0→1→1-0→0
// Error: "Circular dependencies detected: [["0", "1", "1-0"]]"
```

### Performance
- **Complexity**: O(V + E) where V=tasks, E=dependencies
- **Typical**: <1ms for <100 tasks
- **Worst case**: ~10ms for 1000 tasks

## 5. Dependency Validation

### Purpose
Ensure all `dependsOn` references point to valid tasks.

### Enforcement Location
`processJob.ts:178-195`

```typescript
// SAFETY CHECK 3: Enhanced dependency validation
if (childSpec.dependsOn) {
  for (const depId of childSpec.dependsOn) {
    const isExisting = taskRegistry.has(depId) || graph.hasNode(depId);
    const isPlannedSibling = plannedChildIds.has(depId);

    if (!isExisting && !isPlannedSibling) {
      throw new Error(
        `Invalid dependency: Child task ${childId} depends on ` +
        `non-existent task ${depId}. ` +
        `Dependencies must reference existing tasks or siblings being spawned together.`
      );
    }
  }
}
```

### Valid Dependency Types

1. **Existing Tasks**: Already in graph/registry
```typescript
// Task "0-0" depends on root task "0"
dependsOn: ["0"]  // ✓ Valid
```

2. **Sibling Tasks**: Being spawned together
```typescript
childTasks: [
  { ... },  // Will become "0-0"
  { ..., dependsOn: ["0-0"] }  // ✓ Valid - sibling reference
]
```

3. **Uncle/Ancestor Tasks**: Any task in graph
```typescript
// Child "0-0-0" depends on uncle "0-1"
dependsOn: ["0-1"]  // ✓ Valid
```

### Invalid Dependencies

```typescript
// ✗ Non-existent task
dependsOn: ["nonexistent"]

// ✗ Future non-sibling task
dependsOn: ["1-0"]  // When task "1" hasn't spawned yet

// ✗ Self-reference
dependsOn: ["0-0"]  // When this IS task "0-0"
```

### Two-Pass Validation

The system uses **two-pass validation** for sibling dependencies:

**Pass 1: Collect**
```typescript
const plannedChildIds = new Set<string>();
for (let i = 0; i < output.childTasks.length; i++) {
  plannedChildIds.add(`${task.id}-${i}`);
}
```

**Pass 2: Validate**
```typescript
for (const depId of childSpec.dependsOn) {
  const isExisting = taskRegistry.has(depId);
  const isPlannedSibling = plannedChildIds.has(depId);

  if (!isExisting && !isPlannedSibling) {
    throw error;
  }
}
```

This allows siblings to reference each other before they're added to the graph.

## 6. Deadlock Detection

### Purpose
Catch situations where execution stalls with incomplete tasks.

### Enforcement Location
`processJob.ts:113-121`

```typescript
if (executableTasks.length === 0) {
  const incomplete = Array.from(taskRegistry.keys()).filter(
    id => !completed.has(id)
  );
  throw new Error(
    `Deadlock detected: ${incomplete.length} tasks cannot execute. ` +
    `Incomplete tasks: ${incomplete.join(', ')}`
  );
}
```

### When It Triggers
- `completed.size < taskRegistry.size` (tasks remain)
- `getExecutableTasks()` returns empty (no tasks ready)

### Causes
1. **Dependency on failed task** (with `abortOnFailure=false`)
2. **Invalid dependency** (passed validation but unreachable)
3. **Graph corruption** (should never happen)

### Example Scenario
```typescript
// abortOnFailure = false
tasks: [
  { id: "0", ... },  // Fails
  { id: "1", dependsOn: ["0"] }  // Can never execute
]

// Loop iteration:
// completed = {}
// executableTasks = ["0"]
// Execute "0" → Fails → Mark complete

// Next iteration:
// completed = {"0"}
// executableTasks = []  // Task "1" depends on "0" but it failed
// incomplete = ["1"]
// Error: "Deadlock detected: 1 tasks cannot execute. Incomplete tasks: 1"
```

## 7. Race Condition Protection

### Purpose
Prevent concurrent child spawning from corrupting shared state.

### Implementation
Mutex-protected critical section using `async-mutex` library.

### Protected Code
`processJob.ts:207-221`

```typescript
const graphMutex = new Mutex();

// CRITICAL SECTION: Wrap graph/registry modifications
await graphMutex.runExclusive(async () => {
  // Add to graph and registry
  graph.addNode(childId, childTask);
  taskRegistry.set(childId, childTask);

  // Add dependency edges
  if (childTask.dependsOn) {
    for (const depId of childTask.dependsOn) {
      graph.addEdge(depId, childId);
    }

    // Validate no cycles
    graph.validateNoCycles();
  }
});
```

### Why It's Needed
Multiple tasks execute in parallel via `Promise.all()`. Without mutex:

```
Task A spawning:        Task B spawning:
├─ Read graph (OK)     ├─ Read graph (OK)
├─ Add node A-0        ├─ Add node B-0
├─ Validate cycles     ├─ Add node B-1
└─ Add node A-1        └─ Validate cycles
                          ↑ May see inconsistent state!
```

With mutex, operations are serialized:
```
Task A spawns → [Mutex Lock] → Add all A children → [Mutex Unlock]
Task B spawns → [Mutex Lock] → Add all B children → [Mutex Unlock]
```

### Performance Impact
- **Negligible**: Critical section is small (<1ms)
- **Scalability**: Doesn't limit parallelism of task execution
- **Only blocks**: Graph mutation, not task processing

## 8. Input Validation

### Authentication
```typescript
if (!context?.auth) {
  throw new functions.https.HttpsError(
    "unauthenticated",
    "Function must be called while authenticated"
  );
}

if (!authToken || !(await verifyAdmin(authToken))) {
  throw new functions.https.HttpsError(
    "permission-denied",
    "Unauthorized"
  );
}
```

### Task Array Validation
```typescript
if (!Array.isArray(tasksData) || tasksData.length === 0) {
  throw new functions.https.HttpsError(
    "invalid-argument",
    "Invalid input: No tasks provided"
  );
}
```

### Job Name Validation
```typescript
if (typeof jobName !== "string" || jobName.length === 0) {
  throw new functions.https.HttpsError(
    "invalid-argument",
    "Invalid input: Job name is required"
  );
}
```

### Task Field Validation (JobTask constructor)
```typescript
if (typeof service !== "string" || service.trim() === "") {
  error = "Invalid input: service must be a non-empty string";
}

if (typeof command !== "string" || command.trim() === "") {
  error = "Invalid input: command must be a non-empty string";
}
```

## Safety Recommendations

### 1. Start Conservative
```typescript
// First job: Use low limits
{
  maxTasks: 50,
  maxDepth: 3,
  timeout: 60000  // 1 minute
}

// Monitor and adjust based on actual needs
```

### 2. Test Limits
```typescript
// Create test job that intentionally hits limits
{
  name: "test-limits",
  maxTasks: 10,
  maxDepth: 2,
  tasks: [/* spawning task */]
}

// Verify error messages are clear and helpful
```

### 3. Monitor in Production
```typescript
// Log job metrics
console.log(`Job ${jobName}: ${taskCount} tasks, depth ${maxDepthReached}, time ${elapsed}ms`);

// Alert on approaching limits
if (taskCount > maxTasks * 0.8) {
  console.warn(`Approaching task limit: ${taskCount}/${maxTasks}`);
}
```

### 4. Plan for Failure
```typescript
// Always set abortOnFailure appropriately
{
  abortOnFailure: true   // Fail fast (default)
  // vs
  abortOnFailure: false  // Continue on errors
}

// Set reasonable timeout
{
  timeout: Math.min(
    expectedTime * 1.5,  // 50% buffer
    480000               // 8 minutes (safe margin)
  )
}
```

### 5. Document Limits in Handlers
```typescript
/**
 * Processes dataset by recursive splitting.
 *
 * Safety considerations:
 * - Maximum depth: log₂(datasetSize/chunkSize) + 1
 * - Maximum tasks: datasetSize/chunkSize
 * - Recommended limits: maxDepth=7, maxTasks=500
 */
async function handleProcessDataset(task: JobTask): Promise<TaskOutput> {
  // ...
}
```

## Error Messages

All safety mechanisms provide **detailed, actionable error messages**:

- **What failed**: Which limit or validation
- **Current state**: How many tasks, what depth, elapsed time
- **Context**: Which task triggered the error
- **Suggestion**: How to fix (implicit in message)

### Examples

```
Task limit exceeded: 1000 tasks maximum.
Task 0-3-7 attempted to spawn child 0-3-7-0.
This may indicate a runaway AI or infinite loop.
```

```
Task depth limit exceeded: 10 levels maximum.
Task 0-1-2-3-4-5-6-7-8-9 attempted to spawn child at depth 11.
Child ID: 0-1-2-3-4-5-6-7-8-9-0
```

```
Job execution timeout: 300000ms limit exceeded.
Elapsed: 315420ms.
Completed 47/100 tasks.
```

```
Circular dependencies detected: [["0", "1", "2", "0"]]
```

```
Deadlock detected: 3 tasks cannot execute.
Incomplete tasks: 5, 7, 9
```

## Next Steps

- **[API Reference](./05-api-reference.md)**: Complete API documentation
- **[Examples](./06-examples.md)**: Practical usage patterns
