// server/helpers/positioning-guard.ts
export type XY = { x: number; y: number; z?: number };

const EPS = 1e-3;

function variance(arr: number[]) {
  if (!arr.length) return 0;
  const mean = arr.reduce((a,b)=>a+b,0) / arr.length;
  return arr.reduce((a,b)=>a + Math.pow(b-mean,2), 0) / arr.length;
}

function uniqueRatio(arr: number[]) {
  if (!arr.length) return 0;
  const uniq = new Set(arr.map(v => Number.isFinite(v) ? +v.toFixed(4) : v));
  return uniq.size / arr.length;
}

function pointInPolygon(pt: [number, number], poly: Array<[number, number]>) {
  // ray-cast
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const intersect = ((yi > pt[1]) !== (yj > pt[1])) &&
      (pt[0] < (xj - xi) * (pt[1] - yi) / ((yj - yi) || EPS) + xi);
    if (intersect) c = !c;
  }
  return c;
}

export function isTrustworthyCoordSet(
  coords: XY[] | undefined,
  totalElements: number,
  footprint?: Array<{ x:number; y:number }>
) {
  if (!Array.isArray(coords) || coords.length === 0) return false;

  // Need a minimum sample size relative to model size
  const minSample = Math.min( Math.max(20, Math.ceil(0.05 * totalElements)), coords.length );
  const sample = coords.slice(0, minSample);

  const xs = sample.map(c => +c.x).filter(Number.isFinite);
  const ys = sample.map(c => +c.y).filter(Number.isFinite);
  const vx = variance(xs), vy = variance(ys);
  const ux = uniqueRatio(xs), uy = uniqueRatio(ys);

  // If both axes have near-zero variance or very low uniqueness → it's "one point"
  if (vx < EPS && vy < EPS) return false;
  if (Math.max(ux, uy) < 0.20) return false; // <20% unique values = probably repeated point

  // Optional: sanity-check against footprint
  if (Array.isArray(footprint) && footprint.length >= 3) {
    const poly = footprint.map(p => [p.x, p.y] as [number, number]);
    const inside = sample.filter(c => pointInPolygon([c.x, c.y], poly)).length / sample.length;
    if (inside < 0.6) return false; // most points should land in the building area
  }
  return true;
}