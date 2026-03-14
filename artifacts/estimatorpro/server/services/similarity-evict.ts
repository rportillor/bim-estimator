import { and, asc, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import { documentSimilarityCache } from "@shared/schema";
import { storage } from "../storage";

/** Delete rows older than X days (by lastUsed or updatedAt). Returns deleted count. */
export async function evictByAge(maxAgeDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - Math.max(1, maxAgeDays) * 86_400_000);
  const del = await db.delete(documentSimilarityCache).where(
    or(
      lt(documentSimilarityCache.lastUsed, cutoff),
      lt(documentSimilarityCache.updatedAt, cutoff)
    )
  ).returning({ id: documentSimilarityCache.id });
  return del.length;
}

/** Keep at most `maxRows` newest rows (LRU by lastUsed, then usageCount, then createdAt). Returns deleted count. */
export async function evictToCap(maxRows: number): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(documentSimilarityCache);
  const total = Number(count || 0);
  if (total <= maxRows) return 0;

  const toDelete = total - maxRows;

  const oldIds = await db
    .select({ id: documentSimilarityCache.id })
    .from(documentSimilarityCache)
    .orderBy(
      asc(documentSimilarityCache.lastUsed),
      asc(documentSimilarityCache.usageCount),
      asc(documentSimilarityCache.createdAt)
    )
    .limit(toDelete);

  if (!oldIds.length) return 0;

  const del = await db.delete(documentSimilarityCache).where(
    inArray(documentSimilarityCache.id, oldIds.map(r => r.id))
  ).returning({ id: documentSimilarityCache.id });

  return del.length;
}

/** Keep only top-K pairs within a project (by score or recent usage) */
export async function evictProjectToCap(
  projectId: string,
  maxPairs: number,
  mode: "score" | "recent" = "score"
): Promise<{ projectId: string; total: number; kept: number; deleted: number }> {
  // Get this project's document IDs
  const docs = await storage.getDocumentsByProject(projectId);
  const docIds = (docs || []).map((d: any) => d.id).filter(Boolean);
  if (!docIds.length) return { projectId, total: 0, kept: 0, deleted: 0 };

  // Pull all pair rows where BOTH docs belong to this project
  const rows = await db
    .select({
      id: documentSimilarityCache.id,
      score: documentSimilarityCache.similarityScore,
      lastUsed: documentSimilarityCache.lastUsed,
      createdAt: documentSimilarityCache.createdAt,
    })
    .from(documentSimilarityCache)
    .where(
      and(
        inArray(documentSimilarityCache.documentAId, docIds),
        inArray(documentSimilarityCache.documentBId, docIds)
      )
    );

  const total = rows.length;
  if (total <= maxPairs) return { projectId, total, kept: total, deleted: 0 };

  // Sort best-first, keep top K
  const sorted = rows.slice().sort((a, b) => {
    if (mode === "recent") {
      const ta = new Date(a.lastUsed ?? a.createdAt ?? 0).getTime();
      const tb = new Date(b.lastUsed ?? b.createdAt ?? 0).getTime();
      return tb - ta; // newest first
    }
    // mode === "score"
    return Number(b.score) - Number(a.score); // highest score first
  });

  const toKeep = new Set(sorted.slice(0, maxPairs).map(r => r.id));
  const toDeleteIds = rows.map(r => r.id).filter(id => !toKeep.has(id));
  if (toDeleteIds.length) {
    await db
      .delete(documentSimilarityCache)
      .where(inArray(documentSimilarityCache.id, toDeleteIds));
  }

  return { projectId, total, kept: Math.min(total, maxPairs), deleted: toDeleteIds.length };
}