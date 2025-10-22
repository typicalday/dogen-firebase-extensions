# Multi-Phase Orchestration Architecture

## Overview

The Multi-Phase Orchestration Architecture is a progressive context refinement system that breaks down AI task orchestration into three specialized phases. Each phase narrows the context and increases precision, leading to more accurate task generation.

**Three Phases**:
1. **Orchestrator Phase** - Service selection and task decomposition
2. **Service Agent Phase** - Command selection within chosen services
3. **Command Agent Phase** - Parameter construction with full schema validation

## Problem Statement

### Current Single-Phase Approach

The current orchestration system provides the AI with all 20 handlers across 4 services in a single prompt:

**Issues**:
- ❌ **Context Overload**: Too much information (5,000-8,000 tokens) in system instruction
- ❌ **Reduced Accuracy**: AI struggles to pick the right command when seeing all options at once
- ❌ **Parameter Confusion**: Full schemas for all handlers can lead to mixing up parameters
- ❌ **Lower Success Rate**: ~60% first-attempt success due to complexity
- ❌ **Validation Failures**: Common errors include wrong commands, missing parameters, incorrect formats

**Example of Context Overload**:
```
System Instruction (8,000 tokens):
- ai/process-inference (full schema, examples)
- ai/orchestrate (full schema, examples)
- authentication/create-user (full schema, examples)
- authentication/get-user (full schema, examples)
- authentication/update-user (full schema, examples)
- authentication/delete-user (full schema, examples)
- authentication/list-users (full schema, examples)
- authentication/get-user-claims (full schema, examples)
- authentication/set-user-claims (full schema, examples)
- firestore/copy-collection (full schema, examples)
- firestore/copy-document (full schema, examples)
... (20 handlers total)
```

### Multi-Phase Solution

Break orchestration into three focused phases with progressively narrowing context:

**Benefits**:
- ✅ **Focused Context**: Each phase sees only relevant information (500-2,000 tokens per phase)
- ✅ **Higher Accuracy**: Specialized agents make better decisions with less noise
- ✅ **Progressive Refinement**: Each phase builds on the previous with more detail
- ✅ **Schema Validation**: Final phase uses Vertex AI structured output for guaranteed validity
- ✅ **Better Success Rate**: Expected 85%+ first-attempt success with focused context

---

## Architecture Diagram

```
User Prompt
    ↓
┌─────────────────────────────────────────────────┐
│ Phase 1: Orchestrator Phase                    │
│ Context: 4 services (high-level descriptions)  │
│ Decides: Which services + task breakdown       │
│ Output: Array of service-level sub-tasks       │
└─────────────────────────────────────────────────┘
    ↓
    ↓ (For each sub-task)
    ↓
┌─────────────────────────────────────────────────┐
│ Phase 2: Service Agent Phase                   │
│ Context: Commands for ONE service only         │
│ Decides: Which command + parameter needs       │
│ Output: Command routing with refined prompt    │
└─────────────────────────────────────────────────┘
    ↓
    ↓ (For each command)
    ↓
┌─────────────────────────────────────────────────┐
│ Phase 3: Command Agent Phase                   │
│ Context: Full details for ONE command only     │
│ Decides: Exact parameter values + formatting   │
│ Output: Schema-valid task ready for execution  │
└─────────────────────────────────────────────────┘
    ↓
Execution
```

---

## Phase 1: Orchestrator Phase

### Core Responsibilities

1. **Intent Analysis**: Parse and understand the user's high-level objective
2. **Task Decomposition**: Break down the request into logical service-level sub-tasks
3. **Service Selection**: Determine which service handles each sub-task
4. **Dependency Planning**: Define execution order and task dependencies
5. **Prompt Refinement**: Create service-specific prompts for each sub-task
6. **Workflow Strategy**: Determine execution pattern (sequential, parallel, fan-out/fan-in)
7. **Task Count Validation**: Ensure task count is reasonable and within limits
8. **Context Propagation**: Identify what data needs to flow between tasks

### Input Schema

```typescript
{
  prompt: string;           // User's natural language request
  context?: {               // Optional additional context
    [key: string]: any;
  };
  maxTasks?: number;        // Upper limit on total tasks
}
```

### AI Context Provided

**Service Catalog** (High-level only - ~500 tokens):

```markdown
## Available Services

### ai
AI and machine learning operations including inference, content generation, and task orchestration.

### authentication
User management including account creation, updates, deletion, custom claims, and user queries.

### firestore
Database operations including document/collection management, data import/export, and batch operations.

### storage
Cloud storage operations for file management and cleanup.
```

**No command details, no schemas, no examples at this level.**

### Output Schema

```typescript
{
  subtasks: Array<{
    id: string;              // Unique identifier (e.g., "task-0")
    service: string;         // One of: ai, authentication, firestore, storage
    prompt: string;          // Refined prompt for service agent
    dependsOn: string[];     // IDs of tasks this depends on
  }>;
  reasoning?: string;        // Explanation of the plan
}
```

### Examples

#### Example 1: Simple Single-Task Request

**User Prompt**:
```
"Create a firestore document in the restaurant collection and give it a field named 'name' and call it 'Pizza Joes'"
```

**Orchestrator Output**:
```typescript
{
  subtasks: [
    {
      id: "task-0",
      service: "firestore",
      prompt: "Create a document in the 'restaurant' collection with a field 'name' set to 'Pizza Joes'",
      dependsOn: []
    }
  ],
  reasoning: "Single document creation task requires only Firestore service"
}
```

**What happened**:
- Recognized this is a single database operation
- Identified Firestore as the appropriate service
- Refined the prompt to be more precise for the service agent
- No dependencies since it's a single task

---

#### Example 2: Sequential Multi-Service Request

**User Prompt**:
```
"Create a user account for admin@pizzajoes.com with password 'SecurePass123', then create a restaurant document owned by that user with the name 'Pizza Joes'"
```

**Orchestrator Output**:
```typescript
{
  subtasks: [
    {
      id: "create-admin",
      service: "authentication",
      prompt: "Create a user account with email 'admin@pizzajoes.com' and password 'SecurePass123'",
      dependsOn: []
    },
    {
      id: "create-restaurant",
      service: "firestore",
      prompt: "Create a document in the 'restaurant' collection with name='Pizza Joes' and ownerId set to the UID from the created user",
      dependsOn: ["create-admin"]
    }
  ],
  reasoning: "First create the user account to get the UID, then use that UID when creating the restaurant document"
}
```

**What happened**:
- Identified two distinct operations: user creation, then document creation
- Recognized that restaurant needs the user's UID (data dependency)
- Specified `dependsOn` to ensure sequential execution
- Prompted the service agent to use output from the first task

---

#### Example 3: Parallel Operations (Fan-Out)

**User Prompt**:
```
"Export both the 'users' and 'restaurants' collections to JSON files in Cloud Storage"
```

**Orchestrator Output**:
```typescript
{
  subtasks: [
    {
      id: "export-users",
      service: "firestore",
      prompt: "Export the 'users' collection to a JSON file in Cloud Storage",
      dependsOn: []
    },
    {
      id: "export-restaurants",
      service: "firestore",
      prompt: "Export the 'restaurants' collection to a JSON file in Cloud Storage",
      dependsOn: []
    }
  ],
  reasoning: "Both exports are independent and can run in parallel for efficiency"
}
```

**What happened**:
- Recognized two independent operations
- Both use the same service but operate on different data
- No dependencies = parallel execution
- Created separate refined prompts for each

---

#### Example 4: Complex Multi-Step Workflow (Fan-Out → Fan-In)

**User Prompt**:
```
"Create a backup of the users collection, export it to CSV with email and name fields, and also create a user account for the new admin backup@company.com"
```

**Orchestrator Output**:
```typescript
{
  subtasks: [
    {
      id: "backup-users",
      service: "firestore",
      prompt: "Copy the entire 'users' collection to a new collection called 'users_backup'",
      dependsOn: []
    },
    {
      id: "export-backup",
      service: "firestore",
      prompt: "Export the 'users_backup' collection to CSV format in Cloud Storage, including only the 'email' and 'name' fields",
      dependsOn: ["backup-users"]
    },
    {
      id: "create-admin",
      service: "authentication",
      prompt: "Create a user account with email 'backup@company.com' and generate a secure password",
      dependsOn: []
    }
  ],
  reasoning: "Backup operation must complete before export. Admin creation is independent and can run in parallel with backup."
}
```

**What happened**:
- Identified 3 sub-tasks with mixed dependencies
- backup-users and create-admin can run in parallel (no deps)
- export-backup waits for backup-users to complete
- Separated concerns: data operation vs user management

---

#### Example 5: Complex Data Pipeline

**User Prompt**:
```
"Delete all old session data in the 'sessions' collection, then create a new admin user, set their custom claims to include admin role, and export the updated users list to JSON"
```

**Orchestrator Output**:
```typescript
{
  subtasks: [
    {
      id: "cleanup-sessions",
      service: "firestore",
      prompt: "Delete all documents from the 'sessions' collection",
      dependsOn: []
    },
    {
      id: "create-admin",
      service: "authentication",
      prompt: "Create a new user account for an admin user",
      dependsOn: []
    },
    {
      id: "set-claims",
      service: "authentication",
      prompt: "Set custom claims for the newly created admin user to include role='admin'",
      dependsOn: ["create-admin"]
    },
    {
      id: "export-users",
      service: "firestore",
      prompt: "Export all documents from the 'users' collection to JSON format in Cloud Storage",
      dependsOn: ["set-claims"]
    }
  ],
  reasoning: "Session cleanup is independent. Admin creation must complete before setting claims. Export should wait until the new admin is fully configured."
}
```

**What happened**:
- 4 sub-tasks with dependency chain
- cleanup-sessions runs independently in parallel
- create-admin → set-claims → export-users form a sequential chain
- Identified that claims depend on user existence
- Export waits for all user modifications to complete

---

## Phase 2: Service Agent Phase

### Core Responsibilities

1. **Command Matching**: Select the most appropriate command for the sub-task's goal
2. **Parameter Identification**: Determine which parameters will be needed
3. **Prompt Specification**: Create command-specific prompt with parameter details
4. **Validation**: Ensure selected command can accomplish the goal
5. **Edge Case Handling**: Choose between similar commands when multiple options exist
6. **Dependency Passthrough**: Maintain dependency information from orchestrator
7. **Context Understanding**: Parse the sub-task prompt to extract specifics

### Input Schema

```typescript
{
  id: string;              // From orchestrator
  service: string;         // Service name
  prompt: string;          // Refined prompt from orchestrator
  dependsOn: string[];     // Dependencies from orchestrator
}
```

### AI Context Provided

**For Firestore Service** (example - ~1,500 tokens):

```markdown
## Firestore Commands

### copy-collection
Copy an entire collection with all documents and subcollections.
Required: sourcePath, destinationPath

### copy-document
Copy a single document including subcollections.
Required: sourcePath, destinationPath

### create-document
Create or overwrite a document.
Required: documentPath, documentData

### delete-path
Recursively delete documents and subcollections at a path.
Required: path

### delete-documents
Delete multiple documents in batch.
Required: paths (array)

### export-collection-csv
Export collection to CSV with field selection.
Required: collectionPath, bucketPathPrefix, fields
Optional: limit, orderByField, orderByDirection, delimiter

### export-collection-json
Export collection to JSON file.
Required: collectionPath, bucketPathPrefix
Optional: includeSubcollections, limit, orderByField, orderByDirection

### import-collection-csv
Import CSV file into collection.
Required: collectionPath, bucketPath
Optional: fieldMappings, delimiter

### import-collection-json
Import JSON file into collection.
Required: collectionPath, bucketPath

### list-collections
List collections in database or subcollections of document.
Optional: documentPath
```

**No schemas, no detailed examples, just command descriptions and parameter lists.**

### Output Schema

```typescript
{
  id: string;              // Passthrough from input
  service: string;         // Passthrough from input
  command: string;         // Selected command name
  prompt: string;          // Command-specific refined prompt
  dependsOn: string[];     // Passthrough from input
}
```

### Examples

#### Example 1: Simple Document Creation

**Input** (from Orchestrator):
```typescript
{
  id: "task-0",
  service: "firestore",
  prompt: "Create a document in the 'restaurant' collection with a field 'name' set to 'Pizza Joes'",
  dependsOn: []
}
```

**Service Agent Output**:
```typescript
{
  id: "task-0",
  service: "firestore",
  command: "create-document",
  prompt: "Create a document at path 'restaurant/pizzajoes' with documentData containing field name='Pizza Joes'",
  dependsOn: []
}
```

**What happened**:
- Scanned firestore commands
- Identified `create-document` as the match (not copy, not delete, not export)
- Specified more details: path structure, documentData parameter
- Suggested a document ID (pizzajoes) derived from the name

---

#### Example 2: Collection Export with CSV

**Input** (from Orchestrator):
```typescript
{
  id: "export-backup",
  service: "firestore",
  prompt: "Export the 'users_backup' collection to CSV format in Cloud Storage, including only the 'email' and 'name' fields",
  dependsOn: ["backup-users"]
}
```

**Service Agent Output**:
```typescript
{
  id: "export-backup",
  service: "firestore",
  command: "export-collection-csv",
  prompt: "Export from collectionPath 'users_backup' to a Cloud Storage bucket path, with fields array containing 'email' and 'name' fields. Use default delimiter.",
  dependsOn: ["backup-users"]
}
```

**What happened**:
- Identified "CSV" keyword → chose `export-collection-csv` not `export-collection-json`
- Recognized "only email and name" → will need `fields` parameter
- Noted optional parameters like delimiter aren't needed
- Preserved the dependency on backup-users

---

#### Example 3: User Creation (Authentication)

**Input** (from Orchestrator):
```typescript
{
  id: "create-admin",
  service: "authentication",
  prompt: "Create a user account with email 'admin@pizzajoes.com' and password 'SecurePass123'",
  dependsOn: []
}
```

**Service Agent Context** (Authentication commands):
```markdown
## Authentication Commands

### create-user
Create a new Firebase Authentication user.
Required: userRecord
Optional: customClaims

### get-user
Retrieve user information by UID, email, or phone.
Optional: uid, email, phoneNumber

### update-user
Update an existing user's properties.
Required: uid, updateRequest
Optional: customClaims

### delete-user
Delete a user account.
Required: uid

### list-users
List users with pagination.
Optional: maxResults, pageToken

### get-user-claims
Retrieve custom claims for a user.
Required: uid

### set-user-claims
Set custom claims for a user.
Required: uid, customClaims
```

**Service Agent Output**:
```typescript
{
  id: "create-admin",
  service: "authentication",
  command: "create-user",
  prompt: "Create user with userRecord containing email='admin@pizzajoes.com' and password='SecurePass123'. No custom claims needed.",
  dependsOn: []
}
```

**What happened**:
- Chose `create-user` (not get, update, or delete)
- Identified that userRecord will contain email and password
- Noted customClaims is optional and not needed here
- Ready to pass to command agent for full parameter construction

---

#### Example 4: Collection Copy

**Input** (from Orchestrator):
```typescript
{
  id: "backup-users",
  service: "firestore",
  prompt: "Copy the entire 'users' collection to a new collection called 'users_backup'",
  dependsOn: []
}
```

**Service Agent Output**:
```typescript
{
  id: "backup-users",
  service: "firestore",
  command: "copy-collection",
  prompt: "Copy from sourcePath 'users' collection to destinationPath 'users_backup' collection. Include all documents and subcollections.",
  dependsOn: []
}
```

**What happened**:
- "Copy entire collection" → `copy-collection` not `copy-document`
- Identified both sourcePath and destinationPath parameters needed
- Noted that subcollections should be included (default behavior)

---

#### Example 5: Conditional Command Selection

**Input** (from Orchestrator):
```typescript
{
  id: "set-claims",
  service: "authentication",
  prompt: "Set custom claims for the newly created admin user to include role='admin'",
  dependsOn: ["create-admin"]
}
```

**Service Agent Output**:
```typescript
{
  id: "set-claims",
  service: "authentication",
  command: "set-user-claims",
  prompt: "Use the UID from the 'create-admin' task output. Set customClaims to {role: 'admin'}.",
  dependsOn: ["create-admin"]
}
```

**What happened**:
- Chose `set-user-claims` not `create-user` (which also accepts customClaims)
- Recognized need to use UID from dependent task
- Specified the customClaims object structure
- Maintained dependency for data flow

---

## Phase 3: Command Agent Phase

### Core Responsibilities

1. **Parameter Construction**: Build complete input object with all required fields
2. **Format Enforcement**: Apply proper formatting (paths, emails, phone numbers, etc.)
3. **Schema Validation**: Ensure output matches JSON schema exactly
4. **Optional Parameters**: Include optional parameters when appropriate
5. **Type Conversion**: Convert values to correct types (strings, numbers, booleans, arrays, objects)
6. **Dependency Resolution**: Reference outputs from dependent tasks when needed
7. **Constraint Adherence**: Follow all validation rules (min/max, patterns, enums)
8. **Error Prevention**: Construct valid inputs that will pass validation on first attempt

### Input Schema

```typescript
{
  id: string;              // Task ID
  service: string;         // Service name
  command: string;         // Command name
  prompt: string;          // Command-specific prompt
  dependsOn: string[];     // Dependencies
}
```

### AI Context Provided

**For Specific Command** (e.g., firestore/create-document - ~2,000 tokens):

```markdown
## firestore/create-document

### Description
Creates or overwrites a Firestore document at the specified path with the provided data.

### Required Parameters
- documentPath (string): Full path to the document in format 'firestore/{database}/data/{collection}/{docId}'
- documentData (object): The data to write to the document

### Optional Parameters
None

### JSON Schema
{
  "type": "object",
  "properties": {
    "documentPath": {
      "type": "string",
      "pattern": "^firestore/[^/]+/data/.+",
      "description": "Full document path"
    },
    "documentData": {
      "type": "object",
      "description": "Document data object"
    }
  },
  "required": ["documentPath", "documentData"],
  "additionalProperties": false
}

### Examples

Example 1: Create user document
{
  "documentPath": "firestore/(default)/data/users/user123",
  "documentData": {
    "name": "John Doe",
    "email": "john@example.com",
    "createdAt": "2025-01-17T10:00:00Z"
  }
}

Example 2: Create restaurant document
{
  "documentPath": "firestore/(default)/data/restaurants/pizzajoes",
  "documentData": {
    "name": "Pizza Joe's",
    "cuisine": "Italian",
    "rating": 4.5,
    "address": {
      "street": "123 Main St",
      "city": "Springfield"
    }
  }
}

### Validation Rules
- documentPath must start with 'firestore/'
- documentPath must include database name (use '(default)' if unspecified)
- documentPath must include '/data/' separator
- documentPath must end with collection/docId
- documentData must be a valid JSON object
```

**Full schema, multiple examples, all validation rules for THIS command only.**

### Output Schema

```typescript
{
  id: string;              // Passthrough
  service: string;         // Passthrough
  command: string;         // Passthrough
  input: {                 // Fully constructed, schema-valid input
    [key: string]: any;
  };
  dependsOn: string[];     // Passthrough
}
```

### Examples

#### Example 1: Simple Document Creation

**Input** (from Service Agent):
```typescript
{
  id: "task-0",
  service: "firestore",
  command: "create-document",
  prompt: "Create a document at path 'restaurant/pizzajoes' with documentData containing field name='Pizza Joes'",
  dependsOn: []
}
```

**Command Agent Output**:
```typescript
{
  id: "task-0",
  service: "firestore",
  command: "create-document",
  input: {
    documentPath: "firestore/(default)/data/restaurant/pizzajoes",
    documentData: {
      name: "Pizza Joes"
    }
  },
  dependsOn: []
}
```

**What happened**:
- Constructed proper documentPath with firestore/(default)/data/ prefix
- Created documentData object with the name field
- Validated against schema (all required fields present, correct types)
- Ready for immediate execution

---

#### Example 2: CSV Export with Field Mapping

**Input** (from Service Agent):
```typescript
{
  id: "export-backup",
  service: "firestore",
  command: "export-collection-csv",
  prompt: "Export from collectionPath 'users_backup' to a Cloud Storage bucket path, with fields array containing 'email' and 'name' fields. Use default delimiter.",
  dependsOn: ["backup-users"]
}
```

**Command Agent Context** (export-collection-csv):
```markdown
## firestore/export-collection-csv

### Description
Exports a Firestore collection to a CSV file in Cloud Storage with customizable field selection.

### Required Parameters
- collectionPath (string): Path to collection in format 'firestore/{database}/data/{collection}'
- bucketPathPrefix (string): Cloud Storage path in format 'gs://{bucket}/{path}'
- fields (array): Array of field mapping objects

### Optional Parameters
- limit (number): Maximum documents to export
- orderByField (string): Field to order by
- orderByDirection (string): 'asc' or 'desc'
- delimiter (string): CSV delimiter character (default: ',')

### JSON Schema
{
  "type": "object",
  "properties": {
    "collectionPath": {
      "type": "string",
      "pattern": "^firestore/[^/]+/data/.+$"
    },
    "bucketPathPrefix": {
      "type": "string",
      "pattern": "^gs://[^/]+/.+$"
    },
    "fields": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "source": { "type": "string" },
          "header": { "type": "string" }
        },
        "required": ["source", "header"]
      },
      "minItems": 1
    },
    "limit": { "type": "number", "minimum": 1 },
    "orderByField": { "type": "string" },
    "orderByDirection": { "type": "string", "enum": ["asc", "desc"] },
    "delimiter": { "type": "string", "maxLength": 1 }
  },
  "required": ["collectionPath", "bucketPathPrefix", "fields"],
  "additionalProperties": false
}

### Examples

Example 1: Export users with email and name
{
  "collectionPath": "firestore/(default)/data/users",
  "bucketPathPrefix": "gs://my-bucket/exports/users",
  "fields": [
    { "source": "email", "header": "Email Address" },
    { "source": "name", "header": "Full Name" }
  ]
}
```

**Command Agent Output**:
```typescript
{
  id: "export-backup",
  service: "firestore",
  command: "export-collection-csv",
  input: {
    collectionPath: "firestore/(default)/data/users_backup",
    bucketPathPrefix: "gs://[PROJECT_BUCKET]/exports/users_backup",
    fields: [
      { source: "email", header: "Email" },
      { source: "name", header: "Name" }
    ]
  },
  dependsOn: ["backup-users"]
}
```

**What happened**:
- Constructed proper collectionPath format
- Created valid bucketPathPrefix (would use project default bucket)
- Built fields array with source/header objects
- Validated array has minItems: 1
- Omitted optional parameters (limit, orderByField, delimiter) since not specified
- Maintained dependency

---

#### Example 3: User Creation with Nested Object

**Input** (from Service Agent):
```typescript
{
  id: "create-admin",
  service: "authentication",
  command: "create-user",
  prompt: "Create user with userRecord containing email='admin@pizzajoes.com' and password='SecurePass123'. No custom claims needed.",
  dependsOn: []
}
```

**Command Agent Context** (authentication/create-user):
```markdown
## authentication/create-user

### Description
Creates a new Firebase Authentication user with email/password or other providers.

### Required Parameters
- userRecord (object): User record object containing user details

### Optional Parameters
- customClaims (object): Custom claims to set on the user

### JSON Schema
{
  "type": "object",
  "properties": {
    "userRecord": {
      "type": "object",
      "properties": {
        "email": {
          "type": "string",
          "pattern": "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"
        },
        "password": {
          "type": "string",
          "minLength": 6
        },
        "displayName": { "type": "string" },
        "phoneNumber": {
          "type": "string",
          "pattern": "^\\+[1-9]\\d{1,14}$"
        },
        "photoURL": { "type": "string" },
        "disabled": { "type": "boolean" }
      },
      "additionalProperties": false
    },
    "customClaims": {
      "type": "object"
    }
  },
  "required": ["userRecord"],
  "additionalProperties": false
}

### Examples

Example 1: Create user with email and password
{
  "userRecord": {
    "email": "newuser@example.com",
    "password": "securePassword123",
    "displayName": "New User"
  }
}

Example 2: Create user with custom claims
{
  "userRecord": {
    "email": "admin@example.com",
    "password": "adminPass456"
  },
  "customClaims": {
    "role": "admin",
    "permissions": ["read", "write", "delete"]
  }
}
```

**Command Agent Output**:
```typescript
{
  id: "create-admin",
  service: "authentication",
  command: "create-user",
  input: {
    userRecord: {
      email: "admin@pizzajoes.com",
      password: "SecurePass123"
    }
  },
  dependsOn: []
}
```

**What happened**:
- Constructed userRecord object with required nested structure
- Applied email validation pattern
- Applied password minLength validation (6+ characters)
- Omitted customClaims since not needed
- Omitted optional userRecord fields (displayName, phoneNumber, etc.)

---

#### Example 4: Task with Dependency Reference

**Input** (from Service Agent):
```typescript
{
  id: "create-restaurant",
  service: "firestore",
  command: "create-document",
  prompt: "Create a document in the 'restaurant' collection with name='Pizza Joes' and ownerId set to the UID from the user created in task 'create-admin'",
  dependsOn: ["create-admin"]
}
```

**Command Agent Output**:
```typescript
{
  id: "create-restaurant",
  service: "firestore",
  command: "create-document",
  input: {
    documentPath: "firestore/(default)/data/restaurant/pizzajoes",
    documentData: {
      name: "Pizza Joes",
      ownerId: "{{create-admin.output.uid}}"  // Reference to dependent task output
    }
  },
  dependsOn: ["create-admin"]
}
```

**What happened**:
- Recognized need to use output from dependent task
- Created reference syntax for runtime resolution: `{{taskId.output.field}}`
- Constructed proper document structure with both static and dynamic values
- Preserved dependency so execution engine knows to wait

---

#### Example 5: Complex Parameter with Arrays and Options

**Input** (from Service Agent):
```typescript
{
  id: "set-claims",
  service: "authentication",
  command: "set-user-claims",
  prompt: "Use the UID from the 'create-admin' task output. Set customClaims to {role: 'admin', permissions: ['read', 'write', 'delete']}.",
  dependsOn: ["create-admin"]
}
```

**Command Agent Context** (authentication/set-user-claims):
```markdown
## authentication/set-user-claims

### Description
Sets custom claims for a user. Claims are included in ID tokens.

### Required Parameters
- uid (string): User ID
- customClaims (object): Custom claims object (max 1000 bytes)

### JSON Schema
{
  "type": "object",
  "properties": {
    "uid": {
      "type": "string",
      "minLength": 1
    },
    "customClaims": {
      "type": "object"
    }
  },
  "required": ["uid", "customClaims"],
  "additionalProperties": false
}

### Examples

Example 1: Set admin role
{
  "uid": "user123abc",
  "customClaims": {
    "role": "admin",
    "department": "engineering"
  }
}
```

**Command Agent Output**:
```typescript
{
  id: "set-claims",
  service: "authentication",
  command: "set-user-claims",
  input: {
    uid: "{{create-admin.output.uid}}",
    customClaims: {
      role: "admin",
      permissions: ["read", "write", "delete"]
    }
  },
  dependsOn: ["create-admin"]
}
```

**What happened**:
- Referenced dependent task's UID output
- Constructed customClaims object with nested structure
- Properly formatted array of strings for permissions
- Validated against schema (both required fields present)

---

## Summary

### Context Reduction Strategy

| Phase | Context Size | What AI Sees | What AI Decides | Output |
|-------|-------------|--------------|-----------------|--------|
| **Phase 1: Orchestrator** | ~500 tokens | 4 services (high-level) | Service selection, task breakdown, dependencies | Array of service-level sub-tasks |
| **Phase 2: Service Agent** | ~1,500 tokens | Commands for ONE service | Command selection, parameter needs | Command routing with refined prompt |
| **Phase 3: Command Agent** | ~2,000 tokens | Full details for ONE command | Exact parameter values, formatting | Schema-valid executable task |

### Progressive Refinement

```
User: "Create a user and restaurant document"
    ↓
Orchestrator: "I need authentication service for user, firestore service for document"
    ↓
Service Agent (auth): "I need create-user command with userRecord parameter"
Service Agent (firestore): "I need create-document command with documentPath and documentData"
    ↓
Command Agent (auth/create-user): "userRecord = {email: '...', password: '...'}"
Command Agent (firestore/create-document): "documentPath = 'firestore/(default)/data/...', documentData = {...}"
    ↓
Execution: Valid, schema-compliant tasks ready to run
```

### Benefits

**Accuracy Improvements**:
- ✅ **Focused Decision Making**: Each phase makes ONE type of decision with minimal context
- ✅ **Reduced Confusion**: No mixing up parameters from different commands
- ✅ **Better Command Selection**: Service agent sees only relevant commands
- ✅ **Schema Compliance**: Final phase uses structured output for guaranteed validity
- ✅ **Higher Success Rate**: Expected 85%+ first-attempt success (vs current ~60%)

**Token Efficiency**:
- ✅ **Smaller Context Windows**: ~500-2,000 tokens per phase (vs ~8,000 single-phase)
- ✅ **Faster AI Responses**: Less context = faster processing
- ✅ **Lower Costs**: Reduced token usage per orchestration

**Maintainability**:
- ✅ **Separation of Concerns**: Each phase has clear, focused responsibility
- ✅ **Easier Testing**: Can test each phase independently
- ✅ **Better Error Messages**: Know exactly which phase failed
- ✅ **Simpler Debugging**: Inspect intermediate outputs between phases

---

## Implementation Considerations

### Future Implementation Topics

The following sections will be expanded during implementation:

1. **Phase Execution Flow**
   - How phases are called sequentially
   - Data passing between phases
   - Error handling and retry logic

2. **Vertex AI Integration**
   - Model selection per phase
   - Temperature settings
   - Structured output configuration

3. **Validation Strategy**
   - Phase 1 output validation
   - Phase 2 output validation
   - Phase 3 schema enforcement

4. **Performance Optimization**
   - Parallel processing of service agents (Phase 2)
   - Parallel processing of command agents (Phase 3)
   - Caching strategies

5. **Backward Compatibility**
   - Migration path from single-phase
   - Feature flag for gradual rollout
   - Fallback to single-phase on errors

---

## Testing Strategy

### Future Testing Topics

The following will be defined during implementation:

1. **Unit Testing**
   - Test each phase independently
   - Mock AI responses for deterministic tests
   - Validate output schemas

2. **Integration Testing**
   - End-to-end multi-phase orchestration
   - Dependency resolution testing
   - Error propagation across phases

3. **Regression Testing**
   - Compare accuracy: single-phase vs multi-phase
   - Measure success rates per phase
   - Track common failure patterns

4. **Performance Testing**
   - Measure latency per phase
   - Compare total time: single-phase vs multi-phase
   - Token usage analysis

---

**Documentation Version**: 1.0.0
**Status**: Design Specification
**Last Updated**: 2025-01-19
