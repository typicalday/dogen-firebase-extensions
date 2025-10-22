# Command Agent Examples

## Example 1: Simple Firestore Document Creation

### Input (from Service Agent)
```json
{
  "id": "task-0",
  "service": "firestore",
  "command": "createDocument",
  "prompt": "Create a user document for Alice with email alice@example.com and age 30",
  "dependsOn": []
}
```

### AI Context (System Instruction)
```markdown
## firestore/createDocument

### Required Parameters
- **path** (string): Firestore path (firestore/{database}/data/{collection})
- **documentId** (string): Document ID
- **data** (object): Document data

### JSON Schema
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "pattern": "^firestore/[^/]+/data/[^/]+$"
    },
    "documentId": { "type": "string" },
    "data": { "type": "object" }
  },
  "required": ["path", "documentId", "data"]
}
```

### Output (Command Agent)
```json
{
  "id": "task-0",
  "service": "firestore",
  "command": "createDocument",
  "input": {
    "path": "firestore/(default)/data/users",
    "documentId": "user-alice",
    "data": {
      "name": "Alice",
      "email": "alice@example.com",
      "age": 30,
      "createdAt": "2024-01-01T00:00:00Z"
    }
  },
  "dependsOn": []
}
```

### Validation
```typescript
// Ajv validates:
// ✓ path matches pattern
// ✓ documentId is string
// ✓ data is object
// ✓ All required fields present
```

## Example 2: Command with Dependencies

### Input (from Service Agent)
```json
{
  "id": "task-1",
  "service": "authentication",
  "command": "updateUser",
  "prompt": "Set admin role for the user created in task-0",
  "dependsOn": ["task-0"]
}
```

### Output (Command Agent)
```json
{
  "id": "task-1",
  "service": "authentication",
  "command": "updateUser",
  "input": {
    "uid": "{{task-0.output.uid}}",
    "claims": {
      "admin": true
    }
  },
  "dependsOn": ["task-0"]
}
```

### Reference Resolution (Job Executor)
```typescript
// Before execution:
{
  uid: "{{task-0.output.uid}}"  // Reference
}

// After resolution (task-0 output: { uid: "abc123" }):
{
  uid: "abc123"  // Resolved value
}
```

## Example 3: Complex Validation with Enums

### Input
```json
{
  "id": "task-2",
  "service": "storage",
  "command": "uploadFile",
  "prompt": "Upload user avatar as PNG with public read access",
  "dependsOn": []
}
```

### Schema Constraints
```json
{
  "type": "object",
  "properties": {
    "path": { "type": "string" },
    "contentType": {
      "type": "string",
      "enum": ["image/png", "image/jpeg", "image/gif", "application/pdf"]
    },
    "acl": {
      "type": "string",
      "enum": ["private", "public-read", "authenticated-read"]
    }
  },
  "required": ["path", "contentType"]
}
```

### Output
```json
{
  "id": "task-2",
  "service": "storage",
  "command": "uploadFile",
  "input": {
    "path": "storage/avatars/user-avatar.png",
    "contentType": "image/png",
    "acl": "public-read"
  },
  "dependsOn": []
}
```

### Validation
```typescript
// Ajv validates:
// ✓ contentType is in enum ["image/png", "image/jpeg", ...]
// ✓ acl is in enum ["private", "public-read", ...]
// ✗ Would fail if contentType = "image/svg" (not in enum)
```

## Example 4: Format Validation (Email, Phone)

### Input
```json
{
  "id": "task-3",
  "service": "authentication",
  "command": "createUser",
  "prompt": "Create user Bob with email bob@example.com and phone +1234567890",
  "dependsOn": []
}
```

### Schema Constraints
```json
{
  "type": "object",
  "properties": {
    "email": {
      "type": "string",
      "pattern": "^[^@]+@[^@]+\\.[^@]+$"
    },
    "phoneNumber": {
      "type": "string",
      "pattern": "^\\+[1-9]\\d{1,14}$"
    }
  }
}
```

### Output
```json
{
  "id": "task-3",
  "service": "authentication",
  "command": "createUser",
  "input": {
    "email": "bob@example.com",
    "phoneNumber": "+1234567890"
  },
  "dependsOn": []
}
```

### Validation
```typescript
// Ajv validates:
// ✓ email matches email pattern
// ✓ phoneNumber matches E.164 format (+1234567890)
// ✗ Would fail if email = "invalid" (no @)
// ✗ Would fail if phoneNumber = "1234567890" (missing +)
```

## Example 5: Nested Objects and Arrays

### Input
```json
{
  "id": "task-4",
  "service": "firestore",
  "command": "createDocument",
  "prompt": "Create a blog post with title 'Hello World', content 'My first post', and tags ['tech', 'tutorial']",
  "dependsOn": []
}
```

### Schema
```json
{
  "type": "object",
  "properties": {
    "path": { "type": "string" },
    "documentId": { "type": "string" },
    "data": {
      "type": "object",
      "properties": {
        "title": { "type": "string" },
        "content": { "type": "string" },
        "tags": {
          "type": "array",
          "items": { "type": "string" }
        },
        "metadata": {
          "type": "object",
          "properties": {
            "author": { "type": "string" },
            "publishedAt": { "type": "string" }
          }
        }
      }
    }
  }
}
```

### Output
```json
{
  "id": "task-4",
  "service": "firestore",
  "command": "createDocument",
  "input": {
    "path": "firestore/(default)/data/posts",
    "documentId": "post-hello-world",
    "data": {
      "title": "Hello World",
      "content": "My first post",
      "tags": ["tech", "tutorial"],
      "metadata": {
        "author": "system",
        "publishedAt": "2024-01-01T00:00:00Z"
      }
    }
  },
  "dependsOn": []
}
```

### Validation
```typescript
// Ajv validates:
// ✓ data is object
// ✓ tags is array of strings
// ✓ metadata is object with correct properties
// ✓ All nested types match schema
```

## Example 6: Plan Mode vs Execution Mode

### Plan Mode (context.planMode = true)
```typescript
// Command Agent validates and returns output
{
  output: {
    id: "task-0",
    service: "firestore",
    command: "createDocument",
    input: { /* validated parameters */ }
  },
  childTasks: []  // No child tasks spawned
}

// Logs:
// [CommandAgent] Plan mode: Not spawning actual command firestore/createDocument
// [CommandAgent] Command would be executed with parameters: {...}
```

### Execution Mode (context.planMode = false)
```typescript
// Command Agent validates, returns output, AND spawns child
{
  output: {
    id: "task-0",
    service: "firestore",
    command: "createDocument",
    input: { /* validated parameters */ }
  },
  childTasks: [{
    id: "task-0",
    service: "firestore",
    command: "createDocument",
    input: { /* validated parameters */ },
    dependsOn: undefined
  }]
}

// Logs:
// [CommandAgent] Spawning firestore:createDocument childTask
```

## Example 7: Validation Error

### Input
```json
{
  "id": "task-5",
  "service": "authentication",
  "command": "createUser",
  "prompt": "Create user with invalid email 'notanemail'",
  "dependsOn": []
}
```

### AI Output (Invalid)
```json
{
  "id": "task-5",
  "service": "authentication",
  "command": "createUser",
  "input": {
    "email": "notanemail"  // ✗ Doesn't match email pattern
  },
  "dependsOn": []
}
```

### Validation Error
```typescript
// Ajv validation fails:
throw new Error(
  "Parameter validation failed: /email must match pattern"
);

// Command Agent catches and throws:
throw new Error(
  "Command agent failed: Parameter validation failed: /email must match pattern"
);

// Job execution stops, user sees error
```

## Example 8: Multi-Step Workflow

### Task Graph
```json
[
  {
    "id": "task-0",
    "service": "authentication",
    "command": "createUser",
    "prompt": "Create user Charlie with email charlie@example.com"
  },
  {
    "id": "task-1",
    "service": "firestore",
    "command": "createDocument",
    "prompt": "Create user profile document for Charlie",
    "dependsOn": ["task-0"]
  },
  {
    "id": "task-2",
    "service": "authentication",
    "command": "updateUser",
    "prompt": "Set premium role for Charlie",
    "dependsOn": ["task-0"]
  }
]
```

### Command Agent Outputs

#### Task 0 (No Dependencies)
```json
{
  "id": "task-0",
  "service": "authentication",
  "command": "createUser",
  "input": {
    "email": "charlie@example.com",
    "password": "auto-generated-password"
  },
  "dependsOn": []
}
```

#### Task 1 (Depends on Task 0)
```json
{
  "id": "task-1",
  "service": "firestore",
  "command": "createDocument",
  "input": {
    "path": "firestore/(default)/data/profiles",
    "documentId": "{{task-0.output.uid}}",  // Reference
    "data": {
      "name": "Charlie",
      "email": "{{task-0.output.email}}"  // Reference
    }
  },
  "dependsOn": ["task-0"]
}
```

#### Task 2 (Depends on Task 0)
```json
{
  "id": "task-2",
  "service": "authentication",
  "command": "updateUser",
  "input": {
    "uid": "{{task-0.output.uid}}",  // Reference
    "claims": {
      "premium": true
    }
  },
  "dependsOn": ["task-0"]
}
```

### Execution Order
```
1. task-0 executes (no dependencies)
   → Output: { uid: "abc123", email: "charlie@example.com" }

2. task-1 and task-2 execute in parallel (both depend only on task-0)
   → task-1 input after resolution: { documentId: "abc123", data: { email: "charlie@example.com" } }
   → task-2 input after resolution: { uid: "abc123", claims: { premium: true } }
```

## Key Takeaways

1. **Command Agent ONLY constructs parameters** - it doesn't execute commands
2. **Ajv validation catches errors early** - before spawning child tasks
3. **Plan mode allows preview** - see what would execute without side effects
4. **References are preserved as strings** - job executor resolves them before handler execution
5. **Schema constraints are enforced** - type, format, enum, pattern, min/max all validated
6. **Low temperature (0.2) ensures consistency** - parameters are constructed precisely
7. **Error messages are detailed** - Ajv provides exact validation failures
