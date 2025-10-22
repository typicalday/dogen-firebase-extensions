/**
 * Centralized Handler Registry
 *
 * This is the single source of truth for all task handler definitions.
 * Benefits:
 * - DRY principle: Handler definitions exist in ONE place
 * - Type safety: Handler function signatures are enforced
 * - Automatic validation: Tests use the same registry
 * - Easier maintenance: Add new handlers in one location
 * - Better routing: Replace nested switches with simple lookup
 *
 * When adding a new handler:
 * 1. Create the handler file in handlers/{service}/{command}.ts
 * 2. Import the handler function here
 * 3. Add entry to HANDLER_REGISTRY with all metadata
 * 4. That's it! No need to update processJob.ts, catalog.ts, or tests
 */

import { JobTask } from "../jobTask";
import { JobContext } from "../jobContext";

// Import all Firestore handlers
import { handleCopyCollection } from "./firestore/copyCollection";
import { handleCopyDocument } from "./firestore/copyDocument";
import { handleCreateDocument } from "./firestore/createDocument";
import { handleDeletePath } from "./firestore/deletePath";
import { handleDeleteDocuments } from "./firestore/deleteDocuments";
import { handleExportCollectionCSV } from "./firestore/exportCollectionCSV";
import { handleExportCollectionJSON } from "./firestore/exportCollectionJSON";
import { handleImportCollectionCSV } from "./firestore/importCollectionCSV";
import { handleImportCollectionJSON } from "./firestore/importCollectionJSON";
import { handleListCollections } from "./firestore/listCollections";

// Import all Storage handlers
import { handleDeleteStoragePath } from "./storage/deletePath";

// Import all AI handlers
import { handleProcessInference } from "./ai/processInference";
import { handleOrchestratorAgent } from "./ai/orchestrator-agent";
import { handleServiceAgent } from "./ai/service-agent/handler";
import { handleCommandAgent } from "./ai/command-agent/handler";

// Import all Authentication handlers
import { handleCreateUser } from "./authentication/createUser";
import { handleGetUser } from "./authentication/getUser";
import { handleUpdateUser } from "./authentication/updateUser";
import { handleDeleteUser } from "./authentication/deleteUser";
import { handleListUsers } from "./authentication/listUsers";
import { handleGetUserClaims } from "./authentication/getUserClaims";
import { handleSetUserClaims } from "./authentication/setUserClaims";

/**
 * Type definition for a handler function
 * All handlers receive the task and job context for inter-task communication
 */
export type HandlerFunction = (task: JobTask, context: JobContext) => Promise<Record<string, any>>;

/**
 * JSON Schema property definition
 */
export interface SchemaProperty {
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
  pattern?: string;
  description?: string;
  minimum?: number;
  maximum?: number;
  enum?: any[];
  properties?: Record<string, SchemaProperty>;
  items?: SchemaProperty;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * JSON Schema definition for handler input validation
 */
export interface InputSchema {
  type: 'object';
  properties: Record<string, SchemaProperty>;
  required: string[];
  additionalProperties?: boolean;
}

/**
 * Complete definition for a task handler including metadata
 */
export interface HandlerDefinition {
  /** The actual handler function to execute */
  handler: HandlerFunction;

  /** Human-readable description of what this handler does */
  description: string;

  /** Required input parameters for this handler */
  requiredParams: string[];

  /** Optional input parameters for this handler */
  optionalParams?: string[];

  /** JSON Schema for validating input structure and types */
  inputSchema?: InputSchema;

  /** Example usage scenarios with descriptions */
  examples?: Array<{
    input: Record<string, any>;
    description: string;
  }>;
}

/**
 * Service-level registry: maps command names to handler definitions
 */
export type ServiceHandlers = Record<string, HandlerDefinition>;

/**
 * Top-level registry: maps service names to service handlers
 */
export type HandlerRegistry = Record<string, ServiceHandlers>;

/**
 * CENTRALIZED HANDLER REGISTRY
 *
 * This is the single source of truth for all handler definitions.
 * Each entry contains:
 * - handler: The function to execute
 * - description: What the handler does (for AI catalog)
 * - requiredParams: Parameters that must be provided
 * - optionalParams: Parameters that can be provided
 * - examples: Usage examples (for AI understanding)
 */
export const HANDLER_REGISTRY: HandlerRegistry = {
  // ==================== FIRESTORE HANDLERS ====================
  firestore: {
    "copy-collection": {
      handler: handleCopyCollection,
      description:
        "Copy entire Firestore collection with all documents and subcollections",
      requiredParams: ["sourcePath", "destinationPath"],
      optionalParams: [],
      inputSchema: {
        type: 'object',
        properties: {
          sourcePath: {
            type: 'string',
            pattern: '^\/?firestore/[^/]+/data/.+',
            description: 'Source collection path in format: firestore/{database}/data/{collection}'
          },
          destinationPath: {
            type: 'string',
            pattern: '^\/?firestore/[^/]+/data/.+',
            description: 'Destination collection path in format: firestore/{database}/data/{collection}'
          }
        },
        required: ['sourcePath', 'destinationPath'],
        additionalProperties: false
      },
      examples: [
        {
          input: {
            sourcePath: "firestore/default/data/users",
            destinationPath: "firestore/default/data/users_backup",
          },
          description: "Backup users collection",
        },
        {
          input: {
            sourcePath: "firestore/custom-db/data/products",
            destinationPath: "firestore/default/data/products_archive",
          },
          description: "Cross-database collection copy",
        },
      ],
    },

    "copy-document": {
      handler: handleCopyDocument,
      description:
        "Copy single Firestore document with all subcollections to new location",
      requiredParams: ["sourcePath", "destinationPath"],
      optionalParams: [],
      inputSchema: {
        type: 'object',
        properties: {
          sourcePath: {
            type: 'string',
            pattern: '^\/?firestore/[^/]+/data/.+',
            description: 'Source document path in format: firestore/{database}/data/{collection}/{docId}. Must have an even number of path segments (collection/doc pairs).'
          },
          destinationPath: {
            type: 'string',
            pattern: '^\/?firestore/[^/]+/data/.+',
            description: 'Destination document path in format: firestore/{database}/data/{collection}/{docId}. Must have an even number of path segments (collection/doc pairs).'
          }
        },
        required: ['sourcePath', 'destinationPath'],
        additionalProperties: false
      },
      examples: [
        {
          input: {
            sourcePath: "firestore/default/data/users/user123",
            destinationPath: "firestore/default/data/users_archive/user123",
          },
          description: "Archive user document",
        },
        {
          input: {
            sourcePath: "firestore/(default)/data/products/prod456",
            destinationPath: "firestore/default/data/products_backup/prod456",
          },
          description: "Backup product with subcollections",
        },
      ],
    },

    "create-document": {
      handler: handleCreateDocument,
      description:
        "Create or overwrite Firestore document with provided data",
      requiredParams: ["documentPath", "documentData"],
      optionalParams: [],
      inputSchema: {
        type: 'object',
        properties: {
          documentPath: {
            type: 'string',
            pattern: '^\/?firestore/[^/]+/data/.+',
            description: 'Document path in format: firestore/{database}/data/{collection}/{docId}. Must have an even number of path segments (collection/doc pairs).'
          },
          documentData: {
            type: 'object',
            description: 'Document fields, properties, and data to store. Supports nested objects and arrays. Examples: {name: "John", email: "test@example.com", status: "active"}. Can be empty {}.',
            additionalProperties: true,
          }
        },
        required: ['documentPath', 'documentData'],
        additionalProperties: false
      },
      examples: [
        {
          input: {
            documentPath: "firestore/default/data/users/newUser",
            documentData: {
              name: "John Doe",
              email: "john@example.com",
              createdAt: "2025-01-17T00:00:00Z",
            },
          },
          description: "New user with profile data",
        },
        {
          input: {
            documentPath: "firestore/(default)/data/users/user123/profile/main",
            documentData: {
              bio: "Software developer",
              interests: ["coding", "music"],
              verified: true,
            },
          },
          description: "Nested document in subcollection",
        },
      ],
    },

    "delete-path": {
      handler: handleDeletePath,
      description:
        "Recursively delete all documents and subcollections at Firestore path",
      requiredParams: ["path"],
      optionalParams: [],
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            pattern: '^\/?firestore/[^/]+/data/.+',
            description: 'Firestore path to delete in format: firestore/{database}/data/{collection} or firestore/{database}/data/{collection}/{docId}. Can be a collection or document path. All subcollections and documents will be recursively deleted.'
          }
        },
        required: ['path'],
        additionalProperties: false
      },
      examples: [
        {
          input: {
            path: "firestore/default/data/temp_data",
          },
          description: "Delete entire temp_data collection and all its contents",
        },
        {
          input: {
            path: "firestore/default/data/users/user123",
          },
          description: "Delete specific user document",
        },
      ],
    },

    "delete-documents": {
      handler: handleDeleteDocuments,
      description: "Deletes multiple documents specified by an array of paths. Uses batch operations and supports multiple databases.",
      requiredParams: ["paths"],
      optionalParams: [],
      inputSchema: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: {
              type: 'string',
              pattern: '^\/?firestore/[^/]+/data/.+',
              description: 'Document path in format: firestore/{database}/data/{collection}/{docId}'
            },
            description: 'Array of Firestore document paths to delete. Must be a non-empty array. Documents can be from different databases.'
          }
        },
        required: ['paths'],
        additionalProperties: false
      },
      examples: [
        {
          input: {
            paths: [
              "firestore/default/data/temp/doc1",
              "firestore/default/data/temp/doc2",
              "firestore/default/data/temp/doc3",
            ],
          },
          description: "Delete multiple temporary documents in batch",
        },
      ],
    },

    "export-collection-csv": {
      handler: handleExportCollectionCSV,
      description:
        "Exports a Firestore collection to a CSV file in Cloud Storage with customizable field selection and formatting. Supports special field identifiers (_id_ for document ID, _ref_ for document reference path), nested field access using dot notation (e.g., 'user.name'), and custom CSV headers. Handles Firestore-specific types (Timestamp, GeoPoint, DocumentReference, Vector, Bytes) with automatic formatting.",
      requiredParams: ["collectionPath", "bucketPathPrefix", "fields"],
      optionalParams: ["limit", "orderByField", "orderByDirection", "delimiter"],
      inputSchema: {
        type: 'object',
        properties: {
          collectionPath: {
            type: 'string',
            pattern: '^\/?firestore/[^/]+/data/.+',
            description: 'Firestore collection path in format: firestore/{database}/data/{collection}. Must be a collection path (odd number of segments).'
          },
          bucketPathPrefix: {
            type: 'string',
            pattern: '^gs://[^/]+/.+',
            description: 'Cloud Storage destination path prefix in format: gs://{bucket}/{path}. The exported CSV will be saved here with a timestamp suffix.'
          },
          fields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                source: {
                  type: 'string',
                  description: 'Document field in dot notation (e.g., "user.name"). Special identifiers: "_id_" (document ID), "_ref_" (document path).'
                },
                header: {
                  type: 'string',
                  description: 'Optional CSV column header name. Defaults to source field name.'
                }
              }
            },
            description: 'Array of field definitions specifying which document fields to export and their CSV column headers.'
          },
          limit: {
            type: 'number',
            minimum: 1,
            description: 'Maximum number of documents to export. If not specified, exports entire collection.'
          },
          orderByField: {
            type: 'string',
            description: 'Document field name to order results by before exporting.'
          },
          orderByDirection: {
            type: 'string',
            enum: ['asc', 'desc'],
            description: 'Sort direction when orderByField is specified. Either "asc" (ascending) or "desc" (descending).'
          },
          delimiter: {
            type: 'string',
            description: 'CSV delimiter character. Defaults to comma (,). Common alternatives: semicolon (;), tab (\\t), pipe (|).'
          }
        },
        required: ['collectionPath', 'bucketPathPrefix', 'fields'],
        additionalProperties: false
      },
      examples: [
        {
          input: {
            collectionPath: "firestore/default/data/users",
            bucketPathPrefix: "gs://my-bucket/exports",
            fields: [
              { source: "_id_", header: "User ID" },
              { source: "name" },
              { source: "email" },
              { source: "profile.bio", header: "Biography" }
            ]
          },
          description: "Export users collection with document ID, name, email, and nested bio field to CSV",
        },
        {
          input: {
            collectionPath: "firestore/default/data/products",
            bucketPathPrefix: "gs://my-bucket/exports",
            fields: [
              { source: "_id_" },
              { source: "name" },
              { source: "price" }
            ],
            limit: 1000,
            orderByField: "price",
            orderByDirection: "desc",
            delimiter: ";"
          },
          description: "Export top 1000 products ordered by price descending, using semicolon delimiter",
        },
      ],
    },

    "export-collection-json": {
      handler: handleExportCollectionJSON,
      description:
        "Exports a Firestore collection to a JSON file in Cloud Storage. Automatically handles Firestore-specific types (Timestamp, GeoPoint, DocumentReference, Vector, Bytes) by converting them to JSON-serializable format with type identifiers. Supports optional subcollection inclusion and query filtering (limit, orderBy). Generated filename includes timestamp suffix automatically.",
      requiredParams: ["collectionPath", "bucketPathPrefix"],
      optionalParams: ["includeSubcollections", "limit", "orderByField", "orderByDirection"],
      inputSchema: {
        type: 'object',
        properties: {
          collectionPath: {
            type: 'string',
            pattern: '^\/?firestore/[^/]+/data/.+',
            description: 'Firestore collection path in format: firestore/{database}/data/{collection}. Must be a collection path (odd number of segments).'
          },
          bucketPathPrefix: {
            type: 'string',
            pattern: '^gs://[^/]+/.+',
            description: 'Cloud Storage destination path prefix in format: gs://{bucket}/{path}. The exported JSON will be saved here with a timestamp suffix (e.g., {collection}_{timestamp}.json).'
          },
          includeSubcollections: {
            type: 'boolean',
            description: 'Whether to include subcollections in the export. If true, all nested subcollections will be recursively exported.'
          },
          limit: {
            type: 'number',
            minimum: 1,
            description: 'Maximum number of documents to export from the collection. If not specified, exports entire collection.'
          },
          orderByField: {
            type: 'string',
            description: 'Document field name to order results by before exporting. Requires the field to be indexed if used with limit.'
          },
          orderByDirection: {
            type: 'string',
            enum: ['asc', 'desc'],
            description: 'Sort direction when orderByField is specified. Either "asc" (ascending) or "desc" (descending). Defaults to "asc" if not specified.'
          }
        },
        required: ['collectionPath', 'bucketPathPrefix'],
        additionalProperties: false
      },
      examples: [
        {
          input: {
            collectionPath: "firestore/default/data/products",
            bucketPathPrefix: "gs://my-bucket/exports",
          },
          description: "Export entire products collection to JSON file with automatic timestamp naming",
        },
        {
          input: {
            collectionPath: "firestore/default/data/users",
            bucketPathPrefix: "gs://my-bucket/backups",
            includeSubcollections: true,
          },
          description: "Export users collection including all subcollections (e.g., user preferences, orders)",
        },
        {
          input: {
            collectionPath: "firestore/default/data/posts",
            bucketPathPrefix: "gs://my-bucket/exports",
            limit: 100,
            orderByField: "createdAt",
            orderByDirection: "desc",
          },
          description: "Export top 100 most recent posts ordered by creation date descending",
        },
      ],
    },

    "import-collection-csv": {
      handler: handleImportCollectionCSV,
      description:
        "Imports data from a CSV file in Cloud Storage into a Firestore collection. Supports custom field mappings to transform CSV columns into Firestore document fields with nested object support (dot notation). Special field identifiers: _id_ (document ID), _ref_ (document reference path). Automatically handles Firestore-specific types using prefixes: __ref: (DocumentReference), __geo: (GeoPoint), __vector: (array), __bytes: (base64). Supports custom CSV delimiters and automatic ISO8601 date parsing to Timestamp.",
      requiredParams: ["collectionPath", "bucketPath"],
      optionalParams: ["fieldMappings", "delimiter"],
      inputSchema: {
        type: 'object',
        properties: {
          collectionPath: {
            type: 'string',
            pattern: '^\/?firestore/[^/]+/data/.+',
            description: 'Firestore collection path in format: firestore/{database}/data/{collection}. Must be a collection path (odd number of segments).'
          },
          bucketPath: {
            type: 'string',
            pattern: '^gs://[^/]+/.+\\.csv$',
            description: 'Cloud Storage path to CSV file in format: gs://{bucket}/{path}/{filename}.csv'
          },
          fieldMappings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                header: {
                  type: 'string',
                  description: 'CSV column header to map from'
                },
                destination: {
                  type: 'string',
                  description: 'Destination field path in Firestore document (supports dot notation for nested fields, e.g., "user.name"). Use "_id_" for document ID, "_ref_" for document reference path. Set to null to exclude field from import.'
                }
              }
            },
            description: 'Optional array of field mappings to transform CSV columns into Firestore fields. Allows renaming, nesting, and excluding fields.'
          },
          delimiter: {
            type: 'string',
            description: 'CSV delimiter character. Defaults to comma (,). Common alternatives: semicolon (;), tab (\\t), pipe (|).'
          }
        },
        required: ['collectionPath', 'bucketPath'],
        additionalProperties: false
      },
      examples: [
        {
          input: {
            collectionPath: "firestore/default/data/imported_users",
            bucketPath: "gs://my-bucket/imports/users.csv",
          },
          description: "Import users from CSV file with automatic field mapping",
        },
        {
          input: {
            collectionPath: "firestore/default/data/products",
            bucketPath: "gs://my-bucket/imports/products.csv",
            fieldMappings: [
              { header: "id", destination: "_id_" },
              { header: "product_name", destination: "name" },
              { header: "category_name", destination: "category.name" },
              { header: "price_usd", destination: "price" }
            ],
            delimiter: ";"
          },
          description: "Import products with custom field mappings, nested fields, and semicolon delimiter",
        },
        {
          input: {
            collectionPath: "firestore/default/data/locations",
            bucketPath: "gs://my-bucket/imports/locations.csv",
            fieldMappings: [
              { header: "name", destination: "name" },
              { header: "coordinates", destination: "location" }
            ]
          },
          description: "Import locations with GeoPoint coordinates (use __geo:lat,lng format in CSV)",
        },
      ],
    },

    "import-collection-json": {
      handler: handleImportCollectionJSON,
      description:
        "Imports data from a JSON file in Cloud Storage into a Firestore collection. Automatically handles Firestore-specific types (Timestamp, GeoPoint, DocumentReference, Vector, Bytes) by converting them back from JSON-serializable format with type identifiers. Supports subcollections by recursively importing nested collection structures. Uses streaming JSON parser for efficient processing of large files. Expects JSON format matching export-collection-json output structure.",
      requiredParams: ["collectionPath", "bucketPath"],
      optionalParams: [],
      inputSchema: {
        type: 'object',
        properties: {
          collectionPath: {
            type: 'string',
            pattern: '^\/?firestore/[^/]+/data/.+',
            description: 'Firestore collection path in format: firestore/{database}/data/{collection}. Must be a collection path (odd number of segments). All documents from the JSON file will be imported into this collection.'
          },
          bucketPath: {
            type: 'string',
            pattern: '^gs://[^/]+/.+\\.json$',
            description: 'Cloud Storage path to JSON file in format: gs://{bucket}/{path}/{filename}.json. File should be in the format produced by export-collection-json handler.'
          }
        },
        required: ['collectionPath', 'bucketPath'],
        additionalProperties: false
      },
      examples: [
        {
          input: {
            collectionPath: "firestore/default/data/imported_products",
            bucketPath: "gs://my-bucket/imports/products.json",
          },
          description: "Import products from JSON file into Firestore",
        },
        {
          input: {
            collectionPath: "firestore/default/data/users_restored",
            bucketPath: "gs://my-bucket/backups/users_backup_20250117.json",
          },
          description: "Restore users collection from JSON backup including subcollections",
        },
      ],
    },

    "list-collections": {
      handler: handleListCollections,
      description: "Lists Firestore collections. Can list top-level collections in a database or subcollections of a specific document. When no documentPath is provided, lists top-level collections in the default database. When documentPath points to a database (firestore/{database}/data/), lists top-level collections in that database. When documentPath points to a document, lists subcollections under that document.",
      requiredParams: [],
      optionalParams: ["documentPath"],
      inputSchema: {
        type: 'object',
        properties: {
          documentPath: {
            type: 'string',
            pattern: '^\/?firestore/[^/]+/data(/.*)?$',
            description: 'Optional Firestore path. Format: firestore/{database}/data/ to list top-level collections in a specific database, or firestore/{database}/data/{collection}/{docId}/... to list subcollections under a document. If omitted, lists top-level collections in default database.'
          }
        },
        required: [],
        additionalProperties: false
      },
      examples: [
        {
          input: {},
          description: "List all top-level collections in the default database",
        },
        {
          input: {
            documentPath: "firestore/custom-db/data/",
          },
          description: "List all top-level collections in the custom-db database",
        },
        {
          input: {
            documentPath: "firestore/default/data/users/user123",
          },
          description: "List all subcollections under the users/user123 document",
        },
      ],
    },
  },

  // ==================== STORAGE HANDLERS ====================
  storage: {
    "delete-path": {
      handler: handleDeleteStoragePath,
      description:
        "Recursively deletes all files and folders at the specified Cloud Storage path. Deletes files in batches with a safety limit to prevent runaway deletions. By default, only deletes 1 file (use limit parameter to delete more).",
      requiredParams: ["path"],
      optionalParams: ["limit"],
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            pattern: '^gs://[^/]+/.+',
            description: 'Cloud Storage path in format: gs://{bucket}/{path}. All files with this prefix will be deleted.'
          },
          limit: {
            type: 'number',
            minimum: 1,
            description: 'Maximum number of files to delete. Defaults to 1 as a safety limit to prevent accidental mass deletions. Set to a higher number to delete more files.'
          }
        },
        required: ['path'],
        additionalProperties: false
      },
      examples: [
        {
          input: {
            path: "gs://my-bucket/temp_uploads/",
            limit: 100
          },
          description: "Delete up to 100 files in temporary uploads folder",
        },
        {
          input: {
            path: "gs://my-bucket/exports/old_exports/",
            limit: 1000
          },
          description: "Clean up to 1000 old export files",
        },
        {
          input: {
            path: "gs://my-bucket/test/single_file.txt",
          },
          description: "Delete a single file (default limit of 1)",
        },
      ],
    },
  },

  // ==================== AI HANDLERS ====================
  ai: {
    "process-inference": {
      handler: handleProcessInference,
      description:
        "AI inference with Vertex AI Gemini models. Supports multimodal inputs: text, images, audio, video, documents",
      requiredParams: ["prompt"],
      optionalParams: [
        "model",
        "files",
        "systemInstruction",
        "temperature",
        "maxOutputTokens",
        "topP",
        "topK",
        "responseMimeType",
        "responseSchema",
        "candidateCount",
        "stopSequences",
      ],
      inputSchema: {
        type: 'object',
        properties: {
          model: {
            type: 'string',
            pattern: '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$',
            description: 'Vertex AI model identifier to use for inference. Common models include: gemini-2.5-pro (best quality, default), gemini-2.5-flash (fast). Also supports Anthropic Claude, Mistral, and other Model Garden models. See full list: https://cloud.google.com/vertex-ai/generative-ai/docs/model-garden/available-models. The Vertex AI SDK will validate the model name and return an error if invalid. Defaults to gemini-2.5-pro if not specified.'
          },
          prompt: {
            type: 'string',
            description: 'Text prompt for the AI model. This is the main instruction or question for the model.'
          },
          files: {
            type: 'array',
            items: {
              type: 'string',
              pattern: '^(gs://[^/]+/.+|[^/]+/.+)$',
              description: 'File path in format: gs://{bucket}/{path} for Cloud Storage URLs, or {bucket}/{path} for Firebase Storage paths'
            },
            description: 'Optional array of file paths to process. Supports images (PNG, JPEG, WebP), videos (MP4, MOV, MPEG, WebM, FLV, AVI, WMV, 3GP), audio (AAC, FLAC, MP3, WAV, OGG), and documents (PDF, plain text). Limits: 3000 images, 10 videos, 1 audio, 3000 documents.'
          },
          systemInstruction: {
            type: 'string',
            description: 'Optional system instruction to guide the model behavior and response style. Sets the context for how the model should respond.'
          },
          temperature: {
            type: 'number',
            minimum: 0.0,
            maximum: 2.0,
            description: 'Controls randomness in response generation (0.0-2.0). Lower values (0.0-0.3) are more deterministic and focused, higher values (0.7-2.0) are more creative and varied. Default varies by model.'
          },
          maxOutputTokens: {
            type: 'number',
            minimum: 1,
            maximum: 8192,
            description: 'Maximum number of tokens to generate in the response (1-8192). Limits the length of the model output. Default varies by model.'
          },
          topP: {
            type: 'number',
            minimum: 0.0,
            maximum: 1.0,
            description: 'Nucleus sampling parameter (0.0-1.0). Controls diversity via cumulative probability. Lower values make output more focused, higher values more diverse. Default varies by model.'
          },
          topK: {
            type: 'number',
            minimum: 1,
            maximum: 40,
            description: 'Top-K sampling parameter (1-40). Limits token selection to top K most likely tokens. Lower values make output more focused. Default varies by model.'
          },
          responseMimeType: {
            type: 'string',
            enum: ['text/plain', 'application/json'],
            description: 'Desired output format. Use "text/plain" for natural text responses, "application/json" for structured JSON output. When using JSON, provide responseSchema.'
          },
          responseSchema: {
            type: 'object',
            description: 'JSON Schema defining the structure of the expected JSON response. Required when responseMimeType is "application/json". Should be a valid JSON Schema object with type, properties, etc.',
            additionalProperties: true
          },
          candidateCount: {
            type: 'number',
            minimum: 1,
            maximum: 8,
            description: 'Number of response candidates to generate (1-8). Only the first candidate is returned. Higher values consume more resources. Default is 1.'
          },
          stopSequences: {
            type: 'array',
            items: {
              type: 'string',
              description: 'Stop sequence string'
            },
            description: 'Optional array of strings that will stop generation when encountered. Maximum of 5 stop sequences. Use to control where the model stops generating.'
          }
        },
        required: ['prompt'],
        additionalProperties: false
      },
      examples: [
        {
          input: {
            prompt: "Analyze this data and provide insights",
            systemInstruction: "You are a data analysis expert",
            temperature: 0.7,
            maxOutputTokens: 1000,
          },
          description: "Run AI analysis using default model (gemini-2.5-pro)",
        },
        {
          input: {
            model: "gemini-2.5-pro",
            prompt: "Analyze this data and provide insights",
            systemInstruction: "You are a data analysis expert",
            temperature: 0.7,
            maxOutputTokens: 1000,
          },
          description: "Run AI analysis with explicitly specified Gemini 2.5 Pro for best quality and reasoning",
        },
        {
          input: {
            model: "gemini-2.5-flash",
            prompt: "Describe what you see in these images",
            files: ["gs://bucket/image1.jpg", "gs://bucket/image2.jpg"],
            temperature: 0.3,
          },
          description:
            "Analyze multiple images with Gemini 2.5 Flash for fast processing",
        },
        {
          input: {
            model: "gemini-2.0-flash-lite",
            prompt: "Extract structured data from this document",
            files: ["exports/document.pdf"],
            responseMimeType: "application/json",
            responseSchema: {
              type: "object",
              properties: {
                name: { type: "string" },
                date: { type: "string" },
              },
            },
          },
          description: "Extract structured JSON data using cost-efficient Gemini 2.0 Flash-Lite",
        },
      ],
    },

    "orchestrator-agent": {
      handler: handleOrchestratorAgent,
      description:
        "Phase 1 of 3-phase AI orchestration. Analyzes natural language request, decomposes into service-level sub-tasks, returns ai:service-agent tasks. Handles multi-step workflows with dependency resolution",
      requiredParams: ["prompt"],
      optionalParams: [
        "temperature",
        "context",
        "maxChildTasks",
        "timeout",
        "maxDepth",
        "verbose",
        "maxRetries",
        "model",
      ],
      inputSchema: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Natural language description of tasks to orchestrate'
          },
          temperature: {
            type: 'number',
            minimum: 0.0,
            maximum: 1.0,
            description: 'AI temperature for response generation (0.0-1.0). Default: 0.2'
          },
          context: {
            type: 'object',
            description: 'Additional context information for the AI',
            additionalProperties: true
          },
          maxChildTasks: {
            type: 'number',
            minimum: 1,
            maximum: 1000,
            description: 'Maximum number of child tasks that can be spawned. Default: 100'
          },
          timeout: {
            type: 'number',
            minimum: 1000,
            maximum: 300000,
            description: 'Timeout in milliseconds for AI call (1s-5min). Default: 60000'
          },
          maxDepth: {
            type: 'number',
            minimum: 0,
            maximum: 100,
            description: 'Maximum task depth allowed for child tasks. Default: 10'
          },
          verbose: {
            type: 'boolean',
            description: 'Enable verbose logging throughout orchestration. When true, outputs detailed logging at each step. Defaults to context.verbose if not specified.'
          },
          maxRetries: {
            type: 'number',
            minimum: 1,
            maximum: 10,
            description: 'Maximum number of retry attempts if validation fails. Default: 3'
          },
          model: {
            type: 'string',
            description: 'Vertex AI model to use for orchestration. Default: "gemini-2.5-pro"'
          }
        },
        required: ['prompt'],
        additionalProperties: false
      },
      examples: [
        {
          input: {
            prompt: "Create an admin user with email admin@company.com and store their profile in Firestore",
          },
          description: "Simple orchestration - AI determines services needed (authentication, firestore), spawns service agents, which spawn command agents. Job-level aiPlanning controls execution.",
        },
        {
          input: {
            prompt: "Export all product data to JSON, then create a backup copy in Firestore",
            context: {
              reason: "monthly backup",
              requestedBy: "admin",
            },
            maxChildTasks: 10,
          },
          description: "Multi-step workflow with context and task limit. The 3-phase system handles task decomposition, service selection, command selection, and parameter construction automatically.",
        },
        {
          input: {
            prompt: "Analyze user behavior data and generate insights",
            timeout: 120000,
            temperature: 0.2,
            verbose: true,
          },
          description: "Complex orchestration with extended timeout and detailed logging. Orchestrator spawns ai:service-agent tasks, which spawn ai:command-agent tasks, which spawn actual commands.",
        },
      ],
    },

    "service-agent": {
      handler: handleServiceAgent,
      description:
        "Phase 2 of 3-phase orchestration. Receives service and prompt, selects appropriate command, returns ai:command-agent task. Narrows focus from service to command level",
      requiredParams: ["id", "service", "prompt", "dependsOn"],
      optionalParams: ["maxRetries", "model"],
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Task ID assigned by orchestrator (e.g., "task-0", "create-admin")'
          },
          service: {
            type: 'string',
            enum: ['ai', 'authentication', 'firestore', 'storage'],
            description: 'Service name to select command from'
          },
          prompt: {
            type: 'string',
            description: 'Refined prompt from orchestrator describing what needs to be done'
          },
          dependsOn: {
            type: 'array',
            items: { type: 'string' },
            description: 'Task IDs this task depends on. Empty array if no dependencies.'
          },
          maxRetries: {
            type: 'number',
            minimum: 1,
            maximum: 10,
            description: 'Maximum number of retry attempts if validation fails. Default: 3'
          },
          model: {
            type: 'string',
            description: 'Vertex AI model to use for command selection. Default: "gemini-2.5-pro"'
          }
        },
        required: ['id', 'service', 'prompt', 'dependsOn'],
        additionalProperties: false
      },
    },

    "command-agent": {
      handler: handleCommandAgent,
      description:
        "Phase 3 of 3-phase orchestration. Receives command and prompt, constructs schema-valid parameters, returns executable command task. Final refinement from command to parameters",
      requiredParams: ["id", "service", "command", "prompt", "dependsOn"],
      optionalParams: ["maxRetries", "model"],
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Task ID assigned by orchestrator (passthrough from service agent)'
          },
          service: {
            type: 'string',
            description: 'Service name (passthrough from service agent)'
          },
          command: {
            type: 'string',
            description: 'Command name within the service (selected by service agent)'
          },
          prompt: {
            type: 'string',
            description: 'Refined prompt from service agent describing parameter requirements'
          },
          dependsOn: {
            type: 'array',
            items: { type: 'string' },
            description: 'Task IDs this task depends on. Empty array if no dependencies.'
          },
          maxRetries: {
            type: 'number',
            minimum: 1,
            maximum: 10,
            description: 'Maximum number of retry attempts if validation fails. Default: 3'
          },
          model: {
            type: 'string',
            description: 'Vertex AI model to use for parameter construction. Default: "gemini-2.5-pro"'
          }
        },
        required: ['id', 'service', 'command', 'prompt', 'dependsOn'],
        additionalProperties: false
      },
    },
  },

  // ==================== AUTHENTICATION HANDLERS ====================
  authentication: {
    "create-user": {
      handler: handleCreateUser,
      description:
        "Create Firebase Auth user with email/password and optional custom claims for roles/permissions",
      requiredParams: ["userRecord"],
      optionalParams: ["customClaims"],
      inputSchema: {
        type: 'object',
        properties: {
          userRecord: {
            type: 'object',
            description: 'Firebase Auth CreateRequest object containing user properties. At minimum must include email and password.',
            properties: {
              email: {
                type: 'string',
                pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
                description: 'Valid email address for the user'
              },
              password: {
                type: 'string',
                description: 'Password for the user (minimum 6 characters required by Firebase)'
              },
              displayName: {
                type: 'string',
                description: 'Optional display name for the user'
              },
              photoURL: {
                type: 'string',
                description: 'Optional URL of the user profile photo'
              },
              phoneNumber: {
                type: 'string',
                description: 'Optional phone number in E.164 format (e.g., +15555551234)'
              },
              emailVerified: {
                type: 'boolean',
                description: 'Whether the email address is verified. Defaults to false.'
              },
              disabled: {
                type: 'boolean',
                description: 'Whether the user account should be disabled. Defaults to false.'
              }
            },
            required: ['email', 'password']
          },
          customClaims: {
            type: 'object',
            description: 'Optional custom claims object for setting user roles, permissions, or other metadata. These claims will be available in the user ID token.',
            additionalProperties: true
          }
        },
        required: ['userRecord'],
        additionalProperties: false
      },
      examples: [
        {
          input: {
            userRecord: {
              email: "newuser@example.com",
              password: "securePassword123",
              displayName: "New User",
              emailVerified: false,
              disabled: false,
            }
          },
          description: "Basic user with email and password",
        },
        {
          input: {
            userRecord: {
              email: "admin@example.com",
              password: "adminPass123",
              displayName: "Admin User",
              photoURL: "https://example.com/photo.jpg",
              emailVerified: true,
            },
            customClaims: {
              role: "admin",
              permissions: ["read", "write", "delete"],
              department: "engineering"
            }
          },
          description: "Create admin user with custom claims for roles and permissions",
        },
        {
          input: {
            userRecord: {
              email: "verified@example.com",
              password: "pass123456",
              phoneNumber: "+15555551234",
              emailVerified: true,
            }
          },
          description: "Create user with phone number and pre-verified email",
        },
      ],
    },

    "get-user": {
      handler: handleGetUser,
      description:
        "Retrieves Firebase Authentication user information by UID, email, or phone number. At least one identifier must be provided. Returns user profile including uid, email, emailVerified, disabled status, metadata (creation/sign-in times), display name, photo URL, phone number, custom claims, and provider data.",
      requiredParams: [],
      optionalParams: ["uid", "email", "phoneNumber"],
      inputSchema: {
        type: 'object',
        properties: {
          uid: {
            type: 'string',
            description: 'Firebase Authentication user ID (UID). Use this to look up a user by their unique identifier. At least one of uid, email, or phoneNumber must be provided.'
          },
          email: {
            type: 'string',
            pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
            description: 'Email address of the user. Use this to look up a user by their email. At least one of uid, email, or phoneNumber must be provided.'
          },
          phoneNumber: {
            type: 'string',
            pattern: '^\\+[1-9]\\d{1,14}$',
            description: 'Phone number in E.164 format (e.g., +15555551234). Use this to look up a user by their phone number. At least one of uid, email, or phoneNumber must be provided.'
          }
        },
        required: [],
        additionalProperties: false
      },
      examples: [
        {
          input: {
            uid: "user123abc",
          },
          description: "Get user information by UID",
        },
        {
          input: {
            email: "user@example.com",
          },
          description: "Get user information by email",
        },
        {
          input: {
            phoneNumber: "+15555551234",
          },
          description: "Get user information by phone number",
        },
      ],
    },

    "update-user": {
      handler: handleUpdateUser,
      description:
        "Updates an existing Firebase Authentication user's properties. Supports all Firebase Auth UpdateRequest properties including email, password, displayName, photoURL, phoneNumber, emailVerified, and disabled. Can also update custom claims separately for roles and permissions. The handler updates the user first, then sets custom claims if provided.",
      requiredParams: ["uid", "updateRequest"],
      optionalParams: ["customClaims"],
      inputSchema: {
        type: 'object',
        properties: {
          uid: {
            type: 'string',
            description: 'Firebase Authentication user ID (UID) of the user to update'
          },
          updateRequest: {
            type: 'object',
            description: 'Firebase Auth UpdateRequest object containing properties to update. All fields are optional - only include fields you want to update.',
            properties: {
              email: {
                type: 'string',
                pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
                description: 'New email address for the user'
              },
              password: {
                type: 'string',
                description: 'New password for the user (minimum 6 characters required by Firebase)'
              },
              displayName: {
                type: 'string',
                description: 'New display name for the user. Set to null to remove.'
              },
              photoURL: {
                type: 'string',
                description: 'New URL of the user profile photo. Set to null to remove.'
              },
              phoneNumber: {
                type: 'string',
                pattern: '^\\+[1-9]\\d{1,14}$',
                description: 'New phone number in E.164 format (e.g., +15555551234). Set to null to remove.'
              },
              emailVerified: {
                type: 'boolean',
                description: 'Whether the email address should be marked as verified'
              },
              disabled: {
                type: 'boolean',
                description: 'Whether the user account should be disabled'
              }
            }
          },
          customClaims: {
            type: 'object',
            description: 'Optional custom claims object for updating user roles, permissions, or other metadata. These claims will be available in the user ID token. Pass null to remove all custom claims.',
            additionalProperties: true
          }
        },
        required: ['uid', 'updateRequest'],
        additionalProperties: false
      },
      examples: [
        {
          input: {
            uid: "user123abc",
            updateRequest: {
              displayName: "Updated Name",
              disabled: false,
            }
          },
          description: "Update user display name and enable account",
        },
        {
          input: {
            uid: "user456def",
            updateRequest: {
              email: "newemail@example.com",
              password: "newPassword456",
              emailVerified: false,
            }
          },
          description: "Update user email and password (email will need re-verification)",
        },
        {
          input: {
            uid: "user789ghi",
            updateRequest: {
              phoneNumber: "+15555559999",
            },
            customClaims: {
              role: "moderator",
              permissions: ["read", "write"],
            }
          },
          description: "Update user phone number and set custom claims for roles",
        },
        {
          input: {
            uid: "user999jkl",
            updateRequest: {
              displayName: null,
              photoURL: null,
            }
          },
          description: "Remove display name and photo URL from user profile",
        },
      ],
    },

    "delete-user": {
      handler: handleDeleteUser,
      description: "Deletes a Firebase Authentication user account",
      requiredParams: ["uid"],
      optionalParams: [],
      inputSchema: {
        type: 'object',
        properties: {
          uid: {
            type: 'string',
            description: 'Firebase Authentication user ID (UID) of the user to delete. This operation is permanent and cannot be undone.'
          }
        },
        required: ['uid'],
        additionalProperties: false
      },
      examples: [
        {
          input: {
            uid: "user123abc",
          },
          description: "Permanently delete user account",
        },
      ],
    },

    "list-users": {
      handler: handleListUsers,
      description:
        "Lists Firebase Authentication users with pagination support. Returns user profiles including uid, email, emailVerified, disabled status, metadata (creation/sign-in/refresh times), display name, photo URL, phone number, custom claims, provider data, and tokens valid after time. Results include pagination support with pageToken for retrieving additional pages.",
      requiredParams: [],
      optionalParams: ["maxResults", "pageToken"],
      inputSchema: {
        type: 'object',
        properties: {
          maxResults: {
            type: 'number',
            minimum: 1,
            maximum: 1000,
            description: 'Maximum number of users to return per page. Defaults to 1000 (Firebase Auth API maximum). Must be between 1 and 1000.'
          },
          pageToken: {
            type: 'string',
            description: 'Page token from a previous listUsers call. Use this to retrieve the next page of users. Obtain from the pageToken field in the previous response.'
          }
        },
        required: [],
        additionalProperties: false
      },
      examples: [
        {
          input: {
            maxResults: 100,
          },
          description: "List first 100 users",
        },
        {
          input: {},
          description: "List users with default pagination (1000 per page)",
        },
        {
          input: {
            maxResults: 50,
            pageToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
          },
          description: "Get next page of 50 users using pageToken from previous response",
        },
      ],
    },

    "get-user-claims": {
      handler: handleGetUserClaims,
      description:
        "Retrieves custom claims for a Firebase Authentication user. Returns the user's uid, email, customClaims object (roles, permissions, metadata), and the timestamp when claims were retrieved.",
      requiredParams: ["uid"],
      optionalParams: [],
      inputSchema: {
        type: 'object',
        properties: {
          uid: {
            type: 'string',
            description: 'Firebase Authentication user ID (UID) of the user whose custom claims should be retrieved'
          }
        },
        required: ['uid'],
        additionalProperties: false
      },
      examples: [
        {
          input: {
            uid: "user123abc",
          },
          description: "Get user's custom claims (roles, permissions, etc.)",
        },
      ],
    },

    "set-user-claims": {
      handler: handleSetUserClaims,
      description:
        "Sets custom claims for a Firebase Authentication user (roles, permissions, metadata). Custom claims can be used to store user roles and permissions that will be available in ID tokens. Pass null for customClaims to clear all existing claims. The customClaims parameter is required but can be null.",
      requiredParams: ["uid", "customClaims"],
      optionalParams: [],
      inputSchema: {
        type: 'object',
        properties: {
          uid: {
            type: 'string',
            description: 'Firebase Authentication user ID (UID) of the user to set claims for'
          },
          customClaims: {
            type: 'object',
            description: 'Custom claims object for setting user roles, permissions, or other metadata. These claims will be available in the user ID token. Pass null to clear all existing custom claims. Note: This parameter is required but can be null.',
            additionalProperties: true
          }
        },
        required: ['uid', 'customClaims'],
        additionalProperties: false
      },
      examples: [
        {
          input: {
            uid: "user123abc",
            customClaims: {
              role: "admin",
              permissions: ["read", "write", "delete"],
              department: "engineering",
            },
          },
          description: "Set admin role and permissions for user",
        },
        {
          input: {
            uid: "user456def",
            customClaims: {
              role: "viewer",
              permissions: ["read"],
            },
          },
          description: "Set viewer role with limited permissions",
        },
        {
          input: {
            uid: "user789ghi",
            customClaims: null,
          },
          description: "Clear all custom claims for user",
        },
      ],
    },
  },
};

/**
 * Gets a handler function for the specified service and command.
 * Returns undefined if no handler exists.
 *
 * @param service - The service name (e.g., "firestore", "storage")
 * @param command - The command name (e.g., "copy-collection")
 * @returns The handler function or undefined
 */
export function getHandler(
  service: string,
  command: string
): HandlerFunction | undefined {
  return HANDLER_REGISTRY[service]?.[command]?.handler;
}

/**
 * Gets the complete handler definition including metadata.
 * Returns undefined if no handler exists.
 *
 * @param service - The service name
 * @param command - The command name
 * @returns The handler definition or undefined
 */
export function getHandlerDefinition(
  service: string,
  command: string
): HandlerDefinition | undefined {
  return HANDLER_REGISTRY[service]?.[command];
}

/**
 * Checks if a handler exists for the given service/command combination.
 *
 * @param service - The service name
 * @param command - The command name
 * @returns True if handler exists, false otherwise
 */
export function hasHandler(service: string, command: string): boolean {
  return getHandler(service, command) !== undefined;
}

/**
 * Gets all available service names.
 *
 * @returns Array of service names
 */
export function getAvailableServices(): string[] {
  return Object.keys(HANDLER_REGISTRY).sort();
}

/**
 * Gets all available commands for a service.
 *
 * @param service - The service name
 * @returns Array of command names for the service
 */
export function getServiceCommands(service: string): string[] {
  const serviceHandlers = HANDLER_REGISTRY[service];
  if (!serviceHandlers) {
    return [];
  }
  return Object.keys(serviceHandlers).sort();
}

/**
 * Gets a descriptive error message for an unsupported service/command.
 *
 * @param service - The service name
 * @param command - The command name
 * @returns Error message with helpful information
 */
export function getUnsupportedTaskError(
  service: string,
  command: string
): string {
  const availableServices = getAvailableServices();

  // Check if service exists
  if (!HANDLER_REGISTRY[service]) {
    return (
      `Unsupported service: ${service}. ` +
      `Available services: ${availableServices.join(", ")}`
    );
  }

  // Service exists but command doesn't
  const availableCommands = getServiceCommands(service);
  return (
    `Unsupported command: ${service}/${command}. ` +
    `Available commands for ${service}: ${availableCommands.join(", ")}`
  );
}
