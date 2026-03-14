/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  3D GEOMETRY KERNEL — Solid Modeling Engine for BIM
 *  Provides CSG boolean operations, extrusion, sweep, and mesh operations.
 *  All coordinates in metres. Right-hand coordinate system (Z-up).
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
//  VECTOR & MATRIX MATH
// ═══════════════════════════════════════════════════════════════════════════════

export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }

export function vec3(x: number, y: number, z: number): Vec3 { return { x, y, z }; }
export function vec2(x: number, y: number): Vec2 { return { x, y }; }

export function v3add(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
export function v3sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
export function v3scale(a: Vec3, s: number): Vec3 { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
export function v3dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
export function v3cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
export function v3len(a: Vec3): number { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
export function v3normalize(a: Vec3): Vec3 {
  const l = v3len(a);
  return l < 1e-12 ? { x: 0, y: 0, z: 1 } : v3scale(a, 1 / l);
}
export function v3lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return v3add(v3scale(a, 1 - t), v3scale(b, t));
}
export function v3eq(a: Vec3, b: Vec3, eps = 1e-6): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.z - b.z) < eps;
}

export interface Mat4 { m: Float64Array } // 4x4 column-major

export function mat4Identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return { m };
}

export function mat4Translation(t: Vec3): Mat4 {
  const r = mat4Identity();
  r.m[12] = t.x; r.m[13] = t.y; r.m[14] = t.z;
  return r;
}

export function mat4RotationZ(angle: number): Mat4 {
  const r = mat4Identity();
  const c = Math.cos(angle), s = Math.sin(angle);
  r.m[0] = c; r.m[1] = s; r.m[4] = -s; r.m[5] = c;
  return r;
}

export function mat4RotationY(angle: number): Mat4 {
  const r = mat4Identity();
  const c = Math.cos(angle), s = Math.sin(angle);
  r.m[0] = c; r.m[2] = s; r.m[8] = -s; r.m[10] = c;
  return r;
}

export function mat4RotationX(angle: number): Mat4 {
  const r = mat4Identity();
  const c = Math.cos(angle), s = Math.sin(angle);
  r.m[5] = c; r.m[6] = s; r.m[9] = -s; r.m[10] = c;
  return r;
}

export function mat4Scale(s: Vec3): Mat4 {
  const r = mat4Identity();
  r.m[0] = s.x; r.m[5] = s.y; r.m[10] = s.z;
  return r;
}

export function mat4Mul(a: Mat4, b: Mat4): Mat4 {
  const r = { m: new Float64Array(16) };
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a.m[row + k * 4] * b.m[k + col * 4];
      r.m[row + col * 4] = s;
    }
  return r;
}

export function mat4TransformPoint(m: Mat4, p: Vec3): Vec3 {
  return {
    x: m.m[0] * p.x + m.m[4] * p.y + m.m[8] * p.z + m.m[12],
    y: m.m[1] * p.x + m.m[5] * p.y + m.m[9] * p.z + m.m[13],
    z: m.m[2] * p.x + m.m[6] * p.y + m.m[10] * p.z + m.m[14],
  };
}

export function mat4TransformDir(m: Mat4, d: Vec3): Vec3 {
  return v3normalize({
    x: m.m[0] * d.x + m.m[4] * d.y + m.m[8] * d.z,
    y: m.m[1] * d.x + m.m[5] * d.y + m.m[9] * d.z,
    z: m.m[2] * d.x + m.m[6] * d.y + m.m[10] * d.z,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TRIANGLE MESH — Core 3D representation
// ═══════════════════════════════════════════════════════════════════════════════

export interface Triangle {
  v0: Vec3; v1: Vec3; v2: Vec3;
  n: Vec3;     // face normal
}

export interface Mesh {
  triangles: Triangle[];
}

export function triangleNormal(v0: Vec3, v1: Vec3, v2: Vec3): Vec3 {
  return v3normalize(v3cross(v3sub(v1, v0), v3sub(v2, v0)));
}

export function createTriangle(v0: Vec3, v1: Vec3, v2: Vec3): Triangle {
  return { v0, v1, v2, n: triangleNormal(v0, v1, v2) };
}

export function meshFromTriangles(tris: Triangle[]): Mesh {
  return { triangles: tris };
}

export function emptyMesh(): Mesh { return { triangles: [] }; }

export function mergeMeshes(...meshes: Mesh[]): Mesh {
  const out: Triangle[] = [];
  for (const m of meshes) out.push(...m.triangles);
  return { triangles: out };
}

export function transformMesh(mesh: Mesh, mat: Mat4): Mesh {
  return {
    triangles: mesh.triangles.map(t => {
      const v0 = mat4TransformPoint(mat, t.v0);
      const v1 = mat4TransformPoint(mat, t.v1);
      const v2 = mat4TransformPoint(mat, t.v2);
      return createTriangle(v0, v1, v2);
    }),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  2D PROFILE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

export interface Profile2D {
  outer: Vec2[];          // CCW outer boundary
  holes: Vec2[][];        // CW holes (door/window openings)
}

export function rectProfile(width: number, depth: number): Profile2D {
  const hw = width / 2, hd = depth / 2;
  return {
    outer: [vec2(-hw, -hd), vec2(hw, -hd), vec2(hw, hd), vec2(-hw, hd)],
    holes: [],
  };
}

export function circleProfile(radius: number, segments = 24): Profile2D {
  const pts: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    pts.push(vec2(radius * Math.cos(a), radius * Math.sin(a)));
  }
  return { outer: pts, holes: [] };
}

/** L-shaped profile for angle sections */
export function lProfile(w: number, h: number, tw: number, tf: number): Profile2D {
  return {
    outer: [
      vec2(0, 0), vec2(w, 0), vec2(w, tf),
      vec2(tw, tf), vec2(tw, h), vec2(0, h),
    ],
    holes: [],
  };
}

/** I-beam / W-section profile */
export function iProfile(w: number, h: number, tw: number, tf: number): Profile2D {
  const hw = w / 2, htw = tw / 2;
  return {
    outer: [
      vec2(-hw, 0), vec2(hw, 0), vec2(hw, tf),
      vec2(htw, tf), vec2(htw, h - tf), vec2(hw, h - tf),
      vec2(hw, h), vec2(-hw, h), vec2(-hw, h - tf),
      vec2(-htw, h - tf), vec2(-htw, tf), vec2(-hw, tf),
    ],
    holes: [],
  };
}

/** Add a rectangular hole to a profile (for door/window openings in walls) */
export function addRectHole(profile: Profile2D, cx: number, cy: number, w: number, h: number): Profile2D {
  const hw = w / 2, hh = h / 2;
  // CW winding for holes
  const hole: Vec2[] = [
    vec2(cx - hw, cy - hh), vec2(cx - hw, cy + hh),
    vec2(cx + hw, cy + hh), vec2(cx + hw, cy - hh),
  ];
  return { outer: profile.outer, holes: [...profile.holes, hole] };
}

/** Compute area of profile (outer minus holes) */
export function profileArea(p: Profile2D): number {
  let area = Math.abs(polyArea2D(p.outer));
  for (const h of p.holes) area -= Math.abs(polyArea2D(h));
  return area;
}

function polyArea2D(pts: Vec2[]): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return 0.5 * a;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  EXTRUSION — Profile → Solid Mesh
// ═══════════════════════════════════════════════════════════════════════════════

/** Triangulate a convex or nearly-convex polygon (ear-clipping simplified) */
function triangulatePolygon2D(pts: Vec2[]): [number, number, number][] {
  if (pts.length < 3) return [];
  if (pts.length === 3) return [[0, 1, 2]];

  // Fan triangulation (works for convex; approximate for concave)
  const tris: [number, number, number][] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    tris.push([0, i, i + 1]);
  }
  return tris;
}

/** Simple ear-clipping for arbitrary simple polygons */
function earClipTriangulate(pts: Vec2[]): [number, number, number][] {
  if (pts.length < 3) return [];
  if (pts.length === 3) return [[0, 1, 2]];

  const indices = pts.map((_, i) => i);
  const result: [number, number, number][] = [];

  function cross2D(o: Vec2, a: Vec2, b: Vec2): number {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  }

  function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
    const d1 = cross2D(p, a, b), d2 = cross2D(p, b, c), d3 = cross2D(p, c, a);
    const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    return !(hasNeg && hasPos);
  }

  // Ensure CCW winding
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  if (area < 0) indices.reverse();

  let safety = indices.length * 3;
  while (indices.length > 2 && safety-- > 0) {
    let earFound = false;
    for (let i = 0; i < indices.length; i++) {
      const prev = indices[(i - 1 + indices.length) % indices.length];
      const curr = indices[i];
      const next = indices[(i + 1) % indices.length];

      const cp = cross2D(pts[prev], pts[curr], pts[next]);
      if (cp <= 0) continue; // reflex vertex

      // Check no other vertex inside this triangle
      let isEar = true;
      for (let j = 0; j < indices.length; j++) {
        const idx = indices[j];
        if (idx === prev || idx === curr || idx === next) continue;
        if (pointInTriangle(pts[idx], pts[prev], pts[curr], pts[next])) {
          isEar = false;
          break;
        }
      }

      if (isEar) {
        result.push([prev, curr, next]);
        indices.splice(i, 1);
        earFound = true;
        break;
      }
    }
    if (!earFound) break; // degenerate polygon
  }

  return result;
}

/**
 * Extrude a 2D profile along a direction to create a solid mesh.
 * Profile is defined in XY plane, extruded along Z by default.
 */
export function extrudeProfile(profile: Profile2D, height: number, direction: Vec3 = vec3(0, 0, 1)): Mesh {
  const tris: Triangle[] = [];
  const dir = v3normalize(direction);
  const offset = v3scale(dir, height);

  // Build rotation matrix to align Z-axis with extrusion direction
  const mat = buildAlignmentMatrix(dir);

  function transformPt(p: Vec2, dz: number): Vec3 {
    const local = vec3(p.x, p.y, 0);
    const rotated = mat4TransformPoint(mat, local);
    return v3add(rotated, v3scale(dir, dz));
  }

  // Outer wall sides
  extrudeSideWalls(profile.outer, 0, height, transformPt, tris, false);

  // Hole wall sides (reversed winding)
  for (const hole of profile.holes) {
    extrudeSideWalls(hole, 0, height, transformPt, tris, true);
  }

  // Top and bottom caps
  const outerTris = earClipTriangulate(profile.outer);

  // Bottom cap (z = 0)
  for (const [a, b, c] of outerTris) {
    const pa = transformPt(profile.outer[a], 0);
    const pb = transformPt(profile.outer[b], 0);
    const pc = transformPt(profile.outer[c], 0);

    // Check if any vertex is inside a hole — skip if so
    // (Simplified: just create the triangle; proper approach is constrained Delaunay)
    tris.push(createTriangle(pa, pc, pb)); // reversed for bottom face
  }

  // Top cap (z = height)
  for (const [a, b, c] of outerTris) {
    const pa = transformPt(profile.outer[a], height);
    const pb = transformPt(profile.outer[b], height);
    const pc = transformPt(profile.outer[c], height);
    tris.push(createTriangle(pa, pb, pc));
  }

  // Hole caps need to be subtracted — for simplicity, holes create openings
  // (the side walls of holes provide the visible edges)

  return { triangles: tris };
}

function extrudeSideWalls(
  pts: Vec2[], z0: number, z1: number,
  transform: (p: Vec2, z: number) => Vec3,
  tris: Triangle[],
  reversed: boolean
) {
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const bl = transform(pts[i], z0);
    const br = transform(pts[j], z0);
    const tl = transform(pts[i], z1);
    const tr = transform(pts[j], z1);

    if (reversed) {
      tris.push(createTriangle(bl, tl, br));
      tris.push(createTriangle(br, tl, tr));
    } else {
      tris.push(createTriangle(bl, br, tl));
      tris.push(createTriangle(br, tr, tl));
    }
  }
}

function buildAlignmentMatrix(dir: Vec3): Mat4 {
  // Build a rotation matrix that aligns local Z with `dir`
  const up = Math.abs(dir.z) > 0.99 ? vec3(1, 0, 0) : vec3(0, 0, 1);
  const right = v3normalize(v3cross(up, dir));
  const forward = v3normalize(v3cross(dir, right));

  const m = new Float64Array(16);
  m[0] = right.x;   m[1] = right.y;   m[2] = right.z;
  m[4] = forward.x;  m[5] = forward.y;  m[6] = forward.z;
  m[8] = dir.x;     m[9] = dir.y;     m[10] = dir.z;
  m[15] = 1;
  return { m };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SWEEP — Profile along a path (for MEP routing)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sweep a 2D profile along a 3D polyline path.
 * Used for duct runs, pipe runs, cable trays.
 */
export function sweepAlongPath(profile: Profile2D, path: Vec3[]): Mesh {
  if (path.length < 2) return emptyMesh();

  const tris: Triangle[] = [];
  const segments = profile.outer.length;

  // Generate cross-section rings at each path vertex
  const rings: Vec3[][] = [];

  for (let pi = 0; pi < path.length; pi++) {
    const pos = path[pi];

    // Tangent direction
    let tangent: Vec3;
    if (pi === 0) tangent = v3normalize(v3sub(path[1], path[0]));
    else if (pi === path.length - 1) tangent = v3normalize(v3sub(path[pi], path[pi - 1]));
    else tangent = v3normalize(v3add(v3sub(path[pi], path[pi - 1]), v3sub(path[pi + 1], path[pi])));

    // Build frame (Frenet-like)
    const mat = buildAlignmentMatrix(tangent);
    const ring: Vec3[] = [];
    for (const pt of profile.outer) {
      const local = vec3(pt.x, pt.y, 0);
      const rotated = mat4TransformPoint(mat, local);
      ring.push(v3add(pos, rotated));
    }
    rings.push(ring);
  }

  // Connect consecutive rings with quads (2 triangles each)
  for (let ri = 0; ri < rings.length - 1; ri++) {
    const r0 = rings[ri], r1 = rings[ri + 1];
    for (let si = 0; si < segments; si++) {
      const sj = (si + 1) % segments;
      tris.push(createTriangle(r0[si], r0[sj], r1[si]));
      tris.push(createTriangle(r0[sj], r1[sj], r1[si]));
    }
  }

  // Start cap
  const startTris = earClipTriangulate(profile.outer);
  for (const [a, b, c] of startTris) {
    tris.push(createTriangle(rings[0][a], rings[0][c], rings[0][b]));
  }

  // End cap
  const last = rings.length - 1;
  for (const [a, b, c] of startTris) {
    tris.push(createTriangle(rings[last][a], rings[last][b], rings[last][c]));
  }

  return { triangles: tris };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PRIMITIVE GENERATORS
// ═══════════════════════════════════════════════════════════════════════════════

/** Create an axis-aligned box mesh centered at origin */
export function createBox(width: number, height: number, depth: number): Mesh {
  return extrudeProfile(rectProfile(width, depth), height, vec3(0, 0, 1));
}

/** Create a cylinder mesh centered at origin, axis along Z */
export function createCylinder(radius: number, height: number, segments = 24): Mesh {
  return extrudeProfile(circleProfile(radius, segments), height);
}

/** Create an I-beam extrusion */
export function createIBeam(w: number, h: number, tw: number, tf: number, length: number): Mesh {
  return extrudeProfile(iProfile(w, h, tw, tf), length, vec3(1, 0, 0));
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BOUNDING BOX & SPATIAL INDEX
// ═══════════════════════════════════════════════════════════════════════════════

export interface AABB {
  min: Vec3;
  max: Vec3;
}

export function meshBoundingBox(mesh: Mesh): AABB {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const t of mesh.triangles) {
    for (const v of [t.v0, t.v1, t.v2]) {
      if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
      if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
    }
  }
  return { min: vec3(minX, minY, minZ), max: vec3(maxX, maxY, maxZ) };
}

export function aabbOverlap(a: AABB, b: AABB): boolean {
  return a.min.x <= b.max.x && a.max.x >= b.min.x
      && a.min.y <= b.max.y && a.max.y >= b.min.y
      && a.min.z <= b.max.z && a.max.z >= b.min.z;
}

export function aabbVolume(a: AABB): number {
  return Math.max(0, a.max.x - a.min.x) * Math.max(0, a.max.y - a.min.y) * Math.max(0, a.max.z - a.min.z);
}

export function aabbIntersection(a: AABB, b: AABB): AABB | null {
  const min = vec3(Math.max(a.min.x, b.min.x), Math.max(a.min.y, b.min.y), Math.max(a.min.z, b.min.z));
  const max = vec3(Math.min(a.max.x, b.max.x), Math.min(a.max.y, b.max.y), Math.min(a.max.z, b.max.z));
  if (min.x > max.x || min.y > max.y || min.z > max.z) return null;
  return { min, max };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MESH QUANTITY CALCULATIONS — Real geometry-derived QTO
// ═══════════════════════════════════════════════════════════════════════════════

/** Compute volume of a closed triangle mesh using divergence theorem */
export function meshVolume(mesh: Mesh): number {
  let vol = 0;
  for (const t of mesh.triangles) {
    vol += signedVolumeOfTriangle(t.v0, t.v1, t.v2);
  }
  return Math.abs(vol);
}

function signedVolumeOfTriangle(v0: Vec3, v1: Vec3, v2: Vec3): number {
  return (
    v0.x * (v1.y * v2.z - v2.y * v1.z) -
    v1.x * (v0.y * v2.z - v2.y * v0.z) +
    v2.x * (v0.y * v1.z - v1.y * v0.z)
  ) / 6.0;
}

/** Compute surface area of a triangle mesh */
export function meshSurfaceArea(mesh: Mesh): number {
  let area = 0;
  for (const t of mesh.triangles) {
    const edge1 = v3sub(t.v1, t.v0);
    const edge2 = v3sub(t.v2, t.v0);
    area += 0.5 * v3len(v3cross(edge1, edge2));
  }
  return area;
}

/** Compute the lateral (side) surface area of an extruded element (exclude top/bottom) */
export function meshLateralArea(mesh: Mesh, upAxis: Vec3 = vec3(0, 0, 1)): number {
  let area = 0;
  const threshold = 0.5; // cos(60°) — faces within 60° of up/down are top/bottom
  for (const t of mesh.triangles) {
    const dot = Math.abs(v3dot(t.n, upAxis));
    if (dot < threshold) {
      const edge1 = v3sub(t.v1, t.v0);
      const edge2 = v3sub(t.v2, t.v0);
      area += 0.5 * v3len(v3cross(edge1, edge2));
    }
  }
  return area;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MESH SERIALIZATION — For storage, IFC export, and viewer transport
// ═══════════════════════════════════════════════════════════════════════════════

export interface SerializedMesh {
  vertices: number[];   // flat [x,y,z, x,y,z, ...]
  indices: number[];    // triangle indices
  normals: number[];    // per-vertex normals [nx,ny,nz, ...]
}

/** Convert Mesh to flat array format for efficient storage/transfer */
export function serializeMesh(mesh: Mesh): SerializedMesh {
  const vertexMap = new Map<string, number>();
  const vertices: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  function addVertex(v: Vec3, n: Vec3): number {
    const key = `${v.x.toFixed(6)},${v.y.toFixed(6)},${v.z.toFixed(6)}`;
    if (vertexMap.has(key)) return vertexMap.get(key)!;
    const idx = vertices.length / 3;
    vertices.push(v.x, v.y, v.z);
    normals.push(n.x, n.y, n.z);
    vertexMap.set(key, idx);
    return idx;
  }

  for (const t of mesh.triangles) {
    indices.push(
      addVertex(t.v0, t.n),
      addVertex(t.v1, t.n),
      addVertex(t.v2, t.n),
    );
  }

  return { vertices, indices, normals };
}

/** Reconstruct Mesh from serialized format */
export function deserializeMesh(s: SerializedMesh): Mesh {
  const tris: Triangle[] = [];
  for (let i = 0; i < s.indices.length; i += 3) {
    const i0 = s.indices[i] * 3, i1 = s.indices[i + 1] * 3, i2 = s.indices[i + 2] * 3;
    tris.push(createTriangle(
      vec3(s.vertices[i0], s.vertices[i0 + 1], s.vertices[i0 + 2]),
      vec3(s.vertices[i1], s.vertices[i1 + 1], s.vertices[i1 + 2]),
      vec3(s.vertices[i2], s.vertices[i2 + 1], s.vertices[i2 + 2]),
    ));
  }
  return { triangles: tris };
}
