# Practical Examples

## Table of Contents

1. [Simple Sequential Workflow](#1-simple-sequential-workflow)
2. [Parallel Processing](#2-parallel-processing)
3. [AI-Driven Workflow](#3-ai-driven-workflow)
4. [Conditional Branching](#4-conditional-branching)
5. [Fan-Out / Fan-In Pattern](#5-fan-out--fan-in-pattern)
6. [Recursive Data Processing](#6-recursive-data-processing)
7. [Multi-Level Hierarchy](#7-multi-level-hierarchy)
8. [Error Handling Strategies](#8-error-handling-strategies)
9. [Batch Operations](#9-batch-operations)
10. [Complex Dependencies](#10-complex-dependencies)

---

## 1. Simple Sequential Workflow

### Scenario
Process data in three sequential steps: validate → transform → store.

### Implementation

**Client Code**:
```typescript
const result = await processJob({
  name: "sequential-workflow",
  tasks: [
    {
      id: "validate",
      service: "validator",
      command: "validate-data",
      input: { data: rawData }
    },
    {
      id: "transform",
      service: "transformer",
      command: "transform-data",
      dependsOn: ["validate"]
    },
    {
      id: "store",
      service: "firestore",
      command: "create-document",
      dependsOn: ["transform"]
    }
  ]
});
```

### Execution Flow

```
validate → transform → store
   ↓          ↓          ↓
  5s         3s         2s
Total: 10 seconds (sequential)
```

### Key Points
- Each task waits for previous to complete
- No parallelism (dependency chain)
- Simple, predictable execution order

---

## 2. Parallel Processing

### Scenario
Process multiple independent data chunks simultaneously.

### Implementation

**Client Code**:
```typescript
const chunks = splitDataIntoChunks(largeDataset, 10);

const result = await processJob({
  name: "parallel-processing",
  tasks: chunks.map((chunk, index) => ({
    id: `process-${index}`,
    service: "processor",
    command: "process-chunk",
    input: { chunk }
  }))
});
```

### Execution Flow

```
process-0 ────┐
process-1 ────┤
process-2 ────┼─→ All complete
process-3 ────┤
process-4 ────┘

Each: 5 seconds
Total: 5 seconds (parallel)
```

### Key Points
- All tasks run simultaneously
- Maximum throughput
- No dependencies between tasks

---

## 3. AI-Driven Workflow

### Scenario
AI analyzes data and determines next steps dynamically.

### Handler Implementation

```typescript
async function handleAIAnalysis(task: JobTask): Promise<TaskOutput> {
  // 1. Perform AI analysis
  const analysis = await callAI({
    prompt: `Analyze this data and suggest next steps: ${JSON.stringify(task.input.data)}`,
    model: "gpt-4"
  });

  // 2. Parse AI response
  const actions = parseAIResponse(analysis);

  // 3. Generate child tasks based on AI decision
  const childTasks: ChildTaskSpec[] = [];

  // AI decided to store results
  if (actions.store) {
    childTasks.push({
      service: "firestore",
      command: "create-document",
      input: {
        collection: "analysis_results",
        data: {
          original: task.input.data,
          analysis: analysis,
          timestamp: Date.now()
        }
      }
    });
  }

  // AI decided to send notification
  if (actions.notify) {
    childTasks.push({
      service: "messaging",
      command: "send-notification",
      input: {
        userId: task.input.userId,
        title: "Analysis Complete",
        message: actions.notificationMessage
      }
    });
  }

  // AI decided additional processing needed
  if (actions.needsMoreProcessing) {
    childTasks.push({
      service: "ai",
      command: "deep-analysis",
      input: {
        data: task.input.data,
        focusAreas: actions.focusAreas
      }
    });
  }

  return {
    analysis,
    actions,
    childTasks: childTasks.length > 0 ? childTasks : undefined
  };
}
```

**Client Code**:
```typescript
const result = await processJob({
  name: "ai-driven-workflow",
  maxTasks: 50,  // Allow AI to spawn many tasks
  tasks: [
    {
      service: "ai",
      command: "analyze",
      input: {
        data: complexData,
        userId: "user-123"
      }
    }
  ]
});
```

### Key Points
- Runtime-determined workflow
- AI controls task spawning
- Flexible, adaptive processing

---

## 4. Conditional Branching

### Scenario
Validate data and take different paths based on validation result.

### Handler Implementation

```typescript
async function handleValidateAndRoute(task: JobTask): Promise<TaskOutput> {
  const data = task.input.data;
  const validation = validateData(data);

  if (validation.isValid) {
    // Valid path: process and store
    return {
      validation,
      path: "valid",
      childTasks: [
        {
          service: "processor",
          command: "process-data",
          input: { data }
        },
        {
          service: "firestore",
          command: "create-document",
          input: {
            collection: "processed_data",
            data: data
          },
          dependsOn: ["0-0"]  // Wait for processing
        },
        {
          service: "messaging",
          command: "notify-success",
          input: { userId: task.input.userId },
          dependsOn: ["0-1"]  // Wait for storage
        }
      ]
    };
  } else {
    // Invalid path: log error and notify admin
    return {
      validation,
      path: "invalid",
      childTasks: [
        {
          service: "logging",
          command: "log-error",
          input: {
            level: "warning",
            message: "Data validation failed",
            errors: validation.errors
          }
        },
        {
          service: "messaging",
          command: "notify-admin",
          input: {
            subject: "Validation Failed",
            errors: validation.errors
          }
        }
      ]
    };
  }
}
```

**Client Code**:
```typescript
const result = await processJob({
  name: "conditional-workflow",
  tasks: [
    {
      service: "validator",
      command: "validate-and-route",
      input: {
        data: userData,
        userId: "user-123"
      }
    }
  ]
});

// Check which path was taken
const rootTask = result.tasks.find(t => t.id === "0");
console.log(`Took ${rootTask.output.path} path`);
```

### Key Points
- Runtime branching based on validation
- Different child tasks for different outcomes
- No code changes needed for different paths

---

## 5. Fan-Out / Fan-In Pattern

### Scenario
Process data chunks in parallel, then aggregate results.

### Handler Implementation

```typescript
async function handleProcessDataset(task: JobTask): Promise<TaskOutput> {
  const dataset = task.input.dataset;
  const chunkSize = 100;
  const chunks = [];

  // Split dataset into chunks
  for (let i = 0; i < dataset.length; i += chunkSize) {
    chunks.push(dataset.slice(i, i + chunkSize));
  }

  // Create child tasks for parallel processing
  const processingTasks = chunks.map((chunk, index) => ({
    service: "processor",
    command: "process-chunk",
    input: { chunk, index }
  }));

  // Create aggregation task that depends on all processing tasks
  const aggregationTask = {
    service: "aggregator",
    command: "combine-results",
    input: { totalChunks: chunks.length },
    dependsOn: chunks.map((_, i) => `${task.id}-${i}`)
  };

  return {
    chunkCount: chunks.length,
    childTasks: [...processingTasks, aggregationTask]
  };
}

async function handleAggregateResults(task: JobTask): Promise<TaskOutput> {
  // Collect results from parent
  const parentId = task.id.split("-").slice(0, -1).join("-");
  // In real implementation, you'd pass results through task registry

  return {
    aggregatedResult: "Combined results from all chunks",
    timestamp: Date.now()
  };
}
```

**Client Code**:
```typescript
const result = await processJob({
  name: "fan-out-fan-in",
  maxTasks: 1000,
  tasks: [
    {
      service: "processor",
      command: "process-dataset",
      input: {
        dataset: largeArray  // 1000 items
      }
    }
  ]
});

// Results show parallel processing + aggregation
console.log(`Processed ${result.tasks.length} tasks`);
```

### Execution Flow

```
Root
 ├─ Chunk 0 ─┐
 ├─ Chunk 1 ─┤
 ├─ Chunk 2 ─┼─→ Aggregator → Final Result
 ├─ Chunk 3 ─┤
 └─ Chunk 4 ─┘
```

### Key Points
- Parallel fan-out for speed
- Sequential fan-in for aggregation
- Scales with data size

---

## 6. Recursive Data Processing

### Scenario
Process nested data structure recursively.

### Handler Implementation

```typescript
async function handleRecursiveProcess(task: JobTask): Promise<TaskOutput> {
  const data = task.input.data;
  const maxChunkSize = 100;

  // Base case: data is small enough to process directly
  if (data.length <= maxChunkSize) {
    const result = await processDirectly(data);
    return { result };
  }

  // Recursive case: split and spawn children
  const midpoint = Math.floor(data.length / 2);
  const leftChunk = data.slice(0, midpoint);
  const rightChunk = data.slice(midpoint);

  return {
    splitPoint: midpoint,
    childTasks: [
      {
        service: "processor",
        command: "recursive-process",
        input: { data: leftChunk }
      },
      {
        service: "processor",
        command: "recursive-process",
        input: { data: rightChunk }
      },
      {
        service: "aggregator",
        command: "merge-results",
        input: { originalSize: data.length },
        dependsOn: [`${task.id}-0`, `${task.id}-1`]
      }
    ]
  };
}
```

**Client Code**:
```typescript
const result = await processJob({
  name: "recursive-processing",
  maxDepth: 10,  // Allow deep recursion
  maxTasks: 500,
  tasks: [
    {
      service: "processor",
      command: "recursive-process",
      input: {
        data: hugeDataset  // 10,000 items
      }
    }
  ]
});
```

### Execution Tree

```
                    Root (10000 items)
                    /              \
            (5000 items)        (5000 items)
              /    \              /    \
         (2500)  (2500)      (2500)  (2500)
          / \      / \        / \      / \
        ...  ...  ...  ...  ...  ...  ...  ...

Depth: log₂(10000/100) ≈ 7 levels
Tasks: ~200 tasks total
```

### Key Points
- Automatically adapts to data size
- Logarithmic depth
- Parallel processing at each level

---

## 7. Multi-Level Hierarchy

### Scenario
Build a complex workflow with multiple levels of child spawning.

### Handler Implementation

```typescript
// Level 0: Project coordinator
async function handleProjectStart(task: JobTask): Promise<TaskOutput> {
  const modules = task.input.modules;

  return {
    modules: modules.length,
    childTasks: modules.map((module: any) => ({
      service: "module",
      command: "process-module",
      input: { module }
    }))
  };
}

// Level 1: Module processor
async function handleProcessModule(task: JobTask): Promise<TaskOutput> {
  const module = task.input.module;
  const features = analyzeModule(module);

  return {
    featureCount: features.length,
    childTasks: features.map((feature: any) => ({
      service: "feature",
      command: "implement-feature",
      input: { feature }
    }))
  };
}

// Level 2: Feature implementer
async function handleImplementFeature(task: JobTask): Promise<TaskOutput> {
  const feature = task.input.feature;
  const tasks = breakDownFeature(feature);

  return {
    taskCount: tasks.length,
    childTasks: tasks.map((subtask: any) => ({
      service: "task",
      command: "execute-task",
      input: { task: subtask }
    }))
  };
}

// Level 3: Task executor
async function handleExecuteTask(task: JobTask): Promise<TaskOutput> {
  const subtask = task.input.task;
  const result = await executeSubtask(subtask);

  // Base case: no more children
  return {
    result,
    completed: true
  };
}
```

**Client Code**:
```typescript
const result = await processJob({
  name: "multi-level-project",
  maxDepth: 5,
  maxTasks: 500,
  tasks: [
    {
      service: "project",
      command: "start",
      input: {
        modules: [
          { name: "auth", features: ["login", "signup", "reset"] },
          { name: "dashboard", features: ["metrics", "charts"] },
          { name: "settings", features: ["profile", "preferences"] }
        ]
      }
    }
  ]
});
```

### Hierarchy

```
Project
├─ Module: auth
│  ├─ Feature: login
│  │  ├─ Task: validate
│  │  ├─ Task: authenticate
│  │  └─ Task: redirect
│  ├─ Feature: signup
│  │  ├─ Task: validate
│  │  ├─ Task: create-user
│  │  └─ Task: send-email
│  └─ Feature: reset
│     └─ ...
├─ Module: dashboard
│  └─ ...
└─ Module: settings
   └─ ...
```

### Key Points
- Natural decomposition of complex projects
- Each level adds detail
- Parallel execution at each level

---

## 8. Error Handling Strategies

### Scenario A: Fail Fast (abortOnFailure = true)

```typescript
const result = await processJob({
  name: "fail-fast",
  abortOnFailure: true,  // Default
  tasks: [
    { id: "0", service: "s1", command: "c1" },
    { id: "1", service: "s2", command: "c2" },
    { id: "2", service: "s3", command: "c3", dependsOn: ["1"] }
  ]
});

// If task 1 fails:
// - Task 0 completes normally
// - Task 1 marked as failed
// - Task 2 marked as aborted
// - Job status: failed
```

### Scenario B: Continue on Error (abortOnFailure = false)

```typescript
const result = await processJob({
  name: "continue-on-error",
  abortOnFailure: false,
  tasks: [
    { id: "0", service: "s1", command: "c1" },
    { id: "1", service: "s2", command: "c2" },  // Fails
    { id: "2", service: "s3", command: "c3" }   // Independent, continues
  ]
});

// If task 1 fails:
// - Task 0 completes normally
// - Task 1 marked as failed
// - Task 2 executes normally
// - Job status: failed (but partial success)
```

### Scenario C: Retry Logic

```typescript
async function handleWithRetry(task: JobTask): Promise<TaskOutput> {
  const maxRetries = 3;
  let attempt = 0;
  let lastError;

  while (attempt < maxRetries) {
    try {
      const result = await unstableOperation(task.input);
      return {
        result,
        attempts: attempt + 1
      };
    } catch (error: any) {
      lastError = error;
      attempt++;
      await sleep(1000 * attempt);  // Exponential backoff
    }
  }

  // All retries failed, spawn error handler
  return {
    failed: true,
    childTasks: [
      {
        service: "logging",
        command: "log-error",
        input: {
          error: lastError.message,
          attempts: maxRetries
        }
      }
    ]
  };
}
```

### Key Points
- Choose strategy based on requirements
- `abortOnFailure=true` for critical workflows
- `abortOnFailure=false` for best-effort processing
- Implement retry logic in handlers

---

## 9. Batch Operations

### Scenario
Delete 10,000 Firestore documents with proper batching.

### Handler Implementation

```typescript
async function handleBatchDelete(task: JobTask): Promise<TaskOutput> {
  const documentIds = task.input.documentIds;
  const batchSize = 500;  // Firebase batch limit

  if (documentIds.length <= batchSize) {
    // Base case: delete directly
    await batchDeleteDocuments(documentIds);
    return {
      deleted: documentIds.length
    };
  }

  // Recursive case: split into batches
  const batches = [];
  for (let i = 0; i < documentIds.length; i += batchSize) {
    batches.push(documentIds.slice(i, i + batchSize));
  }

  return {
    batchCount: batches.length,
    childTasks: batches.map((batch) => ({
      service: "firestore",
      command: "batch-delete",
      input: { documentIds: batch }
    }))
  };
}
```

**Client Code**:
```typescript
// Get all document IDs to delete
const snapshot = await db.collection("old_data").get();
const docIds = snapshot.docs.map(doc => doc.id);

const result = await processJob({
  name: "batch-delete-operation",
  maxTasks: 50,
  tasks: [
    {
      service: "firestore",
      command: "batch-delete",
      input: {
        documentIds: docIds  // 10,000 IDs
      }
    }
  ]
});

console.log(`Deleted across ${result.tasks.length} batches`);
```

### Key Points
- Respects Firebase batch limits
- Automatic splitting for large operations
- Parallel batch execution

---

## 10. Complex Dependencies

### Scenario
Build a data pipeline with complex dependency relationships.

```typescript
const result = await processJob({
  name: "complex-pipeline",
  tasks: [
    // Stage 1: Parallel data fetching
    { id: "fetch-users", service: "api", command: "fetch", input: { endpoint: "/users" } },
    { id: "fetch-posts", service: "api", command: "fetch", input: { endpoint: "/posts" } },
    { id: "fetch-comments", service: "api", command: "fetch", input: { endpoint: "/comments" } },

    // Stage 2: Transform (depends on fetch)
    {
      id: "transform-users",
      service: "transformer",
      command: "transform",
      dependsOn: ["fetch-users"]
    },
    {
      id: "transform-posts",
      service: "transformer",
      command: "transform",
      dependsOn: ["fetch-posts", "fetch-users"]  // Posts need user data
    },
    {
      id: "transform-comments",
      service: "transformer",
      command: "transform",
      dependsOn: ["fetch-comments", "fetch-posts"]  // Comments need post data
    },

    // Stage 3: Enrich (depends on transforms)
    {
      id: "enrich-posts",
      service: "enricher",
      command: "enrich",
      dependsOn: ["transform-posts", "transform-comments"]  // Add comment counts
    },

    // Stage 4: Store (depends on enrich)
    {
      id: "store-all",
      service: "firestore",
      command: "batch-write",
      dependsOn: ["transform-users", "enrich-posts", "transform-comments"]
    }
  ]
});
```

### Dependency Graph

```
       fetch-users ─────┬─────────> transform-users ────┐
                         │                               │
       fetch-posts ──────┼─────────> transform-posts ───┼───> enrich-posts ──┐
                         │               ↑               │                     │
       fetch-comments ───┴──────> transform-comments ───┴─────────────────────┼──> store-all
                                          ↑                                    │
                                          └────────────────────────────────────┘
```

### Execution Timeline

```
0s: fetch-users, fetch-posts, fetch-comments start (parallel)
2s: All fetches complete
2s: transform-users starts
2s: transform-posts waits for fetch-users (depends on both)
2s: transform-comments starts
3s: transform-users completes
3s: transform-posts now starts (dependencies met)
4s: transform-comments completes
5s: transform-posts completes
5s: enrich-posts starts
6s: enrich-posts completes
6s: store-all starts (all dependencies met)
7s: store-all completes

Total: 7 seconds (vs 21 seconds sequential)
```

### Key Points
- Maximum parallelism with complex dependencies
- Automatic optimization by graph orchestration
- Clear, declarative dependency specification

---

## Best Practices Summary

1. **Start Simple**: Begin with flat task lists, add complexity as needed
2. **Use Dependencies**: Let graph orchestration handle parallelism
3. **Spawn Strategically**: Only spawn children when logic demands it
4. **Set Limits**: Always configure `maxTasks`, `maxDepth`, `timeout`
5. **Handle Errors**: Choose appropriate `abortOnFailure` setting
6. **Test Limits**: Verify behavior when hitting safety limits
7. **Monitor Performance**: Log execution times and task counts
8. **Document Handlers**: Explain spawning logic and depth expectations

## Next Steps

- **[Overview](./01-overview.md)**: System introduction
- **[Task Spawning Guide](./03-task-spawning.md)**: Detailed spawning patterns
- **[Safety Mechanisms](./04-safety-mechanisms.md)**: Limits and validation
- **[API Reference](./05-api-reference.md)**: Complete API docs
