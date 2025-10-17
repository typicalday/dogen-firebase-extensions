# Job Orchestration System - Documentation

## Overview

The **Job Orchestration System** is a sophisticated task execution framework built on Firebase Cloud Functions that enables dynamic, graph-based parallel task execution with runtime-determined child task spawning. Perfect for AI-driven workflows, data pipelines, and complex multi-step operations.

## Key Features

- **Dynamic Task Spawning**: Tasks can create children based on runtime logic (AI decisions, data analysis, conditional branching)
- **Graph-Based Dependencies**: Declare task dependencies for automatic parallel execution
- **Safety Mechanisms**: Multiple layers of protection (task limits, depth limits, cycle detection, deadlock detection, timeout enforcement)
- **Thread-Safe**: Concurrent child spawning with mutex protection
- **Flexible**: Supports custom IDs, conditional workflows, recursive processing
- **Production-Ready**: Comprehensive error handling, Firestore persistence, detailed logging

## Quick Start

### Basic Example

```typescript
import { processJob } from "./src/job/processJob";

const result = await processJob({
  name: "my-first-job",
  tasks: [
    {
      service: "firestore",
      command: "create-document",
      input: {
        collection: "users",
        data: { name: "Alice", age: 30 }
      }
    }
  ]
});

console.log(`Job completed with status: ${result.status}`);
```

### With Dependencies

```typescript
const result = await processJob({
  name: "pipeline",
  tasks: [
    {
      id: "fetch",
      service: "api",
      command: "fetch-data",
      input: { endpoint: "/data" }
    },
    {
      id: "process",
      service: "processor",
      command: "transform",
      dependsOn: ["fetch"]  // Waits for fetch to complete
    },
    {
      id: "store",
      service: "firestore",
      command: "create-document",
      dependsOn: ["process"]  // Waits for process to complete
    }
  ]
});
```

### With Child Spawning

```typescript
// Handler that spawns children
async function handleAIAnalysis(task: JobTask): Promise<TaskOutput> {
  const analysis = await performAnalysis(task.input.data);

  return {
    analysis,
    childTasks: [
      {
        service: "firestore",
        command: "create-document",
        input: { collection: "results", data: analysis }
      },
      {
        service: "messaging",
        command: "send-notification",
        input: { userId: task.input.userId, message: "Analysis complete" }
      }
    ]
  };
}
```

### With Safety Limits

```typescript
const result = await processJob({
  name: "large-operation",
  maxTasks: 500,        // Limit total tasks (default: 1000)
  maxDepth: 5,          // Limit hierarchy depth (default: 10)
  timeout: 300000,      // 5 minute timeout (default: none)
  abortOnFailure: true, // Stop on first error (default: true)
  persist: true,        // Save to Firestore (default: false)
  tasks: [...]
});
```

## Documentation Structure

### 1. [Overview](./01-overview.md)
Introduction to the system, core concepts, and use cases.

**Topics**:
- What is the Job Orchestration System
- Core concepts (Job, Task, Task Graph)
- Key features overview
- Execution flow
- Common use cases
- Architecture principles

**Start here if**: You're new to the system and want a high-level understanding.

---

### 2. [Architecture](./02-architecture.md)
Deep dive into system components, design decisions, and technical details.

**Topics**:
- Core classes (`Job`, `JobTask`, `TaskGraph`)
- Type definitions (`ChildTaskSpec`, `TaskOutput`)
- Main orchestration logic (`processJob`)
- Execution architecture
- Child spawning process
- Thread safety mechanisms
- Persistence layer
- Error handling
- Performance characteristics

**Start here if**: You want to understand how the system works internally or need to modify the core implementation.

---

### 3. [Task Spawning Guide](./03-task-spawning.md)
Comprehensive guide to dynamic child task spawning.

**Topics**:
- Why task spawning
- Basic spawning patterns
- Hierarchical task IDs
- Dependencies between children
- Multi-level spawning
- Depth tracking
- Parallelism strategies
- AI-driven spawning
- Conditional branching
- Best practices
- Common patterns
- Troubleshooting

**Start here if**: You need to implement handlers that spawn children or build dynamic workflows.

---

### 4. [Safety Mechanisms](./04-safety-mechanisms.md)
Understanding limits, validation, and safety features.

**Topics**:
- Task limit (`maxTasks`)
- Depth limit (`maxDepth`)
- Execution timeout
- Cycle detection
- Dependency validation
- Deadlock detection
- Race condition protection
- Input validation
- Error messages
- Safety recommendations

**Start here if**: You want to understand safety features, set appropriate limits, or troubleshoot safety errors.

---

### 5. [API Reference](./05-api-reference.md)
Complete API documentation for all classes, methods, and types.

**Topics**:
- `processJob()` function
- `Job` class
- `JobTask` class
- `TaskGraph` class
- Type definitions
- Handler interface
- Error handling
- Firestore schema
- Performance characteristics

**Start here if**: You need detailed API documentation or are implementing handlers.

---

### 6. [Examples](./06-examples.md)
Practical examples and usage patterns.

**Topics**:
- Simple sequential workflow
- Parallel processing
- AI-driven workflow
- Conditional branching
- Fan-out / Fan-in pattern
- Recursive data processing
- Multi-level hierarchy
- Error handling strategies
- Batch operations
- Complex dependencies

**Start here if**: You want to see practical examples and copy-paste starting points.

---

## Common Scenarios

### "I want to build an AI-driven workflow"
1. Read [Overview](./01-overview.md) for concepts
2. Read [Task Spawning Guide](./03-task-spawning.md) section on AI-driven spawning
3. Check [Examples](./06-examples.md) - AI-Driven Workflow example
4. Review [Safety Mechanisms](./04-safety-mechanisms.md) for appropriate limits

### "I need to process large datasets in parallel"
1. Read [Overview](./01-overview.md) for parallel execution concepts
2. Check [Examples](./06-examples.md) - Fan-Out/Fan-In and Recursive Processing examples
3. Review [Safety Mechanisms](./04-safety-mechanisms.md) for maxTasks configuration
4. See [Task Spawning Guide](./03-task-spawning.md) for batching strategies

### "I want to implement conditional logic"
1. Read [Task Spawning Guide](./03-task-spawning.md) - Conditional Branching section
2. Check [Examples](./06-examples.md) - Conditional Branching example
3. Review [API Reference](./05-api-reference.md) - Handler Interface

### "I'm getting safety limit errors"
1. Check error message details
2. Read [Safety Mechanisms](./04-safety-mechanisms.md) for the specific limit
3. Review [Task Spawning Guide](./03-task-spawning.md) - Best Practices
4. Adjust limits in job configuration

### "I want to understand how the system works internally"
1. Read [Architecture](./02-architecture.md) - full technical details
2. Review [API Reference](./05-api-reference.md) for implementation details
3. Check source code with documentation as reference

### "I need to debug a complex workflow"
1. Review [Safety Mechanisms](./04-safety-mechanisms.md) - Error Messages
2. Check [Task Spawning Guide](./03-task-spawning.md) - Troubleshooting
3. Use [API Reference](./05-api-reference.md) to understand task states
4. See [Examples](./06-examples.md) for similar patterns

## Feature Matrix

| Feature | Supported | Configuration | Default |
|---------|-----------|---------------|---------|
| Dynamic child spawning | ✅ | Handler return value | - |
| Dependency-based execution | ✅ | `dependsOn` array | - |
| Parallel execution | ✅ | Automatic | - |
| Task limit enforcement | ✅ | `maxTasks` | 1000 |
| Depth limit enforcement | ✅ | `maxDepth` | 10 |
| Execution timeout | ✅ | `timeout` (ms) | None |
| Cycle detection | ✅ | Automatic | - |
| Deadlock detection | ✅ | Automatic | - |
| Race condition protection | ✅ | Automatic | - |
| Custom task IDs | ✅ | `id` field | Auto-generated |
| Hierarchical IDs | ✅ | Automatic | - |
| Explicit depth tracking | ✅ | Automatic | - |
| Abort on failure | ✅ | `abortOnFailure` | true |
| Firestore persistence | ✅ | `persist` | false |
| Authentication required | ✅ | Admin role | - |

## Testing

The system includes comprehensive test coverage (133 tests):

```bash
# Run all job tests
npm run test:job

# Test categories:
# - Basic orchestration (53 tests)
# - Full integration (13 tests)
# - Cycle detection (23 tests)
# - Sibling dependencies (23 tests)
# - Explicit depth tracking (8 tests)
# - Client-configurable limits (11 tests)
# - Deadlock detection (1 test)
# - Integration tests (7 tests)
```

## Performance Characteristics

| Job Size | Task Count | Typical Duration | Recommendations |
|----------|------------|------------------|-----------------|
| Small | 10-50 | <1 second | Default settings |
| Medium | 100-500 | 2-10 seconds | Consider timeout |
| Large | 500-1000 | 10-60 seconds | Set timeout <8min |
| Enterprise | 1000+ | - | Split into multiple jobs |

**Firebase Limits**:
- Maximum function execution: ~9 minutes
- Recommended timeout: <480000ms (8 minutes)
- Memory: Standard function limits apply

## Project Structure

```
src/job/
├── docs/
│   ├── README.md                  # This file
│   ├── 01-overview.md             # Introduction and concepts
│   ├── 02-architecture.md         # Technical architecture
│   ├── 03-task-spawning.md        # Child spawning guide
│   ├── 04-safety-mechanisms.md    # Safety features
│   ├── 05-api-reference.md        # Complete API docs
│   └── 06-examples.md             # Practical examples
├── job.ts                         # Job class
├── jobTask.ts                     # JobTask class
├── taskGraph.ts                   # TaskGraph class
├── types.ts                       # Type definitions
├── processJob.ts                  # Main orchestration
└── handlers/                      # Task handlers
    ├── firestore/                 # Firestore operations
    ├── storage/                   # Storage operations
    ├── ai/                        # AI operations
    └── authentication/            # Auth operations
```

## Version Information

**Current Version**: 1.0.0

**Dependencies**:
- `firebase-functions`: ^6.3.2
- `firebase-admin`: ^13.1.0
- `graphlib`: ^2.1.8
- `async-mutex`: ^0.5.0

**TypeScript**: 5.7.3

## Support and Contributing

### Getting Help

1. Check documentation (start with [Overview](./01-overview.md))
2. Review [Examples](./06-examples.md) for similar patterns
3. Check error messages against [Safety Mechanisms](./04-safety-mechanisms.md)
4. Review [API Reference](./05-api-reference.md) for detailed specs

### Reporting Issues

When reporting issues, include:
- Job configuration (name, limits, tasks)
- Error messages (full text)
- Task outputs (if available)
- Expected vs actual behavior
- Relevant handler code

### Best Practices

1. **Start Simple**: Begin with basic workflows, add complexity gradually
2. **Test Limits**: Verify behavior when hitting safety limits
3. **Monitor Performance**: Log execution times and task counts
4. **Document Handlers**: Explain spawning logic and depth expectations
5. **Set Appropriate Limits**: Use conservative limits initially
6. **Handle Errors**: Choose appropriate `abortOnFailure` setting
7. **Use Dependencies**: Let graph orchestration handle parallelism

## License

Internal project - see project root for license information.

---

## Quick Links

- [Overview](./01-overview.md) - Start here for introduction
- [Architecture](./02-architecture.md) - System design and components
- [Task Spawning](./03-task-spawning.md) - Dynamic child spawning
- [Safety Mechanisms](./04-safety-mechanisms.md) - Limits and validation
- [API Reference](./05-api-reference.md) - Complete API documentation
- [Examples](./06-examples.md) - Practical usage patterns

---

**Documentation Version**: 1.0.0
**Last Updated**: 2025-01-17
