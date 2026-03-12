// server/utils/secure-json.ts
// ✅ SECURITY: Enterprise-grade JSON parsing with validation and error handling

import { z } from "zod";

export class JsonSecurityError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = "JsonSecurityError";
  }
}

/**
 * Secure JSON parsing with size limits and validation
 */
export function safeJsonParse<T = any>(
  input: string | null | undefined,
  maxSize: number = 1024 * 1024 // 1MB default limit
): T | null {
  try {
    if (!input || typeof input !== 'string') {
      return null;
    }

    // Security: Check input size to prevent DoS
    if (input.length > maxSize) {
      throw new JsonSecurityError(
        `JSON input exceeds maximum size limit of ${maxSize} bytes`,
        "JSON_SIZE_LIMIT_EXCEEDED"
      );
    }

    // Security: Validate JSON structure before parsing
    if (!isValidJsonStructure(input)) {
      throw new JsonSecurityError(
        "Invalid JSON structure detected",
        "INVALID_JSON_STRUCTURE"
      );
    }

    return JSON.parse(input) as T;
  } catch (error) {
    if (error instanceof JsonSecurityError) {
      throw error;
    }
    
    // Log security events
    console.warn("🔒 [SECURITY] JSON parsing failed:", {
      error: error instanceof Error ? error.message : String(error),
      inputLength: input?.length || 0,
      timestamp: new Date().toISOString()
    });
    
    return null;
  }
}

/**
 * Secure JSON parsing with Zod schema validation
 */
export function parseJsonWithSchema<T>(
  input: string | null | undefined,
  schema: z.ZodSchema<T>
): T | null {
  try {
    const parsed = safeJsonParse(input);
    if (parsed === null) return null;
    
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new JsonSecurityError(
        `JSON validation failed: ${result.error.message}`,
        "SCHEMA_VALIDATION_FAILED"
      );
    }
    
    return result.data;
  } catch (error) {
    console.warn("🔒 [SECURITY] Schema validation failed:", {
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
    return null;
  }
}

/**
 * Secure JSON stringification with circular reference detection
 */
export function safeJsonStringify(
  obj: any,
  maxDepth: number = 10
): string | null {
  try {
    const seen = new WeakSet();
    let depth = 0;
    
    const replacer = (key: string, value: any) => {
      if (depth > maxDepth) {
        throw new JsonSecurityError(
          `JSON serialization depth exceeds limit of ${maxDepth}`,
          "MAX_DEPTH_EXCEEDED"
        );
      }
      
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) {
          return "[Circular Reference]";
        }
        seen.add(value);
        depth++;
      }
      
      return value;
    };
    
    return JSON.stringify(obj, replacer);
  } catch (error) {
    console.warn("🔒 [SECURITY] JSON stringification failed:", {
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
    return null;
  }
}

/**
 * Basic JSON structure validation
 */
function isValidJsonStructure(input: string): boolean {
  // Security: Check for common injection patterns
  const dangerousPatterns = [
    /__proto__/,
    /constructor/,
    /prototype/,
    /function\s*\(/,
    /eval\s*\(/,
    /script/i
  ];
  
  return !dangerousPatterns.some(pattern => pattern.test(input));
}

/**
 * Enterprise security schemas for common data types
 */
export const securitySchemas = {
  bimElement: z.object({
    id: z.string().uuid().optional(),
    type: z.string().max(100),
    name: z.string().max(255).optional(),
    properties: z.record(z.any()).optional(),
    geometry: z.any().optional(),
    location: z.any().optional()
  }),
  
  geometryData: z.object({
    vertices: z.array(z.number()).max(100000),
    faces: z.array(z.number()).max(50000),
    normals: z.array(z.number()).optional(),
    materials: z.array(z.any()).max(1000).optional()
  }),
  
  metadata: z.object({
    progress: z.number().min(0).max(100).optional(),
    lastMessage: z.string().max(500).optional(),
    lastError: z.string().max(1000).optional(),
    timestamp: z.string().datetime().optional()
  })
};