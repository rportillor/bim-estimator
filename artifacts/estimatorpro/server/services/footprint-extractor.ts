// server/services/footprint-extractor.ts
import { storage } from "../storage";
import { extractPdfTextAndPages } from "./pdf-extract";
import sharp from "sharp";
import { parseFirstJsonObject } from '../utils/anthropic-response';

type EnsureArgs = {
  modelId: string;
  projectId: string;
  anthropicClient?: any;     // anthropic.messages.create(...)
  maxDocs?: number;          // how many candidate PDFs to scan (default 8)
  maxPagesPerDoc?: number;   // pages to sample per doc (default 4)
  maxChars?: number;         // prompt cap (default 24000)
};

import { Pt, convexHull as geomConvexHull } from "../helpers/geom-utils";
type SiteExtract = {
  units?: "metric"|"imperial";
  property_line?: Pt[];
  building_footprint?: Pt[];
  legend?: { label: string; keys: string[] }[];
  legend_line_types?: { label: string; desc: string; regex?: string }[];
  notes?: string[];
  source?: "metadata"|"claude-siteplan"|"raster-hull"|"text-dims";
};

const FT2M = 0.3048;

const PLAN_RE = /(site\s*plan|property\s*line|lot\s*line|key\s*plan|civil|parking|grid|north\s*arrow)/i;
const SITE_FILE_HINT = /(A0*0?2|SITE[_\-\s]*PLAN|C-|C0)/i; // catch typical naming

function closePoly(poly: Pt[] | null): Pt[] | null {
  if (!poly || poly.length < 3) return null;
  const a = poly[0], b = poly[poly.length - 1];
  if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-6) return [...poly, { ...a }];
  return poly;
}
function inMeters(poly: Pt[] | null, units?: string): Pt[] | null {
  if (!poly) return null;
  const u = String(units || "").toLowerCase();
  if (/ft|feet|imperial/.test(u)) return poly.map(p => ({ x: p.x * FT2M, y: p.y * FT2M }));
  return poly;
}
function _bboxDims(poly: Pt[] | null) {
  if (!poly || poly.length < 3) return null;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for (const p of poly) { if (p.x<minX)minX=p.x; if (p.y<minY)minY=p.y; if (p.x>maxX)maxX=p.x; if (p.y>maxY)maxY=p.y; }
  return { width: maxX - minX, length: maxY - minY };
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function simplifyRDP(points: Pt[], eps=2): Pt[] {
  if (points.length <= 3) return points;
  const dmax = (p:Pt, a:Pt, b:Pt) => {
    const A=b.y-a.y, B=a.x-b.x, C=b.x*a.y-a.x*b.y;
    return Math.abs(A*p.x + B*p.y + C) / Math.hypot(A,B);
  };
  let maxDist=0, idx=0;
  for (let i=1;i<points.length-1;i++){
    const d=dmax(points[i],points[0],points[points.length-1]);
    if (d>maxDist){maxDist=d;idx=i;}
  }
  if (maxDist>eps){
    const r1=simplifyRDP(points.slice(0,idx+1),eps);
    const r2=simplifyRDP(points.slice(idx),eps);
    return [...r1.slice(0,-1),...r2];
  }
  return [points[0], points[points.length-1]];
}
// ✅ REMOVED: Duplicate convexHull implementation - now using centralized geom-utils version
async function pickSitePlanDocs(projectId: string, maxDocs=8) {
  const all = await storage.getDocumentsByProject(projectId);
  const pdfs = (all||[]).filter((d:any)=> String(d?.fileType||"").toLowerCase().includes("pdf"));
  // Prefer names that look like site plan, but keep a few more as fallback
  const ranked = pdfs.sort((a:any,b:any)=>{
    const an=String(a?.filename||""), bn=String(b?.filename||"");
    const as = PLAN_RE.test(an) || SITE_FILE_HINT.test(an) ? 2 : 0;
    const bs = PLAN_RE.test(bn) || SITE_FILE_HINT.test(bn) ? 2 : 0;
    return (bs-as) || an.localeCompare(bn);
  });
  return ranked.slice(0, maxDocs);
}
function guessDimsFromText(texts: string[]): { width:number; length:number } | null {
  const nums: number[] = [];
  const u: string[] = [];
  const RX = /(\d+(\.\d+)?)\s*(mm|cm|m|ft|feet|')/gi;
  for (const t of texts) {
    let m: RegExpExecArray | null;
    while ((m = RX.exec(t))) {
      const val = parseFloat(m[1]);
      const unit = m[3].toLowerCase();
      nums.push(val); u.push(unit);
    }
  }
  if (!nums.length) return null;
  // Take top two big numbers as width/length
  const idxs = nums.map((n,i)=>({n,i})).sort((a,b)=> b.n-a.n).slice(0,2).map(o=>o.i);
  if (idxs.length<2) return null;
  const toM = (v:number, unit:string) => unit.includes("ft") || unit.includes("'") ? v*FT2M : unit==="mm" ? v/1000 : unit==="cm" ? v/100 : v;
  const w = toM(nums[idxs[0]], u[idxs[0]]); const l = toM(nums[idxs[1]], u[idxs[1]]);
  if (!Number.isFinite(w) || !Number.isFinite(l)) return null;
  if (w < 5 && l < 5) return null; // discard silly sizes
  return { width: Math.max(w,l), length: Math.min(w,l) };
}
async function rasterHullFromPreview(imgPath: string): Promise<Pt[] | null> {
  try {
    // Resolve file path relative to uploads directory
    const path = await import('path');
    const fs = await import('fs');
    const filePath = path.isAbsolute(imgPath) ? imgPath : path.resolve('uploads', imgPath);
    
    // Verify file exists before processing
    if (!fs.existsSync(filePath)) {
      console.warn(`File not found: ${filePath}`);
      return null;
    }
    if (!filePath) return null;
    const img = sharp(filePath);
    const meta = await img.metadata(); if (!meta.width || !meta.height) return null;
    const w = meta.width, h = meta.height;
    // Downscale for speed
    const scale = Math.min(1, 1200 / Math.max(w,h));
    const W = Math.max(300, Math.round(w*scale));
    const H = Math.max(300, Math.round(h*scale));
    const raw = await img.resize(W,H).grayscale().normalise().toColourspace("b-w").raw().toBuffer();
    const data = new Uint8Array(raw);

    // Simple edge sampling: pick pixels darker than threshold (ink)
    const pts: Pt[] = [];
    let _sum=0;
    for (let y=0;y<H;y+=2){
      for (let x=0;x<W;x+=2){
        const v = data[y*W + x];
        _sum += v;
        if (v < 110) { // ink-ish
          // sparsify
          if ((x + y) % 6 === 0) pts.push({ x, y });
        }
      }
    }
    if (pts.length < 50) return null;
    const hull = geomConvexHull(pts);
    // normalize to [0..1] and return as "image units"
    const minX = Math.min(...hull.map(p=>p.x));
    const maxX = Math.max(...hull.map(p=>p.x));
    const minY = Math.min(...hull.map(p=>p.y));
    const maxY = Math.max(...hull.map(p=>p.y));
    const norm = hull.map(p => ({ x: (p.x-minX)/(maxX-minX), y: 1 - (p.y-minY)/(maxY-minY) })); // y up
    return closePoly(norm);
  } catch { return null; }
}

export async function ensureFootprintForModel(args: EnsureArgs): Promise<SiteExtract | null> {
  const { modelId, projectId, anthropicClient, maxDocs=8, maxPagesPerDoc=4, maxChars=24000 } = args;

  // 0) Reuse metadata if present
  try {
    const getModel = (storage as any).getBimModel?.bind(storage);
    if (getModel) {
      const m = await getModel(modelId);
      const md = m?.metadata || {};
      const a  = md?.analysis || md?.building_analysis || {};
      const bld = closePoly(inMeters(a?.footprint || a?.perimeter || null, a?.units));
      const prop = closePoly(inMeters(md?.site?.property_line || null, a?.units));
      if (bld || prop) return { units: a?.units, property_line: prop || undefined, building_footprint: bld || undefined, legend: md?.site?.legend, legend_line_types: md?.site?.legend_line_types, notes: a?.notes, source: "metadata" };
    }
  } catch { /* intentionally empty */ }

  // 1) Try Claude on site plan text
  const siteDocs = await pickSitePlanDocs(projectId, maxDocs);
  const pages: { filename:string; page:number; text:string; docId:string; previews:any[] }[] = [];

  for (const d of siteDocs) {
    try {
      const full = await storage.getDocument(d.id);
      const previews = full?.rasterPreviews ? (typeof full.rasterPreviews === "string" ? JSON.parse(full.rasterPreviews) : full.rasterPreviews) : [];
      const { pageTexts } = await extractPdfTextAndPages({ id: d.id, name: d.filename, storageKey: full?.storageKey || null });
      // Choose pages that look like site/legend/property
      const idx: number[] = [];
      for (let i=0; i<pageTexts.length; i++) {
        const t = pageTexts[i];
        if (/(site\s*plan|property\s*line|building\s*(outline|footprint)|legend|north|bearing|dimension|setback|lot\s*line)/i.test(t)) idx.push(i);
      }
      const take = (idx.length ? idx : Array.from({length: pageTexts.length}, (_, i) => i)).slice(0, maxPagesPerDoc);
      for (const i of take) {
        pages.push({ filename: d.filename, page: i+1, text: pageTexts[i].slice(0, Math.ceil(maxChars/maxPagesPerDoc)), docId: d.id, previews });
      }
    } catch { /* intentionally empty */ }
  }

  if (pages.length && anthropicClient?.messages?.create) {
    const bundle = pages.map(p => `# ${p.filename} — Page ${p.page}\n${p.text}`).join("\n\n---\n\n").slice(0, maxChars);
    try {
      const resp = await anthropicClient.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1600,
        temperature: 0,
        system: `Extract SITE geometry & legend as STRICT JSON; return ONLY JSON:

{
 "units": "metric"|"imperial",
 "property_line": [{"x": number,"y": number}, ... closed] | null,
 "building_footprint": [{"x": number,"y": number}, ... closed] | null,
 "legend": [ {"label": string, "keys": [string,...]}, ... ],
 "legend_line_types": [ {"label": string, "desc": string, "regex": string}, ... ],
 "notes": string[]
}

Rules:
- property_line = OUTERMOST lot/property boundary (largest).
- building_footprint = building outline (exclude setbacks/property).
- vertices clockwise; +x east, +y north; feet allowed if imperial.`,
        messages: [{ role: "user", content: bundle }]
      });

      const txt = Array.isArray((resp as any)?.content)
        ? (resp as any).content.map((c:any)=>c?.text||"").join("\n")
        : String((resp as any)?.content || "");
      const json = parseFirstJsonObject(txt);

      const units = (json?.units === "imperial" ? "imperial" : "metric") as "metric"|"imperial";
      const prop = closePoly(inMeters(json?.property_line || null, units));
      const bld  = closePoly(inMeters(json?.building_footprint || null, units));
      const legend = Array.isArray(json?.legend) ? json.legend.map((e:any)=>({label:String(e?.label||"").trim(), keys:(Array.isArray(e?.keys)? e.keys:[]).map((k:any)=>String(k||"").trim())})) : [];
      const legendLine = Array.isArray(json?.legend_line_types) ? json.legend_line_types.map((e:any)=>({label:String(e?.label||"").trim(), desc:String(e?.desc||"").trim(), regex:String(e?.regex||"").trim()})) : [];

      if (prop || bld) {
        try {
          const updateMeta = (storage as any).updateBimModelMetadata?.bind(storage);
          if (updateMeta) await updateMeta(modelId, { site: { property_line: prop || null, legend, legend_line_types: legendLine }, analysis: { units, footprint: bld || null, perimeter: bld || null } });
        } catch { /* intentionally empty */ }
        return { units, property_line: prop || undefined, building_footprint: bld || undefined, legend, legend_line_types: legendLine, source: "claude-siteplan" };
      }
    } catch {/* fall through to raster */}
  }

  // 2) Raster fallback – build normalized hull from first available preview
  for (const p of pages) {
    const previews = p.previews || [];
    if (!Array.isArray(previews) || !previews.length) continue;
    const key = previews[0]?.key; if (!key) continue;
    const hull01 = await rasterHullFromPreview(String(key));
    if (hull01) {
      // try to infer meters from text if we can:
      const dims = guessDimsFromText(pages.map(pg=>pg.text));
      let meters: Pt[] | null = null;
      if (dims) {
        meters = closePoly(hull01.map(q => ({ x: q.x * dims.width, y: q.y * dims.length })));
      }
      const res: SiteExtract = {
        property_line: undefined,
        building_footprint: meters || hull01, // if no dims we keep [0..1] polygon; calibration will still orient & scale relative
        legend: [],
        legend_line_types: [],
        source: dims ? "raster-hull" : "text-dims"
      };
      try {
        const updateMeta = (storage as any).updateBimModelMetadata?.bind(storage);
        if (updateMeta) await updateMeta(modelId, { analysis: { footprint: res.building_footprint, perimeter: res.building_footprint, dimensions: dims || null } });
      } catch { /* intentionally empty */ }
      return res;
    }
  }

  // 3) Text-only dims fallback (emergency: assume square)
  const dims = guessDimsFromText(pages.map(p=>p.text));
  if (dims) {
    const sq: Pt[] = [{ x: 0, y: 0 }, { x: dims.width, y: 0 }, { x: dims.width, y: dims.length }, { x: 0, y: dims.length }, { x: 0, y: 0 }];
    try {
      const updateMeta = (storage as any).updateBimModelMetadata?.bind(storage);
      if (updateMeta) await updateMeta(modelId, { analysis: { footprint: sq, perimeter: sq, dimensions: dims } });
    } catch { /* intentionally empty */ }
    return { building_footprint: sq, legend: [], legend_line_types: [], source: "text-dims" };
  }

  return null; // no footprint found
}