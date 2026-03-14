// server/utils/claude-response-schemas.ts
// Zod schemas for validating Claude API responses

import { z } from 'zod';

/** Schema for smart-analysis-service analysis results */
export const analysisResultSchema = z.object({
  overallScore: z.number().nullable().optional(),
  riskAreas: z.array(z.string()).optional().default([]),
  recommendations: z.array(z.string()).optional().default([]),
  summary: z.string().nullable().optional(),
  similarities: z.array(z.any()).optional().default([]),
  complianceChecks: z.array(z.any()).optional().default([]),
  boqItems: z.array(z.any()).optional().default([]),
});

/** Schema for construction sequence generator */
export const constructionSequenceSchema = z.object({
  rationale: z.string().optional(),
  constructionMethod: z.string().optional(),
  keyAssumptions: z.array(z.string()).optional().default([]),
  warnings: z.array(z.string()).optional().default([]),
  criticalPath: z.array(z.string()).optional().default([]),
  totalDurationDays: z.number().optional(),
  longLeadItems: z.array(z.any()).optional().default([]),
  activities: z.array(z.object({
    activityId: z.string(),
    wbsCode: z.string().optional(),
    name: z.string(),
    durationDays: z.number(),
    predecessors: z.array(z.string()).optional().default([]),
  }).passthrough()).optional().default([]),
});

/** Schema for compliance check results */
export const complianceResultSchema = z.object({
  code_violations: z.array(z.any()).optional().default([]),
  material_compliance: z.array(z.any()).optional().default([]),
  dimensional_compliance: z.array(z.any()).optional().default([]),
  accessibility_compliance: z.any().optional(),
  fire_safety_compliance: z.any().optional(),
  structural_compliance: z.any().optional(),
  summary: z.object({
    total_violations: z.number().optional().default(0),
    critical_issues: z.number().optional().default(0),
    compliance_percentage: z.number().optional().default(100),
  }).optional(),
});

/** Schema for floor analyzer response */
export const floorDocumentGroupSchema = z.array(z.object({
  floorName: z.string(),
  level: z.number(),
  elevation: z.number().nullable().optional(),
  documentIds: z.array(z.string()),
  reasoning: z.string().optional(),
}));

/** Schema for product extraction */
export const productCatalogSchema = z.array(z.object({
  csi_division: z.string().optional(),
  product_type: z.string().optional(),
  product_name: z.string().optional(),
  manufacturer: z.string().optional(),
  specifications: z.string().optional(),
  default_unit_cost: z.number().optional(),
  unit: z.string().optional(),
}).passthrough());

/**
 * Validate a parsed Claude response against a Zod schema.
 * Returns the validated data on success, or the raw input on failure (with a logged warning).
 * This is a soft validator — it never throws, to avoid breaking production flows.
 */
export function validateClaudeResponse<T>(data: any, schema: z.ZodSchema<T>, context: string): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  // Log validation issues but return the raw data to avoid breaking flows
  console.warn(`[Claude Response Validation] ${context}: schema mismatch — ${result.error.issues.length} issues`, {
    issues: result.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`),
  });
  return data as T;
}
