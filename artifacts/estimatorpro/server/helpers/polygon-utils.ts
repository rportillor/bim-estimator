// server/helpers/polygon-utils.ts
export type Pt = { x: number; y: number };
export type Poly = Pt[];

export function toPt(p: any): Pt {
  if (!p) return { x: 0, y: 0 };
  if (typeof p.x === "number" && typeof p.y === "number") return { x: p.x, y: p.y };
  if (Array.isArray(p) && p.length >= 2) return { x: Number(p[0] || 0), y: Number(p[1] || 0) };
  return { x: Number(p.x || 0), y: Number(p.y || 0) };
}

export function toPoly(arr: any[]): Poly {
  return (arr || []).map(toPt);
}

export function areaSigned(poly: Poly): number {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return 0.5 * a;
}

export function ensureClockwise(poly: Poly): Poly {
  if ((poly || []).length < 3) return poly;
  return areaSigned(poly) < 0 ? [...poly].reverse() : poly;
}

export function centroid(poly: Poly): Pt {
  let cx = 0, cy = 0, A = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const cr = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cr;
    cy += (p.y + q.y) * cr;
    A += cr;
  }
  A *= 0.5;
  if (Math.abs(A) < 1e-8) {
    // fallback: average
    const m = poly.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: m.x / poly.length, y: m.y / poly.length };
  }
  return { x: cx / (6 * A), y: cy / (6 * A) };
}

export function rotate(p: Pt, ang: number, c: Pt): Pt {
  const s = Math.sin(ang), k = Math.cos(ang);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * k - dy * s, y: c.y + dx * s + dy * k };
}

export function applyTransform(x: number, y: number, t: { s: number; r: number; tx: number; ty: number }): Pt {
  // scale -> rotate -> translate around origin (0,0)
  const xs = x * t.s, ys = y * t.s;
  const xr = xs * Math.cos(t.r) - ys * Math.sin(t.r);
  const yr = xs * Math.sin(t.r) + ys * Math.cos(t.r);
  return { x: xr + t.tx, y: yr + t.ty };
}

export function bbox(poly: Poly): { min: Pt; max: Pt; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const w = isFinite(minX) && isFinite(maxX) ? (maxX - minX) : 0;
  const h = isFinite(minY) && isFinite(maxY) ? (maxY - minY) : 0;
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY }, w, h };
}

/** Projection of a point to closest segment of a polyline (closed polygon supported). */
export function projectPointToPolyline(p: Pt, poly: Poly): { point: Pt; dist2: number; segIndex: number; t: number } {
  let best = { point: poly[0], dist2: Infinity, segIndex: 0, t: 0 };
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const abx = b.x - a.x, aby = b.y - a.y;
    const apx = p.x - a.x, apy = p.y - a.y;
    const ab2 = abx * abx + aby * aby || 1e-9;
    let t = (apx * abx + apy * aby) / ab2;
    t = Math.max(0, Math.min(1, t));
    const qx = a.x + t * abx, qy = a.y + t * aby;
    const dx = p.x - qx, dy = p.y - qy;
    const d2 = dx * dx + dy * dy;
    if (d2 < best.dist2) best = { point: { x: qx, y: qy }, dist2: d2, segIndex: i, t };
  }
  return best;
}

/** Point-in-polygon (ray casting). */
export function pointInPolygon(p: Pt, poly: Poly): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i], pj = poly[j];
    const intersect = ((pi.y > p.y) !== (pj.y > p.y)) &&
      (p.x < (pj.x - pi.x) * (p.y - pi.y) / ((pj.y - pi.y) || 1e-9) + pi.x);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Compute a plan transform from raw perimeter + intended width/length.
 * Returns scale s, rotation r, translation tx,ty and transformed perimeter.
 */
export function computePlanTransform(rawPerimeter: Poly, intendedDims?: { width?: number; length?: number }) {
  const perimeter = ensureClockwise(rawPerimeter);
  const cb = bbox(perimeter);
  const wantW = Math.max(0.001, Number(intendedDims?.width || cb.w));
  const wantH = Math.max(0.001, Number(intendedDims?.length || cb.h));

  // Guess rotation: align the longest edge horizontally
  let bestLen = -1, bestAng = 0;
  for (let i = 0; i < perimeter.length; i++) {
    const a = perimeter[i], b = perimeter[(i + 1) % perimeter.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > bestLen) {
      bestLen = len;
      bestAng = Math.atan2(b.y - a.y, b.x - a.x);
    }
  }
  // rotate so the longest edge is near 0° or 180° (horizontal)
  const rot = -bestAng;

  // Apply rotation around centroid and compute scale
  const c0 = centroid(perimeter);
  const rotPoly = perimeter.map(p => rotate(p, rot, c0));
  const rb = bbox(rotPoly);
  const sx = wantW / (rb.w || 1e-9);
  const sy = wantH / (rb.h || 1e-9);
  const s = Math.min(sx, sy); // preserve aspect

  // After scale, translate bottom-left to (0,0)
  const tl = { x: rb.min.x * s, y: rb.min.y * s };
  const tx = -tl.x;
  const ty = -tl.y;

  const transform = { s, r: rot, tx, ty };
  const transformed = rotPoly.map(p => ({ x: p.x * s + tx, y: p.y * s + ty }));
  return { transform, transformed };
}