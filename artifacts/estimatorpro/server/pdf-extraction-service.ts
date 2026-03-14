import fs from "fs/promises";
import pdfParse from "pdf-parse";
import { fromPath as pdf2picFromPath } from "pdf2pic";
import { storage } from './storage';

export interface ExtractedPdf {
  pageCount: number;
  textContent: string;
  pageText: { page: number; text: string }[];
  rasterPreviews: { page: number; filePath: string }[];
}

/** Safely convert any error to a plain string, even broken/non-inspectable objects. */
function safeErr(e: unknown): string {
  try {
    if (e instanceof Error) return e.message;
    return String(e);
  } catch {
    return "[unserializable error]";
  }
}

export async function extractPdf(filePath: string, previewDir: string): Promise<ExtractedPdf> {
  const buffer = await fs.readFile(filePath);
  const parsed = await pdfParse(buffer);
  const raw = parsed.text || "";

  // Split by form-feed where available, else split heuristically by "\n\nPage"
  const pages = raw.split(/\f/g).map((t, i) => ({ page: i + 1, text: t.trim() }));
  const pageCount = Math.max(pages.length, parsed.numpages || 0);

  // PNG previews for first up to 8 pages — optional, skip if ImageMagick unavailable
  let rasterPreviews: { page: number; filePath: string }[] = [];
  try {
    await fs.mkdir(previewDir, { recursive: true });
    const toImage = pdf2picFromPath(filePath, { density: 144, savePath: previewDir, format: "png" });
    const limit = Math.min(pageCount || 1, 8);
    for (let p = 1; p <= limit; p++) {
      try {
        const res = await toImage(p);
        if (res.path) rasterPreviews.push({ page: p, filePath: res.path });
      } catch (pageErr) {
        console.warn(`[pdf] Preview generation skipped for page ${p}: ${safeErr(pageErr)}`);
      }
    }
  } catch (previewErr) {
    console.warn(`[pdf] Raster preview generation unavailable: ${safeErr(previewErr)}`);
  }

  return {
    pageCount,
    textContent: raw,
    pageText: pages,
    rasterPreviews,
  };
}

/**
 * Update document record with extracted PDF content
 */
export async function updateDocumentWithExtractedContent(
  documentId: string, 
  extractedContent: ExtractedPdf
): Promise<void> {
  try {
    console.log(`💾 Storing extracted content for document ${documentId}...`);
    
    await storage.updateDocument(documentId, {
      textContent: extractedContent.textContent,
      pageCount: extractedContent.pageCount,
      pageText: extractedContent.pageText,
      rasterPreviews: extractedContent.rasterPreviews.map(r => ({ page: r.page, key: r.filePath })),
      analysisStatus: "Ready"
    });
    
    console.log(`✅ Document ${documentId} updated with extracted PDF content`);
    
  } catch (error) {
    console.error(`❌ Failed to update document ${documentId} with extracted content:`, safeErr(error));
    throw error;
  }
}

/**
 * Get construction-focused pages for Claude analysis
 * Prioritizes floor plans, elevations, sections, and details
 */
export function getConstructionFocusedContent(extractedContent: ExtractedPdf, tokenLimit: number = 8000): {
  salientPages: string[];
  previews: { page: number; filePath: string }[];
  summary: string;
} {
  const { pageText, rasterPreviews } = extractedContent;
  
  const constructionKeywords = [
    'floor plan', 'elevation', 'section', 'detail', 'grid', 'dimension',
    'wall', 'foundation', 'beam', 'column', 'door', 'window',
    'scale', 'level', 'storey', 'basement', 'ground floor',
    'structural', 'architectural', 'mechanical', 'electrical'
  ];
  
  const scoredPages = pageText.map((pageData, index) => {
    const lowerText = pageData.text.toLowerCase();
    const score = constructionKeywords.reduce((total, keyword) => {
      const matches = (lowerText.match(new RegExp(keyword, 'g')) || []).length;
      return total + matches;
    }, 0);
    return { index, pageData, score };
  });
  
  scoredPages.sort((a, b) => b.score - a.score);
  
  const salientPages: string[] = [];
  const selectedPreviews: { page: number; filePath: string }[] = [];
  let tokenCount = 0;
  
  for (const scoredPage of scoredPages) {
    const pageTokens = scoredPage.pageData.text.length / 4;
    if (tokenCount + pageTokens <= tokenLimit) {
      salientPages.push(scoredPage.pageData.text);
      const preview = rasterPreviews.find(p => p.page === scoredPage.pageData.page);
      if (preview) selectedPreviews.push(preview);
      tokenCount += pageTokens;
    }
    if (salientPages.length >= 6) break;
  }
  
  const summary = `Selected ${salientPages.length} construction-focused pages from ${pageText.length} total pages, targeting floor plans, elevations, and structural details.`;
  
  return {
    salientPages,
    previews: selectedPreviews,
    summary
  };
}
