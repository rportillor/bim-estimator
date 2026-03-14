import pdfParse from "pdf-parse";
import { loadFileBuffer } from "./storage-file-resolver";

export type StoredDoc = { id: string; name: string; storageKey?: string | null };

export async function extractPdfTextAndPages(doc: StoredDoc): Promise<{ pageTexts: string[]; fullText: string }> {
  if (!doc.storageKey) return { pageTexts: [], fullText: "" };

  const buf = await loadFileBuffer(doc.storageKey);
  if (!buf) return { pageTexts: [], fullText: "" };

  const parsed = await pdfParse(buf);
  const raw = parsed.text || "";

  // Light page split heuristic (works fine for plans)
  const pageTexts = raw
    .split(/\n?\s*Page\s+\d+\s*\n/g)
    .map(s => s.trim())
    .filter(Boolean);

  return { pageTexts, fullText: raw };
}

async function gatherContentForClaude(projectId: string) {
  const { storage } = await import("../storage");
  const docs = await storage.getDocumentsByProject(projectId);   // <-- your method
  const pageBlobs: string[] = [];

  for (const d of docs) {
    const { pageTexts } = await extractPdfTextAndPages({ ...d, name: (d as any).filename || 'unknown' });
    pageBlobs.push(...pageTexts);
  }

  // prioritize plan-like pages
  const PLAN = /(site|parking|underground|floor|roof|plan|grid|elevation)/i;
  const salient = pageBlobs.filter(p => PLAN.test(p)).slice(0, 40);
  const fallback = pageBlobs.slice(0, 10);
  const usePages = salient.length ? salient : fallback;

  console.log(`🔥 SENDING SALIENT CONTENT TO CLAUDE: ${usePages.length} pages from ${docs.length} documents`);
  return usePages.join("\n\n----\n\n");
}

export { gatherContentForClaude };