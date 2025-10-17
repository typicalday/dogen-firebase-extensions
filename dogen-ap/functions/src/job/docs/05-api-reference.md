# API Reference

## Cloud Function

### `processJob(data, context)`

Main entry point for job execution. Firebase Cloud Function that orchestrates task execution with dynamic spawning, dependency management, and safety enforcement.

**Type**: `functions.https.onCall`

**Parameters**:
- `data` (object): Job configuration
- `context` (CallableContext): Firebase auth context

**Input Schema**:
```typescript
{
  name: string;                     // Required: Job name
  tasks: TaskSpec[];                // Required: Initial tasks (min length: 1)
  abortOnFailure?: boolean;         // Optional: Abort on task failure (default: true)
  persist?: boolean;                // Optional: Save to Firestore (default: false)
  maxTasks?: number;                // Optional: Task limit (default: 1000)
  maxDepth?: number;                // Optional: Depth limit (default: 10)
  timeout?: number;                 // Optional: Timeout in ms (default: undefined)
}

interface TaskSpec {
  id?: string;                      // Optional: Custom ID (auto-generated if missing)
  service: string;                  // Required: Service name
  command: string;                  // Required: Command name
  input?: Record<string, any>;      // Optional: Task parameters
  dependsOn?: string[];             // Optional: Dependency task IDs
}
```

**Output Schema**:
```typescript
{
  id: string | null;                // Firestore document ID (null if persist=false)
  name: string;                     // Job name
  status: JobStatus;                // Final status
  tasks: TaskResult[];              // All tasks with results
  createdAt: Date;                  // Job creation timestamp
  updatedAt: Date;                  // Last update timestamp
}

interface TaskResult {
  id: string;                       // Task ID
  service: string;                  // Service name
  command: string;                  // Command name
  status: FirebaseTaskStatus;       // Task status
  output: Record<string, any>;      // Task results
  startedAt?: Date;                 // Execution start
  completedAt?: Date;               // Execution end
  dependsOn?: string[];             // Dependencies
}
```

**Throws**:
- `unauthenticated`: Not authenticated
- `permission-denied`: Not admin
- `invalid-argument`: Invalid input
- `deadline-exceeded`: Timeout
- `internal`: Execution error

**Example**:
```typescript
const result = await processJob({
  name: "ai-workflow",
  maxTasks: 100,
  maxDepth: 5,
  timeout: 300000,  // 5 minutes
  abortOnFailure: true,
  persist: false,
  tasks: [
    {
      service: "ai",
      command: "process-inference",
      input: {
        prompt: "Analyze this data...",
        context: {...}
      }
    }
  ]
});

console.log(`Job ${result.name}: ${result.status}`);
console.log(`Completed ${result.tasks.length} tasks`);
```

## Core Classes

### Job

Job container with metadata and configuration.

**Location**: `src/job/job.ts`

#### Constructor

```typescript
constructor({
  name,
  abortOnFailure,
  tasks,
  ref,
  status,
  createdAt,
  updatedAt,
  maxTasks,
  maxDepth,
  timeout
}: {
  name: string;                     // Required
  abortOnFailure: boolean;          // Required
  tasks: JobTask[];                 // Required
  ref?: DocumentReference;          // Optional: Firestore reference
  status?: JobStatus;               // Optional: Initial status (default: Started)
  createdAt?: Date;                 // Optional: Creation time (default: now)
  updatedAt?: Date;                 // Optional: Update time (default: now)
  maxTasks?: number;                // Optional: Task limit (default: 1000)
  maxDepth?: number;                // Optional: Depth limit (default: 10)
  timeout?: number;                 // Optional: Timeout in ms
})
```

**Auto-Generated Fields**:
- Generates task IDs if not provided (numeric: "0", "1", "2")
- Ensures root tasks have `depth = 0`

#### Fields

```typescript
ref: DocumentReference              // Firestore reference
name: string                        // Job name
abortOnFailure: boolean             // Abort on failure flag
tasks: JobTask[]                    // Task array
status: JobStatus                   // Current status
createdAt: Date                     // Creation timestamp
updatedAt: Date                     // Last update timestamp
maxTasks: number                    // Task limit (default: 1000)
maxDepth: number                    // Depth limit (default: 10)
timeout?: number                    // Timeout in ms (optional)
```

#### Methods

##### `persist(): Promise<WriteResult>`

Saves job state to Firestore.

```typescript
await job.persist();
```

##### `update({ status, updatedAt }): Job`

Updates job status and timestamp. Returns `this` for chaining.

```typescript
job.update({
  status: JobStatus.Succeeded,
  updatedAt: new Date()
});
```

##### `toFirestore(): Record<string, any>`

Serializes job to Firestore format.

```typescript
const data = job.toFirestore();
await firestore.collection("jobs").doc(job.ref.id).set(data);
```

#### Enums

##### JobStatus

```typescript
enum JobStatus {
  Started = "started",              // Job is executing
  Succeeded = "succeeded",          // All tasks completed successfully
  Failed = "failed"                 // One or more tasks failed
}
```

### JobTask

Atomic unit of work in the system.

**Location**: `src/job/jobTask.ts`

#### Constructor

```typescript
constructor({
  id,
  service,
  command,
  input,
  output,
  status,
  startedAt,
  completedAt,
  dependsOn,
  depth
}: {
  id?: string;                      // Optional: Task ID
  service: string;                  // Required
  command: string;                  // Required
  input?: Record<string, any>;      // Optional: Task parameters
  output?: Record<string, any>;     // Optional: Task results
  status?: FirebaseTaskStatus;      // Optional: Initial status
  startedAt?: Date;                 // Optional: Execution start
  completedAt?: Date;               // Optional: Execution end
  dependsOn?: string[];             // Optional: Dependencies
  depth?: number;                   // Optional: Depth (default: 0)
})
```

**Validation**:
- `service` must be non-empty string
- `command` must be non-empty string
- Sets status to `Failed` if validation fails

#### Fields

```typescript
id: string                          // Task identifier
service: string                     // Service domain
command: string                     // Command to execute
input?: Record<string, any>         // Task parameters
output?: Record<string, any>        // Task results
status: FirebaseTaskStatus          // Current status
startedAt?: Date                    // Execution start time
completedAt?: Date                  // Execution completion time
dependsOn?: string[]                // Dependency task IDs
depth: number                       // Hierarchy depth
```

#### Methods

##### `update({ output, status, startedAt, completedAt }): JobTask`

Updates task fields. Returns `this` for chaining.

```typescript
task.update({
  status: FirebaseTaskStatus.Succeeded,
  output: { result: "..." },
  completedAt: new Date()
});
```

##### `toFirestore(): Record<string, any>`

Serializes task to Firestore format.

```typescript
const data = task.toFirestore();
```

#### Enums

##### FirebaseTaskStatus

```typescript
enum FirebaseTaskStatus {
  Started = "started",              // Task is executing
  Succeeded = "succeeded",          // Task completed successfully
  Failed = "failed",                // Task failed with error
  Aborted = "aborted"               // Task aborted due to dependency failure
}
```

### TaskGraph

Wrapper around graphlib.Graph for dependency management.

**Location**: `src/job/taskGraph.ts`

#### Constructor

```typescript
constructor(tasks: JobTask[])
```

Creates graph from initial tasks, validates no cycles.

**Throws**: Error if circular dependencies detected

**Example**:
```typescript
const graph = new TaskGraph([
  new JobTask({ id: "0", service: "s1", command: "c1" }),
  new JobTask({ id: "1", service: "s2", command: "c2", dependsOn: ["0"] })
]);
```

#### Methods

##### `addNode(id: string, task: JobTask): void`

Adds task to graph.

**Throws**:
- Error if task with ID already exists

**Note**: Adding a node alone cannot create cycles.

```typescript
graph.addNode("2", new JobTask({
  id: "2",
  service: "service",
  command: "command"
}));
```

##### `addEdge(fromId: string, toId: string): void`

Adds dependency edge (fromId must complete before toId).

**Validates**: No cycles created by this edge.

**Throws**:
- Error if source task doesn't exist
- Error if target task doesn't exist
- Error if edge creates cycle

```typescript
graph.addEdge("0", "1");  // 1 depends on 0
```

##### `hasNode(id: string): boolean`

Checks if task exists in graph.

```typescript
if (graph.hasNode("0")) {
  console.log("Task 0 exists");
}
```

##### `getNode(id: string): JobTask`

Retrieves task by ID.

```typescript
const task = graph.getNode("0");
console.log(task.service, task.command);
```

##### `size(): number`

Returns total number of tasks.

```typescript
console.log(`Graph has ${graph.size()} tasks`);
```

##### `getExecutableTasks(completed: Set<string>): string[]`

Returns task IDs whose dependencies are all completed.

**Algorithm**: For each uncompleted task, check if all predecessors are in `completed` set.

```typescript
const completed = new Set(["0", "1"]);
const executable = graph.getExecutableTasks(completed);
// Returns IDs of tasks that depend only on 0 and 1 (or have no dependencies)
```

##### `getTopologicalOrder(): string[]`

Returns all task IDs in dependency order.

**Use case**: Debugging, visualization, sequential execution.

```typescript
const order = graph.getTopologicalOrder();
console.log("Execution order:", order);
// ["0", "1", "2", "3", ...]
```

##### `validateNoCycles(): void`

Validates that graph contains no circular dependencies.

**Throws**: Error if cycles detected with cycle details.

**Complexity**: O(V + E)

```typescript
graph.addEdge("A", "B");
graph.addEdge("B", "C");
graph.addEdge("C", "A");  // Creates cycle
graph.validateNoCycles();  // Throws: "Circular dependencies detected: [['A','B','C']]"
```

## Type Definitions

### ChildTaskSpec

Specification for spawning child tasks.

**Location**: `src/job/types.ts`

```typescript
interface ChildTaskSpec {
  service: string;                  // Required: Service name
  command: string;                  // Required: Command name
  input?: Record<string, any>;      // Optional: Task parameters
  dependsOn?: string[];             // Optional: Dependency task IDs
}
```

**Usage**:
```typescript
const children: ChildTaskSpec[] = [
  {
    service: "firestore",
    command: "create-document",
    input: { collection: "results", data: {...} }
  },
  {
    service: "storage",
    command: "upload-file",
    input: { path: "file.json", content: "..." },
    dependsOn: ["0-0"]  // Wait for previous child
  }
];

return { result: data, childTasks: children };
```

### TaskOutput

Extended output type for task handlers.

**Location**: `src/job/types.ts`

```typescript
interface TaskOutput extends Record<string, any> {
  childTasks?: ChildTaskSpec[];    // Optional: Children to spawn
  [key: string]: any;               // Handler-specific output
}
```

**Usage**:
```typescript
async function handleMyTask(task: JobTask): Promise<TaskOutput> {
  const result = await processData(task.input);

  return {
    // Handler-specific output
    processedData: result,
    timestamp: Date.now(),

    // Optional: Spawn children
    childTasks: [
      { service: "storage", command: "save", input: { data: result } }
    ]
  };
}
```

## Handler Interface

### Handler Contract

All task handlers must implement this signature:

```typescript
async function handlerName(task: JobTask): Promise<TaskOutput>
```

### Registration

Handlers are registered in `processTask()` function via switch statements:

```typescript
async function processTask(task: JobTask): Promise<Record<string, any>> {
  switch (task.service) {
    case "my-service":
      switch (task.command) {
        case "my-command":
          return await handleMyCommand(task);
        default:
          throw new Error(`Unsupported command: ${task.command}`);
      }
    default:
      throw new Error(`Unsupported service: ${task.service}`);
  }
}
```

### Handler Requirements

1. **Input validation**: Check `task.input` for required fields
2. **Error handling**: Throw errors for failures (caught by orchestrator)
3. **Return output**: Always return object (empty object `{}` is valid)
4. **Optional spawning**: Return `childTasks` array if needed

### Handler Template

```typescript
async function handleMyOperation(task: JobTask): Promise<TaskOutput> {
  // 1. Validate input
  const { requiredField, optionalField = "default" } = task.input || {};

  if (!requiredField) {
    throw new Error("Missing required field: requiredField");
  }

  // 2. Perform operation
  try {
    const result = await performOperation(requiredField, optionalField);

    // 3. Determine if children needed
    const needsFollowUp = checkCondition(result);

    // 4. Return output with optional children
    return {
      // Handler-specific output
      result: result,
      processed: true,

      // Optional: Spawn children conditionally
      ...(needsFollowUp && {
        childTasks: [
          {
            service: "follow-up-service",
            command: "follow-up-command",
            input: { data: result }
          }
        ]
      })
    };
  } catch (error: any) {
    // Errors are caught by orchestrator and mark task as failed
    throw new Error(`Operation failed: ${error.message}`);
  }
}
```

## Error Handling

### Error Types

All errors thrown from `processJob` are Firebase HttpsError:

```typescript
import * as functions from "firebase-functions/v1";

throw new functions.https.HttpsError(
  code,      // Error code (see below)
  message    // Human-readable message
);
```

### Error Codes

| Code | Meaning | When It Occurs |
|------|---------|---------------|
| `unauthenticated` | Not authenticated | No auth context |
| `permission-denied` | Not authorized | Not admin role |
| `invalid-argument` | Invalid input | Missing required fields, invalid formats |
| `deadline-exceeded` | Timeout | Execution time exceeded configured timeout |
| `internal` | Execution error | Task handler failures, unexpected exceptions |

### Error Responses

Clients receive error response:

```typescript
try {
  const result = await processJob({...});
} catch (error: any) {
  console.error("Error code:", error.code);
  console.error("Error message:", error.message);
  console.error("Error details:", error.details);
}
```

### Safety Error Messages

Safety mechanisms throw errors with detailed information:

**Task Limit**:
```
Task limit exceeded: 1000 tasks maximum.
Task 0-3-7 attempted to spawn child 0-3-7-0.
This may indicate a runaway AI or infinite loop.
```

**Depth Limit**:
```
Task depth limit exceeded: 10 levels maximum.
Task 0-1-2-3-4 attempted to spawn child at depth 6.
Child ID: 0-1-2-3-4-0
```

**Timeout**:
```
Job execution timeout: 300000ms limit exceeded.
Elapsed: 315420ms.
Completed 47/100 tasks.
```

**Cycle Detection**:
```
Circular dependencies detected: [["0","1","2","0"]]
```

**Deadlock**:
```
Deadlock detected: 3 tasks cannot execute.
Incomplete tasks: 5, 7, 9
```

**Invalid Dependency**:
```
Invalid dependency: Child task 0-0-1 depends on non-existent task 0-0-5.
Dependencies must reference existing tasks or siblings being spawned together.
```

## Firestore Schema

When `persist: true` is specified, jobs are saved to `/jobs` collection:

```typescript
{
  name: string;                     // Job name
  abortOnFailure: boolean;          // Abort flag
  status: "started" | "succeeded" | "failed";
  tasks: Array<{
    id: string;
    service: string;
    command: string;
    input: object;
    output: object;
    status: "started" | "succeeded" | "failed" | "aborted";
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

**Querying Jobs**:
```typescript
import * as admin from "firebase-admin";

const db = admin.firestore();

// Get all jobs
const jobs = await db.collection("jobs").get();

// Get succeeded jobs
const succeeded = await db.collection("jobs")
  .where("status", "==", "succeeded")
  .get();

// Get recent jobs
const recent = await db.collection("jobs")
  .orderBy("createdAt", "desc")
  .limit(10)
  .get();
```

## Performance Characteristics

### Time Complexity

| Operation | Complexity | Description |
|-----------|------------|-------------|
| Initialize graph | O(V + E) | V = tasks, E = dependencies |
| Get executable tasks | O(V) | Check each task's dependencies |
| Add node | O(1) | Constant time |
| Add edge | O(V + E) | Includes cycle detection |
| Validate cycles | O(V + E) | Graph traversal |
| Full job execution | O(I × V + S × C × (V + E)) | I = iterations, S = spawning tasks, C = children |

### Space Complexity

| Structure | Complexity | Description |
|-----------|------------|-------------|
| Task registry | O(V) | Map of all tasks |
| Graph structure | O(V + E) | Nodes and edges |
| Completed set | O(V) | Set of completed task IDs |

### Typical Performance

- **Small jobs** (10-50 tasks): <1 second
- **Medium jobs** (100-500 tasks): 2-10 seconds
- **Large jobs** (500-1000 tasks): 10-60 seconds
- **Firebase limit**: ~9 minutes maximum

## Next Steps

- **[Examples](./06-examples.md)**: Practical usage patterns
- **[Overview](./01-overview.md)**: High-level introduction
- **[Architecture](./02-architecture.md)**: System design details
