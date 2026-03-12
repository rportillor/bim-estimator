// server/helpers/element-sanitizer.ts
export type SanitizeReport = {
  fixedCount: number;
  swaps: number;
  clamped: number;
  zeros: number;
  examples: { id: string; type: string; before: any; after: any }[];
};

const MAX_DIM = 200;   // meters – anything larger is clamped (site sized)
const MIN_DIM = 0.01;  // meters – avoid zero-thickness
const SWAP_RATIO = Number(process.env.DIM_AXIS_SWAP_RATIO ?? 1.5);

function fixDims(e: any) {
  const dims = e?.geometry?.dimensions || {};
  let w = Number(dims.width  ?? dims.w  ?? 0) || 0;
  let h = Number(dims.height ?? dims.h ?? 0) || 0;
  let d = Number(dims.depth  ?? dims.d  ?? dims.length ?? 0) || 0;

  const before = { w, h, d };
  let swaps = 0, clamped = 0, zeros = 0;

  if (w <= 0 || d <= 0) zeros++;
  // clamp
  const clamp = (x: number) => {
    if (x <= 0) return MIN_DIM;
    if (x > MAX_DIM) { clamped++; return MAX_DIM; }
    return x;
  };
  w = clamp(w); h = clamp(h); d = clamp(d);

  // perimeter/beam-ish long-axis rule heuristic
  const t = String(e?.type || e?.category || "").toUpperCase();
  const perimeterish = /WALL|EXTERIOR|FACADE|BEAM|HEADER|LINTEL|DOOR|WINDOW/.test(t);
  const long = Math.max(w, d), short = Math.min(w, d);
  if (perimeterish && long / Math.max(short, MIN_DIM) >= SWAP_RATIO && w < d) {
    const tmp = w; w = d; d = tmp; swaps++;
  }

  e.geometry = e.geometry || {};
  e.geometry.dimensions = { width: w, height: h, depth: d };

  return { swaps, clamped, zeros, before, after: { w, h, d } };
}

export function sanitizeElements(elements: any[]): { elements: any[]; report: SanitizeReport } {
  const out: any[] = [];
  const report: SanitizeReport = { fixedCount: 0, swaps: 0, clamped: 0, zeros: 0, examples: [] };

  for (const e of elements || []) {
    const next = { ...e };
    const res = fixDims(next);
    if (res.swaps || res.clamped || res.zeros) {
      report.fixedCount++; report.swaps += res.swaps; report.clamped += res.clamped; report.zeros += res.zeros;
      if (report.examples.length < 6) {
        report.examples.push({ id: String(e?.id || ""), type: String(e?.type || e?.category || ""), before: res.before, after: res.after });
      }
    }
    out.push(next);
  }
  return { elements: out, report };
}