import { Router } from "express";
import { buildProjectSimilaritySummary } from "../services/similarity-summary";
import { writeSimilarityCache } from "../services/similarity-cache"; // from earlier file-cache

export const similaritySummaryRouter = Router();

similaritySummaryRouter.get("/projects/:projectId/similarity", async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const source = String(req.query.source || "db"); // "db" or "file"
    if (source === "db") {
      const summary = await buildProjectSimilaritySummary(projectId);
      // optionally write file cache for faster subsequent reads:
      await writeSimilarityCache(projectId, {
        projectId,
        documentMetadata: summary.documents,
        similarities: summary.pairs.map(p => ({ idA: p.a, idB: p.b, score: p.score })),
        overallScore: summary.overallScore,
        riskAreas: [], // add if you have heuristics
        analyzedAt: summary.analyzedAt
      });
      return res.json(summary);
    }
    // else fall back to file cache (existing behavior)
    const { readSimilarityCache } = await import("../services/similarity-cache");
    const cached = await readSimilarityCache(projectId);
    if (!cached) {
      return res.json({
        projectId,
        status: "pending",
        documents: [],
        pairs: [],
        overallScore: 0,
        counts: { totalPairs: 0, critical: 0, high: 0, medium: 0, low: 0 },
        analyzedAt: null
      });
    }
    return res.json(cached);
  } catch (e: any) {
    res.status(500).json({ ok: false, message: e?.message || "Failed to build similarity summary" });
  }
});