// server/helpers/geom-utils.ts
export type Pt = { x: number; y: number };
export type BBox = { minX: number; minY: number; maxX: number; maxY: number };

export function bboxOf(points: Pt[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  if (!isFinite(minX) || !isFinite(minY)) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

// 2D PCA (eigenvectors of covariance); returns major axis (unit) and angle (radians)
export function pca2D(points: Pt[]): { axis: Pt; angle: number; varX: number; varY: number } {
  const n = points.length || 1;
  let mx = 0, my = 0;
  for (const p of points) { mx += p.x; my += p.y; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of points) {
    const dx = p.x - mx, dy = p.y - my;
    sxx += dx*dx; syy += dy*dy; sxy += dx*dy;
  }
  sxx /= n; syy /= n; sxy /= n;
  // eigen decomposition of [[sxx, sxy],[sxy, syy]]
  const tr = sxx + syy;
  const det = sxx*syy - sxy*sxy;
  const tmp = Math.sqrt(Math.max(0, tr*tr/4 - det));
  const l1 = tr/2 + tmp; // largest eigen
  const vx = sxy;
  const vy = l1 - sxx;
  let axis = { x: vx, y: vy };
  const len = Math.hypot(axis.x, axis.y) || 1;
  axis = { x: axis.x/len, y: axis.y/len };
  const angle = Math.atan2(axis.y, axis.x);
  // variances along principal axes approximated by eigenvalues
  const l2 = tr - l1;
  return { axis, angle, varX: Math.max(l1, l2), varY: Math.min(l1, l2) };
}

// Monotone chain convex hull; returns a closed polyline (first==last)
export function convexHull(points: Pt[], minPts = 3): Pt[] {
  const pts = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < minPts) return [];
  const s = [...pts].sort((a,b) => a.x===b.x ? a.y-b.y : a.x-b.x);
  const cross = (o:Pt,a:Pt,b:Pt)=> (a.x-o.x)*(b.y-o.y) - (a.y-o.y)*(b.x-o.x);
  const lower: Pt[] = [];
  for (const p of s) {
    while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i=s.length-1;i>=0;i--) {
    const p = s[i];
    while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  const hull = lower.concat(upper);
  if (hull.length) hull.push({ ...hull[0] });
  return hull;
}

export function rotate(points: Pt[], angle: number, origin?: Pt): Pt[] {
  const o = origin || centroid(points);
  const c = Math.cos(angle), s = Math.sin(angle);
  return points.map(p => {
    const x = p.x - o.x, y = p.y - o.y;
    return { x: o.x + x*c - y*s, y: o.y + x*s + y*c };
  });
}

export function centroid(points: Pt[]): Pt {
  if (!points.length) return { x: 0, y: 0 };
  let sx = 0, sy = 0;
  for (const p of points) { sx += p.x; sy += p.y; }
  return { x: sx/points.length, y: sy/points.length };
}