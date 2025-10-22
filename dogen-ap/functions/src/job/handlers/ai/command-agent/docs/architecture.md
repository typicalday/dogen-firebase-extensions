# Command Agent Architecture

## Handler Flow

### 1. Input Validation
```typescript
const input = task.input as CommandAgentInput;

// Validate input structure
if (!input?.id || !input?.service || !input?.command || !input?.prompt) {
  throw new Error("Invalid input: id, service, command, and prompt are required");
}
```

### 2. Schema Retrieval
```typescript
// Get full schema for the specific command from registry
const { systemInstruction, userPrompt, commandSchema } = buildCommandAgentPrompts(input);

// commandSchema contains:
// - properties: Full property definitions
// - required: Array of required parameter names
// - examples: Example inputs for the command
// - format constraints: Email patterns, phone formats, path patterns, etc.
```

### 3. AI Parameter Construction
```typescript
// Create Vertex AI model with structured output
const model = vertexAI.getGenerativeModel({
  model: "gemini-2.5-pro",
  generationConfig: {
    temperature: 0.2,  // Low temperature for precise construction
    responseSchema: buildPhase3ResponseSchema(input.service, input.command),
    responseMimeType: "application/json"
  },
  systemInstruction: systemInstruction  // ~2K tokens with full schema
});

// Call AI with user prompt containing command routing
const response = await model.generateContent({
  contents: [{ role: "user", parts: [{ text: userPrompt }] }]
});
```

### 4. Response Parsing
```typescript
const responseText = response.response.candidates[0].content.parts[0].text;
const commandAgentOutput = JSON.parse(responseText) as CommandAgentOutput;

// Type guard validation
if (!isCommandAgentOutput(commandAgentOutput)) {
  throw new Error("Invalid AI response format");
}
```

### 5. Ajv Schema Validation
```typescript
const ajv = new Ajv({ allErrors: true, verbose: true });

if (commandSchema) {
  const validate = ajv.compile(commandSchema);
  const valid = validate(commandAgentOutput.input);

  if (!valid) {
    // Format detailed error messages
    const errors = validate.errors
      ?.map(err => `${err.instancePath} ${err.message}`)
      .join('; ');
    throw new Error(`Parameter validation failed: ${errors}`);
  }
}
```

### 6. Plan Mode Decision
```typescript
if (context.planMode) {
  // In plan mode: Don't spawn child tasks
  return {
    output: commandAgentOutput,
    childTasks: []  // Empty array
  };
}

// In execution mode: Spawn actual command
const childTask = {
  id: commandAgentOutput.id,
  service: commandAgentOutput.service,
  command: commandAgentOutput.command,
  input: commandAgentOutput.input,
  dependsOn: commandAgentOutput.dependsOn.length > 0
    ? commandAgentOutput.dependsOn
    : undefined
};

return {
  output: commandAgentOutput,
  childTasks: [childTask]
};
```

## Parameter Construction Details

### System Instruction Structure

The AI receives a comprehensive system instruction (~2K tokens):

```markdown
## Command Schema
### Description
Create a Firestore document with the specified data

### Required Parameters
- **path** (string): Firestore path in format firestore/{database}/data/{collection}
- **documentId** (string): Document ID to create
- **data** (object): Document data to write

### Optional Parameters
- **merge** (boolean): Whether to merge with existing document

### JSON Schema
```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "pattern": "^firestore/[^/]+/data/[^/]+$"
    },
    "documentId": { "type": "string" },
    "data": { "type": "object" },
    "merge": { "type": "boolean" }
  },
  "required": ["path", "documentId", "data"]
}
```

### Examples
Example 1: Create user document
```json
{
  "path": "firestore/(default)/data/users",
  "documentId": "user-123",
  "data": {
    "name": "John Doe",
    "email": "john@example.com"
  }
}
```
```

### User Prompt Structure

The AI receives the command routing as JSON:

```json
{
  "id": "task-0",
  "service": "firestore",
  "command": "createDocument",
  "prompt": "Create a user document for John Doe with email john@example.com",
  "dependsOn": []
}
```

### AI Response Schema

The response schema is dynamically built based on the command:

```typescript
{
  type: SchemaType.OBJECT,
  properties: {
    id: { type: SchemaType.STRING },
    service: { type: SchemaType.STRING },
    command: { type: SchemaType.STRING },
    input: commandSchema.inputSchema,  // Dynamic based on command
    dependsOn: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING }
    }
  },
  required: ["id", "service", "command", "input", "dependsOn"]
}
```

## Validation Process

### Two-Layer Validation

#### Layer 1: Type Guard (Structure)
```typescript
export function isCommandAgentOutput(obj: any): obj is CommandAgentOutput {
  if (typeof obj !== 'object' || obj === null) return false;
  if (typeof obj.id !== 'string') return false;
  if (typeof obj.service !== 'string') return false;
  if (typeof obj.command !== 'string') return false;
  if (typeof obj.input !== 'object' || obj.input === null) return false;
  if (!Array.isArray(obj.dependsOn)) return false;

  for (const dep of obj.dependsOn) {
    if (typeof dep !== 'string') return false;
  }

  return true;
}
```

#### Layer 2: Ajv Schema Validation (Content)
```typescript
const validate = ajv.compile(commandSchema);
const valid = validate(commandAgentOutput.input);

// Ajv checks:
// - All required properties present
// - Property types match schema
// - Format patterns (email, phone, paths)
// - Enum constraints
// - Min/max length/value constraints
// - Array item schemas
// - Object property schemas
```

## Dependency Resolution

### Reference Syntax
```
{{taskId.output.field}}
```

### How It Works

1. **Command Agent**: Preserves reference as string
```typescript
{
  input: {
    uid: "{{task-0.output.uid}}"  // String reference
  }
}
```

2. **Job Execution System**: Resolves references before handler execution
```typescript
// Before handler execution:
const resolvedInput = resolveReferences(task.input, taskOutputs);

// After resolution:
{
  input: {
    uid: "actual-uid-from-task-0"  // Resolved value
  }
}
```

3. **Handler Receives**: Fully resolved parameters
```typescript
async function handleUpdateUser(task: JobTask, context: JobContext) {
  const { uid } = task.input;  // "actual-uid-from-task-0"
  // ... implementation
}
```

## Plan Mode Behavior

### Plan Mode Flow
```
1. Command Agent validates parameters ✓
2. Command Agent returns output ✓
3. Command Agent SKIPS spawning child task ✗
4. Task graph shows "planned" status
5. No actual execution occurs
```

### Execution Mode Flow
```
1. Command Agent validates parameters ✓
2. Command Agent returns output ✓
3. Command Agent spawns child task ✓
4. Job executor runs child task
5. Handler executes with resolved parameters
```

### Why Plan Mode?

Plan mode allows:
- **Preview**: See what commands would execute
- **Validation**: Check task graph before execution
- **Testing**: Test orchestration without side effects
- **Debugging**: Inspect parameters before execution

## Error Handling

### Common Validation Errors

#### Missing Required Parameter
```
Parameter validation failed: /email is required
```

#### Type Mismatch
```
Parameter validation failed: /port must be number
```

#### Format Violation
```
Parameter validation failed: /email must match pattern
```

#### Enum Constraint
```
Parameter validation failed: /status must be equal to one of the allowed values
```

### Error Recovery

Command Agent errors are terminal - they prevent command execution:

```typescript
try {
  // ... validation
} catch (error) {
  console.error(`[CommandAgent] Failed for task ${input.id}:`, error);
  throw new Error(`Command agent failed: ${error.message}`);
  // Job execution stops, user sees error
}
```

## Performance Characteristics

### Token Usage
- System Instruction: ~2K tokens (full schema for ONE command)
- User Prompt: ~200 tokens (command routing JSON)
- Response: ~500 tokens (constructed parameters)
- Total: ~2.7K tokens per command agent call

### Latency
- AI Call: 1-3 seconds (structured output with low temperature)
- Schema Validation: <10ms (Ajv is fast)
- Total: 1-3 seconds per command

### Optimization
- Low temperature (0.2) ensures consistent parameter construction
- Structured output reduces parsing errors
- Ajv validation catches errors before execution
- Plan mode allows validation without execution cost

## Integration Points

### Schema Catalog
```typescript
// src/job/handlers/ai/orchestrator-agent/catalogs/catalog-generator.ts
export function getCommandSchemaFromRegistry(
  service: string,
  command: string
): CommandSchemaInfo | undefined
```

### Handler Registry
```typescript
// src/job/registry.ts
export const HANDLER_REGISTRY: Record<string, HandlerInfo>
```

### Job Context
```typescript
interface JobContext {
  planMode: boolean;  // Command Agent checks this
  verbose: boolean;   // Command Agent logs if true
  // ... other fields
}
```

## Next Steps

- See [examples.md](./examples.md) for real-world parameter construction
- See handler implementations in `src/job/handlers/` for command details
- See `src/job/registry.ts` for complete handler registry
