// server/helpers/claude-placement.ts

export type PlacementSample = { x:number; y:number; z?:number; anchor?: string };
export type PlacementByFamily = Record<string, PlacementSample[]>;

export function extractPlacementByFamily(analysis: any): PlacementByFamily {
  const out: PlacementByFamily = {};
  const src = analysis?.placement_samples && typeof analysis.placement_samples === "object"
    ? analysis.placement_samples : {};

  for (const k of Object.keys(src)) {
    const arr = Array.isArray(src[k]) ? src[k] : [];
    out[k.toUpperCase()] = arr.filter(p => Number.isFinite(p?.x) && Number.isFinite(p?.y))
                              .map(p => ({ x: +p.x, y: +p.y, z: Number.isFinite(p?.z) ? +p.z : undefined, anchor: p?.anchor }));
  }
  return out;
}

export function familyKey(type: string): string {
  const t = (type || "").toUpperCase();
  if (/WALL/.test(t)) return "WALL";
  if (/COLUMN/.test(t)) return "COLUMN";
  if (/BEAM/.test(t)) return "BEAM";
  if (/SLAB|FLOOR/.test(t)) return "SLAB";
  if (/DOOR/.test(t)) return "DOOR";
  if (/WINDOW/.test(t)) return "WINDOW";
  if (/LIGHT/.test(t)) return "LIGHT";
  if (/RECEPTACLE|OUTLET/.test(t)) return "RECEPTACLE";
  if (/SPRINKLER/.test(t)) return "SPRINKLER";
  return "OTHER";
}

export function selectSampleForIndex(
  fam: string,
  samples: PlacementByFamily,
  index: number,
  _totalNeeded: number,
  _footprint?: Array<{x:number;y:number}>
) {
  const arr = samples[fam] || [];
  if (arr.length === 0) return null;
  // simple trust guard: need variance and enough unique XYs
  const xs = arr.map(p=>p.x), ys = arr.map(p=>p.y);
  const v = (a:number[]) => a.length ? a.reduce((s,x)=>s+x*x,0)/a.length - Math.pow(a.reduce((s,x)=>s+x,0)/a.length,2) : 0;
  if (v(xs) < 1 || v(ys) < 1) return null;
  return arr[index % arr.length];
}