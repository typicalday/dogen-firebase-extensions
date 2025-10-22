# Service Agent Architecture

**Phase 2: Command Selection Within Service**

## System Overview

The Service Agent is a focused AI component that operates within a single service domain. It receives a service-specific sub-task and selects the most appropriate command to execute.

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Phase 1: Orchestrator Agent                                     │
│ - Decomposes user request into service-specific sub-tasks       │
│ - Assigns service to each sub-task                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
        ┌─────────────────────────────────────────┐
        │ ServiceAgentInput                       │
        │ {                                       │
        │   id: "task-0",                         │
        │   service: "firestore",                 │
        │   prompt: "Create doc in restaurants",  │
        │   dependsOn: []                         │
        │ }                                       │
        └─────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 2: Service Agent (THIS COMPONENT)                         │
│                                                                  │
│ 1. buildServiceAgentPrompts(input)                              │
│    - Get command catalog for input.service                      │
│    - Build system instruction with commands                     │
│    - Build user prompt with input JSON                          │
│                                                                  │
│ 2. Call Vertex AI with prompts + schema                         │
│    - Model: gemini-2.5-pro                                      │
│    - Temperature: 0.2 (precise selection)                       │
│    - Response schema: PHASE2_RESPONSE_SCHEMA                    │
│                                                                  │
│ 3. Parse and validate response                                  │
│    - Extract JSON from response                                 │
│    - Validate with isServiceAgentOutput()                       │
│                                                                  │
│ 4. Create commandAgent child task                               │
│    - Service: "ai"                                              │
│    - Command: "commandAgent"                                    │
│    - Input: ServiceAgentOutput                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
        ┌─────────────────────────────────────────┐
        │ ServiceAgentOutput                      │
        │ {                                       │
        │   id: "task-0",                         │
        │   service: "firestore",                 │
        │   command: "create-document",           │
        │   prompt: "Create doc at path...",      │
        │   dependsOn: []                         │
        │ }                                       │
        └─────────────────────────────────────────┘
                              ↓
        ┌─────────────────────────────────────────┐
        │ Child Task: ai:commandAgent             │
        │ {                                       │
        │   id: "task-0",                         │
        │   service: "ai",                        │
        │   command: "commandAgent",              │
        │   input: ServiceAgentOutput             │
        │ }                                       │
        └─────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 3: Command Agent                                          │
│ - Constructs parameters for the selected command                │
│ - Validates against command schema                              │
│ - Creates actual service task (firestore:create-document)       │
└─────────────────────────────────────────────────────────────────┘
```

## Handler Flow

### 1. Input Validation

```typescript
// handler.ts:44-47
if (!input?.id || !input?.service || !input?.prompt) {
  throw new Error("Invalid input: id, service, and prompt are required");
}
```

**Validates**:
- `id` exists (task identifier)
- `service` exists (service name)
- `prompt` exists (refined prompt from orchestrator)

### 2. Prompt Construction

```typescript
// handler.ts:75
const { systemInstruction, userPrompt } = buildServiceAgentPrompts(input);
```

**System Instruction** (prompts.ts:17-149):
```
You are a service command selector that chooses the appropriate command
within the {service} service to accomplish a given task.

Your responsibilities:
1. Command Matching: Select the most appropriate command for the sub-task's goal
2. Parameter Identification: Determine which parameters will be needed
3. Prompt Refinement: Create command-specific prompt with parameter hints
4. Validation: Ensure selected command can accomplish the goal
5. Edge Case Handling: Choose between similar commands when multiple options exist

## Available Commands for {service} Service

### {command-1}
**Description**: {description}
**Required Parameters**: {params}
**Optional Parameters**: {params}
---

### {command-2}
...
```

**User Prompt** (prompts.ts:155-157):
```json
{
  "id": "task-0",
  "service": "firestore",
  "prompt": "Create a document in the 'restaurants' collection...",
  "dependsOn": []
}
```

### 3. AI Call with Structured Output

```typescript
// handler.ts:82-90
const model = vertexAI.getGenerativeModel({
  model: "gemini-2.5-pro",
  generationConfig: {
    temperature: 0.2,
    responseSchema: PHASE2_RESPONSE_SCHEMA,
    responseMimeType: "application/json"
  },
  systemInstruction
});
```

**Response Schema** (schema.ts:15-43):
```typescript
{
  type: SchemaType.OBJECT,
  properties: {
    id: { type: SchemaType.STRING },
    service: { type: SchemaType.STRING },
    command: { type: SchemaType.STRING },
    prompt: { type: SchemaType.STRING },
    dependsOn: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING }
    }
  },
  required: ["id", "service", "command", "prompt", "dependsOn"]
}
```

### 4. Response Validation

```typescript
// handler.ts:103-108
const responseText = response.response.candidates[0].content.parts[0].text;
const serviceAgentOutput = JSON.parse(responseText) as ServiceAgentOutput;

if (!isServiceAgentOutput(serviceAgentOutput)) {
  throw new Error("Invalid AI response format");
}
```

**Type Guard** (schema.ts:48-62):
- Validates object structure
- Checks all required fields exist
- Validates dependsOn is string array
- Returns boolean type assertion

### 5. Child Task Creation

```typescript
// handler.ts:117-130
const childTask = {
  id: serviceAgentOutput.id,
  service: "ai",
  command: "commandAgent",
  input: {
    id: serviceAgentOutput.id,
    service: serviceAgentOutput.service,
    command: serviceAgentOutput.command,
    prompt: serviceAgentOutput.prompt,
    dependsOn: serviceAgentOutput.dependsOn
  },
  dependsOn: serviceAgentOutput.dependsOn.length > 0
    ? serviceAgentOutput.dependsOn
    : undefined
};
```

**Output**:
```typescript
{
  output: ServiceAgentOutput,
  childTasks: [commandAgentTask]
}
```

## Command Catalog Integration

### Catalog Structure

```typescript
// command-catalogs.ts:10-18
export interface CommandInfo {
  command: string;
  description: string;
  requiredParams: string[];
  optionalParams: string[];
}

export type ServiceCommandCatalog = Record<string, CommandInfo>;
```

### Catalog Access

```typescript
// prompts.ts:32
const commands = getServiceCommands(service);
```

**getServiceCommands** returns array of CommandInfo for ONE service:
```typescript
[
  {
    command: "create-document",
    description: "Create a single document",
    requiredParams: ["path", "documentData"],
    optionalParams: []
  },
  {
    command: "create-documents-batch",
    description: "Create multiple documents",
    requiredParams: ["collectionPath", "documentsData"],
    optionalParams: []
  },
  // ... more commands for this service
]
```

### Catalog Generation

Command catalogs are auto-generated from HANDLER_REGISTRY to ensure sync between:
- Available handlers
- Phase 2 command selection
- Phase 3 parameter construction

**See**: orchestrator-agent/catalogs/README.md for generation details

## Error Handling

### Input Validation Errors

```typescript
// handler.ts:44-47
if (!input?.id || !input?.service || !input?.prompt) {
  throw new Error("Invalid input: id, service, and prompt are required");
}
```

### Missing Command Catalog

```typescript
// prompts.ts:34-36
if (commands.length === 0) {
  throw new Error(`No commands found for service: ${service}`);
}
```

### AI Call Timeout

```typescript
// handler.ts:93-99
await Promise.race([
  model.generateContent({...}),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`AI call timeout after ${timeout}ms`)), timeout)
  )
])
```

### Invalid Response Format

```typescript
// handler.ts:106-108
if (!isServiceAgentOutput(serviceAgentOutput)) {
  throw new Error("Invalid AI response format");
}
```

All errors are caught and re-thrown with context:
```typescript
// handler.ts:141-144
catch (error: any) {
  console.error(`[ServiceAgent] Failed for task ${input.id}:`, error);
  throw new Error(`Service agent failed: ${error.message}`);
}
```

## Configuration

### Temperature

```typescript
const DEFAULT_TEMPERATURE = 0.2;
```

**Rationale**: Low temperature (0.2) ensures:
- Precise command selection
- Consistent behavior
- Minimal hallucination
- Predictable outputs

### Timeout

```typescript
const DEFAULT_TIMEOUT = 60000; // 60 seconds
```

**Rationale**: Balance between:
- Allowing sufficient time for AI processing
- Preventing hung requests
- User experience (Phase 2 is middle of 3-phase flow)

### Model Selection

```typescript
model: "gemini-2.5-pro"
```

**Rationale**:
- Best balance of speed and accuracy
- Excellent structured output support
- Handles command catalog context well
- Cost-effective for Phase 2 scope

## Token Optimization

### Context Size by Service

**Average Service** (~1,500 tokens):
- System instruction: ~1,200 tokens
  - Role description: ~200 tokens
  - 10-15 commands × 80 tokens each: ~1,000 tokens
- User prompt: ~200 tokens
- Response: ~100 tokens

**Large Service** (firestore: ~2,000 tokens):
- More commands (20+)
- More complex descriptions

**Small Service** (authentication: ~1,000 tokens):
- Fewer commands (5-10)
- Simpler operations

### Optimization Strategies

1. **Service Scoping**: Only include commands for ONE service
   - Orchestrator already chose service (Phase 1)
   - No need to see all 30+ commands across all services

2. **Minimal Descriptions**: Command info includes:
   - Description: 1-2 sentences
   - Required params: List only
   - Optional params: List only
   - NO full schemas
   - NO examples (examples in system instruction)

3. **Structured Output**: JSON schema forces precise format
   - No verbose explanations
   - No markdown formatting
   - Just data

## Testing Considerations

### Unit Tests
- Prompt building with different services
- Response validation with edge cases
- Error handling for invalid inputs

### Integration Tests
- End-to-end with real AI calls
- Command catalog integration
- Child task creation

### Mock Data
```typescript
const mockInput: ServiceAgentInput = {
  id: "test-task",
  service: "firestore",
  prompt: "Create a document",
  dependsOn: []
};
```

## Performance Metrics

**Target Performance**:
- AI call: < 5 seconds
- Total execution: < 6 seconds
- Token usage: ~1,500 tokens per request

**Actual Performance** (observed):
- AI call: 2-4 seconds
- Total execution: 2.5-4.5 seconds
- Token usage: 1,200-2,000 tokens depending on service

## Next Steps

- See README.md for quick start and examples
- See command-agent docs for Phase 3 details
- See orchestrator-agent docs for Phase 1 details
