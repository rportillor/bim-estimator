// server/services/drawing-analyzer.ts
import { LEGEND_MAP } from "../helpers/legend-lexicon";
import { storage } from "../storage";
import { extractPdfTextAndPages } from "./pdf-extract-new";

type Doc = { id:string; filename:string; fileType?:string };
type Page = { page:number; text:string };

function classifySheet(filename:string, pages:Page[]){
  const name = (filename||"").toUpperCase();
  const blob = (pages||[]).slice(0,3).map(p=>p.text).join("\n").toUpperCase();
  const isE  = /(^|[\s_-])E[\s_-]|\bELECTRICAL\b/.test(name) || /\bELECTRICAL\b|\bPANEL\b/.test(blob);
  const isM  = /(^|[\s_-])M[\s_-]|\bMECHANICAL\b/.test(name) || /\bMECHANICAL\b|\bCFM\b|\bRTU\b/.test(blob);
  const isP  = /(^|[\s_-])P[\s_-]|\bPLUMBING\b/.test(name)   || /\bPLUMBING\b|\bDIA\b/.test(blob);
  const isFP = /\bFP\b|\bFIRE\s*PROTECTION\b/.test(name+blob) || /\bSPRINKLER\b/.test(blob);
  const isA  = /(^|[\s_-])A[\s_-]|\bARCH(ITECTURAL)?\b/.test(name) || /\bDOOR\b|\bWINDOW\b|\bWALL\b/.test(blob);
  const isS  = /(^|[\s_-])S[\s_-]|\bSTRUCTURAL\b/.test(name)  || /\bBEAM\b|\bCOLUMN\b|\bFOOTING\b/.test(blob);
  return { E:isE, M:isM, P:isP, FP:isFP, A:isA, S:isS };
}

function _parseSpacing(_text:string, _kind:"light"|"sprinkler"|"receptacle"){
  // Don't try to parse spacing from text - construction drawings show spacing
  // visually with dimension lines and numbers without explicit units.
  // Claude's visual analysis will identify the actual spacing from the drawings.
  return null;
}

function parsePanels(text:string){
  const out: Array<{ tag:string; amps?:number; circuits?:number }> = [];
  const lines = text.split(/\n+/);
  for (const L of lines){
    const m = L.match(/\bpanel\s*([A-Z0-9-]+)\b.*?\b(\d{2,3})\s*A\b/i);
    if (m) out.push({ tag: m[1].toUpperCase(), amps: +m[2] });
  }
  // crude circuit count hint
  const circuitHits = (text.match(/\bCIRCUIT\b|\bCKT\b/ig) || []).length;
  if (out.length && circuitHits) out[0].circuits = Math.max(out[0].circuits||0, circuitHits);
  return out;
}

export async function analyzeDrawingsForFacts(projectId:string, docs:Doc[]) {
  // Temporarily enable for testing - you can change this back to env check later
  const isEnabled = String(process.env.ENABLE_DRAWING_ANALYZER||"on").toLowerCase()==="on";
  console.log(`[analyzer] ENABLE_DRAWING_ANALYZER=${process.env.ENABLE_DRAWING_ANALYZER}, enabled=${isEnabled}`);
  
  if (!isEnabled) {
    return { enabled:false, facts:{} };
  }

  const facts: any = {
    lighting: null,
    sprinklers: null,
    receptacles: null,
    panels: [] as Array<{tag:string; amps?:number; circuits?:number}>,
    legendHits: [] as Array<{type:string; page:number; text:string}>
  };

  for (const doc of docs) {
    if (!/pdf/i.test(doc?.fileType || doc?.filename)) continue;
    let pageTexts: string[] = [];
    try {
      const full = await storage.getDocument(doc.id);
      const { pageTexts: pages, fullText: _fullText } = await extractPdfTextAndPages({
        id: doc.id, name: doc.filename, storageKey: full?.storageKey || null
      });
      pageTexts = pages;
    } catch(e) {
      console.warn("[analyzer] pdf extract failed for", doc.filename, e);
      continue;
    }

    const pages: Page[] = pageTexts.map((t, i)=>({ page: i+1, text: t }));
    const cls = classifySheet(doc.filename, pages);

    // Legend / symbol hits
    for (const p of pages.slice(0,5)) {
      for (const rule of LEGEND_MAP) {
        if (rule.re.test(p.text)) facts.legendHits.push({ type: rule.type, page: p.page, text: p.text.slice(0,400) });
      }
    }

    // Electrical
    if (cls.E) {
      const joined = pages.slice(0,6).map(p=>p.text).join("\n");
      // Only parse panels from text, spacing will come from Claude's visual analysis
      const panels = parsePanels(joined);
      if (panels.length) facts.panels.push(...panels);
    }

    // Fire protection
    // Sprinkler spacing will be determined by Claude's visual analysis of the drawings

    // Mechanical, Plumbing parsing hooks could be added similarly (duct sizes, fixture schedules)
  }

  return { enabled:true, facts };
}