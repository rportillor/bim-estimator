// server/services/similarity-db.ts
import crypto from "crypto";
import { eq, sql } from "drizzle-orm";
// ⬇️ Adjust these two imports to match your project layout
import { db } from "../db";                       // your Drizzle instance
import { documentSimilarityCache } from "@shared/schema"; // your DDL export

export type UpsertPairInput = {
  documentAId: string;
  documentBId: string;
  textA: string;
  textB: string;
  analysisResult: any;                // JSONB
  similarityScore: number;           // 0..1
  overlapType?: string;              // e.g., "content"
  details?: string;                  // free text
  conflicts?: any[];                 // array json
  recommendations?: any[];           // array json
  criticalLevel?: "low" | "medium" | "high" | "critical";
  claudeTokensUsed?: number;         // integer
  claudeModel?: string;              // text
  analysisVersion?: string;          // text
};

export type CachedPairRow = typeof documentSimilarityCache.$inferSelect;

export function hashText(s: string) {
  const norm = (s || "").toLowerCase().replace(/\s+/g, " ").trim();
  return crypto.createHash("md5").update(norm).digest("hex");
}

export function makePairKey(aId: string, aHash: string, bId: string, bHash: string) {
  // symmetric key: sort by (id,hash)
  const left  = `${aId}:${aHash}`;
  const right = `${bId}:${bHash}`;
  const [x, y] = left <= right ? [left, right] : [right, left];
  return crypto.createHash("md5").update(`${x}|${y}`).digest("hex");
}

export async function getCachedPairByTexts(
  documentAId: string,
  textA: string,
  documentBId: string,
  textB: string
): Promise<CachedPairRow | null> {
  const aHash = hashText(textA);
  const bHash = hashText(textB);
  const pair  = makePairKey(documentAId, aHash, documentBId, bHash);
  const rows = await db.select().from(documentSimilarityCache)
    .where(eq(documentSimilarityCache.documentPairHash, pair))
    .limit(1);
  return rows?.[0] || null;
}

export async function getCachedPairByKey(pairHash: string): Promise<CachedPairRow | null> {
  const rows = await db.select().from(documentSimilarityCache)
    .where(eq(documentSimilarityCache.documentPairHash, pairHash)).limit(1);
  return rows?.[0] || null;
}

export async function upsertPair(input: UpsertPairInput): Promise<CachedPairRow> {
  const aHash = hashText(input.textA);
  const bHash = hashText(input.textB);
  const pair  = makePairKey(input.documentAId, aHash, input.documentBId, bHash);

  // Thresholds for criticality (feel free to tune)
  const score = Number(Math.max(0, Math.min(1, input.similarityScore)).toFixed(3));
  const level: UpsertPairInput["criticalLevel"] =
    score >= 0.9 ? "critical" :
    score >= 0.8 ? "high"     :
    score >= 0.6 ? "medium"   : "low";

  const now = new Date();

  // drizzle-orm onConflictDoUpdate
  const inserted = await db.insert(documentSimilarityCache).values({
    documentPairHash: pair,
    documentAId: input.documentAId,
    documentBId: input.documentBId,
    documentAContentHash: aHash,
    documentBContentHash: bHash,
    analysisResult: input.analysisResult ?? {},
    similarityScore: score.toString(),
    overlapType: input.overlapType ?? "content",
    details: input.details ?? "Auto-generated similarity analysis",
    conflicts: (input.conflicts ?? []) as any,
    recommendations: (input.recommendations ?? []) as any,
    criticalLevel: input.criticalLevel ?? level,
    usageCount: 1,
    lastUsed: now,
    claudeTokensUsed: Math.max(0, Math.floor(input.claudeTokensUsed ?? 0)),
    claudeModel: input.claudeModel ?? "claude-sonnet-4-20250514",
    analysisVersion: input.analysisVersion ?? "1.0",
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: documentSimilarityCache.documentPairHash,
    set: {
      analysisResult:            (input.analysisResult ?? {}) as any,
      similarityScore:           score.toString(),
      overlapType:               input.overlapType ?? "content",
      details:                   input.details ?? "Auto-generated similarity analysis",
      conflicts:                 (input.conflicts ?? []) as any,
      recommendations:           (input.recommendations ?? []) as any,
      criticalLevel:             input.criticalLevel ?? level,
      usageCount:                sql`${documentSimilarityCache.usageCount} + 1`,
      lastUsed:                  now,
      claudeTokensUsed:          Math.max(0, Math.floor(input.claudeTokensUsed ?? 0)),
      claudeModel:               input.claudeModel ?? "claude-sonnet-4-20250514",
      analysisVersion:           input.analysisVersion ?? "1.0",
      updatedAt:                 now,
    }
  }).returning();

  return inserted[0];
}