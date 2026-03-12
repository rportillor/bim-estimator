// server/helpers/positioning.ts
import { inferStoreyElevation } from "./storeys";

export type Vec3 = { x: number; y: number; z: number };
export type BuildingStorey = { name?: string; elevation?: number };
export type BuildingAnalysis = {
  dimensions?: { width: number; length: number };
  perimeter?: Array<{ x: number; z: number }>;
  origin?: Vec3;
};
export type PositioningMode = "auto" | "forcePerimeter" | "preferClaude";

const DEFAULT_GRID_SPACING = 3;
const EPS = 1e-6;

export function isNearOrigin(p?: Partial<Vec3>): boolean {
  if (!p) return true;
  const x = Number((p as any).x ?? 0);
  const y = Number((p as any).y ?? 0);
  const z = Number((p as any).z ?? 0);
  return Math.abs(x) < EPS && Math.abs(y) < EPS && Math.abs(z) < EPS;
}

export function isGridPattern(p: Vec3, spacing = DEFAULT_GRID_SPACING, tol = 1e-3): boolean {
  const rx = Math.abs(p.x / spacing - Math.round(p.x / spacing));
  const rz = Math.abs(p.z / spacing - Math.round(p.z / spacing));
  return rx < tol && rz < tol;
}

// treat "near zero" OR a tiny cluster as invalid
export function isDegenerateCluster(p?: {x?:number;y?:number;z?:number}): boolean {
  if (!p) return true;
  const x = Number(p.x ?? 0), y = Number(p.y ?? 0), z = Number(p.z ?? 0);
  const SMALL = 0.75; // ~3/4 of a meter is not plausible for a whole-building reference cluster
  // classic near-origin
  const near0 = Math.abs(x) < SMALL && Math.abs(y) < SMALL && Math.abs(z) < SMALL;
  // observed pattern: (0,0,-0.5) style lines
  const lineNear = Math.abs(x) < SMALL && Math.abs(y) < SMALL && Math.abs(z + 0.5) < SMALL;
  return near0 || lineNear;
}

function rectPerimeter(dim: { width: number; length: number }, o: Vec3) {
  const w = Math.max(0.1, dim.width);
  const l = Math.max(0.1, dim.length);
  const x = o.x;
  const z = o.z;
  return [
    { x, z },
    { x: x + w, z },
    { x: x + w, z: z + l },
    { x, z: z + l },
    { x, z }
  ];
}

function perimLen(pts: { x: number; z: number }[]) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    L += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return L;
}

function pointAlong(pts: { x: number; z: number }[], d: number) {
  let r = d;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (r <= len || len < EPS) {
      const t = len < EPS ? 0 : r / len;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    r -= len;
  }
  return pts[pts.length - 1];
}

export function computeClockwisePerimeterPosition(index: number, total: number, analysis: BuildingAnalysis) {
  const i = Math.max(0, Math.min(index, Math.max(1, total) - 1));
  const origin = analysis.origin || { x: 0, y: 0, z: 0 };
  // NO FALLBACK DIMENSIONS - building shape must come from actual documents
  let pts = analysis.perimeter && analysis.perimeter.length >= 4 
    ? [...analysis.perimeter] 
    : analysis.dimensions 
    ? rectPerimeter(analysis.dimensions, origin) 
    : (() => {
        console.error('❌ CRITICAL: No building perimeter or dimensions from construction documents!');
        console.error('❌ Cannot generate building without actual dimensions.');
        console.error('❌ Please provide construction documents with building footprint/dimensions.');
        // Return minimal points to prevent crash but make it obvious something is wrong
        return [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 1 }, { x: 0, z: 0 }];
      })();
  
  if (pts[0].x !== pts[pts.length - 1].x || pts[0].z !== pts[pts.length - 1].z) {
    pts = [...pts, pts[0]];
  }
  
  const perim = Math.max(EPS, perimLen(pts));
  const step = perim / Math.max(1, total);
  return pointAlong(pts, (step * i) % perim);
}

function classify(t?: string): "perimeter" | "interior" | "neutral" {
  const s = (t || "").toLowerCase();
  if (/(wall|partition|curtain|exterior|door|window|opening)/.test(s)) return "perimeter";
  if (/(slab|floor|roof|column|beam)/.test(s)) return "interior";
  return "neutral";
}

function interiorGrid(index: number, total: number, analysis: BuildingAnalysis, margin = 1, spacing = DEFAULT_GRID_SPACING) {
  const o = analysis.origin || { x: 0, y: 0, z: 0 };
  // NO FALLBACK - dimensions must come from actual construction documents
  if (!analysis.dimensions?.width || !analysis.dimensions?.length) {
    console.error('❌ CRITICAL: No building dimensions available for interior grid placement');
    console.error('❌ Building dimensions must be extracted from construction documents');
    // Return origin point to prevent crash
    return { x: o.x, z: o.z };
  }
  const w = Math.max(0.1, analysis.dimensions.width);
  const l = Math.max(0.1, analysis.dimensions.length);
  const W = Math.max(0.1, w - 2 * margin);
  const L = Math.max(0.1, l - 2 * margin);
  const cols = Math.max(1, Math.floor(W / spacing));
  const rows = Math.max(1, Math.ceil(total / cols));
  const col = index % cols;
  const row = Math.floor(index / cols);
  const x = o.x + margin + (W / Math.max(1, cols - 1)) * (cols === 1 ? 0 : col);
  const z = o.z + margin + (L / Math.max(1, rows - 1)) * (rows === 1 ? 0 : row);
  return { x, z };
}

export function computePositionForElement(opts: {
  index: number;
  total: number;
  storey?: BuildingStorey;
  existing?: Partial<{ real?: Vec3; coords?: Vec3 }>;
  analysis?: BuildingAnalysis | null;
  elementType?: string;
  mode?: PositioningMode;
  typeAware?: boolean;
  gridSpacing?: number;
}): Vec3 {
  const spacing = opts.gridSpacing || DEFAULT_GRID_SPACING;
  const ex = (opts.existing?.real || opts.existing?.coords) as Vec3 | undefined;
  const haveAnalysis = !!opts.analysis && (((opts.analysis?.dimensions?.width ?? 0) > 0) || ((opts.analysis?.perimeter?.length ?? 0) >= 4));
  const behavior = opts.typeAware === false ? "neutral" : classify(opts.elementType);
  // Get floor height from Claude's analysis if available
  const floorHeightMm = (opts.analysis as any)?.building_specifications?.floor_height_mm || 
                         (opts.analysis as any)?.floor_height_mm;
  const inferredElevation = inferStoreyElevation(opts.storey?.name, floorHeightMm);
  // Only use inferred elevation if it's a real value, otherwise default to 0 for ground floor
  const y = Number(opts.storey?.elevation ?? inferredElevation ?? 0);

  // preferClaude: keep Claude's coords unless obviously bad
  if (opts.mode === "preferClaude" && ex && !isDegenerateCluster(ex) && !isGridPattern(ex, spacing)) {
    return { ...ex, y };
  }

  // forcePerimeter: perimeter types on perimeter when analysis exists
  if (opts.mode === "forcePerimeter" && haveAnalysis && behavior !== "interior") {
    const p = computeClockwisePerimeterPosition(opts.index, opts.total, opts.analysis!);
    return { x: p.x, y, z: p.z };
  }

  // auto: smart override
  if (haveAnalysis) {
    if (behavior === "perimeter") {
      const override = !ex || isDegenerateCluster(ex) || isGridPattern(ex, spacing);
      if (override) {
        const p = computeClockwisePerimeterPosition(opts.index, opts.total, opts.analysis!);
        return { x: p.x, y, z: p.z };
      }
    } else if (behavior === "interior") {
      const p = interiorGrid(opts.index, opts.total, opts.analysis!, 1, spacing);
      return { x: p.x, y, z: p.z };
    } else {
      if (ex && !isDegenerateCluster(ex) && !isGridPattern(ex, spacing)) {
        return { ...ex, y };
      }
      const p = computeClockwisePerimeterPosition(opts.index, opts.total, opts.analysis!);
      return { x: p.x, y, z: p.z };
    }
  }

  // no analysis → keep good coords or even-spread
  if (ex && !isDegenerateCluster(ex)) {
    return { ...ex, y };
  }
  
  const cols = Math.ceil(Math.sqrt(Math.max(1, opts.total)));
  const row = Math.floor(opts.index / cols);
  const col = opts.index % cols;
  return { x: col * spacing, y, z: row * spacing };
}

// Optional OO API (matches your docs)
export class EnhancedPositioning {
  constructor(private analysis?: BuildingAnalysis | null, private mode: PositioningMode = "auto") {}
  
  place(index: number, total: number, storey?: BuildingStorey, existing?: Vec3, elementType?: string) {
    return computePositionForElement({
      index,
      total,
      storey,
      existing: { real: existing },
      analysis: this.analysis,
      elementType: this.mode === "forcePerimeter" ? elementType : elementType,
      mode: this.mode,
      typeAware: true,
    });
  }
}