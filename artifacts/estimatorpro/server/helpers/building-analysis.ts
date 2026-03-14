// server/helpers/building-analysis.ts
import type { BuildingAnalysis } from "./positioning";

// Raw element (Claude/RealQTO shapes we see)
type RawElement = {
  type?: string; category?: string; name?: string;
  location?: { x?: number; y?: number; z?: number };
  coordinates?: { x?: number; y?: number; z?: number };
  geometry?: { location?: { realLocation?: { x:number; y:number; z:number } } };
  properties?: { realLocation?: { x:number; y:number; z:number } };
  dimensions?: { width?: number; height?: number; depth?: number } | string;
  size?: { x?: number; y?: number; z?: number };
};

const UNIT: Record<string, number> = {
  m: 1, meter: 1, meters: 1,
  mm: 0.001, cm: 0.01, km: 1000,
  ft: 0.3048, foot: 0.3048, feet: 0.3048,
  in: 0.0254, inch: 0.0254, inches: 0.0254,
};
const toMeters = (n:number, u?:string) => n * (UNIT[(u||"m").toLowerCase()] ?? 1);

// "48m x 32m", "160' x 105'", "48 m by 32 m", "width 48 m, length 32 m"
function parseDimsFromText(text?: string | null): { width?: number; length?: number } | null {
  if (!text) return null;
  const s = (""+text).toLowerCase().replace(/×/g,"x");
  const r1 = s.match(/([\d.]+)\s*([a-z'"]+)?\s*[xby]\s*([\d.]+)\s*([a-z'"]+)?/i);
  if (r1) {
    const a = parseFloat(r1[1]); const au = (r1[2]||"").replace(/["']/g,"");
    const b = parseFloat(r1[3]); const bu = (r1[4]||"").replace(/["']/g,"") || au;
    const width  = toMeters(a, au);
    const length = toMeters(b, bu);
    if (Number.isFinite(width) && Number.isFinite(length)) return { width, length };
  }
  const w = s.match(/width[^0-9]*([\d.]+)\s*([a-z'"]+)/i);
  const l = s.match(/length[^0-9]*([\d.]+)\s*([a-z'"]+)/i);
  if (w && l) {
    const width  = toMeters(parseFloat(w[1]), (w[2]||"").replace(/["']/g,""));
    const length = toMeters(parseFloat(l[1]), (l[2]||"").replace(/["']/g,""));
    if (Number.isFinite(width) && Number.isFinite(length)) return { width, length };
  }
  return null;
}

function pickLoc(e: RawElement) {
  return e?.geometry?.location?.realLocation
      || e?.properties?.realLocation
      || e?.location
      || e?.coordinates
      || null;
}

// Heuristic: prefer perimeter-defining types for bounding box if available
const PERIM_RE = /(exterior|foundation|wall|curtain|facade|slab|floor|roof)/i;

export function analysisFromRawElements(raw?: RawElement[] | null): BuildingAnalysis | null {
  if (!raw || !raw.length) return null;

  // First pass: only perimeter-ish types; fallback to all if none.
  let pool = raw.filter(r => PERIM_RE.test((r.type||r.category||"")));
  if (!pool.length) pool = raw;

  let minX=+Infinity, maxX=-Infinity, minZ=+Infinity, maxZ=-Infinity;
  for (const r of pool) {
    const p = pickLoc(r); if (!p) continue;
    let x=Number(p.x ?? 0), z=Number(p.z ?? 0);
    if (!Number.isFinite(x)||!Number.isFinite(z)) continue;
    // If Claude leaked mm, normalize the huge magnitudes
    if (Math.abs(x)>1000 || Math.abs(z)>1000){ x/=1000; z/=1000; }
    minX=Math.min(minX,x); maxX=Math.max(maxX,x);
    minZ=Math.min(minZ,z); maxZ=Math.max(maxZ,z);
  }
  if (![minX,maxX,minZ,maxZ].every(Number.isFinite)) return null;

  // pad a hair to avoid edge clipping
  const pad = 0.5;
  const origin = { x: minX - pad, y: 0, z: minZ - pad };
  const width  = Math.max(0.1, (maxX - minX) + 2*pad);
  const length = Math.max(0.1, (maxZ - minZ) + 2*pad);
  return { origin, dimensions: { width, length } };
}

export function deriveBuildingAnalysisFromClaude(input: any): BuildingAnalysis | null {
  if (!input) return null;

  // A) Structured
  if (input.dimensions || input.perimeter) {
    const origin = input.origin && Number.isFinite(Number(input.origin.x))
      ? { x:Number(input.origin.x), y:Number(input.origin.y||0), z:Number(input.origin.z) }
      : { x:0, y:0, z:0 };
    if (Array.isArray(input.perimeter) && input.perimeter.length>=3) {
      const per = input.perimeter.map((p:any)=>({ x:Number(p.x||p[0]||0), z:Number(p.z||p[1]||0) }));
      return { origin, perimeter: per };
    }
    if (input.dimensions) {
      const w=Number(input.dimensions.width), l=Number(input.dimensions.length);
      if (Number.isFinite(w) && Number.isFinite(l)) return { origin, dimensions:{ width:w, length:l } };
    }
  }

  // B) Text blob (Claude sometimes returns prose)
  const text = typeof input === "string" ? input : (typeof input?.text === "string" ? input.text : "");
  const dims = parseDimsFromText(text);
  if (dims?.width && dims?.length) return { origin:{x:0,y:0,z:0}, dimensions:{ width:dims.width, length:dims.length } };

  return null;
}

/** If Claude produced an obviously wrong footprint, recompute from elements. */
export function validateOrRecomputeAnalysis(
  initial: BuildingAnalysis | null,
  rawElements?: RawElement[] | null
): BuildingAnalysis | null {
  const tiny = (v:number) => !Number.isFinite(v) || v < 2; // Only reject truly tiny dimensions (room-size instead of building-size)
  if (!initial) return analysisFromRawElements(rawElements);
  if (initial.dimensions && (tiny(initial.dimensions.width) || tiny(initial.dimensions.length))) {
    console.log(`⚠️ Claude dimensions rejected as too small: ${initial.dimensions.width}m x ${initial.dimensions.length}m, recomputing from elements`);
    const rec = analysisFromRawElements(rawElements);
    return rec || initial;
  }
  console.log(`✅ Using Claude's building dimensions: ${initial.dimensions?.width}m x ${initial.dimensions?.length}m`);
  return initial;
}