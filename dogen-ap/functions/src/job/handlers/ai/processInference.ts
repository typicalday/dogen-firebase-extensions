import { JobTask } from "../../jobTask";
import { JobContext } from "../../jobContext";
import { parseStoragePath, getBucketByName } from "../../../utils/utils";
import { VertexAI, Part, Content } from "@google-cloud/vertexai";
import config from "../../../config";
import * as path from 'path';

interface InferenceTaskInput {
  model: string;
  prompt: string;
  files?: string[];
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  responseMimeType?: string;
  responseSchema?: object;
  candidateCount?: number;
  stopSequences?: string[];
}

interface InferenceTaskOutput {
  model: string;
  prompt: string;
  response: string;
  filesProcessed?: string[];
  usage?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  processedAt: string;
}

export async function handleProcessInference(task: JobTask, context: JobContext): Promise<InferenceTaskOutput> {
  const input = task.input as InferenceTaskInput | undefined;
  
  if (!input?.model || !input?.prompt) {
    throw new Error("Invalid input: model and prompt are required");
  }

  // Get project ID - use localProjectIdOverride if set (for local testing), otherwise use Firebase project
  const projectId = config.localProjectIdOverride ?? config.firebaseProjectId;

  if (!projectId) {
    throw new Error("Project ID not found");
  }

  // Initialize Vertex AI
  const vertexAI = new VertexAI({
    project: projectId,
    location: config.location || 'us-central1',
  });

  // Process files if provided
  let fileParts: Part[] = [];
  let filesProcessed: string[] = [];
  
  if (input.files && input.files.length > 0) {
    // Validate file input constraints
    validateFileInput(input.files);
    fileParts = await processFiles(input.files);
    filesProcessed = input.files;
  }

  // Build generation config - only include parameters that were explicitly provided
  const generationConfig: any = {};

  if (input.temperature !== undefined) {
    generationConfig.temperature = input.temperature;
  }

  if (input.topP !== undefined) {
    generationConfig.topP = input.topP;
  }

  if (input.topK !== undefined) {
    generationConfig.topK = input.topK;
  }

  if (input.maxOutputTokens !== undefined) {
    generationConfig.maxOutputTokens = input.maxOutputTokens;
  }

  if (input.candidateCount !== undefined) {
    generationConfig.candidateCount = input.candidateCount;
  }

  if (input.responseMimeType) {
    generationConfig.responseMimeType = input.responseMimeType;
  }

  if (input.responseSchema) {
    generationConfig.responseSchema = input.responseSchema;
  }

  if (input.stopSequences) {
    generationConfig.stopSequences = input.stopSequences;
  }

  // Get the model
  const model = vertexAI.getGenerativeModel({
    model: input.model,
    systemInstruction: input.systemInstruction,
    generationConfig,
  });

  // Prepare the content
  const contents: Content[] = [{
    role: 'user',
    parts: [
      { text: input.prompt },
      ...fileParts
    ]
  }];

  try {
    const result = await model.generateContent({
      contents,
    });
    
    const response = result.response;
    const candidate = response.candidates?.[0];
    
    if (!candidate || !candidate.content || !candidate.content.parts) {
      throw new Error("No response generated");
    }

    // Extract text from response parts
    const responseText = candidate.content.parts
      .filter(part => part.text)
      .map(part => part.text)
      .join('');
    
    return {
      model: input.model,
      prompt: input.prompt,
      response: responseText,
      filesProcessed: filesProcessed.length > 0 ? filesProcessed : undefined,
      usage: response.usageMetadata ? {
        promptTokenCount: response.usageMetadata.promptTokenCount,
        candidatesTokenCount: response.usageMetadata.candidatesTokenCount,
        totalTokenCount: response.usageMetadata.totalTokenCount,
      } : undefined,
      processedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error('Error processing inference request:', error);
    throw new Error(`Inference processing failed: ${error.message}`);
  }
}

async function processFiles(filePaths: string[]): Promise<Part[]> {
  const parts: Part[] = [];
  const supportedMimeTypes = new Set([
    // Images
    'image/png', 'image/jpeg', 'image/webp',
    // Videos
    'video/mp4', 'video/mpeg', 'video/quicktime', 'video/webm', 
    'video/x-flv', 'video/x-msvideo', 'video/x-ms-wmv', 'video/3gpp',
    // Audio
    'audio/aac', 'audio/flac', 'audio/mpeg', 'audio/wav', 'audio/ogg',
    // Documents
    'application/pdf', 'text/plain',
  ]);
  
  for (const filePath of filePaths) {
    try {
      let mimeType: string;
      let fileUri: string;
      
      // Check if it's a Cloud Storage URL
      if (filePath.startsWith('gs://')) {
        // For Cloud Storage files, we can directly use the URI
        mimeType = getMimeTypeFromPath(filePath);
        fileUri = filePath;
      } else {
        // For other paths, assume they're in our Firebase Storage
        const [bucketName, storagePath] = parseStoragePath(filePath);
        const bucket = getBucketByName(bucketName);
        const file = bucket.file(storagePath);
        
        // Get file metadata to determine content type
        const [metadata] = await file.getMetadata();
        mimeType = metadata.contentType || getMimeTypeFromPath(storagePath);
        
        // For Firebase Storage files, we need to construct a gs:// URL
        fileUri = `gs://${bucket.name}/${storagePath}`;
      }
      
      // Validate MIME type is supported
      if (!supportedMimeTypes.has(mimeType)) {
        throw new Error(`Unsupported file type: ${mimeType}. Supported types are: images (PNG, JPEG, WebP), videos (MP4, MOV, MPEG, WebM, FLV, AVI, WMV, 3GP), audio (AAC, FLAC, MP3, WAV, OGG), and documents (PDF, plain text).`);
      }
      
      parts.push({
        fileData: {
          mimeType: mimeType,
          fileUri: fileUri
        }
      });
    } catch (error: any) {
      console.error(`Error processing file ${filePath}:`, error);
      throw new Error(`Failed to process file ${filePath}: ${error.message}`);
    }
  }
  
  return parts;
}

function validateFileInput(filePaths: string[]): void {
  const fileTypeCounts: { [key: string]: number } = {
    image: 0,
    video: 0,
    audio: 0,
    document: 0,
  };

  for (const filePath of filePaths) {
    const mimeType = getMimeTypeFromPath(filePath);
    
    if (mimeType.startsWith('image/')) {
      fileTypeCounts.image++;
    } else if (mimeType.startsWith('video/')) {
      fileTypeCounts.video++;
    } else if (mimeType.startsWith('audio/')) {
      fileTypeCounts.audio++;
    } else if (mimeType === 'application/pdf' || mimeType === 'text/plain') {
      fileTypeCounts.document++;
    }
  }

  // Validate constraints
  if (fileTypeCounts.image > 3000) {
    throw new Error(`Too many image files: ${fileTypeCounts.image}. Maximum allowed is 3000.`);
  }
  
  if (fileTypeCounts.video > 10) {
    throw new Error(`Too many video files: ${fileTypeCounts.video}. Maximum allowed is 10.`);
  }
  
  if (fileTypeCounts.audio > 1) {
    throw new Error(`Too many audio files: ${fileTypeCounts.audio}. Maximum allowed is 1.`);
  }
  
  if (fileTypeCounts.document > 3000) {
    throw new Error(`Too many document files: ${fileTypeCounts.document}. Maximum allowed is 3000.`);
  }
}

function getMimeTypeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: { [key: string]: string } = {
    // Text files
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.xml': 'application/xml',
    
    // Documents
    '.pdf': 'application/pdf',
    
    // Images - only supported formats
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    
    // Audio - supported formats
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    
    // Video - supported formats
    '.mp4': 'video/mp4',
    '.mpeg': 'video/mpeg',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.flv': 'video/x-flv',
    '.avi': 'video/x-msvideo',
    '.wmv': 'video/x-ms-wmv',
    '.3gp': 'video/3gpp',
  };
  
  return mimeTypes[ext] || 'application/octet-stream';
}