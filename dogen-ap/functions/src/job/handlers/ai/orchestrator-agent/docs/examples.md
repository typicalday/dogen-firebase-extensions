# Orchestrator Agent Examples (Phase 1)

These examples show Phase 1 outputs only - service selection and task decomposition. Phase 2/3 (command selection and parameter construction) happen in separate handlers.

## Example 1: Simple Service Selection

**User Request**:
```typescript
{
  service: "ai",
  command: "orchestratorAgent",
  input: {
    prompt: "Copy the users collection to users_backup"
  }
}
```

**Phase 1 Output**:
```typescript
{
  childTasks: [
    {
      service: "ai",
      command: "serviceAgent",
      input: {
        id: "task-0",
        service: "firestore",
        prompt: "Copy the users collection to users_backup",
        dependencies: []
      }
    }
  ]
}
```

**What Happens Next** (Phase 2/3):
- Job system spawns `ai:serviceAgent` task
- Phase 2 selects `firestore/copy-collection` command
- Phase 3 constructs: `{ sourcePath: "firestore/(default)/data/users", destinationPath: "firestore/(default)/data/users_backup" }`

---

## Example 2: Multi-Service Workflow

**User Request**:
```typescript
{
  prompt: "Create an admin user and export all users to CSV"
}
```

**Phase 1 Output**:
```typescript
{
  childTasks: [
    {
      service: "ai",
      command: "serviceAgent",
      input: {
        id: "task-0",
        service: "authentication",
        prompt: "Create an admin user",
        dependencies: []
      }
    },
    {
      service: "ai",
      command: "serviceAgent",
      input: {
        id: "task-1",
        service: "firestore",
        prompt: "Export all users to CSV",
        dependencies: []
      }
    }
  ]
}
```

**Note**: Phase 1 identifies both services needed - authentication and firestore. Tasks run in parallel (no dependencies).

---

## Example 3: Sequential Dependencies

**User Request**:
```typescript
{
  prompt: "Copy users to backup, then export the backup to JSON"
}
```

**Phase 1 Output**:
```typescript
{
  childTasks: [
    {
      service: "ai",
      command: "serviceAgent",
      input: {
        id: "task-0",
        service: "firestore",
        prompt: "Copy users to backup",
        dependencies: []
      }
    },
    {
      service: "ai",
      command: "serviceAgent",
      input: {
        id: "task-1",
        service: "firestore",
        prompt: "Export the backup to JSON",
        dependencies: ["task-0"]
      }
    }
  ]
}
```

**Note**: Phase 1 understands the sequential relationship and encodes dependency: task-1 waits for task-0.

---

## Example 4: Parallel Execution

**User Request**:
```typescript
{
  prompt: "Export users and products collections to JSON in parallel"
}
```

**Phase 1 Output**:
```typescript
{
  childTasks: [
    {
      service: "ai",
      command: "serviceAgent",
      input: {
        id: "task-0",
        service: "firestore",
        prompt: "Export users collection to JSON",
        dependencies: []
      }
    },
    {
      service: "ai",
      command: "serviceAgent",
      input: {
        id: "task-1",
        service: "firestore",
        prompt: "Export products collection to JSON",
        dependencies: []
      }
    }
  ]
}
```

**Note**: No dependencies means parallel execution. Both tasks start immediately.

---

## Example 5: Multi-Stage Workflow

**User Request**:
```typescript
{
  prompt: "Create backup user, copy all users to backup collection, then clean up old storage files"
}
```

**Phase 1 Output**:
```typescript
{
  childTasks: [
    {
      service: "ai",
      command: "serviceAgent",
      input: {
        id: "task-0",
        service: "authentication",
        prompt: "Create backup user",
        dependencies: []
      }
    },
    {
      service: "ai",
      command: "serviceAgent",
      input: {
        id: "task-1",
        service: "firestore",
        prompt: "Copy all users to backup collection",
        dependencies: ["task-0"]
      }
    },
    {
      service: "ai",
      command: "serviceAgent",
      input: {
        id: "task-2",
        service: "storage",
        prompt: "Clean up old storage files",
        dependencies: ["task-1"]
      }
    }
  ]
}
```

**Note**: Phase 1 identifies 3 services and plans sequential execution: authentication → firestore → storage.

---

## What Phase 1 Doesn't Show

**No Command Details**:
```
Phase 1 doesn't specify:
- authentication/create-user (Phase 2 selects this)
- firestore/copy-collection (Phase 2 selects this)
- storage/delete-path (Phase 2 selects this)
```

**No Parameters**:
```
Phase 1 doesn't construct:
- { email: "backup@example.com", password: "..." } (Phase 3)
- { sourcePath: "...", destinationPath: "..." } (Phase 3)
- { path: "gs://bucket/old-files", limit: 100 } (Phase 3)
```

**No Schema Validation**:
```
Phase 1 doesn't validate:
- Email patterns
- Path formats
- Parameter types
- Required fields
```

---

## Complete 3-Phase Flow Example

```
1. Phase 1 (Orchestrator Agent):
   Input: "Copy users to backup"
   Output: {
     service: "firestore",
     prompt: "Copy users to backup",
     dependencies: []
   }

2. Phase 2 (Service Agent):
   Input: {
     service: "firestore",
     prompt: "Copy users to backup"
   }
   Output: {
     service: "firestore",
     command: "copy-collection",
     prompt: "Copy users to backup"
   }

3. Phase 3 (Command Agent):
   Input: {
     service: "firestore",
     command: "copy-collection",
     prompt: "Copy users to backup"
   }
   Output: {
     service: "firestore",
     command: "copy-collection",
     input: {
       sourcePath: "firestore/(default)/data/users",
       destinationPath: "firestore/(default)/data/users_backup"
     }
   }

4. Job System:
   Executes: firestore/copy-collection with validated parameters
```

---

## Key Takeaways

1. **Phase 1 is Strategic**: Decides "which services" not "which commands"
2. **Lightweight Context**: Only sees 4 services (~500 tokens), not 30+ commands (~8K tokens)
3. **Fast Planning**: 90% token reduction enables quick service-level planning
4. **Deferred Details**: Commands (Phase 2) and parameters (Phase 3) handled separately
5. **Progressive Refinement**: Each phase adds more detail and context
