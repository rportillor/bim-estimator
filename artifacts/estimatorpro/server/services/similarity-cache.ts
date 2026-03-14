// server/services/similarity-cache.ts
import fs from "fs/promises";
import path from "path";

export type SimilarityCachePayload = {
  projectId: string;
  documentMetadata: any;      // whatever you want to store about docs/pages
  similarities: Array<{ idA: string; idB: string; score: number }>;
  overallScore?: number;
  riskAreas?: string[];
  analyzedAt: string;         // ISO date
};

function folder() {
  return path.join(process.cwd(), "cache", "document-similarity");
}

function fileFor(projectId: string) {
  // sanitize to safe filename
  const safe = projectId.replace(/[^a-z0-9_\-.]/gi, "_");
  return path.join(folder(), `${safe}.json`);
}

export async function readSimilarityCache(projectId: string): Promise<SimilarityCachePayload | null> {
  try {
    const f = fileFor(projectId);
    const buf = await fs.readFile(f);
    return JSON.parse(buf.toString("utf8"));
  } catch {
    return null;
  }
}

export async function writeSimilarityCache(projectId: string, payload: SimilarityCachePayload): Promise<void> {
  const dir = folder();
  await fs.mkdir(dir, { recursive: true });
  const f = fileFor(projectId);
  const data = JSON.stringify(payload, null, 2);
  await fs.writeFile(f, data, "utf8");
}