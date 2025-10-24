import { Timestamp, DocumentReference, GeoPoint, FieldValue } from "firebase-admin/firestore";

/**
 * Recursively sanitize an object by replacing all undefined values with null
 * This is necessary because Firestore rejects undefined values
 */
export function sanitizeForFirestore(obj: any): any {
  if (obj === undefined) {
    return null;
  }

  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // Don't sanitize Firestore special types - they need to stay as-is
  if (obj instanceof Timestamp ||
      obj instanceof DocumentReference ||
      obj instanceof GeoPoint ||
      obj instanceof FieldValue) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForFirestore(item));
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    sanitized[key] = sanitizeForFirestore(value);
  }
  return sanitized;
}
