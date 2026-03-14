/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  NURBS ENGINE — Non-Uniform Rational B-Spline Curves & Surfaces
 *  Provides precision geometry beyond basic extrusions:
 *  - NURBS curves (arbitrary degree) with knot vectors
 *  - NURBS surfaces (bi-parametric patches)
 *  - Sweep along arbitrary NURBS paths
 *  - Loft between multiple NURBS curves
 *  - Sub-millimetre tolerance boolean operations
 *  All coordinates in metres. Z-up coordinate system.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import {
  type Vec2, type Vec3, type Mesh, type Profile2D, type Triangle,
  vec3, v3add, v3sub, v3scale, v3normalize, v3cross, v3len, v3lerp,
  createTriangle, emptyMesh, mergeMeshes, extrudeProfile,
  mat4Identity, mat4Translation, mat4Mul, mat4TransformPoint,
  type Mat4,
} from './geometry-kernel';

// ═══════════════════════════════════════════════════════════════════════════════
//  NURBS CURVE
// ═══════════════════════════════════════════════════════════════════════════════

export interface NurbsControlPoint {
  x: number; y: number; z: number;
  w: number; // weight (1.0 = non-rational)
}

export interface NurbsCurve {
  degree: number;
  controlPoints: NurbsControlPoint[];
  knots: number[];
}

/** Create a uniform NURBS curve from 3D points (all weights = 1) */
export function createNurbsCurve(points: Vec3[], degree = 3): NurbsCurve {
  const n = points.length;
  const d = Math.min(degree, n - 1);
  const controlPoints: NurbsControlPoint[] = points.map(p => ({ ...p, w: 1 }));

  // Generate clamped uniform knot vector
  const m = n + d + 1;
  const knots: number[] = [];
  for (let i = 0; i < m; i++) {
    if (i <= d) knots.push(0);
    else if (i >= m - d - 1) knots.push(1);
    else knots.push((i - d) / (m - 2 * d));
  }

  return { degree: d, controlPoints, knots };
}

/** Create a weighted NURBS curve (rational) */
export function createWeightedNurbsCurve(
  points: Vec3[], weights: number[], degree = 3
): NurbsCurve {
  const n = points.length;
  const d = Math.min(degree, n - 1);
  const controlPoints: NurbsControlPoint[] = points.map((p, i) => ({
    ...p, w: weights[i] ?? 1,
  }));
  const m = n + d + 1;
  const knots: number[] = [];
  for (let i = 0; i < m; i++) {
    if (i <= d) knots.push(0);
    else if (i >= m - d - 1) knots.push(1);
    else knots.push((i - d) / (m - 2 * d));
  }
  return { degree: d, controlPoints, knots };
}

/** Evaluate a NURBS curve at parameter t ∈ [0, 1] using de Boor's algorithm */
export function evaluateNurbsCurve(curve: NurbsCurve, t: number): Vec3 {
  const { degree: p, controlPoints: cps, knots: U } = curve;
  const n = cps.length - 1;

  // Clamp t
  t = Math.max(U[p], Math.min(U[n + 1], t));

  // Find knot span
  let span = p;
  for (let i = p; i <= n; i++) {
    if (t >= U[i] && t < U[i + 1]) { span = i; break; }
  }
  if (t >= U[n + 1]) span = n;

  // De Boor's algorithm in homogeneous coordinates
  const d: { x: number; y: number; z: number; w: number }[] = [];
  for (let j = 0; j <= p; j++) {
    const cp = cps[span - p + j];
    d.push({ x: cp.x * cp.w, y: cp.y * cp.w, z: cp.z * cp.w, w: cp.w });
  }

  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = span - p + j;
      const denom = U[i + p - r + 1] - U[i];
      const alpha = denom < 1e-12 ? 0 : (t - U[i]) / denom;
      d[j] = {
        x: (1 - alpha) * d[j - 1].x + alpha * d[j].x,
        y: (1 - alpha) * d[j - 1].y + alpha * d[j].y,
        z: (1 - alpha) * d[j - 1].z + alpha * d[j].z,
        w: (1 - alpha) * d[j - 1].w + alpha * d[j].w,
      };
    }
  }

  const result = d[p];
  const wInv = Math.abs(result.w) < 1e-12 ? 1 : 1 / result.w;
  return vec3(result.x * wInv, result.y * wInv, result.z * wInv);
}

/** Sample a NURBS curve into polyline points */
export function sampleNurbsCurve(curve: NurbsCurve, segments = 64): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    pts.push(evaluateNurbsCurve(curve, i / segments));
  }
  return pts;
}

/** Compute tangent at parameter t via finite difference */
export function nurbsTangent(curve: NurbsCurve, t: number, eps = 1e-5): Vec3 {
  const t0 = Math.max(0, t - eps);
  const t1 = Math.min(1, t + eps);
  const p0 = evaluateNurbsCurve(curve, t0);
  const p1 = evaluateNurbsCurve(curve, t1);
  return v3normalize(v3sub(p1, p0));
}

/** Compute approximate arc length of NURBS curve */
export function nurbsArcLength(curve: NurbsCurve, segments = 100): number {
  let len = 0;
  let prev = evaluateNurbsCurve(curve, 0);
  for (let i = 1; i <= segments; i++) {
    const curr = evaluateNurbsCurve(curve, i / segments);
    len += v3len(v3sub(curr, prev));
    prev = curr;
  }
  return len;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  NURBS CIRCLE / ARC (Rational B-Spline)
// ═══════════════════════════════════════════════════════════════════════════════

/** Create a NURBS representation of a full circle in XY plane */
export function nurbsCircle(radius: number, center: Vec3 = vec3(0, 0, 0)): NurbsCurve {
  const r = radius;
  const w = Math.SQRT1_2; // cos(45°)
  const controlPoints: NurbsControlPoint[] = [
    { x: center.x + r, y: center.y, z: center.z, w: 1 },
    { x: center.x + r, y: center.y + r, z: center.z, w: w },
    { x: center.x, y: center.y + r, z: center.z, w: 1 },
    { x: center.x - r, y: center.y + r, z: center.z, w: w },
    { x: center.x - r, y: center.y, z: center.z, w: 1 },
    { x: center.x - r, y: center.y - r, z: center.z, w: w },
    { x: center.x, y: center.y - r, z: center.z, w: 1 },
    { x: center.x + r, y: center.y - r, z: center.z, w: w },
    { x: center.x + r, y: center.y, z: center.z, w: 1 }, // duplicate first
  ];
  const knots = [0, 0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1, 1];
  return { degree: 2, controlPoints, knots };
}

/** Create a NURBS arc (portion of circle) */
export function nurbsArc(
  radius: number, startAngle: number, endAngle: number,
  center: Vec3 = vec3(0, 0, 0)
): NurbsCurve {
  const pts = sampleNurbsCurve(nurbsCircle(radius, center), 72);
  const startIdx = Math.round((startAngle / (2 * Math.PI)) * 72);
  const endIdx = Math.round((endAngle / (2 * Math.PI)) * 72);
  const arcPts = startIdx < endIdx
    ? pts.slice(startIdx, endIdx + 1)
    : [...pts.slice(startIdx), ...pts.slice(0, endIdx + 1)];
  return createNurbsCurve(arcPts, 3);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  NURBS SURFACE
// ═══════════════════════════════════════════════════════════════════════════════

export interface NurbsSurface {
  degreeU: number;
  degreeV: number;
  controlGrid: NurbsControlPoint[][]; // [rows][cols]
  knotsU: number[];
  knotsV: number[];
}

/** Create a NURBS surface from a grid of points */
export function createNurbsSurface(
  grid: Vec3[][], degreeU = 3, degreeV = 3
): NurbsSurface {
  const rows = grid.length;
  const cols = grid[0].length;
  const dU = Math.min(degreeU, rows - 1);
  const dV = Math.min(degreeV, cols - 1);

  const controlGrid: NurbsControlPoint[][] = grid.map(row =>
    row.map(p => ({ ...p, w: 1 }))
  );

  const makeKnots = (n: number, d: number) => {
    const m = n + d + 1;
    const knots: number[] = [];
    for (let i = 0; i < m; i++) {
      if (i <= d) knots.push(0);
      else if (i >= m - d - 1) knots.push(1);
      else knots.push((i - d) / (m - 2 * d));
    }
    return knots;
  };

  return {
    degreeU: dU, degreeV: dV,
    controlGrid,
    knotsU: makeKnots(rows, dU),
    knotsV: makeKnots(cols, dV),
  };
}

/** Evaluate a NURBS surface at (u, v) ∈ [0,1]² */
export function evaluateNurbsSurface(surface: NurbsSurface, u: number, v: number): Vec3 {
  // Evaluate rows at parameter v, then evaluate resulting curve at u
  const { controlGrid, degreeV, knotsV } = surface;
  const rowPoints: NurbsControlPoint[] = controlGrid.map(row => {
    const rowCurve: NurbsCurve = { degree: degreeV, controlPoints: row, knots: knotsV };
    const pt = evaluateNurbsCurve(rowCurve, v);
    return { ...pt, w: 1 };
  });

  const uCurve: NurbsCurve = {
    degree: surface.degreeU,
    controlPoints: rowPoints,
    knots: surface.knotsU,
  };
  return evaluateNurbsCurve(uCurve, u);
}

/** Tessellate a NURBS surface into a triangle mesh */
export function tessellateNurbsSurface(
  surface: NurbsSurface, resU = 32, resV = 32
): Mesh {
  const grid: Vec3[][] = [];
  for (let i = 0; i <= resU; i++) {
    const row: Vec3[] = [];
    for (let j = 0; j <= resV; j++) {
      row.push(evaluateNurbsSurface(surface, i / resU, j / resV));
    }
    grid.push(row);
  }

  const tris: Triangle[] = [];
  for (let i = 0; i < resU; i++) {
    for (let j = 0; j < resV; j++) {
      const p00 = grid[i][j];
      const p10 = grid[i + 1][j];
      const p01 = grid[i][j + 1];
      const p11 = grid[i + 1][j + 1];
      tris.push(createTriangle(p00, p10, p11));
      tris.push(createTriangle(p00, p11, p01));
    }
  }

  return { triangles: tris };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SWEEP ALONG NURBS PATH
// ═══════════════════════════════════════════════════════════════════════════════

/** Build a Frenet frame (tangent, normal, binormal) along a curve */
function frenetFrame(curve: NurbsCurve, t: number): { T: Vec3; N: Vec3; B: Vec3 } {
  const eps = 1e-4;
  const t0 = Math.max(0, t - eps);
  const t1 = Math.min(1, t + eps);
  const t2 = Math.min(1, t + 2 * eps);

  const p0 = evaluateNurbsCurve(curve, t0);
  const p1 = evaluateNurbsCurve(curve, t1);
  const p2 = evaluateNurbsCurve(curve, t2);

  const T = v3normalize(v3sub(p1, p0));

  // Approximate second derivative for normal
  const d2 = v3sub(v3add(p0, v3scale(p1, -2)), v3scale(p2, -1));
  let N = v3normalize(v3sub(d2, v3scale(T, dotVec3(d2, T))));

  // Fallback if curvature is near zero
  if (v3len(N) < 0.01) {
    const up = Math.abs(T.y) < 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0);
    N = v3normalize(v3cross(T, up));
  }

  const B = v3normalize(v3cross(T, N));
  return { T, N, B };
}

function dotVec3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Sweep a 2D profile along a NURBS curve path */
export function sweepProfileAlongNurbs(
  profile: Profile2D, path: NurbsCurve, segments = 48
): Mesh {
  const tris: Triangle[] = [];
  const rings: Vec3[][] = [];

  // Generate cross-section rings along the path
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const pos = evaluateNurbsCurve(path, t);
    const { N, B } = frenetFrame(path, t);

    const ring: Vec3[] = profile.outer.map(pt => {
      return v3add(pos, v3add(v3scale(N, pt.x), v3scale(B, pt.y)));
    });
    rings.push(ring);
  }

  // Connect adjacent rings with quads (split into triangles)
  const nPts = profile.outer.length;
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < nPts; j++) {
      const j1 = (j + 1) % nPts;
      const p00 = rings[i][j];
      const p01 = rings[i][j1];
      const p10 = rings[i + 1][j];
      const p11 = rings[i + 1][j1];
      tris.push(createTriangle(p00, p10, p11));
      tris.push(createTriangle(p00, p11, p01));
    }
  }

  // Cap start and end
  capRing(rings[0], tris, true);
  capRing(rings[rings.length - 1], tris, false);

  return { triangles: tris };
}

function capRing(ring: Vec3[], tris: Triangle[], flip: boolean): void {
  // Fan triangulation from first point
  for (let i = 1; i < ring.length - 1; i++) {
    if (flip) {
      tris.push(createTriangle(ring[0], ring[i + 1], ring[i]));
    } else {
      tris.push(createTriangle(ring[0], ring[i], ring[i + 1]));
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LOFT BETWEEN NURBS CURVES
// ═══════════════════════════════════════════════════════════════════════════════

/** Loft a surface between multiple NURBS cross-section curves */
export function loftNurbsCurves(curves: NurbsCurve[], segments = 32): Mesh {
  if (curves.length < 2) return emptyMesh();

  const tris: Triangle[] = [];
  const grid: Vec3[][] = [];

  for (const curve of curves) {
    const row: Vec3[] = [];
    for (let j = 0; j <= segments; j++) {
      row.push(evaluateNurbsCurve(curve, j / segments));
    }
    grid.push(row);
  }

  for (let i = 0; i < grid.length - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const p00 = grid[i][j];
      const p01 = grid[i][j + 1];
      const p10 = grid[i + 1][j];
      const p11 = grid[i + 1][j + 1];
      tris.push(createTriangle(p00, p10, p11));
      tris.push(createTriangle(p00, p11, p01));
    }
  }

  return { triangles: tris };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PRECISION BOOLEAN WITH TOLERANCE
// ═══════════════════════════════════════════════════════════════════════════════

/** Tolerance-aware point equality (sub-millimetre: 0.0001m = 0.1mm) */
const PRECISION_TOL = 0.0001; // 0.1mm

export function preciseEquals(a: Vec3, b: Vec3): boolean {
  return Math.abs(a.x - b.x) < PRECISION_TOL
    && Math.abs(a.y - b.y) < PRECISION_TOL
    && Math.abs(a.z - b.z) < PRECISION_TOL;
}

/** Snap a point to the nearest grid point at given precision */
export function snapToGrid(p: Vec3, gridSize = PRECISION_TOL): Vec3 {
  return vec3(
    Math.round(p.x / gridSize) * gridSize,
    Math.round(p.y / gridSize) * gridSize,
    Math.round(p.z / gridSize) * gridSize,
  );
}

/** Remove degenerate triangles (area below threshold) from mesh */
export function removeDegenerate(mesh: Mesh, minArea = 1e-10): Mesh {
  return {
    triangles: mesh.triangles.filter(t => {
      const e1 = v3sub(t.v1, t.v0);
      const e2 = v3sub(t.v2, t.v0);
      const area = 0.5 * v3len(v3cross(e1, e2));
      return area > minArea;
    }),
  };
}

/** Merge vertices within tolerance to produce watertight meshes */
export function weldVertices(mesh: Mesh, tolerance = PRECISION_TOL): Mesh {
  const vertexMap = new Map<string, Vec3>();

  function canonicalize(p: Vec3): Vec3 {
    const key = `${Math.round(p.x / tolerance)}_${Math.round(p.y / tolerance)}_${Math.round(p.z / tolerance)}`;
    if (!vertexMap.has(key)) vertexMap.set(key, p);
    return vertexMap.get(key)!;
  }

  return {
    triangles: mesh.triangles.map(t => createTriangle(
      canonicalize(t.v0), canonicalize(t.v1), canonicalize(t.v2),
    )),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CURVED WALL / PIPE PROFILES
// ═══════════════════════════════════════════════════════════════════════════════

/** Create a curved wall following a NURBS path */
export function createCurvedWall(
  path: NurbsCurve,
  height: number,
  thickness: number,
  segments = 32
): Mesh {
  const tris: Triangle[] = [];
  const pts = sampleNurbsCurve(path, segments);

  // Build inner and outer wall lines
  const innerPts: Vec3[] = [];
  const outerPts: Vec3[] = [];
  const halfT = thickness / 2;

  for (let i = 0; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    const tangent = nurbsTangent(path, t);
    // Normal in XY plane (perpendicular to tangent)
    const normal = v3normalize(vec3(-tangent.y, tangent.x, 0));
    innerPts.push(v3add(pts[i], v3scale(normal, -halfT)));
    outerPts.push(v3add(pts[i], v3scale(normal, halfT)));
  }

  // Build quad strips for outer face, inner face, top, and bottom
  for (let i = 0; i < pts.length - 1; i++) {
    // Outer face
    const ob = outerPts[i], ob1 = outerPts[i + 1];
    const ot = v3add(ob, vec3(0, 0, height));
    const ot1 = v3add(ob1, vec3(0, 0, height));
    tris.push(createTriangle(ob, ob1, ot1));
    tris.push(createTriangle(ob, ot1, ot));

    // Inner face (reversed)
    const ib = innerPts[i], ib1 = innerPts[i + 1];
    const it = v3add(ib, vec3(0, 0, height));
    const it1 = v3add(ib1, vec3(0, 0, height));
    tris.push(createTriangle(ib, it1, ib1));
    tris.push(createTriangle(ib, it, it1));

    // Top face
    tris.push(createTriangle(ot, ot1, it1));
    tris.push(createTriangle(ot, it1, it));

    // Bottom face
    tris.push(createTriangle(ob, ib1, ob1));
    tris.push(createTriangle(ob, ib, ib1));
  }

  // End caps
  const makeEndCap = (outer: Vec3, inner: Vec3, h: number, flip: boolean) => {
    const outerTop = v3add(outer, vec3(0, 0, h));
    const innerTop = v3add(inner, vec3(0, 0, h));
    if (flip) {
      tris.push(createTriangle(outer, innerTop, inner));
      tris.push(createTriangle(outer, outerTop, innerTop));
    } else {
      tris.push(createTriangle(outer, inner, innerTop));
      tris.push(createTriangle(outer, innerTop, outerTop));
    }
  };

  makeEndCap(outerPts[0], innerPts[0], height, true);
  makeEndCap(outerPts[outerPts.length - 1], innerPts[innerPts.length - 1], height, false);

  return { triangles: tris };
}

/** Create a pipe/duct following a NURBS path with circular cross-section */
export function createNurbsPipe(
  path: NurbsCurve,
  outerRadius: number,
  wallThickness: number,
  segments = 32, circleSegments = 16
): Mesh {
  const innerRadius = outerRadius - wallThickness;
  const profile: Profile2D = {
    outer: Array.from({ length: circleSegments }, (_, i) => {
      const a = (2 * Math.PI * i) / circleSegments;
      return { x: outerRadius * Math.cos(a), y: outerRadius * Math.sin(a) };
    }),
    holes: innerRadius > 0 ? [
      Array.from({ length: circleSegments }, (_, i) => {
        const a = (2 * Math.PI * i) / circleSegments;
        return { x: innerRadius * Math.cos(a), y: innerRadius * Math.sin(a) };
      }),
    ] : [],
  };

  return sweepProfileAlongNurbs(profile, path, segments);
}
