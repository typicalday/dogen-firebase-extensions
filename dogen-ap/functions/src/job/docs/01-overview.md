# Job Orchestration System - Overview

## Introduction

The Job Orchestration System is a sophisticated task execution framework built on Firebase Cloud Functions that enables **dynamic, graph-based parallel task execution** with **runtime-determined child task spawning**. It's designed for complex workflows where the next steps are determined by AI or other runtime logic.

## Core Concepts

### Job
A **Job** is a named collection of tasks with execution parameters:
- **Name**: Human-readable identifier
- **Tasks**: Array of tasks to execute
- **Execution Mode**: Sequential dependencies or parallel execution
- **Safety Limits**: Configurable bounds (maxTasks, maxDepth, timeout)
- **Persistence**: Optional state persistence to Firestore

### Task
A **Task** is an atomic unit of work with:
- **Service**: The service domain (e.g., "firestore", "ai", "storage", "authentication")
- **Command**: The specific operation (e.g., "create-document", "process-inference")
- **Input**: Parameters for the operation
- **Output**: Results and optional child tasks
- **Status**: Lifecycle state (started, succeeded, failed, aborted)
- **Dependencies**: Optional array of task IDs that must complete first

### Task Graph
The system uses a **Directed Acyclic Graph (DAG)** to manage task dependencies:
- **Nodes**: Individual tasks
- **Edges**: Dependency relationships (A must complete before B)
- **Parallel Execution**: Tasks with no dependencies or met dependencies run concurrently
- **Dynamic Mutation**: Graph can be extended during execution via child spawning

## Key Features

### 1. Dynamic Child Task Spawning
Tasks can spawn child tasks during execution based on runtime logic:
```typescript
// AI inference task spawns a write task based on results
{
  service: "ai",
  command: "process-inference",
  input: { prompt: "Analyze this data..." }
}
// Returns:
{
  analysis: "...",
  childTasks: [
    {
      service: "firestore",
      command: "create-document",
      input: { collection: "results", data: {...} }
    }
  ]
}
```

### 2. Dependency-Based Orchestration
Tasks declare dependencies via `dependsOn` array:
```typescript
{
  id: "task-2",
  service: "storage",
  command: "upload-file",
  dependsOn: ["task-0", "task-1"]  // Waits for both tasks
}
```

### 3. Parallel Execution
Tasks with met dependencies execute concurrently using `Promise.all()`:
- Maximizes throughput
- Reduces total execution time
- Safe concurrent spawning via mutex protection

### 4. Comprehensive Safety Mechanisms
- **Task Limit** (`maxTasks`): Prevents runaway spawning (default: 1000)
- **Depth Limit** (`maxDepth`): Prevents infinite recursion (default: 10)
- **Execution Timeout**: Configurable time limit (optional)
- **Cycle Detection**: Prevents circular dependencies
- **Deadlock Detection**: Catches execution stalls

### 5. Hierarchical Task IDs
Tasks use hierarchical string IDs for clarity:
- Root tasks: `"0"`, `"1"`, `"2"`
- Children: `"0-0"`, `"0-1"`, `"0-2"`
- Grandchildren: `"0-0-0"`, `"0-0-1"`
- Supports custom IDs: `"task-alpha"`, `"my-custom-id"`

### 6. Explicit Depth Tracking
Each task tracks its depth in the hierarchy:
- Root tasks: `depth = 0`
- Children: `depth = parent.depth + 1`
- Independent of ID format (supports custom IDs)

## Execution Flow

```
1. Client submits job with initial tasks
2. System creates task graph with initial nodes
3. Main execution loop begins:
   a. Check timeout (if configured)
   b. Get executable tasks (dependencies met)
   c. Detect deadlock if no tasks ready but incomplete tasks remain
   d. Execute ready tasks in parallel
   e. Process task outputs
   f. Spawn child tasks if specified (with validation)
   g. Add children to graph dynamically
   h. Validate no cycles created
   i. Mark tasks complete
   j. Repeat until all tasks complete
4. Return job results with all task outputs
```

## Use Cases

### AI-Driven Workflows
```
User Request → AI Analysis → [
  Write to Firestore,
  Upload to Storage,
  Send Notification
] (determined by AI)
```

### Multi-Step Data Processing
```
Fetch Data → [
  Transform A → Write A,
  Transform B → Write B,
  Transform C → Write C
] (parallel transforms)
```

### Conditional Pipelines
```
Validate Input → {
  if valid: Process → Store → Notify
  if invalid: Log Error → Notify Admin
} (runtime branching)
```

### Batch Operations with Dependencies
```
[
  Delete Old Data,
  Migrate Schema
] → Import New Data → Verify → Notify
```

## Architecture Principles

1. **Graph-Based Orchestration**: Use DAG for dependency management
2. **Fail-Fast**: Detect issues immediately (cycles, depth limits, invalid dependencies)
3. **Defense-in-Depth**: Multiple safety layers (validation, limits, error detection)
4. **Runtime Flexibility**: Allow dynamic task generation based on results
5. **Parallelism**: Maximize concurrent execution where safe
6. **Explicit Over Implicit**: Depth and dependencies are explicitly tracked
7. **Immutable History**: Task state transitions are recorded with timestamps

## Performance Characteristics

- **Concurrency**: O(width) where width = max parallel tasks at any level
- **Cycle Detection**: O(V + E) per edge addition
- **Deadlock Detection**: O(V) per iteration
- **Memory**: O(V + E) where V = tasks, E = dependencies
- **Typical Job**: <100 tasks, completes in <10 seconds
- **Maximum Job**: 1000 tasks (configurable), ~9 minutes (Firebase limit)

## Next Steps

- **[Architecture](./02-architecture.md)**: Deep dive into components and design
- **[Task Spawning](./03-task-spawning.md)**: How to spawn children effectively
- **[Safety Mechanisms](./04-safety-mechanisms.md)**: Understanding limits and validation
- **[API Reference](./05-api-reference.md)**: Complete API documentation
- **[Examples](./06-examples.md)**: Practical usage patterns
