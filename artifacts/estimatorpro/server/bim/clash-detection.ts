/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  3D CLASH DETECTION ENGINE — Real geometry intersection testing
 *  Uses spatial indexing (octree) for efficient broad-phase,
 *  then AABB and triangle-level narrow-phase testing.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import {
  type Vec3, type AABB, type Mesh, type Triangle,
  vec3, v3sub, v3dot, v3cross, v3add, v3scale, v3len,
  aabbOverlap, aabbIntersection, aabbVolume, meshBoundingBox,
} from './geometry-kernel';

import type { BIMSolid } from './parametric-elements';

// ═══════════════════════════════════════════════════════════════════════════════
//  CLASH RESULT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type ClashType = 'hard' | 'soft' | 'clearance';
export type ClashSeverity = 'critical' | 'major' | 'minor' | 'info';

export interface ClashResult {
  id: string;
  type: ClashType;
  severity: ClashSeverity;
  elementA: { id: string; type: string; name: string; storey: string };
  elementB: { id: string; type: string; name: string; storey: string };
  overlapVolume: number;           // m³ approximate
  overlapRegion: AABB;             // bounding box of clash zone
  point: Vec3;                     // representative clash point
  distance: number;                // penetration depth (negative for hard clash)
  description: string;
  discipline: string;              // e.g. "Structural vs MEP", "Arch vs Struct"
}

export interface ClashTestConfig {
  tolerance: number;               // metres — minimum overlap to report (default 0.01)
  clearanceDistance: number;        // metres — for clearance checks (default 0.05)
  ignoreSameHost: boolean;         // skip clashes between wall and its hosted door/window
  ignoreSameStorey: boolean;       // only check within same storey (performance)
  categories?: string[];           // filter: only test these categories
  excludePairs?: [string, string][]; // skip specific type pairs (e.g. ['Slab', 'Wall'])
  maxResults?: number;             // limit results
}

const DEFAULT_CONFIG: ClashTestConfig = {
  tolerance: 0.01,
  clearanceDistance: 0.05,
  ignoreSameHost: true,
  ignoreSameStorey: false,
  maxResults: 1000,
};

// ═══════════════════════════════════════════════════════════════════════════════
//  OCTREE — Spatial Index for broad-phase
// ═══════════════════════════════════════════════════════════════════════════════

interface OctreeNode {
  bounds: AABB;
  children: OctreeNode[] | null;
  elements: { index: number; bounds: AABB }[];
  depth: number;
}

const MAX_OCTREE_DEPTH = 8;
const MAX_ELEMENTS_PER_NODE = 16;

function createOctreeNode(bounds: AABB, depth: number): OctreeNode {
  return { bounds, children: null, elements: [], depth };
}

function subdivideOctree(node: OctreeNode): void {
  const { min, max } = node.bounds;
  const mid = vec3((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);

  node.children = [];
  for (let x = 0; x < 2; x++) {
    for (let y = 0; y < 2; y++) {
      for (let z = 0; z < 2; z++) {
        const childMin = vec3(
          x === 0 ? min.x : mid.x,
          y === 0 ? min.y : mid.y,
          z === 0 ? min.z : mid.z,
        );
        const childMax = vec3(
          x === 0 ? mid.x : max.x,
          y === 0 ? mid.y : max.y,
          z === 0 ? mid.z : max.z,
        );
        node.children.push(createOctreeNode({ min: childMin, max: childMax }, node.depth + 1));
      }
    }
  }

  // Redistribute elements
  for (const elem of node.elements) {
    for (const child of node.children) {
      if (aabbOverlap(elem.bounds, child.bounds)) {
        child.elements.push(elem);
      }
    }
  }
  node.elements = [];
}

function octreeInsert(node: OctreeNode, index: number, bounds: AABB): void {
  if (!aabbOverlap(bounds, node.bounds)) return;

  if (node.children) {
    for (const child of node.children) {
      octreeInsert(child, index, bounds);
    }
    return;
  }

  node.elements.push({ index, bounds });

  if (node.elements.length > MAX_ELEMENTS_PER_NODE && node.depth < MAX_OCTREE_DEPTH) {
    subdivideOctree(node);
  }
}

function octreeQuery(node: OctreeNode, queryBounds: AABB): number[] {
  if (!aabbOverlap(queryBounds, node.bounds)) return [];

  const results: number[] = [];

  if (node.children) {
    for (const child of node.children) {
      results.push(...octreeQuery(child, queryBounds));
    }
  } else {
    for (const elem of node.elements) {
      if (aabbOverlap(elem.bounds, queryBounds)) {
        results.push(elem.index);
      }
    }
  }

  return [...new Set(results)]; // deduplicate
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TRIANGLE-TRIANGLE INTERSECTION (Moller's algorithm)
// ═══════════════════════════════════════════════════════════════════════════════

function trianglesIntersect(t1: Triangle, t2: Triangle): boolean {
  // SAT (Separating Axis Theorem) based test
  // Test all 13 potential separating axes

  const verts1 = [t1.v0, t1.v1, t1.v2];
  const verts2 = [t2.v0, t2.v1, t2.v2];

  const edges1 = [v3sub(t1.v1, t1.v0), v3sub(t1.v2, t1.v1), v3sub(t1.v0, t1.v2)];
  const edges2 = [v3sub(t2.v1, t2.v0), v3sub(t2.v2, t2.v1), v3sub(t2.v0, t2.v2)];

  // Test face normals
  if (separatedOnAxis(verts1, verts2, t1.n)) return false;
  if (separatedOnAxis(verts1, verts2, t2.n)) return false;

  // Test edge cross products
  for (const e1 of edges1) {
    for (const e2 of edges2) {
      const axis = v3cross(e1, e2);
      if (v3len(axis) < 1e-10) continue;
      if (separatedOnAxis(verts1, verts2, axis)) return false;
    }
  }

  return true; // No separating axis found
}

function separatedOnAxis(verts1: Vec3[], verts2: Vec3[], axis: Vec3): boolean {
  let min1 = Infinity, max1 = -Infinity;
  let min2 = Infinity, max2 = -Infinity;

  for (const v of verts1) {
    const d = v3dot(v, axis);
    if (d < min1) min1 = d;
    if (d > max1) max1 = d;
  }

  for (const v of verts2) {
    const d = v3dot(v, axis);
    if (d < min2) min2 = d;
    if (d > max2) max2 = d;
  }

  return max1 < min2 || max2 < min1;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN CLASH DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

export function runClashDetection(
  elements: BIMSolid[],
  config: Partial<ClashTestConfig> = {},
): ClashResult[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const results: ClashResult[] = [];

  if (elements.length < 2) return results;

  // Build spatial index
  const allBounds = elements.map(e => e.boundingBox);
  const worldMin = vec3(
    Math.min(...allBounds.map(b => b.min.x)) - 1,
    Math.min(...allBounds.map(b => b.min.y)) - 1,
    Math.min(...allBounds.map(b => b.min.z)) - 1,
  );
  const worldMax = vec3(
    Math.max(...allBounds.map(b => b.max.x)) + 1,
    Math.max(...allBounds.map(b => b.max.y)) + 1,
    Math.max(...allBounds.map(b => b.max.z)) + 1,
  );

  const octree = createOctreeNode({ min: worldMin, max: worldMax }, 0);
  for (let i = 0; i < elements.length; i++) {
    octreeInsert(octree, i, elements[i].boundingBox);
  }

  // Exclude pairs set
  const excludeSet = new Set<string>();
  for (const [a, b] of cfg.excludePairs || []) {
    excludeSet.add(`${a}|${b}`);
    excludeSet.add(`${b}|${a}`);
  }

  // Check all pairs using spatial index
  const testedPairs = new Set<string>();

  for (let i = 0; i < elements.length; i++) {
    if (cfg.maxResults && results.length >= cfg.maxResults) break;

    const elA = elements[i];

    // Expand bounds for clearance check
    const queryBounds: AABB = {
      min: vec3(
        elA.boundingBox.min.x - cfg.clearanceDistance,
        elA.boundingBox.min.y - cfg.clearanceDistance,
        elA.boundingBox.min.z - cfg.clearanceDistance,
      ),
      max: vec3(
        elA.boundingBox.max.x + cfg.clearanceDistance,
        elA.boundingBox.max.y + cfg.clearanceDistance,
        elA.boundingBox.max.z + cfg.clearanceDistance,
      ),
    };

    const candidates = octreeQuery(octree, queryBounds);

    for (const j of candidates) {
      if (j <= i) continue; // avoid duplicate pairs
      if (cfg.maxResults && results.length >= cfg.maxResults) break;

      const pairKey = `${i}|${j}`;
      if (testedPairs.has(pairKey)) continue;
      testedPairs.add(pairKey);

      const elB = elements[j];

      // Filter checks
      if (cfg.ignoreSameHost && (elA.hostId === elB.id || elB.hostId === elA.id)) continue;
      if (cfg.ignoreSameHost && elA.hostedIds.includes(elB.id)) continue;
      if (cfg.ignoreSameStorey && elA.storey !== elB.storey) continue;
      if (excludeSet.has(`${elA.type}|${elB.type}`)) continue;

      // AABB overlap check
      const overlap = aabbIntersection(elA.boundingBox, elB.boundingBox);

      if (overlap) {
        // Hard clash — AABBs actually overlap
        const overlapVol = aabbVolume(overlap);
        if (overlapVol < cfg.tolerance ** 3) continue; // too small

        // Triangle-level verification (sample)
        const hasTriangleClash = verifyTriangleClash(elA.mesh, elB.mesh, 50);

        if (hasTriangleClash || overlapVol > 0.001) {
          const severity = classifySeverity(elA, elB, overlapVol);
          const discipline = `${elA.category} vs ${elB.category}`;

          results.push({
            id: `clash_${i}_${j}`,
            type: 'hard',
            severity,
            elementA: { id: elA.id, type: elA.type, name: elA.name, storey: elA.storey },
            elementB: { id: elB.id, type: elB.type, name: elB.name, storey: elB.storey },
            overlapVolume: overlapVol,
            overlapRegion: overlap,
            point: vec3(
              (overlap.min.x + overlap.max.x) / 2,
              (overlap.min.y + overlap.max.y) / 2,
              (overlap.min.z + overlap.max.z) / 2,
            ),
            distance: -Math.cbrt(overlapVol),
            description: `${elA.type} "${elA.name}" intersects ${elB.type} "${elB.name}" (${(overlapVol * 1e6).toFixed(0)} cm³)`,
            discipline,
          });
        }
      } else {
        // Check clearance violation
        const dist = aabbMinDistance(elA.boundingBox, elB.boundingBox);
        if (dist < cfg.clearanceDistance && dist > cfg.tolerance) {
          results.push({
            id: `clearance_${i}_${j}`,
            type: 'clearance',
            severity: 'minor',
            elementA: { id: elA.id, type: elA.type, name: elA.name, storey: elA.storey },
            elementB: { id: elB.id, type: elB.type, name: elB.name, storey: elB.storey },
            overlapVolume: 0,
            overlapRegion: { min: elA.boundingBox.min, max: elA.boundingBox.max },
            point: vec3(
              (elA.origin.x + elB.origin.x) / 2,
              (elA.origin.y + elB.origin.y) / 2,
              (elA.origin.z + elB.origin.z) / 2,
            ),
            distance: dist,
            description: `${elA.type} "${elA.name}" too close to ${elB.type} "${elB.name}" (${(dist * 1000).toFixed(0)}mm clearance)`,
            discipline: `${elA.category} vs ${elB.category}`,
          });
        }
      }
    }
  }

  // Sort by severity
  const severityOrder: Record<string, number> = { critical: 0, major: 1, minor: 2, info: 3 };
  results.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return results;
}

function verifyTriangleClash(meshA: Mesh, meshB: Mesh, sampleCount: number): boolean {
  // Sample triangles from each mesh for intersection testing
  const trisA = meshA.triangles;
  const trisB = meshB.triangles;

  const stepA = Math.max(1, Math.floor(trisA.length / sampleCount));
  const stepB = Math.max(1, Math.floor(trisB.length / sampleCount));

  for (let i = 0; i < trisA.length; i += stepA) {
    for (let j = 0; j < trisB.length; j += stepB) {
      if (trianglesIntersect(trisA[i], trisB[j])) return true;
    }
  }
  return false;
}

function classifySeverity(elA: BIMSolid, elB: BIMSolid, overlapVolume: number): ClashSeverity {
  // Cross-discipline clashes are more severe
  if (elA.category !== elB.category) {
    if (overlapVolume > 0.01) return 'critical';
    if (overlapVolume > 0.001) return 'major';
    return 'minor';
  }

  // Structural clashes are critical
  if (elA.category === 'Structural' || elB.category === 'Structural') {
    if (overlapVolume > 0.005) return 'critical';
    return 'major';
  }

  if (overlapVolume > 0.01) return 'major';
  if (overlapVolume > 0.001) return 'minor';
  return 'info';
}

function aabbMinDistance(a: AABB, b: AABB): number {
  let dx = 0, dy = 0, dz = 0;

  if (a.max.x < b.min.x) dx = b.min.x - a.max.x;
  else if (b.max.x < a.min.x) dx = a.min.x - b.max.x;

  if (a.max.y < b.min.y) dy = b.min.y - a.max.y;
  else if (b.max.y < a.min.y) dy = a.min.y - b.max.y;

  if (a.max.z < b.min.z) dz = b.min.z - a.max.z;
  else if (b.max.z < a.min.z) dz = a.min.z - b.max.z;

  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CLASH REPORT SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

export interface ClashSummary {
  total: number;
  bySeverity: Record<ClashSeverity, number>;
  byType: Record<ClashType, number>;
  byDiscipline: Record<string, number>;
  topClashes: ClashResult[];
}

export function summarizeClashes(clashes: ClashResult[]): ClashSummary {
  const bySeverity: Record<string, number> = { critical: 0, major: 0, minor: 0, info: 0 };
  const byType: Record<string, number> = { hard: 0, soft: 0, clearance: 0 };
  const byDiscipline: Record<string, number> = {};

  for (const c of clashes) {
    bySeverity[c.severity] = (bySeverity[c.severity] || 0) + 1;
    byType[c.type] = (byType[c.type] || 0) + 1;
    byDiscipline[c.discipline] = (byDiscipline[c.discipline] || 0) + 1;
  }

  return {
    total: clashes.length,
    bySeverity: bySeverity as Record<ClashSeverity, number>,
    byType: byType as Record<ClashType, number>,
    byDiscipline,
    topClashes: clashes.slice(0, 20),
  };
}
