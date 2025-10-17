# Task Catalog Reference

## Overview

The Task Catalog is an **auto-generated registry** of all available handler capabilities. It provides the AI with complete knowledge of what tasks can be orchestrated.

**Key Features**:
- ✅ Auto-generated from handler registry (single source of truth)
- ✅ Always in sync with available handlers
- ✅ Includes descriptions, parameters, and examples
- ✅ Zero manual maintenance required

## Catalog Generation

**Location**: `catalog.ts:15-33`

**Implementation**:
```typescript
const TASK_CATALOG: TaskCapability[] = (() => {
  const catalog: TaskCapability[] = [];

  // Auto-generate from centralized handler registry
  for (const [service, commands] of Object.entries(HANDLER_REGISTRY)) {
    for (const [command, definition] of Object.entries(commands)) {
      catalog.push({
        service,
        command,
        description: definition.description,
        requiredParams: definition.requiredParams,
        optionalParams: definition.optionalParams || [],
        examples: definition.examples || []
      });
    }
  }

  return catalog;
})();
```

**Benefits**:
1. **DRY Principle**: Handler metadata defined once in registry
2. **Type Safety**: TypeScript ensures consistency
3. **Auto-Sync**: Adding/removing handlers automatically updates catalog
4. **No Drift**: Catalog always matches actual handlers

---

## Catalog Structure

### TaskCapability Interface

**Location**: `types.ts`

```typescript
export interface TaskCapability {
  service: string;              // Service name (ai, authentication, firestore, storage)
  command: string;              // Command name within service
  description: string;          // Human-readable description
  requiredParams: string[];     // Parameters that must be provided
  optionalParams: string[];     // Parameters that can be provided
  examples: Array<{             // Usage examples
    input: Record<string, any>;
    description: string;
  }>;
}
```

---

## Available Services

### Service: `ai` (2 commands)

#### 1. `ai/process-inference`
**Description**: Performs AI inference using Vertex AI Gemini models

**Required**: `model`, `prompt`

**Optional**: `files`, `systemInstruction`, `temperature`, `maxOutputTokens`, `topP`, `topK`, `responseMimeType`, `responseSchema`, `candidateCount`, `stopSequences`

**Example**:
```json
{
  "model": "gemini-2.5-pro",
  "prompt": "Analyze this data and provide insights",
  "systemInstruction": "You are a data analysis expert",
  "temperature": 0.7,
  "maxOutputTokens": 1000
}
```

#### 2. `ai/orchestrate`
**Description**: AI-powered task orchestration that generates validated task plans

**Required**: `prompt`

**Optional**: `maxRetries`, `temperature`, `context`, `maxChildTasks`, `timeout`, `maxDepth`

**Example**:
```json
{
  "prompt": "Copy users collection to backup",
  "maxRetries": 3,
  "temperature": 0.2
}
```

---

### Service: `authentication` (7 commands)

#### 1. `authentication/create-user`
**Description**: Creates a new Firebase Authentication user

**Required**: `userRecord`

**Optional**: `customClaims`

**Example**:
```json
{
  "userRecord": {
    "email": "newuser@example.com",
    "password": "securePassword123",
    "displayName": "New User"
  },
  "customClaims": {
    "role": "admin",
    "permissions": ["read", "write"]
  }
}
```

#### 2. `authentication/get-user`
**Description**: Retrieves user information by UID, email, or phone

**Required**: None (but at least one of uid, email, or phoneNumber must be provided)

**Optional**: `uid`, `email`, `phoneNumber`

**Example**:
```json
{
  "email": "user@example.com"
}
```

#### 3. `authentication/update-user`
**Description**: Updates an existing user's properties

**Required**: `uid`, `updateRequest`

**Optional**: `customClaims`

**Example**:
```json
{
  "uid": "user123abc",
  "updateRequest": {
    "displayName": "Updated Name",
    "disabled": false
  }
}
```

#### 4. `authentication/delete-user`
**Description**: Deletes a user account

**Required**: `uid`

**Example**:
```json
{
  "uid": "user123abc"
}
```

#### 5. `authentication/list-users`
**Description**: Lists users with pagination

**Required**: None

**Optional**: `maxResults`, `pageToken`

**Example**:
```json
{
  "maxResults": 100
}
```

#### 6. `authentication/get-user-claims`
**Description**: Retrieves custom claims for a user

**Required**: `uid`

**Example**:
```json
{
  "uid": "user123abc"
}
```

#### 7. `authentication/set-user-claims`
**Description**: Sets custom claims for a user

**Required**: `uid`, `customClaims`

**Example**:
```json
{
  "uid": "user123abc",
  "customClaims": {
    "role": "admin",
    "department": "engineering"
  }
}
```

---

### Service: `firestore` (10 commands)

#### 1. `firestore/copy-collection`
**Description**: Copies entire collection with all documents and subcollections

**Required**: `sourcePath`, `destinationPath`

**Example**:
```json
{
  "sourcePath": "firestore/(default)/data/users",
  "destinationPath": "firestore/(default)/data/users_backup"
}
```

#### 2. `firestore/copy-document`
**Description**: Copies a single document including subcollections

**Required**: `sourcePath`, `destinationPath`

**Example**:
```json
{
  "sourcePath": "firestore/(default)/data/users/user123",
  "destinationPath": "firestore/(default)/data/users_archive/user123"
}
```

#### 3. `firestore/create-document`
**Description**: Creates or overwrites a document

**Required**: `documentPath`, `documentData`

**Example**:
```json
{
  "documentPath": "firestore/(default)/data/users/newUser",
  "documentData": {
    "name": "John Doe",
    "email": "john@example.com"
  }
}
```

#### 4. `firestore/delete-path`
**Description**: Recursively deletes documents and subcollections at path

**Required**: `path`

**Example**:
```json
{
  "path": "firestore/(default)/data/temp_data"
}
```

#### 5. `firestore/delete-documents`
**Description**: Deletes multiple documents in batch

**Required**: `paths`

**Example**:
```json
{
  "paths": [
    "firestore/(default)/data/temp/doc1",
    "firestore/(default)/data/temp/doc2"
  ]
}
```

#### 6. `firestore/export-collection-csv`
**Description**: Exports collection to CSV with field selection

**Required**: `collectionPath`, `bucketPathPrefix`, `fields`

**Optional**: `limit`, `orderByField`, `orderByDirection`, `delimiter`

**Example**:
```json
{
  "collectionPath": "firestore/(default)/data/users",
  "bucketPathPrefix": "gs://my-bucket/exports",
  "fields": [
    { "source": "_id_", "header": "User ID" },
    { "source": "email", "header": "Email" }
  ]
}
```

#### 7. `firestore/export-collection-json`
**Description**: Exports collection to JSON file

**Required**: `collectionPath`, `bucketPathPrefix`

**Optional**: `includeSubcollections`, `limit`, `orderByField`, `orderByDirection`

**Example**:
```json
{
  "collectionPath": "firestore/(default)/data/products",
  "bucketPathPrefix": "gs://my-bucket/exports"
}
```

#### 8. `firestore/import-collection-csv`
**Description**: Imports CSV file into collection

**Required**: `collectionPath`, `bucketPath`

**Optional**: `fieldMappings`, `delimiter`

**Example**:
```json
{
  "collectionPath": "firestore/(default)/data/imported_users",
  "bucketPath": "gs://my-bucket/imports/users.csv"
}
```

#### 9. `firestore/import-collection-json`
**Description**: Imports JSON file into collection

**Required**: `collectionPath`, `bucketPath`

**Example**:
```json
{
  "collectionPath": "firestore/(default)/data/imported_products",
  "bucketPath": "gs://my-bucket/imports/products.json"
}
```

#### 10. `firestore/list-collections`
**Description**: Lists collections in database or subcollections of document

**Required**: None

**Optional**: `documentPath`

**Example**:
```json
{
  "documentPath": "firestore/(default)/data/"
}
```

---

### Service: `storage` (1 command)

#### 1. `storage/delete-path`
**Description**: Recursively deletes files at Cloud Storage path

**Required**: `path`

**Optional**: `limit`

**Example**:
```json
{
  "path": "gs://my-bucket/temp_uploads/",
  "limit": 100
}
```

---

## Catalog API

### Core Functions

#### `getTaskCatalog()`
Returns complete array of task capabilities

**Usage**:
```typescript
import { getTaskCatalog } from './catalog';

const catalog = getTaskCatalog();
console.log(`Total handlers: ${catalog.length}`);
catalog.forEach(cap => {
  console.log(`${cap.service}/${cap.command}: ${cap.description}`);
});
```

**Output**:
```
Total handlers: 20
ai/process-inference: Performs AI inference using Vertex AI...
ai/orchestrate: AI-powered task orchestration...
authentication/create-user: Creates a new Firebase Authentication user...
...
```

#### `findTaskCapability(service, command)`
Finds specific task capability

**Usage**:
```typescript
import { findTaskCapability } from './catalog';

const capability = findTaskCapability('firestore', 'copy-collection');
if (capability) {
  console.log('Description:', capability.description);
  console.log('Required:', capability.requiredParams);
  console.log('Examples:', capability.examples.length);
}
```

**Output**:
```
Description: Copies an entire Firestore collection...
Required: [ 'sourcePath', 'destinationPath' ]
Examples: 2
```

#### `isValidServiceCommand(service, command)`
Validates service/command combination exists

**Usage**:
```typescript
import { isValidServiceCommand } from './catalog';

console.log(isValidServiceCommand('firestore', 'copy-collection')); // true
console.log(isValidServiceCommand('firestore', 'invalid-command')); // false
console.log(isValidServiceCommand('invalid-service', 'command'));   // false
```

#### `getAvailableServices()`
Lists all service names

**Usage**:
```typescript
import { getAvailableServices } from './catalog';

const services = getAvailableServices();
console.log('Services:', services);
```

**Output**:
```
Services: [ 'ai', 'authentication', 'firestore', 'storage' ]
```

#### `getServiceCommands(service)`
Lists commands for a service

**Usage**:
```typescript
import { getServiceCommands } from './catalog';

const commands = getServiceCommands('firestore');
console.log('Firestore commands:', commands);
```

**Output**:
```
Firestore commands: [
  'copy-collection',
  'copy-document',
  'create-document',
  'delete-path',
  'delete-documents',
  'export-collection-csv',
  'export-collection-json',
  'import-collection-csv',
  'import-collection-json',
  'list-collections'
]
```

---

## Catalog Statistics

**Current Catalog** (as of 2025-01-17):

| Metric | Value |
|--------|-------|
| Total Handlers | 20 |
| Services | 4 |
| AI Commands | 2 |
| Authentication Commands | 7 |
| Firestore Commands | 10 |
| Storage Commands | 1 |
| Total Examples | 49 |
| Avg Examples per Handler | 2.5 |

**Handler Distribution**:
- Firestore: 50% (10/20)
- Authentication: 35% (7/20)
- AI: 10% (2/20)
- Storage: 5% (1/20)

---

## Adding New Handlers

### Workflow

**Step 1**: Create handler file
```bash
touch src/job/handlers/myservice/mycommand.ts
```

**Step 2**: Implement handler
```typescript
export async function handleMyCommand(task: JobTask): Promise<Record<string, any>> {
  // Implementation
  return { success: true };
}
```

**Step 3**: Register in registry.ts
```typescript
import { handleMyCommand } from './myservice/mycommand';

export const HANDLER_REGISTRY: HandlerRegistry = {
  // ... existing services
  myservice: {
    "my-command": {
      handler: handleMyCommand,
      description: "Does something useful",
      requiredParams: ["param1", "param2"],
      optionalParams: ["param3"],
      inputSchema: {
        type: 'object',
        properties: {
          param1: { type: 'string' },
          param2: { type: 'number' },
          param3: { type: 'boolean' }
        },
        required: ['param1', 'param2'],
        additionalProperties: false
      },
      examples: [
        {
          input: { param1: "value", param2: 42 },
          description: "Basic usage example"
        }
      ]
    }
  }
};
```

**Step 4**: Verify auto-generation
```typescript
import { getTaskCatalog, isValidServiceCommand } from './catalog';

// Catalog auto-updates
const catalog = getTaskCatalog();
console.log('Handler count:', catalog.length); // Should be 21

// Validate new handler
console.log(isValidServiceCommand('myservice', 'my-command')); // true
```

**That's it!** Catalog, validation, and AI awareness all update automatically.

---

## Catalog Validation

### Test Coverage

**Location**: `orchestrate.spec.ts:18-63`

**Tests**:
1. ✅ All catalog entries have valid handlers
2. ✅ All handlers represented in catalog
3. ✅ Correct catalog count (20 handlers)
4. ✅ Valid required parameters for all entries
5. ✅ Valid examples for all entries
6. ✅ Non-empty descriptions
7. ✅ Catalog lookup functions work correctly
8. ✅ Service/command validation accurate

**Run Tests**:
```bash
npm run test:ai
```

**Expected Output**:
```
Task Catalog Validation
  ✓ should have handlers for all cataloged tasks
  ✓ should have all handlers represented in catalog
  ✓ should have correct catalog count
  ✓ should have valid required parameters
  ✓ should have valid examples
  ✓ should have non-empty descriptions
  ...

67 passing
```

---

## Drift Detection

### Problem: Manual Catalog

**Old Approach** (avoided):
```typescript
// ❌ Manual catalog maintenance
const TASK_CATALOG = [
  {
    service: 'firestore',
    command: 'copy-collection',
    description: '...',
    // ... manually duplicated from handler
  },
  // ... repeat for each handler
];
```

**Issues**:
- 🔴 Catalog and handlers can drift
- 🔴 Forgetting to update catalog when adding handlers
- 🔴 Duplicate maintenance burden
- 🔴 No type safety between catalog and handlers

### Solution: Auto-Generation

**Current Approach** (implemented):
```typescript
// ✅ Auto-generated from registry
const TASK_CATALOG = (() => {
  return Object.entries(HANDLER_REGISTRY).flatMap(/* ... */);
})();
```

**Benefits**:
- ✅ Zero drift possible
- ✅ Single source of truth (registry)
- ✅ Type-safe with interfaces
- ✅ Automatic updates
- ✅ DRY principle enforced

---

## Best Practices

### For Descriptions

**Be Specific**:
```typescript
// ❌ Vague
description: "Handles users"

// ✅ Specific
description: "Creates a new Firebase Authentication user with email/password or other providers"
```

**Mention Key Features**:
```typescript
description: "Exports collection to CSV with customizable field selection and formatting. " +
             "Supports nested fields, special identifiers (_id_, _ref_), and Firestore types."
```

### For Parameters

**List All Required**:
```typescript
requiredParams: ["sourcePath", "destinationPath"]
```

**List All Optional**:
```typescript
optionalParams: ["limit", "orderByField", "orderByDirection"]
```

**Don't Mix**: Keep required and optional separate

### For Examples

**Include Common Use Cases**:
```typescript
examples: [
  {
    input: { /* basic usage */ },
    description: "Basic usage"
  },
  {
    input: { /* advanced usage */ },
    description: "Advanced usage with optional parameters"
  }
]
```

**Show Real Data**:
```typescript
// ✅ Real example
{
  email: "admin@example.com",
  displayName: "Admin User"
}

// ❌ Placeholder example
{
  email: "user@domain.com",
  displayName: "User Name"
}
```

---

## Monitoring Catalog Health

### Metrics to Track

1. **Handler Count**: Should grow as features added
2. **Example Coverage**: Every handler should have 1-3 examples
3. **Description Quality**: Clear, specific, actionable
4. **Schema Coverage**: All handlers should have input schemas

### Validation Script

```typescript
import { getTaskCatalog } from './catalog';

const catalog = getTaskCatalog();

// Check coverage
const withoutExamples = catalog.filter(c => c.examples.length === 0);
console.log(`Handlers without examples: ${withoutExamples.length}`);

const shortDescriptions = catalog.filter(c => c.description.length < 50);
console.log(`Handlers with short descriptions: ${shortDescriptions.length}`);

// Report statistics
console.log(`Total handlers: ${catalog.length}`);
console.log(`Services: ${[...new Set(catalog.map(c => c.service))].length}`);
console.log(`Avg examples per handler: ${catalog.reduce((sum, c) => sum + c.examples.length, 0) / catalog.length}`);
```

---

## Integration Points

### With Validation System

**Location**: `validator.ts:69-86`

```typescript
// Catalog validates service/command combinations
if (!isValidServiceCommand(service, command)) {
  errors.push(`Unknown service/command: ${service}/${command}`);
}
```

### With Prompt Builder

**Location**: `promptBuilder.ts:33-155`

```typescript
// Catalog included in AI system instruction
const catalog = getTaskCatalog();
catalog.forEach(capability => {
  prompt += formatCapability(capability);
});
```

### With Handler Registry

**Location**: `catalog.ts:15-33`

```typescript
// Catalog auto-generates from registry
for (const [service, commands] of Object.entries(HANDLER_REGISTRY)) {
  for (const [command, definition] of Object.entries(commands)) {
    catalog.push(convertToCapability(service, command, definition));
  }
}
```

---

## Future Enhancements

### Potential Additions

1. **Category Metadata**: Group handlers by use case
2. **Popularity Metrics**: Track which handlers are used most
3. **Version Support**: Handle different handler versions
4. **Deprecation Notices**: Mark handlers as deprecated
5. **Cost Estimates**: Estimate resource usage per handler

### Extensibility

Current system supports easy addition of:
- New services (just add to registry)
- New commands (just add to service in registry)
- New metadata fields (update TaskCapability interface)
- New validation rules (update validator)

**The catalog will automatically include all registry changes!**
