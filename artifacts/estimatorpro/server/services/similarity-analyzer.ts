import { runDocumentSimilarity } from "../document-similarity";

type Progress = {
  status: "idle" | "running" | "done" | "error";
  totalPairs: number;
  processed: number;
  skipped: number;
  startedAt?: string;
  finishedAt?: string;
  lastError?: string;
};

class SimilarityAnalyzer {
  private progress: Progress = { status: "idle", totalPairs: 0, processed: 0, skipped: 0 };

  getProgress() { return this.progress; }
  hasActiveSession() { return this.progress.status === "running"; }

  async start(projectId: string, anthropic: any, pairs: any[], documentMetadata: any) {
    this.progress = {
      status: "running",
      totalPairs: pairs.length,
      processed: 0,
      skipped: 0,
      startedAt: new Date().toISOString(),
    };

    // Hook into runDocumentSimilarity progress (optional callback supported below)
    try {
      await runDocumentSimilarity(projectId, anthropic, pairs, documentMetadata, (p) => {
        this.progress = { ...this.progress, processed: p.processed, skipped: p.skipped };
      });
      this.progress = {
        ...this.progress,
        status: "done",
        processed: this.progress.totalPairs,
        finishedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      this.progress = {
        ...this.progress,
        status: "error",
        lastError: err?.message || String(err),
        finishedAt: new Date().toISOString(),
      };
      throw err;
    }
  }

  /** Convenience alias many routes expect. */
  async analyzeProjectDocuments(projectId: string, anthropic: any, pairs: any[], documentMetadata: any) {
    return this.start(projectId, anthropic, pairs, documentMetadata);
  }

  /** Heatmap-friendly shape (very simple aggregate; adjust to taste). */
  async generateHeatmapData(projectId: string) {
    const { readSimilarityCache } = await import("./similarity-cache");
    const cached = await readSimilarityCache(projectId);
    const sims = cached?.similarities || [];
    // Grid = top 100 pairs by score
    const top = sims.slice().sort((a: any, b: any) => Number(b.score) - Number(a.score)).slice(0, 100);
    return { projectId, grid: top, min: 0, max: 1, generatedAt: new Date().toISOString() };
  }

  /** Stub for now; returns empty list until compliance rules defined. */
  async detectComplianceOverlaps(projectId: string) {
    return { projectId, items: [], generatedAt: new Date().toISOString() };
  }
}

export const similarityAnalyzer = new SimilarityAnalyzer();