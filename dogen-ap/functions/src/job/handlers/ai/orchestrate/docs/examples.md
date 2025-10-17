# AI Orchestration Examples

## Table of Contents

1. [Simple Examples](#simple-examples)
2. [Multi-Step Workflows](#multi-step-workflows)
3. [Dependency Patterns](#dependency-patterns)
4. [Real-World Scenarios](#real-world-scenarios)
5. [Error Handling Examples](#error-handling-examples)
6. [Advanced Patterns](#advanced-patterns)

---

## Simple Examples

### Example 1: Single Task Orchestration

**Prompt**: "Copy the users collection to users_backup"

**Input**:
```json
{
  "service": "ai",
  "command": "orchestrate",
  "input": {
    "prompt": "Copy the users collection to users_backup",
    "temperature": 0.2
  }
}
```

**AI-Generated Plan**:
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
    }
  ],
  "reasoning": "Creating a backup copy of the users collection to users_backup"
}
```

**Output**:
```json
{
  "childTasks": [
    {
      "id": "orchestrate-backup",
      "service": "firestore",
      "command": "copy-collection",
      "input": {
        "sourcePath": "firestore/(default)/data/users",
        "destinationPath": "firestore/(default)/data/users_backup"
      },
      "dependsOn": []
    }
  ],
  "reasoning": "Creating a backup copy of the users collection to users_backup",
  "model": "gemini-2.0-flash-thinking-exp-01-21",
  "aiCallDuration": 1245,
  "validationAttempts": 1
}
```

---

### Example 2: Create User with Custom Claims

**Prompt**: "Create a new admin user with email admin@example.com and password securePass123"

**Input**:
```json
{
  "service": "ai",
  "command": "orchestrate",
  "input": {
    "prompt": "Create a new admin user with email admin@example.com and password securePass123",
    "maxRetries": 3
  }
}
```

**AI-Generated Plan**:
```json
{
  "tasks": [
    {
      "service": "authentication",
      "command": "create-user",
      "input": {
        "userRecord": {
          "email": "admin@example.com",
          "password": "securePass123",
          "displayName": "Admin User",
          "emailVerified": true
        },
        "customClaims": {
          "role": "admin",
          "permissions": ["read", "write", "delete"]
        }
      }
    }
  ],
  "reasoning": "Creating admin user with appropriate custom claims for role and permissions"
}
```

---

### Example 3: Export Collection to JSON

**Prompt**: "Export the products collection to Cloud Storage as JSON"

**Input**:
```json
{
  "service": "ai",
  "command": "orchestrate",
  "input": {
    "prompt": "Export the products collection to Cloud Storage as JSON",
    "context": {
      "bucket": "my-exports-bucket"
    }
  }
}
```

**AI-Generated Plan**:
```json
{
  "tasks": [
    {
      "service": "firestore",
      "command": "export-collection-json",
      "input": {
        "collectionPath": "firestore/(default)/data/products",
        "bucketPathPrefix": "gs://my-exports-bucket/exports/products"
      }
    }
  ],
  "reasoning": "Exporting products collection to JSON file in Cloud Storage"
}
```

---

## Multi-Step Workflows

### Example 4: Sequential Processing

**Prompt**: "Copy users to backup, then export the backup to CSV"

**Input**:
```json
{
  "service": "ai",
  "command": "orchestrate",
  "input": {
    "prompt": "Copy users to backup, then export the backup to CSV"
  }
}
```

**AI-Generated Plan**:
```json
{
  "tasks": [
    {
      "id": "copy",
      "service": "firestore",
      "command": "copy-collection",
      "input": {
        "sourcePath": "firestore/(default)/data/users",
        "destinationPath": "firestore/(default)/data/users_backup"
      },
      "dependsOn": []
    },
    {
      "id": "export",
      "service": "firestore",
      "command": "export-collection-csv",
      "input": {
        "collectionPath": "firestore/(default)/data/users_backup",
        "bucketPathPrefix": "gs://exports/users_backup",
        "fields": [
          { "source": "_id_", "header": "User ID" },
          { "source": "email", "header": "Email" },
          { "source": "displayName", "header": "Name" }
        ]
      },
      "dependsOn": ["copy"]
    }
  ],
  "reasoning": "First copying users to backup collection, then exporting backup to CSV"
}
```

**Execution Flow**: `copy → export`

---

### Example 5: Parallel Processing

**Prompt**: "Export both users and products collections to JSON"

**AI-Generated Plan**:
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
      },
      "dependsOn": []
    },
    {
      "id": "export-products",
      "service": "firestore",
      "command": "export-collection-json",
      "input": {
        "collectionPath": "firestore/(default)/data/products",
        "bucketPathPrefix": "gs://exports/products"
      },
      "dependsOn": []
    }
  ],
  "reasoning": "Exporting both collections in parallel for efficiency"
}
```

**Execution Flow**: `[export-users, export-products]` (parallel)

---

### Example 6: Fan-In Aggregation

**Prompt**: "Export users and products, then delete temporary files"

**AI-Generated Plan**:
```json
{
  "tasks": [
    {
      "id": "export-users",
      "service": "firestore",
      "command": "export-collection-json",
      "input": {
        "collectionPath": "firestore/(default)/data/users",
        "bucketPathPrefix": "gs://temp/users"
      },
      "dependsOn": []
    },
    {
      "id": "export-products",
      "service": "firestore",
      "command": "export-collection-json",
      "input": {
        "collectionPath": "firestore/(default)/data/products",
        "bucketPathPrefix": "gs://temp/products"
      },
      "dependsOn": []
    },
    {
      "id": "cleanup",
      "service": "storage",
      "command": "delete-path",
      "input": {
        "path": "gs://temp/old/",
        "limit": 100
      },
      "dependsOn": ["export-users", "export-products"]
    }
  ],
  "reasoning": "Exporting collections in parallel, then cleaning up after both complete"
}
```

**Execution Flow**: `[export-users, export-products] → cleanup`

---

## Dependency Patterns

### Example 7: Diamond Pattern

**Prompt**: "Fetch data, process it in two different ways, then merge the results"

**AI-Generated Plan**:
```json
{
  "tasks": [
    {
      "id": "fetch",
      "service": "firestore",
      "command": "export-collection-json",
      "input": {
        "collectionPath": "firestore/(default)/data/raw_data",
        "bucketPathPrefix": "gs://processing/raw"
      },
      "dependsOn": []
    },
    {
      "id": "process-a",
      "service": "ai",
      "command": "process-inference",
      "input": {
        "model": "gemini-2.5-flash",
        "prompt": "Process data type A",
        "files": ["processing/raw.json"]
      },
      "dependsOn": ["fetch"]
    },
    {
      "id": "process-b",
      "service": "ai",
      "command": "process-inference",
      "input": {
        "model": "gemini-2.5-flash",
        "prompt": "Process data type B",
        "files": ["processing/raw.json"]
      },
      "dependsOn": ["fetch"]
    },
    {
      "id": "merge",
      "service": "firestore",
      "command": "create-document",
      "input": {
        "documentPath": "firestore/(default)/data/results/merged",
        "documentData": {
          "status": "completed",
          "timestamp": "2025-01-17T00:00:00Z"
        }
      },
      "dependsOn": ["process-a", "process-b"]
    }
  ],
  "reasoning": "Diamond pattern: fetch → [process-a, process-b] → merge"
}
```

**Execution Flow**:
```
    fetch
   /     \
process-a process-b
   \     /
    merge
```

---

### Example 8: Complex DAG

**Prompt**: "Multi-stage ETL pipeline with validation and error handling"

**AI-Generated Plan**:
```json
{
  "tasks": [
    {
      "id": "extract",
      "service": "firestore",
      "command": "export-collection-json",
      "input": {
        "collectionPath": "firestore/(default)/data/source",
        "bucketPathPrefix": "gs://etl/extract"
      },
      "dependsOn": []
    },
    {
      "id": "validate",
      "service": "ai",
      "command": "process-inference",
      "input": {
        "model": "gemini-2.5-flash",
        "prompt": "Validate extracted data quality",
        "files": ["etl/extract.json"]
      },
      "dependsOn": ["extract"]
    },
    {
      "id": "transform-1",
      "service": "ai",
      "command": "process-inference",
      "input": {
        "model": "gemini-2.5-pro",
        "prompt": "Transform data format A"
      },
      "dependsOn": ["validate"]
    },
    {
      "id": "transform-2",
      "service": "ai",
      "command": "process-inference",
      "input": {
        "model": "gemini-2.5-pro",
        "prompt": "Transform data format B"
      },
      "dependsOn": ["validate"]
    },
    {
      "id": "load",
      "service": "firestore",
      "command": "import-collection-json",
      "input": {
        "collectionPath": "firestore/(default)/data/destination",
        "bucketPath": "gs://etl/transformed.json"
      },
      "dependsOn": ["transform-1", "transform-2"]
    }
  ],
  "reasoning": "ETL pipeline: extract → validate → [transform-1, transform-2] → load"
}
```

**Execution Flow**:
```
extract → validate → transform-1 → load
                  ↘ transform-2 ↗
```

---

## Real-World Scenarios

### Example 9: User Onboarding Workflow

**Prompt**: "Create a new user account, set admin role, and send welcome document to storage"

**AI-Generated Plan**:
```json
{
  "tasks": [
    {
      "id": "create-user",
      "service": "authentication",
      "command": "create-user",
      "input": {
        "userRecord": {
          "email": "newuser@example.com",
          "password": "temp123456",
          "displayName": "New User",
          "emailVerified": false
        }
      },
      "dependsOn": []
    },
    {
      "id": "set-role",
      "service": "authentication",
      "command": "set-user-claims",
      "input": {
        "uid": "{{create-user.uid}}",
        "customClaims": {
          "role": "admin",
          "onboarded": true
        }
      },
      "dependsOn": ["create-user"]
    },
    {
      "id": "create-profile",
      "service": "firestore",
      "command": "create-document",
      "input": {
        "documentPath": "firestore/(default)/data/user_profiles/{{create-user.uid}}",
        "documentData": {
          "email": "newuser@example.com",
          "displayName": "New User",
          "createdAt": "2025-01-17T00:00:00Z",
          "status": "active"
        }
      },
      "dependsOn": ["create-user"]
    }
  ],
  "reasoning": "User onboarding: create account → [set role, create profile]"
}
```

---

### Example 10: Data Migration

**Prompt**: "Migrate users from old collection to new collection, then delete old collection"

**AI-Generated Plan**:
```json
{
  "tasks": [
    {
      "id": "export-old",
      "service": "firestore",
      "command": "export-collection-json",
      "input": {
        "collectionPath": "firestore/(default)/data/users_old",
        "bucketPathPrefix": "gs://migration/users_old",
        "includeSubcollections": true
      },
      "dependsOn": []
    },
    {
      "id": "import-new",
      "service": "firestore",
      "command": "import-collection-json",
      "input": {
        "collectionPath": "firestore/(default)/data/users_new",
        "bucketPath": "gs://migration/users_old.json"
      },
      "dependsOn": ["export-old"]
    },
    {
      "id": "verify",
      "service": "firestore",
      "command": "list-collections",
      "input": {
        "documentPath": "firestore/(default)/data/"
      },
      "dependsOn": ["import-new"]
    },
    {
      "id": "cleanup",
      "service": "firestore",
      "command": "delete-path",
      "input": {
        "path": "firestore/(default)/data/users_old"
      },
      "dependsOn": ["verify"]
    }
  ],
  "reasoning": "Safe migration: export → import → verify → cleanup"
}
```

**Execution Flow**: `export-old → import-new → verify → cleanup`

---

### Example 11: Batch User Creation

**Prompt**: "Create 3 test users with different roles"

**AI-Generated Plan**:
```json
{
  "tasks": [
    {
      "id": "create-admin",
      "service": "authentication",
      "command": "create-user",
      "input": {
        "userRecord": {
          "email": "admin@test.com",
          "password": "admin123",
          "displayName": "Admin User"
        },
        "customClaims": {
          "role": "admin"
        }
      },
      "dependsOn": []
    },
    {
      "id": "create-moderator",
      "service": "authentication",
      "command": "create-user",
      "input": {
        "userRecord": {
          "email": "moderator@test.com",
          "password": "mod123",
          "displayName": "Moderator User"
        },
        "customClaims": {
          "role": "moderator"
        }
      },
      "dependsOn": []
    },
    {
      "id": "create-viewer",
      "service": "authentication",
      "command": "create-user",
      "input": {
        "userRecord": {
          "email": "viewer@test.com",
          "password": "view123",
          "displayName": "Viewer User"
        },
        "customClaims": {
          "role": "viewer"
        }
      },
      "dependsOn": []
    }
  ],
  "reasoning": "Creating 3 test users in parallel with different roles"
}
```

**Execution Flow**: `[create-admin, create-moderator, create-viewer]` (parallel)

---

## Error Handling Examples

### Example 12: Validation Failure → Retry → Success

**Attempt 1 - Invalid Plan**:
```json
{
  "tasks": [
    {
      "service": "firestore",
      "command": "copy-collection",
      "input": {
        "sourcePath": "users"  // ❌ Invalid path format
      }
    }
  ]
}
```

**Validation Error**:
```
"Task 0 (firestore/copy-collection): /sourcePath must match pattern '^firestore/[^/]+/data/.+'"
```

**Attempt 2 - Fixed Plan** (after error feedback):
```json
{
  "tasks": [
    {
      "service": "firestore",
      "command": "copy-collection",
      "input": {
        "sourcePath": "firestore/(default)/data/users",  // ✅ Valid format
        "destinationPath": "firestore/(default)/data/users_backup"
      }
    }
  ]
}
```

**Result**: ✅ Validation succeeds, task executes

---

### Example 13: Task Limit Exceeded

**Input**:
```json
{
  "service": "ai",
  "command": "orchestrate",
  "input": {
    "prompt": "Create 150 test users",
    "maxChildTasks": 100
  }
}
```

**Attempt 1 - Too Many Tasks**:
```json
{
  "tasks": [ /* 150 create-user tasks */ ]
}
```

**Validation Error**:
```
"Task limit exceeded: AI attempted to create 150 tasks, but maxChildTasks limit is 100.
 Consider breaking down the request into smaller operations or increasing maxChildTasks."
```

**Attempt 2 - Adjusted Approach**:
```json
{
  "tasks": [
    {
      "service": "firestore",
      "command": "import-collection-csv",
      "input": {
        "collectionPath": "firestore/(default)/data/import_users",
        "bucketPath": "gs://imports/users.csv"
      }
    }
  ],
  "reasoning": "Using CSV import instead of individual user creation to respect task limit"
}
```

**Result**: ✅ AI adapts to use batch import instead

---

## Advanced Patterns

### Example 14: Conditional Logic (Simulated with Dependencies)

**Prompt**: "Process data, then either export to CSV or JSON based on size"

**AI-Generated Plan** (AI simulates conditional):
```json
{
  "tasks": [
    {
      "id": "check-size",
      "service": "firestore",
      "command": "list-collections",
      "input": {
        "documentPath": "firestore/(default)/data/"
      },
      "dependsOn": []
    },
    {
      "id": "export-csv",
      "service": "firestore",
      "command": "export-collection-csv",
      "input": {
        "collectionPath": "firestore/(default)/data/data",
        "bucketPathPrefix": "gs://exports/data",
        "fields": [{ "source": "_id_" }]
      },
      "dependsOn": ["check-size"]
    },
    {
      "id": "export-json",
      "service": "firestore",
      "command": "export-collection-json",
      "input": {
        "collectionPath": "firestore/(default)/data/data",
        "bucketPathPrefix": "gs://exports/data"
      },
      "dependsOn": ["check-size"]
    }
  ],
  "reasoning": "Both exports will run; user can choose which output to use based on check-size results"
}
```

**Note**: True conditional logic requires runtime decision-making, which is not yet supported. AI generates both paths.

---

### Example 15: Recursive Orchestration (Depth Limit)

**Prompt**: "Orchestrate a complex workflow that might need sub-orchestration"

**Parent Orchestration**:
```json
{
  "service": "ai",
  "command": "orchestrate",
  "input": {
    "prompt": "Main workflow orchestration",
    "maxDepth": 5  // Allow nested orchestration up to depth 5
  }
}
```

**AI-Generated Plan** (at depth 0):
```json
{
  "tasks": [
    {
      "id": "stage-1",
      "service": "firestore",
      "command": "copy-collection",
      "input": { /* ... */ }
    },
    {
      "id": "sub-orchestrate",
      "service": "ai",
      "command": "orchestrate",
      "input": {
        "prompt": "Handle complex data processing sub-tasks",
        "maxDepth": 4  // Nested orchestration at depth 1
      },
      "dependsOn": ["stage-1"]
    }
  ]
}
```

**Depth Protection**:
- Depth 0: Main orchestration ✅
- Depth 1: Sub-orchestration ✅
- Depth 2-4: Further nesting ✅
- Depth 5: Blocked by maxDepth limit ❌

---

### Example 16: Using Context for Personalization

**Input**:
```json
{
  "service": "ai",
  "command": "orchestrate",
  "input": {
    "prompt": "Set up a new project environment",
    "context": {
      "projectName": "my-app",
      "environment": "production",
      "region": "us-central1",
      "owner": "admin@example.com"
    }
  }
}
```

**AI-Generated Plan** (using context):
```json
{
  "tasks": [
    {
      "id": "create-admin",
      "service": "authentication",
      "command": "create-user",
      "input": {
        "userRecord": {
          "email": "admin@example.com",
          "password": "auto-generated-temp-password",
          "displayName": "my-app Admin"
        },
        "customClaims": {
          "role": "admin",
          "environment": "production",
          "project": "my-app"
        }
      }
    },
    {
      "id": "create-config",
      "service": "firestore",
      "command": "create-document",
      "input": {
        "documentPath": "firestore/(default)/data/config/my-app",
        "documentData": {
          "projectName": "my-app",
          "environment": "production",
          "region": "us-central1",
          "owner": "admin@example.com",
          "createdAt": "2025-01-17T00:00:00Z"
        }
      }
    }
  ],
  "reasoning": "Setting up project environment with context-aware configuration"
}
```

---

## Output Metadata

Every orchestration includes metadata:

```json
{
  "childTasks": [ /* tasks */ ],
  "reasoning": "AI's explanation of the plan",
  "model": "gemini-2.0-flash-thinking-exp-01-21",
  "aiCallDuration": 1245,  // milliseconds
  "validationAttempts": 2  // number of retries needed
}
```

### Understanding Validation Attempts

- **1 attempt**: Plan was valid on first try ✅
- **2 attempts**: Plan failed once, succeeded on retry
- **3 attempts**: Plan failed twice, succeeded on third try
- **>3 attempts**: Max retries exceeded, returned error

High validation attempts indicate:
1. Complex or ambiguous prompt
2. Missing catalog information
3. Strict schema constraints
4. AI learning curve

---

## Best Practices for Prompts

### 1. Be Specific
❌ Bad: "Do something with users"
✅ Good: "Copy the users collection to users_backup"

### 2. Include Details
❌ Bad: "Export data"
✅ Good: "Export the products collection to JSON in Cloud Storage bucket my-exports"

### 3. Specify Dependencies
❌ Bad: "Copy users and export them"
✅ Good: "Copy users to backup, then export the backup to CSV"

### 4. Use Context for Dynamic Values
❌ Bad: Hardcode values in prompt
✅ Good: Pass values via context object

### 5. Consider Limits
❌ Bad: "Create 500 users"
✅ Good: "Import users from CSV file" (batch operation)

### 6. Trust the AI
- AI understands task catalog and constraints
- AI will generate proper Firestore paths and formats
- AI will create dependency chains for sequential operations
- AI will parallelize independent tasks automatically
