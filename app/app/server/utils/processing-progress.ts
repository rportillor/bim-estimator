// server/utils/processing-progress.ts
// ═══════════════════════════════════════════════════════════════════════════════
// SHARED UTILITY: Processing Progress State
// ═══════════════════════════════════════════════════════════════════════════════
//
// Extracted from server/batch-processor.ts to break the circular dependency
// between routes.ts and batch-processor.ts.
//
// Previously:
//   batch-processor.ts owns currentProgress state and exports getProcessingProgress()
//   routes.ts uses: const { getProcessingProgress } = await import('./batch-processor')
//   → circular: batch-processor.ts also imports from routes.ts
//
// Now:
//   Both batch-processor.ts and routes.ts import from this shared util.
//   batch-processor.ts mutates the exported state directly.
//   routes.ts calls getProcessingProgress() without touching batch-processor.
//
// ═══════════════════════════════════════════════════════════════════════════════

export interface ProcessingProgress {
  phase: 'content_extraction' | 'ai_analysis' | 'completed';
  completed: number;
  total: number;
  errors: string[];
  currentDocument?: string;
}

// Module-level singleton — batch-processor.ts mutates this directly
export const processingProgress: ProcessingProgress = {
  phase: 'content_extraction',
  completed: 0,
  total: 0,
  errors: [],
};

/** Returns a snapshot of current processing progress. */
export function getProcessingProgress(): ProcessingProgress {
  return processingProgress;
}
