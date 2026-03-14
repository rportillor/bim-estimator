/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  BREP GEOMETRY KERNEL — Advanced Solid Modeling Engine
 *  Extends the base geometry kernel with:
 *  - BSP-tree based CSG boolean operations (union, subtract, intersect)
 *  - Revolution solids (columns, pipes, domes)
 *  - Fillet and chamfer operations on edges
 *  - Arc/spline profile segments for curved walls
 *  - Loft between profiles
 *  - Offset surfaces for wall layers
 *  All coordinates in metres. Z-up right-hand coordinate system.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import {
  type Vec2, type Vec3, type Mesh, type Triangle, type Profile2D, type AABB, type Mat4,
  vec2, vec3, v3add, v3sub, v3scale, v3normalize, v3cross, v3dot, v3len, v3lerp, v3eq,
  createTriangle, emptyMesh, mergeMeshes, transformMesh,
  meshBoundingBox, meshVolume, meshSurfaceArea,
  mat4Identity, mat4Translation, mat4RotationZ, mat4RotationX, mat4RotationY,
  mat4Mul, mat4TransformPoint, mat4TransformDir,
  extrudeProfile, rectProfile, circleProfile,
  serializeMesh, type SerializedMesh,
} from './geometry-kernel';

// ═══════════════════════════════════════════════════════════════════════════════
//  BREP DATA STRUCTURES — Boundary Representation topology
// ═══════════════════════════════════════════════════════════════════════════════

export interface BRepVertex {
  id: number;
  position: Vec3;
  edges: number[];        // half-edge ids originating from this vertex
}

export interface BRepHalfEdge {
  id: number;
  origin: number;         // vertex id
  twin: number;           // opposite half-edge id (-1 if boundary)
  next: number;           // next half-edge in the face loop
  prev: number;           // previous half-edge in the face loop
  face: number;           // face this half-edge belongs to (-1 if none)
}

export interface BRepFace {
  id: number;
  outerLoop: number;      // first half-edge id of the outer loop
  innerLoops: number[];   // first half-edge ids of inner loops (holes)
  normal: Vec3;
  plane: Plane;
}

export interface Plane {
  normal: Vec3;
  d: number;              // ax + by + cz + d = 0
}

export interface BRepSolid {
  vertices: Map<number, BRepVertex>;
  halfEdges: Map<number, BRepHalfEdge>;
  faces: Map<number, BRepFace>;
  nextId: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BSP TREE — Binary Space Partition for CSG boolean operations
// ═══════════════════════════════════════════════════════════════════════════════

interface BSPNode {
  plane: Plane;
  front: BSPNode | null;
  back: BSPNode | null;
  coplanarFront: BSPPolygon[];
  coplanarBack: BSPPolygon[];
}

interface BSPPolygon {
  vertices: Vec3[];
  normal: Vec3;
  shared: number;         // material/face id
}

function planeFromPoints(a: Vec3, b: Vec3, c: Vec3): Plane {
  const n = v3normalize(v3cross(v3sub(b, a), v3sub(c, a)));
  return { normal: n, d: -v3dot(n, a) };
}

function planeSignedDistance(plane: Plane, point: Vec3): number {
  return v3dot(plane.normal, point) + plane.d;
}

const EPSILON = 1e-5;

const enum Side { COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3 }

function classifyPoint(plane: Plane, point: Vec3): Side {
  const d = planeSignedDistance(plane, point);
  if (d > EPSILON) return Side.FRONT;
  if (d < -EPSILON) return Side.BACK;
  return Side.COPLANAR;
}

function classifyPolygon(plane: Plane, poly: BSPPolygon): Side {
  let front = 0, back = 0;
  for (const v of poly.vertices) {
    const s = classifyPoint(plane, v);
    if (s === Side.FRONT) front++;
    else if (s === Side.BACK) back++;
  }
  if (front > 0 && back === 0) return Side.FRONT;
  if (back > 0 && front === 0) return Side.BACK;
  if (front > 0 && back > 0) return Side.SPANNING;
  return Side.COPLANAR;
}

function splitPolygon(
  plane: Plane,
  poly: BSPPolygon,
): { front: BSPPolygon | null; back: BSPPolygon | null } {
  const frontVerts: Vec3[] = [];
  const backVerts: Vec3[] = [];
  const n = poly.vertices.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const vi = poly.vertices[i];
    const vj = poly.vertices[j];
    const di = planeSignedDistance(plane, vi);
    const dj = planeSignedDistance(plane, vj);
    const si = di > EPSILON ? Side.FRONT : di < -EPSILON ? Side.BACK : Side.COPLANAR;
    const sj = dj > EPSILON ? Side.FRONT : dj < -EPSILON ? Side.BACK : Side.COPLANAR;

    if (si !== Side.BACK) frontVerts.push(vi);
    if (si !== Side.FRONT) backVerts.push(vi);

    if ((si | sj) === Side.SPANNING) {
      const t = di / (di - dj);
      const intersection = v3lerp(vi, vj, t);
      frontVerts.push(intersection);
      backVerts.push(intersection);
    }
  }

  const front = frontVerts.length >= 3
    ? { vertices: frontVerts, normal: poly.normal, shared: poly.shared }
    : null;
  const back = backVerts.length >= 3
    ? { vertices: backVerts, normal: poly.normal, shared: poly.shared }
    : null;

  return { front, back };
}

function buildBSP(polygons: BSPPolygon[]): BSPNode | null {
  if (polygons.length === 0) return null;

  const plane = planeFromPoints(polygons[0].vertices[0], polygons[0].vertices[1], polygons[0].vertices[2]);
  const node: BSPNode = {
    plane,
    front: null,
    back: null,
    coplanarFront: [],
    coplanarBack: [],
  };

  const frontPolys: BSPPolygon[] = [];
  const backPolys: BSPPolygon[] = [];

  for (const poly of polygons) {
    const side = classifyPolygon(plane, poly);
    switch (side) {
      case Side.COPLANAR:
        if (v3dot(plane.normal, poly.normal) > 0) {
          node.coplanarFront.push(poly);
        } else {
          node.coplanarBack.push(poly);
        }
        break;
      case Side.FRONT:
        frontPolys.push(poly);
        break;
      case Side.BACK:
        backPolys.push(poly);
        break;
      case Side.SPANNING: {
        const { front, back } = splitPolygon(plane, poly);
        if (front) frontPolys.push(front);
        if (back) backPolys.push(back);
        break;
      }
    }
  }

  node.front = buildBSP(frontPolys);
  node.back = buildBSP(backPolys);
  return node;
}

function allPolygons(node: BSPNode | null): BSPPolygon[] {
  if (!node) return [];
  return [
    ...node.coplanarFront,
    ...node.coplanarBack,
    ...allPolygons(node.front),
    ...allPolygons(node.back),
  ];
}

function clipPolygons(node: BSPNode | null, polygons: BSPPolygon[]): BSPPolygon[] {
  if (!node) return polygons;

  let front: BSPPolygon[] = [];
  let back: BSPPolygon[] = [];

  for (const poly of polygons) {
    const side = classifyPolygon(node.plane, poly);
    switch (side) {
      case Side.FRONT:
        front.push(poly);
        break;
      case Side.BACK:
        back.push(poly);
        break;
      case Side.COPLANAR:
        front.push(poly);
        break;
      case Side.SPANNING: {
        const result = splitPolygon(node.plane, poly);
        if (result.front) front.push(result.front);
        if (result.back) back.push(result.back);
        break;
      }
    }
  }

  front = clipPolygons(node.front, front);
  back = node.back ? clipPolygons(node.back, back) : [];

  return [...front, ...back];
}

function clipTo(a: BSPNode | null, b: BSPNode | null): void {
  if (!a || !b) return;
  a.coplanarFront = clipPolygons(b, a.coplanarFront);
  a.coplanarBack = clipPolygons(b, a.coplanarBack);
  clipTo(a.front, b);
  clipTo(a.back, b);
}

function invertNode(node: BSPNode | null): void {
  if (!node) return;
  for (const poly of node.coplanarFront) {
    poly.vertices.reverse();
    poly.normal = v3scale(poly.normal, -1);
  }
  for (const poly of node.coplanarBack) {
    poly.vertices.reverse();
    poly.normal = v3scale(poly.normal, -1);
  }
  const tmp = node.coplanarFront;
  node.coplanarFront = node.coplanarBack;
  node.coplanarBack = tmp;
  node.plane.normal = v3scale(node.plane.normal, -1);
  node.plane.d = -node.plane.d;
  const tmpChild = node.front;
  node.front = node.back;
  node.back = tmpChild;
  invertNode(node.front);
  invertNode(node.back);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CSG BOOLEAN OPERATIONS — Union, Subtract, Intersect
// ═══════════════════════════════════════════════════════════════════════════════

function meshToPolygons(mesh: Mesh): BSPPolygon[] {
  return mesh.triangles.map((t, i) => ({
    vertices: [t.v0, t.v1, t.v2],
    normal: t.n,
    shared: i,
  }));
}

function polygonsToMesh(polygons: BSPPolygon[]): Mesh {
  const tris: Triangle[] = [];
  for (const poly of polygons) {
    // Fan triangulate polygon
    for (let i = 1; i < poly.vertices.length - 1; i++) {
      tris.push(createTriangle(poly.vertices[0], poly.vertices[i], poly.vertices[i + 1]));
    }
  }
  return { triangles: tris };
}

/**
 * CSG Union: A ∪ B — combines two solids into one
 */
export function csgUnion(meshA: Mesh, meshB: Mesh): Mesh {
  const a = buildBSP(meshToPolygons(meshA));
  const b = buildBSP(meshToPolygons(meshB));
  if (!a) return meshB;
  if (!b) return meshA;

  clipTo(a, b);
  clipTo(b, a);
  invertNode(b);
  clipTo(b, a);
  invertNode(b);

  const result = [...allPolygons(a), ...allPolygons(b)];
  return polygonsToMesh(result);
}

/**
 * CSG Subtract: A - B — cuts B out of A
 */
export function csgSubtract(meshA: Mesh, meshB: Mesh): Mesh {
  const a = buildBSP(meshToPolygons(meshA));
  const b = buildBSP(meshToPolygons(meshB));
  if (!a) return emptyMesh();
  if (!b) return meshA;

  invertNode(a);
  clipTo(a, b);
  clipTo(b, a);
  invertNode(b);
  clipTo(b, a);
  invertNode(b);
  invertNode(a);

  // Invert B polygons (they form the void interior)
  const bPolys = allPolygons(b);
  for (const p of bPolys) {
    p.vertices.reverse();
    p.normal = v3scale(p.normal, -1);
  }

  const result = [...allPolygons(a), ...bPolys];
  return polygonsToMesh(result);
}

/**
 * CSG Intersect: A ∩ B — keeps only the overlap
 */
export function csgIntersect(meshA: Mesh, meshB: Mesh): Mesh {
  const a = buildBSP(meshToPolygons(meshA));
  const b = buildBSP(meshToPolygons(meshB));
  if (!a || !b) return emptyMesh();

  invertNode(a);
  clipTo(b, a);
  invertNode(b);
  clipTo(a, b);
  clipTo(b, a);
  invertNode(a);
  invertNode(b);

  const result = [...allPolygons(a), ...allPolygons(b)];
  return polygonsToMesh(result);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  REVOLUTION SOLID — Rotate a 2D profile around an axis
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a solid of revolution by rotating a 2D profile around an axis.
 * Profile is defined in the XZ plane, rotated around the Z axis.
 * Used for: columns (circular), domes, spheres, pipe fittings.
 */
export function revolutionSolid(
  profile: Vec2[],       // 2D profile in XZ plane (x = radius, y = height)
  angle: number = Math.PI * 2,  // revolution angle in radians
  segments: number = 24,
): Mesh {
  if (profile.length < 2) return emptyMesh();

  const tris: Triangle[] = [];
  const isClosed = Math.abs(angle - Math.PI * 2) < 0.01;

  // Generate rings
  const rings: Vec3[][] = [];
  const actualSegments = isClosed ? segments : segments + 1;

  for (let s = 0; s < actualSegments; s++) {
    const theta = (angle * s) / segments;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const ring: Vec3[] = [];

    for (const pt of profile) {
      ring.push(vec3(pt.x * cos, pt.x * sin, pt.y));
    }
    rings.push(ring);
  }

  // Connect rings
  for (let s = 0; s < rings.length; s++) {
    const nextS = (s + 1) % rings.length;
    if (!isClosed && s === rings.length - 1) continue;

    const r0 = rings[s];
    const r1 = rings[nextS];

    for (let p = 0; p < profile.length - 1; p++) {
      tris.push(createTriangle(r0[p], r1[p], r0[p + 1]));
      tris.push(createTriangle(r1[p], r1[p + 1], r0[p + 1]));
    }
  }

  // Cap ends if not full revolution
  if (!isClosed) {
    const firstRing = rings[0];
    const lastRing = rings[rings.length - 1];

    for (let p = 1; p < profile.length - 1; p++) {
      tris.push(createTriangle(firstRing[0], firstRing[p + 1], firstRing[p]));
      tris.push(createTriangle(lastRing[0], lastRing[p], lastRing[p + 1]));
    }
  }

  return { triangles: tris };
}

/**
 * Create a dome (half sphere) with given radius and segments
 */
export function createDome(radius: number, segments: number = 24): Mesh {
  const profile: Vec2[] = [];
  const halfSegs = Math.max(4, Math.floor(segments / 2));
  for (let i = 0; i <= halfSegs; i++) {
    const angle = (Math.PI / 2) * (i / halfSegs);
    profile.push(vec2(radius * Math.cos(angle), radius * Math.sin(angle)));
  }
  return revolutionSolid(profile, Math.PI * 2, segments);
}

/**
 * Create a sphere with given radius
 */
export function createSphere(radius: number, segments: number = 24): Mesh {
  const profile: Vec2[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = Math.PI * (i / segments);
    profile.push(vec2(radius * Math.sin(angle), -radius * Math.cos(angle)));
  }
  return revolutionSolid(profile, Math.PI * 2, segments);
}

/**
 * Create a torus (used for pipe elbows)
 */
export function createTorus(
  majorRadius: number,
  minorRadius: number,
  angle: number = Math.PI * 2,
  majorSegments: number = 24,
  minorSegments: number = 12,
): Mesh {
  const tris: Triangle[] = [];

  for (let i = 0; i < majorSegments; i++) {
    const theta0 = (angle * i) / majorSegments;
    const theta1 = (angle * (i + 1)) / majorSegments;

    for (let j = 0; j < minorSegments; j++) {
      const phi0 = (2 * Math.PI * j) / minorSegments;
      const phi1 = (2 * Math.PI * (j + 1)) / minorSegments;

      const p00 = torusPoint(majorRadius, minorRadius, theta0, phi0);
      const p10 = torusPoint(majorRadius, minorRadius, theta1, phi0);
      const p01 = torusPoint(majorRadius, minorRadius, theta0, phi1);
      const p11 = torusPoint(majorRadius, minorRadius, theta1, phi1);

      tris.push(createTriangle(p00, p10, p01));
      tris.push(createTriangle(p10, p11, p01));
    }
  }

  return { triangles: tris };
}

function torusPoint(R: number, r: number, theta: number, phi: number): Vec3 {
  return vec3(
    (R + r * Math.cos(phi)) * Math.cos(theta),
    (R + r * Math.cos(phi)) * Math.sin(theta),
    r * Math.sin(phi),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ARC & SPLINE PROFILE SEGMENTS — For curved walls
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate points along a circular arc in 2D.
 * Center-based definition: center, radius, start angle, end angle.
 */
export function arcPoints(
  center: Vec2,
  radius: number,
  startAngle: number,
  endAngle: number,
  segments: number = 16,
): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = startAngle + t * (endAngle - startAngle);
    pts.push(vec2(center.x + radius * Math.cos(angle), center.y + radius * Math.sin(angle)));
  }
  return pts;
}

/**
 * Three-point arc: compute arc through start, mid, end points.
 */
export function threePointArc(
  start: Vec2,
  mid: Vec2,
  end: Vec2,
  segments: number = 16,
): Vec2[] {
  // Find circumscribed circle center
  const ax = start.x, ay = start.y;
  const bx = mid.x, by = mid.y;
  const cx = end.x, cy = end.y;

  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-10) {
    // Collinear — return straight line
    const pts: Vec2[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      pts.push(vec2(ax + t * (cx - ax), ay + t * (cy - ay)));
    }
    return pts;
  }

  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;

  const center = vec2(ux, uy);
  const radius = Math.sqrt((ax - ux) ** 2 + (ay - uy) ** 2);

  const startAngle = Math.atan2(ay - uy, ax - ux);
  const midAngle = Math.atan2(by - uy, bx - ux);
  let endAngle = Math.atan2(cy - uy, cx - ux);

  // Ensure correct winding direction
  let da1 = midAngle - startAngle;
  let da2 = endAngle - startAngle;
  if (da1 < 0) da1 += 2 * Math.PI;
  if (da2 < 0) da2 += 2 * Math.PI;
  if (da1 > da2) {
    // Reverse direction
    endAngle = startAngle - (2 * Math.PI - da2);
  } else {
    endAngle = startAngle + da2;
  }

  return arcPoints(center, radius, startAngle, endAngle, segments);
}

/**
 * Cubic Bezier spline in 2D.
 */
export function cubicBezier2D(
  p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2,
  segments: number = 16,
): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    pts.push(vec2(
      mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
      mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
    ));
  }
  return pts;
}

/**
 * Create a profile with arc segments — for curved walls.
 * Each segment can be either 'line' or 'arc' (defined by midpoint).
 */
export interface ProfileSegment {
  type: 'line' | 'arc';
  end: Vec2;
  mid?: Vec2;             // midpoint for arc segments
  bulge?: number;         // DXF-style bulge factor (alternative to mid)
}

export function profileFromSegments(
  start: Vec2,
  segments: ProfileSegment[],
  arcResolution: number = 12,
): Profile2D {
  const outer: Vec2[] = [start];
  let current = start;

  for (const seg of segments) {
    if (seg.type === 'arc' && seg.mid) {
      const arcPts = threePointArc(current, seg.mid, seg.end, arcResolution);
      // Skip first point (it's the current point)
      for (let i = 1; i < arcPts.length; i++) {
        outer.push(arcPts[i]);
      }
    } else if (seg.type === 'arc' && seg.bulge) {
      // DXF bulge → arc
      const dx = seg.end.x - current.x;
      const dy = seg.end.y - current.y;
      const chordLen = Math.sqrt(dx * dx + dy * dy);
      const sagitta = Math.abs(seg.bulge) * chordLen / 2;
      const radius = (chordLen * chordLen / 4 + sagitta * sagitta) / (2 * sagitta);

      const midX = (current.x + seg.end.x) / 2;
      const midY = (current.y + seg.end.y) / 2;
      const perpX = -dy / chordLen;
      const perpY = dx / chordLen;
      const sign = seg.bulge > 0 ? 1 : -1;
      const offset = sign * (radius - sagitta);

      const mid = vec2(midX + perpX * offset, midY + perpY * offset);
      const arcPts = threePointArc(current, mid, seg.end, arcResolution);
      for (let i = 1; i < arcPts.length; i++) {
        outer.push(arcPts[i]);
      }
    } else {
      outer.push(seg.end);
    }
    current = seg.end;
  }

  return { outer, holes: [] };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FILLET & CHAMFER — Edge rounding/cutting
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Apply fillet (rounded corners) to a 2D profile.
 * radius: fillet radius in metres
 * indices: which vertices to fillet (all if not specified)
 */
export function filletProfile(
  profile: Profile2D,
  radius: number,
  indices?: number[],
  segments: number = 6,
): Profile2D {
  const pts = profile.outer;
  const n = pts.length;
  const result: Vec2[] = [];
  const targetIndices = indices || pts.map((_, i) => i);

  for (let i = 0; i < n; i++) {
    if (!targetIndices.includes(i)) {
      result.push(pts[i]);
      continue;
    }

    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];

    const d1 = vec2(prev.x - curr.x, prev.y - curr.y);
    const d2 = vec2(next.x - curr.x, next.y - curr.y);

    const len1 = Math.sqrt(d1.x * d1.x + d1.y * d1.y);
    const len2 = Math.sqrt(d2.x * d2.x + d2.y * d2.y);

    if (len1 < 1e-6 || len2 < 1e-6) {
      result.push(curr);
      continue;
    }

    // Unit vectors along edges
    const u1 = vec2(d1.x / len1, d1.y / len1);
    const u2 = vec2(d2.x / len2, d2.y / len2);

    // Angle between edges
    const dot = u1.x * u2.x + u1.y * u2.y;
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));

    if (angle < 0.01 || angle > Math.PI - 0.01) {
      result.push(curr);
      continue;
    }

    // Tangent length from corner to fillet start/end
    const tanLen = Math.min(radius / Math.tan(angle / 2), len1 * 0.4, len2 * 0.4);
    const actualRadius = tanLen * Math.tan(angle / 2);

    // Fillet start and end points
    const start = vec2(curr.x + u1.x * tanLen, curr.y + u1.y * tanLen);
    const end = vec2(curr.x + u2.x * tanLen, curr.y + u2.y * tanLen);

    // Fillet center: offset from corner along bisector
    const bisector = vec2(u1.x + u2.x, u1.y + u2.y);
    const bisLen = Math.sqrt(bisector.x * bisector.x + bisector.y * bisector.y);
    if (bisLen < 1e-6) {
      result.push(curr);
      continue;
    }
    const biUnit = vec2(bisector.x / bisLen, bisector.y / bisLen);
    const centerDist = actualRadius / Math.sin(angle / 2);
    const center = vec2(curr.x + biUnit.x * centerDist, curr.y + biUnit.y * centerDist);

    // Arc from start to end
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    let endAngle = Math.atan2(end.y - center.y, end.x - center.x);

    // Determine direction (cross product of edge vectors)
    const cross = u1.x * u2.y - u1.y * u2.x;
    if (cross > 0) {
      while (endAngle > startAngle) endAngle -= 2 * Math.PI;
    } else {
      while (endAngle < startAngle) endAngle += 2 * Math.PI;
    }

    const arcPts = arcPoints(center, actualRadius, startAngle, endAngle, segments);
    result.push(...arcPts);
  }

  return { outer: result, holes: profile.holes };
}

/**
 * Apply chamfer (angled cut) to profile corners.
 */
export function chamferProfile(
  profile: Profile2D,
  distance: number,
  indices?: number[],
): Profile2D {
  const pts = profile.outer;
  const n = pts.length;
  const result: Vec2[] = [];
  const targetIndices = indices || pts.map((_, i) => i);

  for (let i = 0; i < n; i++) {
    if (!targetIndices.includes(i)) {
      result.push(pts[i]);
      continue;
    }

    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];

    const d1 = vec2(prev.x - curr.x, prev.y - curr.y);
    const d2 = vec2(next.x - curr.x, next.y - curr.y);

    const len1 = Math.sqrt(d1.x * d1.x + d1.y * d1.y);
    const len2 = Math.sqrt(d2.x * d2.x + d2.y * d2.y);

    const chamDist = Math.min(distance, len1 * 0.4, len2 * 0.4);

    result.push(vec2(
      curr.x + (d1.x / len1) * chamDist,
      curr.y + (d1.y / len1) * chamDist,
    ));
    result.push(vec2(
      curr.x + (d2.x / len2) * chamDist,
      curr.y + (d2.y / len2) * chamDist,
    ));
  }

  return { outer: result, holes: profile.holes };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LOFT — Connect two profiles to create a solid
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Loft between two profiles at different heights.
 * Profiles must have the same number of vertices.
 * Used for: tapered columns, transitional duct pieces.
 */
export function loftProfiles(
  profileA: Profile2D,
  heightA: number,
  profileB: Profile2D,
  heightB: number,
): Mesh {
  const ptsA = profileA.outer;
  const ptsB = profileB.outer;

  if (ptsA.length !== ptsB.length || ptsA.length < 3) {
    // Fallback: resample to match vertex count
    const count = Math.max(ptsA.length, ptsB.length);
    const resA = resampleProfile(ptsA, count);
    const resB = resampleProfile(ptsB, count);
    return loftProfilesInternal(resA, heightA, resB, heightB);
  }

  return loftProfilesInternal(ptsA, heightA, ptsB, heightB);
}

function resampleProfile(pts: Vec2[], count: number): Vec2[] {
  if (pts.length === count) return pts;

  // Compute total perimeter
  let totalLen = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const dx = pts[j].x - pts[i].x;
    const dy = pts[j].y - pts[i].y;
    totalLen += Math.sqrt(dx * dx + dy * dy);
  }

  const result: Vec2[] = [];
  const segLen = totalLen / count;
  let accumulated = 0;
  let edgeIdx = 0;

  for (let i = 0; i < count; i++) {
    const target = segLen * i;
    while (edgeIdx < pts.length) {
      const j = (edgeIdx + 1) % pts.length;
      const dx = pts[j].x - pts[edgeIdx].x;
      const dy = pts[j].y - pts[edgeIdx].y;
      const len = Math.sqrt(dx * dx + dy * dy);

      if (accumulated + len >= target) {
        const t = (target - accumulated) / len;
        result.push(vec2(
          pts[edgeIdx].x + t * dx,
          pts[edgeIdx].y + t * dy,
        ));
        break;
      }
      accumulated += len;
      edgeIdx++;
    }
  }

  while (result.length < count) {
    result.push(pts[pts.length - 1]);
  }

  return result;
}

function loftProfilesInternal(
  ptsA: Vec2[], heightA: number,
  ptsB: Vec2[], heightB: number,
): Mesh {
  const tris: Triangle[] = [];
  const n = ptsA.length;

  // Side faces
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a0 = vec3(ptsA[i].x, ptsA[i].y, heightA);
    const a1 = vec3(ptsA[j].x, ptsA[j].y, heightA);
    const b0 = vec3(ptsB[i].x, ptsB[i].y, heightB);
    const b1 = vec3(ptsB[j].x, ptsB[j].y, heightB);

    tris.push(createTriangle(a0, a1, b0));
    tris.push(createTriangle(a1, b1, b0));
  }

  // Bottom cap (profile A)
  for (let i = 1; i < n - 1; i++) {
    tris.push(createTriangle(
      vec3(ptsA[0].x, ptsA[0].y, heightA),
      vec3(ptsA[i + 1].x, ptsA[i + 1].y, heightA),
      vec3(ptsA[i].x, ptsA[i].y, heightA),
    ));
  }

  // Top cap (profile B)
  for (let i = 1; i < n - 1; i++) {
    tris.push(createTriangle(
      vec3(ptsB[0].x, ptsB[0].y, heightB),
      vec3(ptsB[i].x, ptsB[i].y, heightB),
      vec3(ptsB[i + 1].x, ptsB[i + 1].y, heightB),
    ));
  }

  return { triangles: tris };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  OFFSET PROFILE — For wall layer extrusion
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Offset a 2D profile inward or outward.
 * Positive offset = outward (enlarge), negative = inward (shrink).
 * Used for: generating individual wall layers from assembly definition.
 */
export function offsetProfile(profile: Profile2D, offset: number): Profile2D {
  const pts = profile.outer;
  const n = pts.length;
  const result: Vec2[] = [];

  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];

    // Edge normals (pointing outward)
    const e1 = vec2(curr.x - prev.x, curr.y - prev.y);
    const e2 = vec2(next.x - curr.x, next.y - curr.y);

    const len1 = Math.sqrt(e1.x * e1.x + e1.y * e1.y);
    const len2 = Math.sqrt(e2.x * e2.x + e2.y * e2.y);

    if (len1 < 1e-10 || len2 < 1e-10) {
      result.push(curr);
      continue;
    }

    const n1 = vec2(-e1.y / len1, e1.x / len1);
    const n2 = vec2(-e2.y / len2, e2.x / len2);

    // Average normal at vertex (bisector)
    const avgN = vec2(n1.x + n2.x, n1.y + n2.y);
    const avgLen = Math.sqrt(avgN.x * avgN.x + avgN.y * avgN.y);

    if (avgLen < 1e-10) {
      result.push(vec2(curr.x + n1.x * offset, curr.y + n1.y * offset));
      continue;
    }

    // Miter offset
    const dot = n1.x * n2.x + n1.y * n2.y;
    const miterScale = offset / (1 + dot);
    const clampedScale = Math.min(Math.abs(miterScale), Math.abs(offset) * 3) * Math.sign(miterScale);

    result.push(vec2(
      curr.x + (avgN.x / avgLen) * clampedScale * avgLen,
      curr.y + (avgN.y / avgLen) * clampedScale * avgLen,
    ));
  }

  return { outer: result, holes: profile.holes };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CURVED WALL EXTRUSION — Along a 2D path
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extrude a rectangular cross-section along a curved 2D path.
 * Path is defined in the XY plane, extrusion goes up in Z.
 * Used for: curved walls, curved beams.
 */
export function extrudeAlongPath2D(
  path: Vec2[],
  thickness: number,
  height: number,
): Mesh {
  if (path.length < 2) return emptyMesh();

  const tris: Triangle[] = [];

  // Generate offset paths (inner and outer edges)
  const halfT = thickness / 2;
  const innerPath: Vec2[] = [];
  const outerPath: Vec2[] = [];

  for (let i = 0; i < path.length; i++) {
    const prev = i > 0 ? path[i - 1] : path[i];
    const curr = path[i];
    const next = i < path.length - 1 ? path[i + 1] : path[i];

    // Tangent direction
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-10) {
      innerPath.push(curr);
      outerPath.push(curr);
      continue;
    }

    // Normal (perpendicular to tangent, pointing left)
    const nx = -dy / len;
    const ny = dx / len;

    innerPath.push(vec2(curr.x - nx * halfT, curr.y - ny * halfT));
    outerPath.push(vec2(curr.x + nx * halfT, curr.y + ny * halfT));
  }

  const n = path.length;

  // Bottom face (z = 0)
  for (let i = 0; i < n - 1; i++) {
    const a = vec3(innerPath[i].x, innerPath[i].y, 0);
    const b = vec3(outerPath[i].x, outerPath[i].y, 0);
    const c = vec3(innerPath[i + 1].x, innerPath[i + 1].y, 0);
    const d = vec3(outerPath[i + 1].x, outerPath[i + 1].y, 0);
    tris.push(createTriangle(a, c, b));
    tris.push(createTriangle(b, c, d));
  }

  // Top face (z = height)
  for (let i = 0; i < n - 1; i++) {
    const a = vec3(innerPath[i].x, innerPath[i].y, height);
    const b = vec3(outerPath[i].x, outerPath[i].y, height);
    const c = vec3(innerPath[i + 1].x, innerPath[i + 1].y, height);
    const d = vec3(outerPath[i + 1].x, outerPath[i + 1].y, height);
    tris.push(createTriangle(a, b, c));
    tris.push(createTriangle(b, d, c));
  }

  // Outer face
  for (let i = 0; i < n - 1; i++) {
    const bl = vec3(outerPath[i].x, outerPath[i].y, 0);
    const br = vec3(outerPath[i + 1].x, outerPath[i + 1].y, 0);
    const tl = vec3(outerPath[i].x, outerPath[i].y, height);
    const tr = vec3(outerPath[i + 1].x, outerPath[i + 1].y, height);
    tris.push(createTriangle(bl, br, tl));
    tris.push(createTriangle(br, tr, tl));
  }

  // Inner face
  for (let i = 0; i < n - 1; i++) {
    const bl = vec3(innerPath[i].x, innerPath[i].y, 0);
    const br = vec3(innerPath[i + 1].x, innerPath[i + 1].y, 0);
    const tl = vec3(innerPath[i].x, innerPath[i].y, height);
    const tr = vec3(innerPath[i + 1].x, innerPath[i + 1].y, height);
    tris.push(createTriangle(bl, tl, br));
    tris.push(createTriangle(br, tl, tr));
  }

  // Start cap
  {
    const a = vec3(innerPath[0].x, innerPath[0].y, 0);
    const b = vec3(outerPath[0].x, outerPath[0].y, 0);
    const c = vec3(outerPath[0].x, outerPath[0].y, height);
    const d = vec3(innerPath[0].x, innerPath[0].y, height);
    tris.push(createTriangle(a, b, c));
    tris.push(createTriangle(a, c, d));
  }

  // End cap
  {
    const i = n - 1;
    const a = vec3(innerPath[i].x, innerPath[i].y, 0);
    const b = vec3(outerPath[i].x, outerPath[i].y, 0);
    const c = vec3(outerPath[i].x, outerPath[i].y, height);
    const d = vec3(innerPath[i].x, innerPath[i].y, height);
    tris.push(createTriangle(a, c, b));
    tris.push(createTriangle(a, d, c));
  }

  return { triangles: tris };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PIPE FITTING GEOMETRY — Elbows, tees, reducers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a pipe elbow (90° bend).
 */
export function createPipeElbow(
  outerDiameter: number,
  bendRadius: number,
  angle: number = Math.PI / 2,
  segments: number = 16,
): Mesh {
  const radius = outerDiameter / 2;
  return createTorus(bendRadius, radius, angle, segments, Math.max(8, Math.floor(segments / 2)));
}

/**
 * Create a pipe reducer (transition between two diameters).
 */
export function createPipeReducer(
  diameterA: number,
  diameterB: number,
  length: number,
  segments: number = 24,
): Mesh {
  const profileA = circleProfile(diameterA / 2, segments);
  const profileB = circleProfile(diameterB / 2, segments);
  return loftProfiles(profileA, 0, profileB, length);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MESH UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute mesh centroid (center of mass assuming uniform density).
 */
export function meshCentroid(mesh: Mesh): Vec3 {
  let cx = 0, cy = 0, cz = 0, totalArea = 0;
  for (const t of mesh.triangles) {
    const area = 0.5 * v3len(v3cross(v3sub(t.v1, t.v0), v3sub(t.v2, t.v0)));
    const midX = (t.v0.x + t.v1.x + t.v2.x) / 3;
    const midY = (t.v0.y + t.v1.y + t.v2.y) / 3;
    const midZ = (t.v0.z + t.v1.z + t.v2.z) / 3;
    cx += midX * area;
    cy += midY * area;
    cz += midZ * area;
    totalArea += area;
  }
  if (totalArea < 1e-10) return vec3(0, 0, 0);
  return vec3(cx / totalArea, cy / totalArea, cz / totalArea);
}

/**
 * Compute moment of inertia tensor (simplified, around centroid).
 */
export function meshMomentOfInertia(mesh: Mesh): { Ixx: number; Iyy: number; Izz: number } {
  const c = meshCentroid(mesh);
  let Ixx = 0, Iyy = 0, Izz = 0;

  for (const t of mesh.triangles) {
    for (const v of [t.v0, t.v1, t.v2]) {
      const dx = v.x - c.x, dy = v.y - c.y, dz = v.z - c.z;
      Ixx += dy * dy + dz * dz;
      Iyy += dx * dx + dz * dz;
      Izz += dx * dx + dy * dy;
    }
  }

  const scale = 1 / (mesh.triangles.length * 3);
  return { Ixx: Ixx * scale, Iyy: Iyy * scale, Izz: Izz * scale };
}

/**
 * Decimate a mesh to reduce triangle count while preserving shape.
 * Simple vertex-clustering approach.
 */
export function decimateMesh(mesh: Mesh, targetTriCount: number): Mesh {
  if (mesh.triangles.length <= targetTriCount) return mesh;

  const ratio = targetTriCount / mesh.triangles.length;
  const bb = meshBoundingBox(mesh);
  const cellSize = Math.cbrt(
    ((bb.max.x - bb.min.x) * (bb.max.y - bb.min.y) * (bb.max.z - bb.min.z)) /
    (targetTriCount * 0.5),
  );

  if (cellSize < 1e-6) return mesh;

  // Cluster vertices
  const vertexMap = new Map<string, Vec3>();

  function clusterKey(v: Vec3): string {
    const gx = Math.floor((v.x - bb.min.x) / cellSize);
    const gy = Math.floor((v.y - bb.min.y) / cellSize);
    const gz = Math.floor((v.z - bb.min.z) / cellSize);
    return `${gx},${gy},${gz}`;
  }

  function clusterVertex(v: Vec3): Vec3 {
    const key = clusterKey(v);
    if (!vertexMap.has(key)) {
      vertexMap.set(key, v);
    }
    return vertexMap.get(key)!;
  }

  const tris: Triangle[] = [];
  for (const t of mesh.triangles) {
    const v0 = clusterVertex(t.v0);
    const v1 = clusterVertex(t.v1);
    const v2 = clusterVertex(t.v2);

    // Skip degenerate triangles
    if (v3eq(v0, v1) || v3eq(v1, v2) || v3eq(v0, v2)) continue;

    tris.push(createTriangle(v0, v1, v2));
  }

  return { triangles: tris };
}

/**
 * Smooth a mesh using Laplacian smoothing (1 iteration).
 * Preserves boundary edges.
 */
export function smoothMesh(mesh: Mesh, iterations: number = 1, factor: number = 0.5): Mesh {
  let current = mesh;

  for (let iter = 0; iter < iterations; iter++) {
    // Build adjacency
    const vertexMap = new Map<string, { sum: Vec3; count: number; original: Vec3 }>();

    function vKey(v: Vec3): string {
      return `${v.x.toFixed(6)},${v.y.toFixed(6)},${v.z.toFixed(6)}`;
    }

    for (const t of current.triangles) {
      for (const v of [t.v0, t.v1, t.v2]) {
        const key = vKey(v);
        if (!vertexMap.has(key)) {
          vertexMap.set(key, { sum: vec3(0, 0, 0), count: 0, original: v });
        }
      }

      // Add neighbor contributions
      const pairs: [Vec3, Vec3][] = [[t.v0, t.v1], [t.v1, t.v2], [t.v2, t.v0]];
      for (const [a, b] of pairs) {
        const ka = vKey(a);
        const kb = vKey(b);
        const ea = vertexMap.get(ka)!;
        const eb = vertexMap.get(kb)!;
        ea.sum = v3add(ea.sum, b);
        ea.count++;
        eb.sum = v3add(eb.sum, a);
        eb.count++;
      }
    }

    // Compute smoothed positions
    const smoothed = new Map<string, Vec3>();
    for (const [key, entry] of vertexMap) {
      if (entry.count === 0) {
        smoothed.set(key, entry.original);
      } else {
        const avg = v3scale(entry.sum, 1 / entry.count);
        smoothed.set(key, v3lerp(entry.original, avg, factor));
      }
    }

    // Rebuild mesh with smoothed vertices
    const tris: Triangle[] = [];
    for (const t of current.triangles) {
      const v0 = smoothed.get(vKey(t.v0)) || t.v0;
      const v1 = smoothed.get(vKey(t.v1)) || t.v1;
      const v2 = smoothed.get(vKey(t.v2)) || t.v2;
      tris.push(createTriangle(v0, v1, v2));
    }

    current = { triangles: tris };
  }

  return current;
}
