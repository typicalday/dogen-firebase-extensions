# Job Orchestration System - Architecture

## System Components

### 1. Core Classes

#### `Job` (src/job/job.ts)
The container for job metadata and configuration.

**Fields**:
```typescript
class Job {
  ref: DocumentReference;          // Firestore reference for persistence
  name: string;                     // Human-readable job name
  abortOnFailure: boolean;          // Whether to abort on task failure
  tasks: JobTask[];                 // Initial tasks
  status: JobStatus;                // started | succeeded | failed
  createdAt: Date;                  // Job creation timestamp
  updatedAt: Date;                  // Last update timestamp
  maxTasks: number;                 // Maximum total tasks (default: 1000)
  maxDepth: number;                 // Maximum hierarchy depth (default: 10)
  timeout?: number;                 // Optional execution timeout in ms
}
```

**Responsibilities**:
- Auto-generate task IDs if not provided
- Ensure root tasks have `depth = 0`
- Provide Firestore serialization
- Store execution parameters

#### `JobTask` (src/job/jobTask.ts)
The atomic unit of work in the system.

**Fields**:
```typescript
class JobTask {
  id: string;                       // Unique task identifier
  service: string;                  // Service domain (required)
  command: string;                  // Command to execute (required)
  input?: Record<string, any>;      // Task parameters
  output?: Record<string, any>;     // Task results
  status: FirebaseTaskStatus;       // started | succeeded | failed | aborted
  startedAt?: Date;                 // Execution start time
  completedAt?: Date;               // Execution completion time
  dependsOn?: string[];             // Array of dependency task IDs
  depth: number;                    // Hierarchy depth (0 = root)
}
```

**Status Lifecycle**:
```
Started (initial) → Succeeded (normal completion)
                 → Failed (error occurred)
                 → Aborted (dependency failed + abortOnFailure=true)
```

**Responsibilities**:
- Validate service and command are non-empty
- Track execution timing
- Provide Firestore serialization
- Support in-place updates via `update()` method

#### `TaskGraph` (src/job/taskGraph.ts)
Wrapper around `graphlib.Graph` for dependency management.

**Purpose**: Provides a safe, validated interface for graph operations.

**Methods**:
```typescript
class TaskGraph {
  constructor(tasks: JobTask[])
    // Creates graph from initial tasks, validates no cycles

  addNode(id: string, task: JobTask): void
    // Adds task to graph, throws if duplicate

  addEdge(fromId: string, toId: string): void
    // Adds dependency edge, validates no cycles immediately

  hasNode(id: string): boolean
    // Checks if task exists in graph

  getNode(id: string): JobTask
    // Retrieves task by ID

  size(): number
    // Returns total number of tasks

  getExecutableTasks(completed: Set<string>): string[]
    // Returns task IDs whose dependencies are all completed

  getTopologicalOrder(): string[]
    // Returns all task IDs in dependency order

  validateNoCycles(): void
    // Throws if circular dependencies exist
}
```

**Key Features**:
- **Immediate validation**: `addEdge()` validates no cycles on each call
- **Thread-safe usage**: Designed for use with mutex protection
- **Efficient queries**: O(V + E) complexity for cycle detection

### 2. Type Definitions (src/job/types.ts)

#### `ChildTaskSpec`
Specification for spawning child tasks:
```typescript
interface ChildTaskSpec {
  service: string;                  // Required
  command: string;                  // Required
  input?: Record<string, any>;      // Optional
  dependsOn?: string[];             // Optional dependencies
}
```

#### `TaskOutput`
Extended output type that handlers return:
```typescript
interface TaskOutput extends Record<string, any> {
  childTasks?: ChildTaskSpec[];    // Optional array of children to spawn
  [key: string]: any;               // Handler-specific output fields
}
```

### 3. Main Orchestration (src/job/processJob.ts)

#### Entry Point: `processJob()`
Firebase Cloud Function that orchestrates job execution.

**Input**:
```typescript
{
  name: string;                     // Job name (required)
  tasks: Array<{                    // Initial tasks (required)
    service: string;
    command: string;
    input?: Record<string, any>;
    dependsOn?: string[];
  }>;
  abortOnFailure?: boolean;         // Default: true
  persist?: boolean;                // Save to Firestore? Default: false
  maxTasks?: number;                // Default: 1000
  maxDepth?: number;                // Default: 10
  timeout?: number;                 // Execution timeout in ms (optional)
}
```

**Output**:
```typescript
{
  id: string | null;                // Firestore ID (if persist=true)
  name: string;                     // Job name
  status: JobStatus;                // Final status
  tasks: Array<{                    // All tasks with results
    id: string;
    service: string;
    command: string;
    status: FirebaseTaskStatus;
    output: Record<string, any>;
    startedAt?: Date;
    completedAt?: Date;
    dependsOn?: string[];
  }>;
  createdAt: Date;
  updatedAt: Date;
}
```

## Execution Architecture

### Main Execution Loop

```typescript
// 1. Initialization
const taskRegistry = new Map<string, JobTask>();  // All tasks
const graph = new TaskGraph(job.tasks);           // Dependency graph
const completed = new Set<string>();              // Completed task IDs
const graphMutex = new Mutex();                   // Thread safety
const executionStartTime = Date.now();            // Timeout tracking

// 2. Main Loop
while (completed.size < taskRegistry.size) {
  // 2a. Timeout check
  if (job.timeout && Date.now() - executionStartTime > job.timeout) {
    throw timeout error;
  }

  // 2b. Get executable tasks
  const executableTasks = graph.getExecutableTasks(completed);

  // 2c. Deadlock detection
  if (executableTasks.length === 0) {
    throw deadlock error with incomplete task list;
  }

  // 2d. Parallel execution
  await Promise.all(
    executableTasks.map(async (taskId) => {
      // Execute task
      // Handle failures/aborts
      // Spawn children if specified
      // Mark complete
    })
  );
}

// 3. Return results
return job with all task outputs;
```

### Child Spawning Process

Located in `processJob.ts:140-230`, executed within the parallel task loop:

```typescript
// 1. Execute task handler
const output = await processTask(task);

// 2. Check for children
if (output.childTasks && Array.isArray(output.childTasks)) {

  // FIRST PASS: Collect all child IDs that will be created
  const plannedChildIds = new Set<string>();
  for (let i = 0; i < output.childTasks.length; i++) {
    plannedChildIds.add(`${task.id}-${i}`);
  }

  // SECOND PASS: Create children with validation
  for (let i = 0; i < output.childTasks.length; i++) {
    const childSpec = output.childTasks[i];
    const childId = `${task.id}-${i}`;

    // SAFETY CHECK 1: Task limit
    if (taskRegistry.size >= job.maxTasks) {
      throw error;
    }

    // SAFETY CHECK 2: Depth limit
    const depth = (task.depth ?? 0) + 1;
    if (depth > job.maxDepth) {
      throw error;
    }

    // SAFETY CHECK 3: Dependency validation
    if (childSpec.dependsOn) {
      for (const depId of childSpec.dependsOn) {
        const isExisting = taskRegistry.has(depId) || graph.hasNode(depId);
        const isPlannedSibling = plannedChildIds.has(depId);

        if (!isExisting && !isPlannedSibling) {
          throw invalid dependency error;
        }
      }
    }

    // Create child task
    const childTask = new JobTask({
      id: childId,
      service: childSpec.service,
      command: childSpec.command,
      input: childSpec.input,
      dependsOn: childSpec.dependsOn,
      depth: depth,
    });

    // CRITICAL SECTION: Mutex-protected graph mutation
    await graphMutex.runExclusive(async () => {
      graph.addNode(childId, childTask);
      taskRegistry.set(childId, childTask);

      if (childTask.dependsOn) {
        for (const depId of childTask.dependsOn) {
          graph.addEdge(depId, childId);
        }

        // Validate no cycles created
        graph.validateNoCycles();
      }
    });
  }
}
```

### Task Handler Integration

Handlers are registered in `processTask()` function:

```typescript
async function processTask(task: JobTask): Promise<Record<string, any>> {
  switch (task.service) {
    case "firestore":
      switch (task.command) {
        case "create-document":
          return await handleCreateDocument(task);
        case "delete-path":
          return await handleDeletePath(task);
        // ... more commands
      }
    case "ai":
      switch (task.command) {
        case "process-inference":
          return await handleProcessInference(task);
      }
    // ... more services
  }
}
```

**Handler Contract**:
```typescript
async function handlerName(task: JobTask): Promise<TaskOutput> {
  // 1. Validate task.input
  // 2. Perform operation
  // 3. Return output (optionally with childTasks)
  return {
    // Handler-specific output
    result: "...",

    // Optional: Spawn children
    childTasks: [
      {
        service: "...",
        command: "...",
        input: {...},
        dependsOn: ["..."], // Optional
      }
    ]
  };
}
```

## Thread Safety

### Race Condition Protection

**Problem**: Multiple parallel tasks spawning children simultaneously could corrupt shared state.

**Solution**: Mutex-protected critical section using `async-mutex` library.

```typescript
const graphMutex = new Mutex();

// All graph/registry mutations wrapped
await graphMutex.runExclusive(async () => {
  graph.addNode(childId, childTask);
  taskRegistry.set(childId, childTask);

  if (childTask.dependsOn) {
    for (const depId of childTask.dependsOn) {
      graph.addEdge(depId, childId);
    }
    graph.validateNoCycles();
  }
});
```

**Protected Operations**:
- `graph.addNode()` - Adding tasks to graph
- `taskRegistry.set()` - Adding tasks to registry
- `graph.addEdge()` - Adding dependency edges
- `graph.validateNoCycles()` - Cycle validation

**Performance Impact**: Negligible (<1ms) due to small critical section.

## Persistence

### Optional Firestore Integration

When `persist: true` is specified:

1. Job document created in `/jobs` collection
2. Periodic state saves every 10 seconds during execution
3. Final state save on completion/failure
4. Document includes all task states and outputs

**Firestore Schema**:
```typescript
{
  name: string;
  abortOnFailure: boolean;
  status: "started" | "succeeded" | "failed";
  tasks: Array<{
    id: string;
    service: string;
    command: string;
    input: object;
    output: object;
    status: string;
    startedAt: Timestamp | null;
    completedAt: Timestamp | null;
    dependsOn: string[];
    depth: number;
  }>;
  maxTasks: number;
  maxDepth: number;
  timeout: number | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

## Error Handling

### Error Types

1. **Validation Errors** (`invalid-argument`)
   - Missing required fields
   - Invalid input formats
   - Empty task arrays

2. **Authorization Errors** (`unauthenticated`, `permission-denied`)
   - No auth context
   - Not admin role

3. **Execution Errors** (`internal`)
   - Task handler failures
   - Unexpected exceptions
   - Graph corruption

4. **Safety Limit Errors**
   - Task limit exceeded (maxTasks)
   - Depth limit exceeded (maxDepth)
   - Circular dependencies detected
   - Invalid dependency references

5. **Timeout Errors** (`deadline-exceeded`)
   - Execution time exceeded configured timeout
   - Includes progress information

### Error Propagation

```
Task Error → Mark task as Failed → {
  if abortOnFailure=true:
    Mark pending tasks as Aborted → Job Failed
  if abortOnFailure=false:
    Continue execution → Job May Succeed if other tasks complete
}
```

## Performance Considerations

### Time Complexity

| Operation | Complexity | Notes |
|-----------|------------|-------|
| Initialize graph | O(V + E) | V = tasks, E = dependencies |
| Get executable tasks | O(V) | Check each task's dependencies |
| Add node | O(1) | Constant time operation |
| Add edge | O(V + E) | Includes cycle detection |
| Spawn children | O(C × (V + E)) | C = children, includes validation |
| Full execution | O(I × V + S × C × (V + E)) | I = iterations, S = spawning tasks |

### Space Complexity

| Structure | Complexity | Notes |
|-----------|------------|-------|
| Task registry | O(V) | Map of all tasks |
| Graph structure | O(V + E) | Nodes and edges |
| Completed set | O(V) | Set of completed task IDs |
| Mutex queue | O(1) | Single mutex instance |

### Optimization Strategies

1. **Parallel Execution**: Use `Promise.all()` for independent tasks
2. **Early Validation**: Fail fast on invalid configurations
3. **Efficient Queries**: Use Set for O(1) membership checks
4. **Batch Operations**: Group operations in critical section
5. **Minimal Locks**: Keep mutex-protected sections small

## Dependencies

### External Libraries

- **firebase-functions**: Cloud Functions runtime
- **firebase-admin**: Firestore access
- **graphlib**: Graph algorithms and data structures
- **async-mutex**: Async mutex for race condition prevention

### Library Justification

- **graphlib**: Industry-standard, battle-tested DAG implementation
- **async-mutex**: Clean async/await syntax for mutex operations
- Both are lightweight and well-maintained

## Next Steps

- **[Task Spawning Guide](./03-task-spawning.md)**: How to spawn children effectively
- **[Safety Mechanisms](./04-safety-mechanisms.md)**: Understanding limits and validation
- **[API Reference](./05-api-reference.md)**: Complete API documentation
