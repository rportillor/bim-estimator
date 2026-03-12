// server/services/raster-glyph-locator.ts
// Legend → symbol template matching on raster plan images (PNG/JPG) to get true XY (page coords).
// Optional dependency: "sharp". If not available, we no-op safely.

import fs from "fs";
import path from "path";
import { storage } from "../storage";

type Hit = {
  type: "LIGHT_FIXTURE" | "SPRINKLER" | "RECEPTACLE" | "EXIT_SIGN" | "VAV";
  docId: string;
  page: number;
  x: number;   // page pixels
  y: number;   // page pixels
  w: number;   // page pixels (template width at best scale)
  h: number;   // page pixels
  score: number; // NCC score
  pageWidth: number;
  pageHeight: number;
};

function trySharp() {
  try {
    // Use require in try-catch to safely handle optional dependency
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sharp = require("sharp");
    return sharp as typeof import("sharp");
  } catch {
    return null;
  }
}

const TEMPLATE_DIR = path.join(process.cwd(), "server", "assets", "legend-templates");

// Load all known templates (present or not)
async function loadTemplates(sharp: any) {
  const map: Record<string, { name:string; data: Uint8Array; w:number; h:number }> = {};
  const CAND = [
    ["LIGHT_FIXTURE", "light_fixture.png"],
    ["SPRINKLER",     "sprinkler.png"],
    ["RECEPTACLE",    "receptacle.png"],
    ["EXIT_SIGN",     "exit_sign.png"],
    ["VAV",           "vav.png"]
  ] as const;

  for (const [key, file] of CAND) {
    const p = path.join(TEMPLATE_DIR, file);
    if (!fs.existsSync(p)) continue;
    const img = sharp(p).grayscale().normalise();
    const meta = await img.metadata();
    if (!meta.width || !meta.height) continue;
    const raw = await img
      .resize(Math.min(48, meta.width), Math.min(48, meta.height), { fit: "inside" })
      .raw()
      .toBuffer();
    const m2 = await img.metadata();
    map[key] = { name: key, data: raw, w: m2.width!, h: m2.height! };
  }
  return map;
}

function ncc(
  src: Uint8Array, sw: number, sh: number,
  tpl: Uint8Array, tw: number, th: number,
  ox: number, oy: number
){
  // Normalized cross-correlation over grayscale 1-channel images
  // src at (ox,oy) window size tw×th vs template
  let sumS=0, sumT=0, sumSS=0, sumTT=0, sumST=0;
  for (let j=0;j<th;j++){
    for (let i=0;i<tw;i++){
      const s = src[(oy+j)*sw + (ox+i)];
      const t = tpl[j*tw + i];
      sumS += s; sumT += t;
      sumSS += s*s; sumTT += t*t;
      sumST += s*t;
    }
  }
  const n = tw*th;
  const num = sumST - (sumS*sumT)/n;
  const d1  = sumSS - (sumS*sumS)/n;
  const d2  = sumTT - (sumT*sumT)/n;
  const den = Math.sqrt(Math.max(d1,1e-9) * Math.max(d2,1e-9));
  return den>0 ? num/den : 0;
}

function nms(hits: Hit[], radiusPx=24): Hit[] {
  // Non-max suppression by score
  const out: Hit[] = [];
  const used = new Array(hits.length).fill(false);
  const sorted = hits.map((h,i)=>({h,i})).sort((a,b)=>b.h.score - a.h.score);
  for (const {h,i} of sorted){
    if (used[i]) continue;
    out.push(h);
    for (let j=0;j<sorted.length;j++){
      if (used[j]) continue;
      const g = sorted[j].h;
      if (g.docId!==h.docId || g.page!==h.page) continue;
      const dx=g.x-h.x, dy=g.y-h.y;
      if ((dx*dx+dy*dy) <= radiusPx*radiusPx) used[j]=true;
    }
  }
  return out;
}

export async function detectRasterSymbolsForModel(modelId: string): Promise<Hit[]> {
  if (String(process.env.ENABLE_RASTER_GLYPH||"off").toLowerCase()!=="on") return [];
  const sharp = trySharp();
  if (!sharp) {
    console.warn("[raster] 'sharp' not installed — set ENABLE_RASTER_GLYPH=off or `npm i sharp` to enable.");
    return [];
  }

  // 1) get model → project → docs → raster previews
  const model = await (storage as any).getBimModel?.(modelId);
  const projectId = model?.projectId || model?.project_id || null;
  if (!projectId) return [];
  const docs = await storage.getDocumentsByProject(projectId);
  const previews: Array<{ docId:string; page:number; key:string }> = [];
  for (const d of docs||[]){
    const full = await storage.getDocument(d.id);
    const arr = typeof full?.rasterPreviews==="string" ? JSON.parse(full.rasterPreviews) : (full?.rasterPreviews||[]);
    for (const r of arr||[]) {
      if (!r?.key) continue;
      previews.push({ docId: d.id, page: Number(r.page||1), key: r.key });
    }
  }
  if (!previews.length) return [];

  // 2) load templates
  const templates = await loadTemplates(sharp);
  const tkeys = Object.keys(templates);
  if (!tkeys.length) {
    console.warn("[raster] no legend templates found in server/assets/legend-templates — skipping raster match.");
    return [];
  }

  // 3) scan pages (scaled down) with simple NCC at stride / multi-scale
  const hits: Hit[] = [];
  const MAX_PAGES = Math.min(previews.length, Number(process.env.RASTER_MAX_PAGES || 30));
  const STRIDE = Number(process.env.RASTER_STRIDE || 8);
  const scales = [0.8, 1.0, 1.25]; // small pyramid

  for (let pi=0; pi<MAX_PAGES; pi++){
    const p = previews[pi];
    try {
      const filePath = (storage as any).getFilePath?.(p.key) || p.key;
      if (!fs.existsSync(filePath)) continue;

      // clamp working size
      const img = sharp(filePath).grayscale().normalise();
      const meta = await img.metadata();
      const maxDim = Math.max(meta.width||0, meta.height||0);
      const scalePage = maxDim>1600 ? 1600/maxDim : 1.0;
      const page = img.resize(Math.round((meta.width||0)*scalePage), Math.round((meta.height||0)*scalePage));
      const pageRaw = await page.raw().toBuffer();
      const pageMeta = await page.metadata();
      const PW = pageMeta.width!, PH = pageMeta.height!;

      for (const k of tkeys){
        const tpl = templates[k];
        for (const s of scales){
          const tw = Math.max(8, Math.round(tpl.w*s)), th = Math.max(8, Math.round(tpl.h*s));
          const tplScaled = await sharp(tpl.data, { raw:{ width: tpl.w, height: tpl.h, channels:1 }})
              .resize(tw, th, { fit:"fill" }).raw().toBuffer();

          // slide window
          for (let y=0; y<=PH-th; y+=STRIDE){
            for (let x=0; x<=PW-tw; x+=STRIDE){
              const score = ncc(pageRaw, PW, PH, tplScaled, tw, th, x, y);
              if (score >= 0.72) { // threshold; adjust as needed
                hits.push({
                  type: k as Hit["type"],
                  docId: p.docId, page: p.page,
                  x: Math.round(x/scalePage),
                  y: Math.round(y/scalePage),
                  w: Math.round(tw/scalePage),
                  h: Math.round(th/scalePage),
                  score,
                  pageWidth: Math.round(PW/scalePage),
                  pageHeight: Math.round(PH/scalePage)
                });
              }
            }
          }
        }
      }
    } catch (e:any) {
      console.warn("[raster] page scan failed:", e?.message || e);
    }
  }

  // suppress duplicates
  const clean = nms(hits, 32);
  console.log(`[raster] hits: raw=${hits.length} nms=${clean.length}`);
  return clean;
}