// server/services/pdf-extract.ts
import pdfParse from "pdf-parse";
import { loadFileBuffer } from "./storage-file-resolver";

export type StoredDoc = { id: string; name: string; storageKey?: string | null };

/**
 * Reads a PDF via your FileStorageService.readFile() abstraction (through the resolver),
 * extracts text with pdf-parse, and returns per-page text blobs + full text.
 */
export async function extractPdfTextAndPages(
  doc: StoredDoc
): Promise<{ pageTexts: string[]; fullText: string }> {
  if (!doc?.storageKey) return { pageTexts: [], fullText: "" };

  const buf = await loadFileBuffer(doc.storageKey);
  if (!buf) return { pageTexts: [], fullText: "" };

  const parsed = await pdfParse(buf);
  const raw = parsed.text || "";

  // Best-effort page split. Plans often have explicit "Page N" markers;
  // if not, we still get usable text for Claude.
  const pageTexts = raw
    .split(/\n?\s*Page\s+\d+\s*\n/g)
    .map((s) => s.trim())
    .filter(Boolean);

  return { pageTexts, fullText: raw };
}