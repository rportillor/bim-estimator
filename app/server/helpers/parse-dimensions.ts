// server/helpers/parse-dimensions.ts
export type Dims = { width:number; height:number; depth:number };

const UNIT_FACTORS: Record<string, number> = {
  m: 1, meter: 1, meters: 1,
  mm: 0.001,
  cm: 0.01,
  km: 1000,
  in: 0.0254, inch: 0.0254, inches: 0.0254,
  ft: 0.3048, foot: 0.3048, feet: 0.3048,
};

function toMeters(val: number, unit?: string): number {
  if (!unit) return val;
  const u = unit.toLowerCase();
  return val * (UNIT_FACTORS[u] ?? 1);
}

export function parseDimensionString(text?: string | null): Partial<Dims> | null {
  if (!text) return null;
  const s = (""+text).replace(/×/g, "x").toLowerCase().trim();

  // "3m x 2.4m x 0.2m" or "3000mm x 2400mm x 200mm"
  const multi = s.match(/([\d.]+)\s*([a-z]+)?\s*[x*]\s*([\d.]+)\s*([a-z]+)?\s*[x*]\s*([\d.]+)\s*([a-z]+)?/i);
  if (multi) {
    const w = toMeters(parseFloat(multi[1]), multi[2]);
    const h = toMeters(parseFloat(multi[3]), multi[4]);
    const d = toMeters(parseFloat(multi[5]), multi[6]);
    if (Number.isFinite(w) && Number.isFinite(h) && Number.isFinite(d)) return { width:w, height:h, depth:d };
  }

  // "width: 3000mm, height: 2400mm, depth: 200mm"
  const wMatch = s.match(/width[^0-9]*([\d.]+)\s*([a-z]+)/);
  const hMatch = s.match(/height[^0-9]*([\d.]+)\s*([a-z]+)/);
  const dMatch = s.match(/(depth|thickness)[^0-9]*([\d.]+)\s*([a-z]+)/);
  const out: Partial<Dims> = {};
  if (wMatch) out.width = toMeters(parseFloat(wMatch[1]), wMatch[2]);
  if (hMatch) out.height = toMeters(parseFloat(hMatch[1]), hMatch[2]);
  if (dMatch) out.depth = toMeters(parseFloat(dMatch[2]), dMatch[3]);

  return Object.keys(out).length ? out : null;
}