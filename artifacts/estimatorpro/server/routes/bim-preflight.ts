// server/routes/bim-preflight.ts
import { Router, type Request, type Response } from "express";
import { storage } from "../storage";
import { extractPdfTextAndPages } from "../services/pdf-extract";
import { loadFileBuffer } from "../services/storage-file-resolver";

export const bimPreflightRouter = Router();

/**
 * GET /api/bim/models/:modelId/preflight?projectId=...
 * Checks: docs exist, files resolvable, text length, current element count.
 * Returns a diagnostic payload so "can't be generated" becomes actionable.
 */
bimPreflightRouter.get("/bim/models/:modelId/preflight", async (req: Request, res: Response) => {
  const { modelId } = req.params;
  const projectId = (req.query.projectId as string) || modelId; // fall back if you key docs by modelId

  try {
    const docs = await storage.getDocumentsByProject(projectId);
    const docsFound = docs.length;

    let resolvable = 0;
    let totalChars = 0;
    const docSummaries: Array<{ id: string; name: string; storageKey?: string | null; resolvable: boolean; chars: number }> = [];

    for (const d of docs) {
      let ok = false, chars = 0;
      if (d.storageKey) {
        const buf = await loadFileBuffer(d.storageKey);
        if (buf && buf.length) {
          ok = true;
          const { fullText } = await extractPdfTextAndPages({ id: d.id, name: d.filename, storageKey: d.storageKey });
          chars = (fullText || "").length;
          totalChars += chars;
        }
      }
      if (ok) resolvable++;
      docSummaries.push({ id: d.id, name: d.filename, storageKey: d.storageKey, resolvable: ok, chars });
    }

    const elements = await storage.getBimElements(modelId);
    const elementCount = elements.length;

    res.json({
      ok: true,
      modelId,
      projectId,
      docsFound,
      resolvableDocs: resolvable,
      totalChars,
      elementCount,
      docs: docSummaries.slice(0, 20), // cap to keep response small
      advice: advise({ docsFound, resolvable, totalChars, elementCount }),
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err?.message || "Preflight failed" });
  }
});

function advise({ docsFound, resolvable, totalChars, elementCount }: { docsFound: number; resolvable: number; totalChars: number; elementCount: number }) {
  const tips: string[] = [];
  if (!docsFound) tips.push("No documents found for this projectId. Ensure projectId is correct and documents are linked.");
  if (docsFound && !resolvable) tips.push("Documents exist but none are readable from disk. Storage keys likely don't match files under ./uploads.");
  if (resolvable && totalChars < 200) tips.push("Parsed PDF text is too small for analysis. Verify plan PDFs are text-based or add OCR later.");
  if (!elementCount) tips.push("No BIM elements in DB for this model. Trigger generation after fixing documents.");
  return tips;
}