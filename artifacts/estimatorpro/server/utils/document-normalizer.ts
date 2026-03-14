// server/utils/document-normalizer.ts
// ═══════════════════════════════════════════════════════════════════════════════
// SHARED UTILITY: Document API Normalizer
// ═══════════════════════════════════════════════════════════════════════════════
//
// Extracted from server/routes.ts to break the circular dependency between
// routes.ts and batch-processor.ts.
//
// Previously:
//   routes.ts defines normalizeDocumentForApi()
//   batch-processor.ts uses: const { normalizeDocumentForApi } = await import('./routes')
//   → circular: routes.ts also dynamically imports batch-processor.ts
//
// Now:
//   Both routes.ts and batch-processor.ts import from this shared util.
//   No cycle.
//
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Normalizes a raw storage document row into the API response shape.
 * Handles field name variations (snake_case vs camelCase, legacy vs current).
 * No defaults invented — missing fields map to null or empty string as appropriate.
 */
export function normalizeDocumentForApi(doc: any) {
  return {
    ...doc,
    // Ensure both filename and originalName are available for compatibility
    filename: doc?.filename ?? doc?.originalName ?? doc?.name ?? "",
    originalName: doc?.originalName ?? doc?.filename ?? doc?.name ?? "",
    // Handle review status field variations
    reviewStatus: doc?.reviewStatus ?? doc?.status ?? "unreviewed",
    analysisStatus: doc?.analysisStatus ?? doc?.analysis_status ?? "Pending",
    reviewedAt: doc?.reviewedAt ?? doc?.reviewed_at ?? null,
    uploadedAt: doc?.uploadedAt ?? doc?.createdAt ?? doc?.created_at ?? null,
    // Handle file size field variations
    fileSize: doc?.fileSize ?? doc?.file_size ?? null,
    fileType: doc?.fileType ?? doc?.file_type ?? doc?.mimeType ?? "",
    revisionNumber: Number(doc?.revisionNumber ?? doc?.revision_number ?? 0),
    changeImpactSummary: doc?.changeImpactSummary ?? doc?.change_impact_summary ?? "",
    estimateImpact: doc?.estimateImpact ?? doc?.estimate_impact ?? "unknown",
  };
}
