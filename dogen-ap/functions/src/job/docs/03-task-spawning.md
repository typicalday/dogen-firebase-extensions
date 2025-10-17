# Dynamic Task Spawning Guide

## Overview

**Task spawning** is the ability for a running task to dynamically create child tasks based on its execution results. This enables AI-driven workflows, conditional branching, and data-driven task generation.

## Why Task Spawning?

### Problem

Traditional job systems require all tasks to be defined upfront. This doesn't work when:
- **AI determines next steps**: GPT analyzes data and decides what operations to perform
- **Data-driven workflows**: Number and type of tasks depend on runtime data
- **Conditional logic**: Different paths based on results
- **Decomposition**: Break large operations into parallel sub-tasks

### Solution

Tasks return a `childTasks` array in their output:

```typescript
return {
  analysis: "...",           // Normal output
  childTasks: [              // Spawn children
    { service: "firestore", command: "create-document", input: {...} },
    { service: "storage", command: "upload-file", input: {...} }
  ]
};
```

## Basic Spawning

### Handler Contract

Task handlers return `TaskOutput` which extends `Record<string, any>`:

```typescript
interface TaskOutput {
  [key: string]: any;              // Your custom output
  childTasks?: ChildTaskSpec[];    // Optional children
}

interface ChildTaskSpec {
  service: string;                  // Required
  command: string;                  // Required
  input?: Record<string, any>;      // Optional
  dependsOn?: string[];             // Optional dependencies
}
```

### Simple Example

```typescript
async function handleProcessInference(task: JobTask): Promise<TaskOutput> {
  // 1. Perform AI inference
  const result = await performInference(task.input.prompt);

  // 2. Decide what to do based on results
  const actions = analyzeResults(result);

  // 3. Spawn child tasks
  return {
    result: result,
    actions: actions,
    childTasks: [
      {
        service: "firestore",
        command: "create-document",
        input: {
          collection: "results",
          data: { result, timestamp: Date.now() }
        }
      },
      {
        service: "storage",
        command: "upload-file",
        input: {
          path: `results/${task.id}.json`,
          content: JSON.stringify(result)
        }
      }
    ]
  };
}
```

## Hierarchical Task IDs

### ID Generation

Children receive hierarchical IDs automatically:

```
Parent Task: "0"
  ├─ Child 0: "0-0"
  ├─ Child 1: "0-1"
  └─ Child 2: "0-2"
      ├─ Grandchild 0: "0-2-0"
      ├─ Grandchild 1: "0-2-1"
      └─ Grandchild 2: "0-2-2"
```

### ID Format

- **Root tasks**: Numeric strings (`"0"`, `"1"`, `"2"`) or custom (`"task-alpha"`)
- **Children**: Parent ID + `-` + index (`"0-0"`, `"task-alpha-0"`)
- **Depth-independent**: Custom IDs work seamlessly

## Dependencies Between Children

### Sibling Dependencies

Children can depend on each other when spawned together:

```typescript
childTasks: [
  {
    service: "firestore",
    command: "create-document",
    input: { collection: "users", data: {...} }
    // This becomes "0-0"
  },
  {
    service: "firestore",
    command: "create-document",
    input: { collection: "profiles", data: {...} },
    dependsOn: ["0-0"]  // Wait for sibling to complete
    // This becomes "0-1", waits for "0-0"
  }
]
```

### Two-Pass Validation

The system uses two-pass validation for sibling dependencies:

1. **First Pass**: Collect all child IDs that will be created
2. **Second Pass**: Validate each dependency is either:
   - An existing task in the graph, OR
   - A sibling being spawned in this operation

This allows children to reference siblings before they exist in the graph.

### Cross-Level Dependencies

Children can depend on tasks at any level:

```typescript
// Parent task "0" spawns:
childTasks: [
  {
    service: "step1",
    command: "process",
    // Becomes "0-0"
  },
  {
    service: "step2",
    command: "process",
    dependsOn: ["0-0", "1"]  // Depends on sibling AND uncle task "1"
    // Becomes "0-1"
  }
]
```

## Multi-Level Spawning

### Recursive Spawning

Children can spawn their own children:

```typescript
// Root task "0" spawns child "0-0"
// Child "0-0" spawns "0-0-0", "0-0-1"
// Grandchild "0-0-0" spawns "0-0-0-0", "0-0-0-1"
```

### Example: Recursive Data Processing

```typescript
async function handleProcessDataset(task: JobTask): Promise<TaskOutput> {
  const dataset = task.input.dataset;
  const chunkSize = 100;

  if (dataset.length <= chunkSize) {
    // Base case: process directly
    return {
      result: processChunk(dataset)
    };
  } else {
    // Recursive case: split and spawn children
    const chunks = splitIntoChunks(dataset, chunkSize);

    return {
      childTasks: chunks.map((chunk, index) => ({
        service: "data",
        command: "process-dataset",
        input: { dataset: chunk }
        // Children will recursively split if needed
      }))
    };
  }
}
```

## Depth Tracking

### Explicit Depth Field

Each task has an explicit `depth` field:
- Root tasks: `depth = 0`
- Children: `depth = parent.depth + 1`
- Independent of ID format

### Depth Limit Enforcement

When spawning children:

```typescript
// SAFETY CHECK 2: Depth limit
const depth = (task.depth ?? 0) + 1;
if (depth > job.maxDepth) {
  throw new Error(
    `Task depth limit exceeded: ${job.maxDepth} levels maximum. ` +
    `Task ${task.id} attempted to spawn child at depth ${depth}.`
  );
}
```

### Custom Depth Limits

```typescript
// Client can configure maxDepth per job
const result = await processJob({
  name: "deep-processing",
  maxDepth: 5,  // Allow 5 levels instead of default 10
  tasks: [...]
});
```

## Parallelism Strategies

### Independent Children (Parallel)

Default behavior - all children run in parallel:

```typescript
childTasks: [
  { service: "service1", command: "cmd1" },  // Runs immediately
  { service: "service2", command: "cmd2" },  // Runs immediately
  { service: "service3", command: "cmd3" }   // Runs immediately
]
```

### Sequential Children

Use dependencies to force order:

```typescript
childTasks: [
  { service: "step1", command: "cmd" },
  { service: "step2", command: "cmd", dependsOn: ["0-0"] },
  { service: "step3", command: "cmd", dependsOn: ["0-1"] }
]
```

### Fan-Out / Fan-In

Parallel processing with final aggregation:

```typescript
const parent = "0";  // Assuming this is the parent task ID

childTasks: [
  // Fan-out: Process chunks in parallel
  { service: "process", command: "chunk1" },  // 0-0
  { service: "process", command: "chunk2" },  // 0-1
  { service: "process", command: "chunk3" },  // 0-2

  // Fan-in: Aggregate after all complete
  {
    service: "aggregate",
    command: "combine",
    dependsOn: ["0-0", "0-1", "0-2"]  // 0-3, waits for all
  }
]
```

## AI-Driven Spawning

### Example: AI Decides Next Steps

```typescript
async function handleAIWorkflow(task: JobTask): Promise<TaskOutput> {
  // 1. Get AI recommendation
  const aiResponse = await callAI({
    prompt: task.input.prompt,
    context: task.input.context
  });

  // 2. Parse AI response for actions
  const actions = parseAIActions(aiResponse);

  // 3. Generate child tasks based on AI decision
  const childTasks: ChildTaskSpec[] = [];

  if (actions.shouldStoreResult) {
    childTasks.push({
      service: "firestore",
      command: "create-document",
      input: {
        collection: "ai_results",
        data: aiResponse
      }
    });
  }

  if (actions.shouldNotify) {
    childTasks.push({
      service: "messaging",
      command: "send-notification",
      input: {
        userId: task.input.userId,
        message: aiResponse.summary
      }
    });
  }

  if (actions.needsFollowUp) {
    childTasks.push({
      service: "ai",
      command: "process-inference",
      input: {
        prompt: actions.followUpPrompt,
        context: aiResponse
      }
    });
  }

  return {
    aiResponse,
    actions,
    childTasks: childTasks.length > 0 ? childTasks : undefined
  };
}
```

## Conditional Branching

### Example: Validation with Different Paths

```typescript
async function handleValidateAndProcess(task: JobTask): Promise<TaskOutput> {
  const data = task.input.data;
  const validation = validate(data);

  if (validation.isValid) {
    // Valid path: process and store
    return {
      validation,
      childTasks: [
        {
          service: "processor",
          command: "process-data",
          input: { data }
        },
        {
          service: "firestore",
          command: "create-document",
          input: { collection: "processed", data },
          dependsOn: ["0-0"]  // Wait for processing
        }
      ]
    };
  } else {
    // Invalid path: log error and notify
    return {
      validation,
      childTasks: [
        {
          service: "logging",
          command: "log-error",
          input: { errors: validation.errors }
        },
        {
          service: "messaging",
          command: "notify-admin",
          input: { errors: validation.errors }
        }
      ]
    };
  }
}
```

## Best Practices

### 1. Return Children in Output

Always include `childTasks` in the return value:

```typescript
// ✅ Good
return {
  result: data,
  childTasks: [...]
};

// ❌ Bad - won't be processed
this.spawnChildren([...]);  // No such method exists
```

### 2. Validate Before Spawning

Check limits and validity before returning children:

```typescript
const childSpecs = generateChildren(data);

if (childSpecs.length > 50) {
  throw new Error("Too many children - would exceed limits");
}

if (depth >= maxDepth - 1) {
  // Don't spawn at max depth
  return { result: data };
}

return { result: data, childTasks: childSpecs };
```

### 3. Use Meaningful IDs for Dependencies

When referencing dependencies, use parent context:

```typescript
// If this is task "0-0", children will be "0-0-0", "0-0-1", etc.
const parentId = task.id;  // "0-0"

return {
  childTasks: [
    { service: "step1", command: "cmd" },  // Will become "0-0-0"
    {
      service: "step2",
      command: "cmd",
      dependsOn: [`${parentId}-0`]  // Reference first child
    }
  ]
};
```

### 4. Limit Recursion Depth

Always have a base case for recursive spawning:

```typescript
if (task.depth >= 5 || data.length < threshold) {
  // Base case: don't spawn children
  return processDirectly(data);
}

// Recursive case: spawn children
return {
  childTasks: splitAndSpawn(data)
};
```

### 5. Handle Empty Child Arrays

The system handles empty/undefined `childTasks` gracefully:

```typescript
// All of these are valid:
return { result: data };                          // No children
return { result: data, childTasks: undefined };   // No children
return { result: data, childTasks: [] };          // No children
return { result: data, childTasks: [...] };       // With children
```

## Common Patterns

### Pattern 1: Transform and Store

```typescript
childTasks: [
  {
    service: "transformer",
    command: "transform",
    input: { data: raw Data }
  },
  {
    service: "firestore",
    command: "create-document",
    input: { collection: "results" },
    dependsOn: ["0-0"]
  }
]
```

### Pattern 2: Parallel Processing with Aggregation

```typescript
const chunks = splitData(data, chunkSize);

childTasks: [
  // Process all chunks in parallel
  ...chunks.map(chunk => ({
    service: "processor",
    command: "process-chunk",
    input: { chunk }
  })),
  // Aggregate after all complete
  {
    service: "aggregator",
    command: "combine",
    dependsOn: chunks.map((_, i) => `${task.id}-${i}`)
  }
]
```

### Pattern 3: Conditional Chaining

```typescript
childTasks: [
  {
    service: "validator",
    command: "validate"
  },
  {
    service: "processor",
    command: "process",
    dependsOn: ["0-0"]  // Only if validation succeeds
  },
  {
    service: "notifier",
    command: "notify",
    dependsOn: ["0-1"]  // Only if processing succeeds
  }
]
```

## Troubleshooting

### Error: "Task limit exceeded"

**Cause**: Spawned too many total tasks (exceeds `maxTasks`).

**Solution**:
- Reduce fanout (spawn fewer children)
- Increase `maxTasks` in job config
- Process in batches instead of spawning all at once

### Error: "Depth limit exceeded"

**Cause**: Too many levels of nesting (exceeds `maxDepth`).

**Solution**:
- Add base case to stop recursion earlier
- Increase `maxDepth` in job config
- Flatten hierarchy by spawning grandchildren as direct children

### Error: "Invalid dependency"

**Cause**: Child references non-existent task ID.

**Solution**:
- Ensure dependency ID exists in graph OR is a sibling
- Use correct ID format (`"0-0"`, not `"0_0"`)
- Reference dependencies before spawning dependent children

### Error: "Circular dependencies detected"

**Cause**: Children create a cycle (A depends on B, B depends on A).

**Solution**:
- Review dependency graph
- Ensure DAG structure (no cycles)
- Check sibling dependencies for circular references

## Next Steps

- **[Safety Mechanisms](./04-safety-mechanisms.md)**: Understanding limits and validation
- **[API Reference](./05-api-reference.md)**: Complete API documentation
- **[Examples](./06-examples.md)**: More practical usage patterns
