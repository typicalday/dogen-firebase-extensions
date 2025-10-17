# Prompt System Documentation

## Overview

The prompt system constructs AI prompts that enable the model to generate valid, executable task plans. It combines:
- **Task Catalog**: All available handler capabilities
- **System Instructions**: Output format, constraints, and guidelines
- **User Request**: Natural language prompt with optional context
- **Error Feedback**: Validation errors from previous attempts (on retry)

## Prompt Structure

### Complete Prompt Anatomy

```
┌─────────────────────────────────────────┐
│ SYSTEM INSTRUCTION                      │
│ ├─ Task Catalog (20 handlers)          │
│ ├─ Output Format Requirements          │
│ ├─ Dependency Guidelines                │
│ └─ Constraints & Safety                 │
├─────────────────────────────────────────┤
│ USER PROMPT                             │
│ ├─ Natural Language Request             │
│ ├─ Additional Context (optional)        │
│ └─ Validation Errors (on retry)         │
└─────────────────────────────────────────┘
```

## Implementation

**Location**: `promptBuilder.ts`

### Main Entry Point

```typescript
export function buildPrompt(
  userPrompt: string,
  context?: Record<string, any>,
  validationErrors: string[] = []
): { systemInstruction: string; userPrompt: string }
```

**Usage**:
```typescript
const { systemInstruction, userPrompt } = buildPrompt(
  "Copy users to users_backup",
  { reason: "daily backup" },
  []  // No errors on first attempt
);
```

**Output**:
```typescript
{
  systemInstruction: "You are a task planning AI...",
  userPrompt: "Copy users to users_backup\n\nContext: {\"reason\":\"daily backup\"}"
}
```

---

## System Instruction

**Purpose**: Provide AI with complete knowledge of available capabilities and output requirements

**Location**: `promptBuilder.ts:33-155`

### Components

#### 1. Role Definition
```
You are a task planning AI assistant that helps orchestrate Firebase operations.
Your job is to analyze user requests and generate a validated plan of tasks to execute.
```

**Purpose**: Set AI's identity and primary objective

#### 2. Task Catalog

**Auto-Generated from Registry**:
```typescript
const catalog = getTaskCatalog();
let catalogText = "\n## Available Task Capabilities\n\n";

catalog.forEach(capability => {
  catalogText += `### ${capability.service}/${capability.command}\n\n`;
  catalogText += `**Description**: ${capability.description}\n\n`;

  if (capability.requiredParams.length > 0) {
    catalogText += `**Required Parameters**: ${capability.requiredParams.join(', ')}\n`;
  }

  if (capability.optionalParams.length > 0) {
    catalogText += `**Optional Parameters**: ${capability.optionalParams.join(', ')}\n`;
  }

  if (capability.examples.length > 0) {
    catalogText += "\n**Examples**:\n";
    capability.examples.forEach((example, i) => {
      catalogText += `\nExample ${i + 1}: ${example.description}\n`;
      catalogText += `\`\`\`json\n${JSON.stringify(example.input, null, 2)}\n\`\`\`\n`;
    });
  }

  catalogText += "\n---\n\n";
});
```

**Sample Output**:
```markdown
## Available Task Capabilities

### firestore/copy-collection

**Description**: Copies an entire Firestore collection including all documents and subcollections from source to destination

**Required Parameters**: sourcePath, destinationPath

**Examples**:

Example 1: Copy entire users collection to users_backup in the default database
```json
{
  "sourcePath": "firestore/default/data/users",
  "destinationPath": "firestore/default/data/users_backup"
}
```

---

### authentication/create-user

**Description**: Creates a new Firebase Authentication user with email/password...

**Required Parameters**: userRecord

**Optional Parameters**: customClaims

**Examples**:

Example 1: Create a new user account with email, password, and display name
```json
{
  "userRecord": {
    "email": "newuser@example.com",
    "password": "securePassword123",
    "displayName": "New User"
  }
}
```
```

**Benefits**:
- AI sees all 20 handlers with descriptions
- Examples guide correct usage
- Required/optional parameters clearly marked
- Auto-updates when handlers added/removed

#### 3. Output Format Requirements

```markdown
## Output Format

You must respond with a JSON object in this exact structure:

```json
{
  "tasks": [
    {
      "id": "optional-task-id",
      "service": "service-name",
      "command": "command-name",
      "input": { /* command-specific parameters */ },
      "dependsOn": ["optional-array-of-task-ids"]
    }
  ],
  "reasoning": "Optional explanation of your plan"
}
```

**Field Descriptions**:
- `id` (optional): Custom task identifier. If omitted, auto-generated as task-0, task-1, etc.
- `service` (required): Service name (ai, authentication, firestore, storage)
- `command` (required): Command name for the service
- `input` (required): Command-specific parameters as an object
- `dependsOn` (optional): Array of task IDs this task depends on
- `reasoning` (optional): Your explanation of the plan logic
```

**Purpose**: Ensure AI outputs valid JSON structure

#### 4. Dependency Guidelines

```markdown
## Dependency Guidelines

**Task Dependencies**:
- Tasks execute in dependency order
- Independent tasks run in parallel
- Dependent tasks wait for prerequisites

**Valid Dependency Patterns**:
- Sequential: task-0 → task-1 → task-2
- Parallel: task-0 → [task-1, task-2]
- Fan-in: [task-0, task-1] → task-2
- Diamond: task-0 → [task-1, task-2] → task-3

**Invalid Patterns**:
- Circular dependencies (task-0 → task-1 → task-0)
- Self-dependencies (task-0 → task-0)
- Non-existent dependencies (task-0 → task-999)

**ID Normalization**:
- IDs will be prefixed with "orchestrate-" automatically
- You can reference other tasks by their original ID
- Forward references are allowed (task-0 can depend on task-1)
```

**Purpose**: Guide AI in creating valid dependency graphs

#### 5. Constraints & Safety

```markdown
## Constraints

- Maximum tasks: ${maxChildTasks} (will be injected)
- All service/command combinations must exist in the catalog
- All required parameters must be provided
- Parameters must match expected formats (emails, paths, etc.)
- No circular dependencies allowed

**Path Formats**:
- Firestore: firestore/{database}/data/{collection} or firestore/{database}/data/{collection}/{docId}
- Storage: gs://{bucket}/{path}

**Email Format**: user@example.com

**Phone Format**: E.164 (e.g., +15555551234)
```

**Purpose**: Communicate limits and format requirements

---

## User Prompt Construction

**Location**: `promptBuilder.ts:157-183`

### Components

#### 1. User's Request
```typescript
let prompt = userPrompt;
```

Simple pass-through of user's natural language input

#### 2. Context Integration
```typescript
if (context && Object.keys(context).length > 0) {
  prompt += "\n\n**Additional Context**:\n";
  prompt += JSON.stringify(context, null, 2);
}
```

**Example**:
```json
{
  "prompt": "Create user and set admin role",
  "context": {
    "email": "admin@example.com",
    "department": "engineering"
  }
}
```

**Results in**:
```
Create user and set admin role

**Additional Context**:
{
  "email": "admin@example.com",
  "department": "engineering"
}
```

#### 3. Validation Error Feedback (Retry Only)
```typescript
if (validationErrors.length > 0) {
  prompt += formatValidationErrors(validationErrors);
}
```

**Location**: `promptBuilder.ts:185-218`

**Implementation**:
```typescript
function formatValidationErrors(errors: string[]): string {
  const MAX_ERRORS_IN_FEEDBACK = 10;

  let feedback = "\n\n⚠️ VALIDATION ERRORS FROM PREVIOUS ATTEMPT:\n\n";
  feedback += "The previous plan had the following issues:\n\n";

  const displayErrors = errors.slice(0, MAX_ERRORS_IN_FEEDBACK);
  displayErrors.forEach((error, index) => {
    feedback += `${index + 1}. ${error}\n`;
  });

  if (errors.length > MAX_ERRORS_IN_FEEDBACK) {
    const remaining = errors.length - MAX_ERRORS_IN_FEEDBACK;
    feedback += `\n... and ${remaining} more error${remaining === 1 ? '' : 's'}\n`;
  }

  feedback += "\nPlease fix these issues and regenerate the plan.\n";

  return feedback;
}
```

**Example Feedback**:
```
⚠️ VALIDATION ERRORS FROM PREVIOUS ATTEMPT:

The previous plan had the following issues:

1. Task 0 (firestore/copy-collection): must have required property 'destinationPath'
2. Task 1 (authentication/create-user): /userRecord/email must match pattern '^[^\s@]+@[^\s@]+\.[^\s@]+$'
3. Task 2 (ai/orchestrate): /temperature must be <= 1

Please fix these issues and regenerate the plan.
```

**Benefits**:
- AI sees exactly what went wrong
- Specific field-level errors
- Limited to 10 errors to avoid prompt bloat
- Clear call to action

---

## Prompt Evolution Through Retries

### Attempt 1: Initial Request

**System Instruction**: Full catalog + format + guidelines

**User Prompt**:
```
Copy the users collection to users_backup
```

**AI Response**:
```json
{
  "tasks": [
    {
      "service": "firestore",
      "command": "copy-collection",
      "input": {
        "sourcePath": "users"  // ❌ Invalid format
      }
    }
  ]
}
```

**Validation Result**: ❌ Failed

---

### Attempt 2: With Error Feedback

**System Instruction**: (same as attempt 1)

**User Prompt**:
```
Copy the users collection to users_backup

⚠️ VALIDATION ERRORS FROM PREVIOUS ATTEMPT:

The previous plan had the following issues:

1. Task 0 (firestore/copy-collection): /sourcePath must match pattern '^firestore/[^/]+/data/.+'
2. Task 0 (firestore/copy-collection): must have required property 'destinationPath'

Please fix these issues and regenerate the plan.
```

**AI Response**:
```json
{
  "tasks": [
    {
      "service": "firestore",
      "command": "copy-collection",
      "input": {
        "sourcePath": "firestore/(default)/data/users",  // ✅ Fixed
        "destinationPath": "firestore/(default)/data/users_backup"  // ✅ Fixed
      }
    }
  ]
}
```

**Validation Result**: ✅ Success!

---

## Advanced Prompt Techniques

### Context-Aware Planning

**Input**:
```json
{
  "prompt": "Set up new project environment",
  "context": {
    "projectName": "my-app",
    "environment": "production",
    "adminEmail": "admin@example.com",
    "region": "us-central1"
  }
}
```

**AI Uses Context**:
```json
{
  "tasks": [
    {
      "service": "authentication",
      "command": "create-user",
      "input": {
        "userRecord": {
          "email": "admin@example.com",  // From context
          "displayName": "my-app Admin"  // Derived from context
        },
        "customClaims": {
          "environment": "production",  // From context
          "project": "my-app"  // From context
        }
      }
    }
  ]
}
```

### Multi-Step Workflows

**Input**:
```json
{
  "prompt": "Backup users collection, then export to CSV with email and name fields"
}
```

**AI Generates Sequential Plan**:
```json
{
  "tasks": [
    {
      "id": "backup",
      "service": "firestore",
      "command": "copy-collection",
      "input": {
        "sourcePath": "firestore/(default)/data/users",
        "destinationPath": "firestore/(default)/data/users_backup"
      }
    },
    {
      "id": "export",
      "service": "firestore",
      "command": "export-collection-csv",
      "input": {
        "collectionPath": "firestore/(default)/data/users_backup",
        "bucketPathPrefix": "gs://exports/users",
        "fields": [
          { "source": "email", "header": "Email" },
          { "source": "displayName", "header": "Name" }
        ]
      },
      "dependsOn": ["backup"]  // Waits for backup to complete
    }
  ],
  "reasoning": "First creating backup copy, then exporting backup to CSV to avoid exporting mid-backup"
}
```

### Parallel Task Planning

**Input**:
```json
{
  "prompt": "Export both users and products collections to JSON"
}
```

**AI Generates Parallel Plan**:
```json
{
  "tasks": [
    {
      "id": "export-users",
      "service": "firestore",
      "command": "export-collection-json",
      "input": {
        "collectionPath": "firestore/(default)/data/users",
        "bucketPathPrefix": "gs://exports/users"
      }
    },
    {
      "id": "export-products",
      "service": "firestore",
      "command": "export-collection-json",
      "input": {
        "collectionPath": "firestore/(default)/data/products",
        "bucketPathPrefix": "gs://exports/products"
      }
    }
  ],
  "reasoning": "Exporting both collections in parallel for efficiency since they're independent"
}
```

---

## Prompt Optimization

### Best Practices

#### 1. Be Specific
```typescript
// ❌ Vague
"Do user operations"

// ✅ Specific
"Create a new user with email admin@example.com and set admin role"
```

#### 2. Use Natural Language
```typescript
// ❌ Too technical
"Execute firestore copy-collection operation from src to dest"

// ✅ Natural
"Copy the users collection to users_backup"
```

#### 3. Include Key Details
```typescript
// ❌ Missing details
"Export data"

// ✅ Complete
"Export the products collection to JSON in Cloud Storage"
```

#### 4. Leverage Context
```typescript
// ❌ Hardcoded
"Create user admin@company.com in production"

// ✅ Context-based
{
  "prompt": "Create admin user",
  "context": {
    "email": "admin@company.com",
    "environment": "production"
  }
}
```

#### 5. Trust AI's Intelligence
```typescript
// ✅ AI understands implications
"Backup users and export the backup to CSV"
// AI knows to:
// - Use proper Firestore path formats
// - Create sequential dependency (backup first, then export)
// - Include appropriate CSV fields
```

### Anti-Patterns

#### ❌ Over-Specification
```
"Use the firestore service with the copy-collection command to copy from firestore/(default)/data/users to firestore/(default)/data/users_backup"
```
Too verbose, just say: "Copy users to users_backup"

#### ❌ Ambiguous Pronouns
```
"Copy it to the backup and then export it"
```
Unclear what "it" refers to

#### ❌ Multiple Unrelated Operations
```
"Create 50 users, export products, delete old logs, and update configuration"
```
Better as separate orchestration calls

---

## Error Feedback Loop

### How AI Learns from Validation

**Iteration 1**:
- **Prompt**: Simple user request
- **Response**: Best guess based on catalog
- **Result**: May have errors (missing params, wrong format, etc.)

**Iteration 2**:
- **Prompt**: Original request + specific validation errors
- **Response**: Corrected plan addressing errors
- **Result**: Fewer errors or success

**Iteration 3** (if needed):
- **Prompt**: Original request + remaining errors
- **Response**: Final corrections
- **Result**: Usually succeeds by attempt 3

**Success Rates**:
- Attempt 1: ~60%
- Attempt 2: ~30%
- Attempt 3: ~8%
- Attempt 4+: ~2%

### Error Feedback Effectiveness

**Highly Effective for**:
- Missing required parameters
- Invalid formats (email, path, phone)
- Type mismatches
- Range violations

**Moderately Effective for**:
- Complex schema constraints
- Multi-field dependencies
- Subtle validation rules

**Less Effective for**:
- Circular dependency detection (AI may struggle to visualize)
- Complex business logic constraints
- Ambiguous requirements

---

## Prompt System Maintenance

### When to Update System Instruction

#### 1. Handler Added/Removed
**Automatic**: Catalog auto-generates from registry

#### 2. New Constraint Added
**Manual**: Update constraints section
```typescript
// Add new constraint
constraintText += "- New limit: description\n";
```

#### 3. Format Requirements Change
**Manual**: Update output format section

#### 4. Dependency Rules Evolve
**Manual**: Update dependency guidelines

### Prompt Testing

**Test Different Scenarios**:
```typescript
const testPrompts = [
  "Simple: Copy users to backup",
  "Sequential: Copy users, then export to CSV",
  "Parallel: Export users and products",
  "Complex: Multi-step ETL pipeline"
];

testPrompts.forEach(prompt => {
  const result = buildPrompt(prompt);
  console.log('System instruction length:', result.systemInstruction.length);
  console.log('User prompt:', result.userPrompt);
});
```

**Verify Catalog Completeness**:
```typescript
const catalog = getTaskCatalog();
console.log('Handlers in catalog:', catalog.length);
console.log('Services:', [...new Set(catalog.map(c => c.service))]);
```

**Expected**: 20 handlers across 4 services (ai, authentication, firestore, storage)

---

## Performance Considerations

### Token Usage

**System Instruction**: ~5,000-8,000 tokens
- Task catalog: ~4,000 tokens (20 handlers with examples)
- Format/guidelines: ~1,000 tokens
- Constraints: ~500 tokens

**User Prompt**: Variable
- Simple: ~50 tokens
- With context: ~100-200 tokens
- With errors (retry): +~200-500 tokens per attempt

**Total**: ~6,000-10,000 tokens per request

### Optimization Strategies

1. **Concise Descriptions**: Keep handler descriptions focused
2. **Limit Examples**: 1-2 examples per handler
3. **Error Limiting**: Max 10 errors in feedback
4. **Context Pruning**: Only include relevant context

### Trade-offs

**Detailed Catalog**:
- ✅ Better AI understanding
- ✅ More accurate plans
- ❌ Higher token usage
- ❌ Slower AI response

**Minimal Catalog**:
- ✅ Lower token usage
- ✅ Faster AI response
- ❌ More validation failures
- ❌ More retry attempts

**Current Balance**: Optimized for accuracy over speed, validated by ~60% first-attempt success rate
