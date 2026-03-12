// server/helpers/layout-repair.ts
import { bboxOf, convexHull, pca2D, rotate, centroid, Pt } from "./geom-utils";
import { detectGridFromElements } from "./grid-detect";

type RepairOptions = {
  force?: boolean;        // force repair even if not strictly collinear
  minAspectRatio?: number; // if varX/varY > N ⇒ likely collinear pattern
};

export type RepairResult = {
  applied: boolean;
  reason?: string;
  footprint?: Pt[];
  propertyLine?: Pt[];
  grid?: { xs: number[]; ys: number[] };
  stats?: any;
  elements: any[];
};

function getPoint(e: any): Pt {
  const g = typeof e?.geometry === "string" ? JSON.parse(e.geometry) : e?.geometry || {};
  const p = g?.location?.realLocation || e?.location || { x: 0, y: 0, z: 0 };
  return { x: +p.x || 0, y: +p.y || 0 };
}

function setPoint(e: any, p: Pt) {
  const g = (typeof e.geometry === "string" ? JSON.parse(e.geometry) : e.geometry) || {};
  g.location = g.location || {};
  g.location.realLocation = { ...(g.location.realLocation || {}), x: p.x, y: p.y, z: (g.location.realLocation?.z ?? 0) };
  e.geometry = g;
}

/** Heuristic layout repair:
 *  - Detects near-collinear layouts via PCA
 *  - Rotates to principal frame, spreads along orthogonal axis using inferred grid
 *  - Derives footprint hull, property line (same as footprint until we have explicit)
 *  - Returns grid lines for viewer overlay
 */
export function repairLayout(elementsIn: any[], opts: RepairOptions = {}): RepairResult {
  const elements = elementsIn.map(e => (typeof e?.geometry === "string" ? { ...e, geometry: JSON.parse(e.geometry) } : { ...e }));
  const pts = elements.map(getPoint);
  const { varX, varY, angle } = pca2D(pts);
  const ratio = (Math.max(varX, 1e-6) / Math.max(varY, 1e-6));

  const minAspect = opts.minAspectRatio ?? 12; // "domino line" if > 12× variance difference
  if (!opts.force && !(ratio > minAspect)) {
    // Return only helpful overlays
    const hull = convexHull(pts);
    const grid = detectGridFromElements(elements);
    return { applied: false, reason: "not-collinear", elements: elementsIn, footprint: hull, propertyLine: hull, grid, stats: { ratio, angle } };
  }

  // Rotate all points to PCA frame (major axis ~ X)
  const c = centroid(pts);
  const rotated = rotate(pts, -angle, c);
  // Compute grid from rotated elements
  const rotatedElems = elements.map((e, i) => ({ e, p: rotated[i] }));
  const grid = detectGridFromElements(rotatedElems.map(x => {
    const copy = { ...x.e };
    const g = (copy.geometry = copy.geometry || {});
    g.location = g.location || {};
    g.location.realLocation = { ...(g.location.realLocation || {}), x: x.p.x, y: x.p.y, z: (g.location.realLocation?.z ?? 0) };
    return copy;
  }));

  // If all nearly same Y, spread them across detected Y grid (or synthetic lanes)
  const Ys = rotated.map(p => p.y);
  const ySpan = Math.max(...Ys) - Math.min(...Ys);
  const narrow = ySpan < 0.02 * (Math.max(...rotated.map(p=>p.x)) - Math.min(...rotated.map(p=>p.x))); // <2% of X span

  let ysSlots: number[] = grid.ys && grid.ys.length >= 3 ? grid.ys.slice().sort((a,b)=>a-b) : [];
  if (narrow && ysSlots.length === 0) {
    // synthesize 8 lanes over ±W/6
    const W = Math.max(4, Math.sqrt(elements.length));
    ysSlots = Array.from({length: 8}, (_,i)=> (i-3.5) * (W/8));
  }

  if (narrow) {
    let k = 0;
    for (let i=0;i<rotated.length;i++) {
      const p = rotated[i];
      const lane = ysSlots[k % ysSlots.length] || 0;
      rotated[i] = { x: p.x, y: lane };
      k++;
    }
  }

  // Rotate back to world frame
  const repaired = rotate(rotated, +angle, c);

  // Write back positions
  for (let i=0;i<elements.length;i++) setPoint(elements[i], repaired[i]);

  // Compute overlays
  const hull = convexHull(repaired);
  const prop = hull.length ? hull : convexHull(pts); // fallback

  return {
    applied: true,
    reason: narrow ? "collinear-spread" : "high-aspect-spread",
    footprint: hull,
    propertyLine: prop,
    grid,
    stats: { ratio, angle, narrow, lanes: ysSlots.length },
    elements
  };
}