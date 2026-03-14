// server/services/raster-legend-assoc.ts
import sharp from "sharp";
import { storage } from "../storage";

type Gray = { w:number; h:number; data: Uint8Array }; // 0..255

async function readGrayPng(path: string): Promise<Gray> {
  const img = sharp(path);
  const { width, height } = await img.metadata();
  if (!width || !height) throw new Error("image has no size");
  const raw = await img.removeAlpha().grayscale().raw().toBuffer();
  return { w: width, h: height, data: new Uint8Array(raw) };
}

function _crop(g: Gray, x:number, y:number, w:number, h:number): Gray {
  const out = new Uint8Array(w*h);
  for (let j=0;j<h;j++){
    const sy = Math.min(g.h-1, Math.max(0, y+j));
    for (let i=0;i<w;i++){
      const sx = Math.min(g.w-1, Math.max(0, x+i));
      out[j*w+i] = g.data[sy*g.w + sx];
    }
  }
  return { w, h, data: out };
}

function normCorr(img: Gray, tpl: Gray, ox:number, oy:number): number {
  // normalized cross-correlation in [0..1]
  let sumI=0,sumT=0,sumI2=0,sumT2=0,sumIT=0;
  for (let j=0;j<tpl.h;j++){
    for (let i=0;i<tpl.w;i++){
      const a = img.data[(oy+j)*img.w + (ox+i)];
      const b = tpl.data[j*tpl.w + i];
      sumI += a; sumT += b; sumI2 += a*a; sumT2 += b*b; sumIT += a*b;
    }
  }
  const n = tpl.w*tpl.h;
  const num = sumIT - (sumI*sumT)/n;
  const den = Math.sqrt( (sumI2 - (sumI*sumI)/n) * (sumT2 - (sumT*sumT)/n) + 1e-9 );
  return den > 0 ? Math.max(0, Math.min(1, num/den)) : 0;
}

function synthCircleTemplate(diamPx: number, stroke=2): Gray {
  const r = Math.max(4, Math.round(diamPx/2));
  const w = 2*r+1, h=w;
  const data = new Uint8Array(w*h).fill(0);
  for (let y=0;y<h;y++){
    for (let x=0;x<w;x++){
      const dx = x-r, dy = y-r, dd = Math.sqrt(dx*dx+dy*dy);
      if (Math.abs(dd - r) <= stroke) data[y*w+x] = 255;
    }
  }
  return { w, h, data };
}

/** Detect circular-ish symbols (trees, manholes, valves, poles) across scales. */
export async function detectRoundSymbolsFromRasters(projectId: string, maxPages=6): Promise<{ pageId:string; imagePath:string; hits: { cx_norm:number; cy_norm:number; score:number }[] }[]> {
  // Load a few site plan preview rasters
  const docs = await storage.getDocumentsByProject(projectId);
  const PLAN = /(site\s*plan|civil|parking|key\s*plan)/i;
  const pdfs = (docs||[]).filter((d:any)=> (d?.fileType||"").includes("pdf") && PLAN.test(String(d?.filename||""))).slice(0, maxPages);

  const out: { pageId:string; imagePath:string; hits: { cx_norm:number; cy_norm:number; score:number }[] }[] = [];

  for (const d of pdfs) {
    try {
      const full = await storage.getDocument(d.id);
      const previews = full?.rasterPreviews
        ? (typeof full.rasterPreviews === "string" ? JSON.parse(full.rasterPreviews) : full.rasterPreviews)
        : [];
      if (!Array.isArray(previews) || !previews.length) continue;

      // take first preview for speed (extend if you want)
      const page0 = previews[0];
      // storage.getFilePath or resolver: assume storage.getFilePath(path) works with a relative key
      const imgPath = (page0?.key || "").toString();
      if (!imgPath) continue;
      
      const fullPath = imgPath; // Use imgPath directly
      const gray = await readGrayPng(fullPath);

      // build a small bank of circle templates (different sizes)
      const bank = [10,14,18,24,30].map(px => synthCircleTemplate(px, 2));
      const stride = 4; // step for sliding window
      const hits: { cx_norm:number; cy_norm:number; score:number }[] = [];

      for (const tpl of bank) {
        for (let y=0; y<=gray.h - tpl.h; y+=stride) {
          for (let x=0; x<=gray.w - tpl.w; x+=stride) {
            const s = normCorr(gray, tpl, x, y);
            if (s >= 0.82) { // threshold – tuneable
              hits.push({ cx_norm: (x + tpl.w/2)/gray.w, cy_norm: (y + tpl.h/2)/gray.h, score: s });
            }
          }
        }
      }

      // thin duplicates (NMS)
      hits.sort((a,b)=> b.score - a.score);
      const keep: typeof hits = [];
      const rad = 0.02; // normalized distance threshold
      for (const h of hits) {
        if (keep.every(k => Math.hypot(k.cx_norm - h.cx_norm, k.cy_norm - h.cy_norm) > rad)) keep.push(h);
      }

      out.push({ pageId: String(d.id), imagePath: imgPath, hits: keep });
    } catch (e) { 
      console.warn(`Symbol detection failed for document ${d.id}:`, e);
      /* continue */ 
    }
  }

  return out;
}