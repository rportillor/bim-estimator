import { and, inArray } from "drizzle-orm";
import { db } from "../db";
import { documentSimilarityCache } from "@shared/schema";
import { storage } from "../storage";

export type ProjectSimilaritySummary = {
  projectId: string;
  documents: Array<{ id: string; filename?: string }>;
  pairs: Array<{ a: string; b: string; score: number; criticalLevel: string }>;
  overallScore: number;
  counts: { totalPairs: number; critical: number; high: number; medium: number; low: number };
  analyzedAt: string;
};

export async function buildProjectSimilaritySummary(projectId: string): Promise<ProjectSimilaritySummary> {
  const docs = await storage.getDocumentsByProject(projectId); // you said this exists
  const docIds = (docs || []).map((d: any) => d.id).filter(Boolean);
  if (!docIds.length) {
    return {
      projectId,
      documents: [],
      pairs: [],
      overallScore: 0,
      counts: { totalPairs: 0, critical: 0, high: 0, medium: 0, low: 0 },
      analyzedAt: new Date().toISOString()
    };
  }

  const rows = await db
    .select({
      a: documentSimilarityCache.documentAId,
      b: documentSimilarityCache.documentBId,
      score: documentSimilarityCache.similarityScore,
      level: documentSimilarityCache.criticalLevel
    })
    .from(documentSimilarityCache)
    .where(
      and(
        inArray(documentSimilarityCache.documentAId, docIds),
        inArray(documentSimilarityCache.documentBId, docIds)
      )
    );

  const pairs = rows.map(r => ({
    a: r.a,
    b: r.b,
    score: Number(r.score),
    criticalLevel: String(r.level || "low")
  }));

  const counts = {
    totalPairs: pairs.length,
    critical: pairs.filter(p => p.criticalLevel === "critical").length,
    high:     pairs.filter(p => p.criticalLevel === "high").length,
    medium:   pairs.filter(p => p.criticalLevel === "medium").length,
    low:      pairs.filter(p => p.criticalLevel === "low").length
  };

  const mean = pairs.length ? pairs.reduce((s, p) => s + p.score, 0) / pairs.length : 0;

  return {
    projectId,
    documents: (docs || []).map((d: any) => ({ id: d.id, filename: d.filename || d.name })),
    pairs,
    overallScore: Number(mean.toFixed(4)),
    counts,
    analyzedAt: new Date().toISOString()
  };
}