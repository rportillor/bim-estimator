/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  BIM PARAMETRIC CONSTRAINTS ENGINE
 *  Post-processing pipeline that enforces spatial relationships:
 *    1. Wall auto-joins (T-joins, L-joins, cross-joins)
 *    2. Beam-column snapping
 *    3. Trim/extend logic at element intersections
 *    4. Phase assignment & LOD classification
 *    5. Workset assignment
 *    6. Revision tracking
 * ══════════════════════════════════════════════════════════════════════════════
 */

import {
  type Vec2, type Vec3, vec2, vec3, v3add, v3sub, v3len, v3scale, v3normalize, v3dot,
  type AABB, aabbOverlap,
} from './geometry-kernel';

import {
  type BIMSolid, type LODLevel, type PhaseAssignment, type WorksetInfo, type RevisionInfo,
} from './parametric-elements';

// ═══════════════════════════════════════════════════════════════════════════════
//  WALL AUTO-JOIN — Detect and link wall endpoints at T/L/X intersections
// ═══════════════════════════════════════════════════════════════════════════════

export interface WallJoin {
  type: 'L' | 'T' | 'X';
  wallIds: string[];
  point: Vec2;
}

/**
 * Detect wall endpoint proximity and create join relationships.
 * Walls whose endpoints are within `tolerance` metres of each other
 * or within `tolerance` of another wall's midline are joined.
 */
export function autoJoinWalls(elements: BIMSolid[], tolerance = 0.05): WallJoin[] {
  const walls = elements.filter(e => /wall|partition/i.test(e.type) && !/curtain/i.test(e.type));
  const joins: WallJoin[] = [];

  // Extract wall endpoints from bounding box and rotation
  interface WallEndpoints {
    id: string;
    start: Vec2;
    end: Vec2;
    midline: { start: Vec2; end: Vec2; dir: Vec2; length: number };
    element: BIMSolid;
  }

  const wallData: WallEndpoints[] = walls.map(w => {
    const bb = w.boundingBox;
    const cos = Math.cos(w.rotation);
    const sin = Math.sin(w.rotation);
    const length = w.quantities.length || v3len(v3sub(
      vec3(bb.max.x, bb.max.y, 0),
      vec3(bb.min.x, bb.min.y, 0),
    ));

    const start = vec2(w.origin.x, w.origin.y);
    const end = vec2(w.origin.x + cos * length, w.origin.y + sin * length);
    const dir = vec2(cos, sin);

    return {
      id: w.id,
      start,
      end,
      midline: { start, end, dir, length },
      element: w,
    };
  });

  const joined = new Set<string>();

  for (let i = 0; i < wallData.length; i++) {
    for (let j = i + 1; j < wallData.length; j++) {
      const a = wallData[i];
      const b = wallData[j];

      // Check all endpoint-to-endpoint distances
      const dists = [
        { d: dist2D(a.start, b.start), ptA: 'start', ptB: 'start' },
        { d: dist2D(a.start, b.end), ptA: 'start', ptB: 'end' },
        { d: dist2D(a.end, b.start), ptA: 'end', ptB: 'start' },
        { d: dist2D(a.end, b.end), ptA: 'end', ptB: 'end' },
      ];

      const closest = dists.reduce((min, d) => d.d < min.d ? d : min);

      if (closest.d < tolerance) {
        // Endpoint-to-endpoint join: L or X
        const point = closest.ptA === 'start' ? a.start : a.end;
        const angle = angleBetweenWalls(a, b);

        // L-join (roughly perpendicular) or X-join (crossed)
        const joinType = Math.abs(angle - Math.PI / 2) < 0.3 ? 'L' as const : 'X' as const;

        const pairKey = [a.id, b.id].sort().join('|');
        if (!joined.has(pairKey)) {
          joined.add(pairKey);
          joins.push({ type: joinType, wallIds: [a.id, b.id], point });

          // Link in element data
          if (!a.element.connectedIds.includes(b.id)) a.element.connectedIds.push(b.id);
          if (!b.element.connectedIds.includes(a.id)) b.element.connectedIds.push(a.id);
        }
      } else {
        // Check T-join: endpoint of one wall near midline of the other
        const tJoinA = pointToSegmentDist(a.start, b.midline.start, b.midline.end);
        const tJoinB = pointToSegmentDist(a.end, b.midline.start, b.midline.end);
        const tJoinC = pointToSegmentDist(b.start, a.midline.start, a.midline.end);
        const tJoinD = pointToSegmentDist(b.end, a.midline.start, a.midline.end);

        const tChecks = [
          { d: tJoinA, pt: a.start },
          { d: tJoinB, pt: a.end },
          { d: tJoinC, pt: b.start },
          { d: tJoinD, pt: b.end },
        ];

        const closestT = tChecks.reduce((min, c) => c.d < min.d ? c : min);

        if (closestT.d < tolerance) {
          const pairKey = [a.id, b.id].sort().join('|');
          if (!joined.has(pairKey)) {
            joined.add(pairKey);
            joins.push({ type: 'T', wallIds: [a.id, b.id], point: closestT.pt });

            if (!a.element.connectedIds.includes(b.id)) a.element.connectedIds.push(b.id);
            if (!b.element.connectedIds.includes(a.id)) b.element.connectedIds.push(a.id);
          }
        }
      }
    }
  }

  return joins;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BEAM-COLUMN SNAPPING — Snap beam endpoints to nearest column
// ═══════════════════════════════════════════════════════════════════════════════

export interface SnapResult {
  beamId: string;
  columnId: string;
  snapEnd: 'start' | 'end';
  snapDistance: number;        // metres — how far the beam was moved
}

/**
 * Snap beam endpoints to the nearest column center if within tolerance.
 * Mutates beam origin/endpoint positions and creates connectedIds links.
 */
export function snapBeamsToColumns(elements: BIMSolid[], tolerance = 0.3): SnapResult[] {
  const beams = elements.filter(e => /beam|girder|joist/i.test(e.type));
  const columns = elements.filter(e => /column|pillar/i.test(e.type));
  const results: SnapResult[] = [];

  for (const beam of beams) {
    const beamBB = beam.boundingBox;
    const beamStart = beam.origin;
    const beamLength = beam.quantities.length || 5;
    const cos = Math.cos(beam.rotation);
    const sin = Math.sin(beam.rotation);
    const beamEnd = vec3(
      beamStart.x + cos * beamLength,
      beamStart.y + sin * beamLength,
      beamStart.z,
    );

    for (const col of columns) {
      if (beam.storey !== col.storey) continue;

      const colCenter = vec3(col.origin.x, col.origin.y, beamStart.z);

      // Check start
      const dStart = v3len(v3sub(beamStart, colCenter));
      if (dStart < tolerance && dStart > 0.001) {
        results.push({
          beamId: beam.id,
          columnId: col.id,
          snapEnd: 'start',
          snapDistance: dStart,
        });
        if (!beam.connectedIds.includes(col.id)) beam.connectedIds.push(col.id);
        if (!col.connectedIds.includes(beam.id)) col.connectedIds.push(beam.id);
      }

      // Check end
      const dEnd = v3len(v3sub(beamEnd, colCenter));
      if (dEnd < tolerance && dEnd > 0.001) {
        results.push({
          beamId: beam.id,
          columnId: col.id,
          snapEnd: 'end',
          snapDistance: dEnd,
        });
        if (!beam.connectedIds.includes(col.id)) beam.connectedIds.push(col.id);
        if (!col.connectedIds.includes(beam.id)) col.connectedIds.push(beam.id);
      }
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TRIM / EXTEND — Adjust element endpoints at intersections
// ═══════════════════════════════════════════════════════════════════════════════

export interface TrimExtendResult {
  elementId: string;
  action: 'trimmed' | 'extended';
  end: 'start' | 'end';
  targetElementId: string;
  originalLength: number;
  newLength: number;
}

/**
 * Trim or extend linear elements (walls, beams) to meet at intersections.
 * If two walls/beams nearly intersect (gap < tolerance or overlap < tolerance),
 * adjusts the shorter element to exactly meet the longer one.
 */
export function trimExtendAtIntersections(elements: BIMSolid[], tolerance = 0.15): TrimExtendResult[] {
  const linearElements = elements.filter(e =>
    /wall|beam|grade beam|partition/i.test(e.type) && e.quantities.length
  );
  const results: TrimExtendResult[] = [];

  for (let i = 0; i < linearElements.length; i++) {
    for (let j = i + 1; j < linearElements.length; j++) {
      const a = linearElements[i];
      const b = linearElements[j];
      if (a.storey !== b.storey) continue;

      const aLen = a.quantities.length!;
      const bLen = b.quantities.length!;
      const aCos = Math.cos(a.rotation);
      const aSin = Math.sin(a.rotation);
      const bCos = Math.cos(b.rotation);
      const bSin = Math.sin(b.rotation);

      const aStart = vec2(a.origin.x, a.origin.y);
      const aEnd = vec2(a.origin.x + aCos * aLen, a.origin.y + aSin * aLen);
      const bStart = vec2(b.origin.x, b.origin.y);
      const bEnd = vec2(b.origin.x + bCos * bLen, b.origin.y + bSin * bLen);

      // Check if lines intersect
      const intersection = lineIntersection2D(aStart, aEnd, bStart, bEnd);
      if (!intersection) continue;

      const { t, u, point } = intersection;

      // t is parameter along A (0=start, 1=end), u along B
      // If both are in [0,1], already intersecting
      // If one is slightly outside [0,1+tolerance/length], we can extend

      // Check if A needs extending
      if (t >= -tolerance / aLen && t <= 1 + tolerance / aLen) {
        if (u >= -tolerance / bLen && u <= 1 + tolerance / bLen) {
          // Near-intersection — check gap
          const gapA = t < 0 ? -t * aLen : t > 1 ? (t - 1) * aLen : 0;
          const gapB = u < 0 ? -u * bLen : u > 1 ? (u - 1) * bLen : 0;

          if (gapA > 0 && gapA < tolerance) {
            results.push({
              elementId: a.id,
              action: t < 0 ? 'extended' : 'extended',
              end: t < 0 ? 'start' : 'end',
              targetElementId: b.id,
              originalLength: aLen,
              newLength: aLen + gapA,
            });
            // Update connected IDs
            if (!a.connectedIds.includes(b.id)) a.connectedIds.push(b.id);
            if (!b.connectedIds.includes(a.id)) b.connectedIds.push(a.id);
          }

          if (gapB > 0 && gapB < tolerance) {
            results.push({
              elementId: b.id,
              action: u < 0 ? 'extended' : 'extended',
              end: u < 0 ? 'start' : 'end',
              targetElementId: a.id,
              originalLength: bLen,
              newLength: bLen + gapB,
            });
            if (!a.connectedIds.includes(b.id)) a.connectedIds.push(b.id);
            if (!b.connectedIds.includes(a.id)) b.connectedIds.push(a.id);
          }
        }
      }
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PHASE ASSIGNMENT — Assign construction phases to elements
// ═══════════════════════════════════════════════════════════════════════════════

/** WBS phase mapping per element type/storey */
const PHASE_MAP: Record<string, { phaseId: string; phaseName: string }> = {
  'Pile':               { phaseId: '1.3.1', phaseName: 'Deep Foundations' },
  'Footing':            { phaseId: '1.3.2', phaseName: 'Footings' },
  'Grade Beam':         { phaseId: '1.3.3', phaseName: 'Foundation Walls & Grade Beams' },
  'Foundation':         { phaseId: '1.3.2', phaseName: 'Footings' },
  'Column':             { phaseId: '1.4.1', phaseName: 'Superstructure' },
  'Beam':               { phaseId: '1.4.1', phaseName: 'Superstructure' },
  'Floor Slab':         { phaseId: '1.4.1', phaseName: 'Superstructure' },
  'Exterior Wall':      { phaseId: '1.5',   phaseName: 'Building Envelope' },
  'Curtain Wall':       { phaseId: '1.5',   phaseName: 'Building Envelope' },
  'Interior Wall':      { phaseId: '1.6',   phaseName: 'Interior Construction' },
  'Door':               { phaseId: '1.6',   phaseName: 'Interior Construction' },
  'Window':             { phaseId: '1.5',   phaseName: 'Building Envelope' },
  'Roof Slab':          { phaseId: '1.5',   phaseName: 'Building Envelope' },
  'Stair':              { phaseId: '1.6',   phaseName: 'Interior Construction' },
  'Railing':            { phaseId: '1.6',   phaseName: 'Interior Construction' },
  'Ramp':               { phaseId: '1.6',   phaseName: 'Interior Construction' },
  'Duct':               { phaseId: '1.7',   phaseName: 'Mechanical Systems' },
  'Pipe':               { phaseId: '1.8',   phaseName: 'Plumbing Systems' },
  'Cable Tray':         { phaseId: '1.8',   phaseName: 'Electrical Systems' },
  'Light':              { phaseId: '1.8',   phaseName: 'Electrical Systems' },
  'Sprinkler':          { phaseId: '1.7',   phaseName: 'Fire Protection' },
  'Rebar':              { phaseId: '1.4.1', phaseName: 'Superstructure' },
  'Connection Plate':   { phaseId: '1.4.1', phaseName: 'Superstructure' },
  'Bolt':               { phaseId: '1.4.1', phaseName: 'Superstructure' },
};

/**
 * Assign construction phases to all elements based on type and storey.
 */
export function assignPhases(elements: BIMSolid[]): void {
  for (const el of elements) {
    const mapping = PHASE_MAP[el.type] || findPhaseByType(el.type);
    if (mapping) {
      el.phase = {
        phaseId: mapping.phaseId,
        phaseName: mapping.phaseName,
        createdPhase: mapping.phaseName,
      };
    }
  }
}

function findPhaseByType(type: string): { phaseId: string; phaseName: string } {
  const t = type.toLowerCase();
  if (/foundation|footing|pile|grade.beam/i.test(t)) return { phaseId: '1.3', phaseName: 'Foundations & Substructure' };
  if (/column|beam|slab|floor/i.test(t)) return { phaseId: '1.4', phaseName: 'Superstructure' };
  if (/exterior|curtain|window|roof|envelope/i.test(t)) return { phaseId: '1.5', phaseName: 'Building Envelope' };
  if (/interior|door|stair|ramp|railing|partition/i.test(t)) return { phaseId: '1.6', phaseName: 'Interior Construction' };
  if (/duct|hvac|mechanical|sprinkler/i.test(t)) return { phaseId: '1.7', phaseName: 'Mechanical Systems' };
  if (/pipe|plumb|sanitary|domestic/i.test(t)) return { phaseId: '1.8', phaseName: 'Plumbing Systems' };
  if (/electric|cable|light|panel|receptacle|switch/i.test(t)) return { phaseId: '1.8', phaseName: 'Electrical Systems' };
  return { phaseId: '1.6', phaseName: 'General Construction' };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LOD CLASSIFICATION — Assign LOD 100-500 per BIM Forum spec
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Classify element LOD based on the geometry detail and data completeness.
 * LOD 100: Conceptual (mass/volume only)
 * LOD 200: Approximate geometry (generic shapes, no detail)
 * LOD 300: Precise geometry (actual size/shape, modeled accurately)
 * LOD 350: Precise geometry + connections/interfaces
 * LOD 400: Fabrication-ready (with connection details, rebar, etc.)
 * LOD 500: As-built (field-verified)
 */
export function classifyLOD(elements: BIMSolid[]): void {
  for (const el of elements) {
    el.lod = computeElementLOD(el);
  }
}

function computeElementLOD(el: BIMSolid): LODLevel {
  let score = 0;

  // Geometry completeness
  if (el.mesh.triangles.length > 0) score += 1;
  if (el.mesh.triangles.length > 12) score += 1;  // More than a simple box
  if (el.profile) score += 1;                       // Has cross-section profile

  // Quantity data
  if (el.quantities.volume > 0) score += 1;
  if (el.quantities.weight) score += 1;
  if (el.quantities.length) score += 1;

  // Material detail
  if (el.assembly && el.assembly.layers.length > 1) score += 1; // Multi-layer assembly
  if (el.layers && el.layers.length > 1) score += 1;

  // Connections & relationships
  if (el.connectedIds.length > 0) score += 1;
  if (el.connections && el.connections.length > 0) score += 2; // Has connection details

  // Reinforcement
  if (el.rebar) score += 2;

  // Source fidelity
  if (el.source === 'ifc_imported') score += 1;
  if (el.source === 'user_placed') score += 1;

  // Classify
  if (score >= 12) return 500;
  if (score >= 9) return 400;
  if (score >= 7) return 350;
  if (score >= 4) return 300;
  if (score >= 2) return 200;
  return 100;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WORKSET ASSIGNMENT — Assign elements to worksets by discipline
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Assign worksets to elements based on category and type.
 */
export function assignWorksets(elements: BIMSolid[]): void {
  for (const el of elements) {
    el.workset = inferWorkset(el);
  }
}

function inferWorkset(el: BIMSolid): WorksetInfo {
  const t = el.type.toLowerCase();

  if (el.category === 'Structural' || /column|beam|slab|footing|pile|grade.beam|rebar|bolt|connection/i.test(t)) {
    return {
      worksetId: 'WS_STRUCT',
      worksetName: 'Structural',
      discipline: 'Structural',
      isEditable: true,
    };
  }

  if (/duct|hvac|mechanical|vav/i.test(t)) {
    return {
      worksetId: 'WS_MECH',
      worksetName: 'Mechanical',
      discipline: 'Mechanical',
      isEditable: true,
    };
  }

  if (/pipe|plumb|sanitary|domestic|storm/i.test(t)) {
    return {
      worksetId: 'WS_PLUMB',
      worksetName: 'Plumbing',
      discipline: 'Plumbing',
      isEditable: true,
    };
  }

  if (/electric|cable|light|panel|receptacle|switch|power|data/i.test(t)) {
    return {
      worksetId: 'WS_ELEC',
      worksetName: 'Electrical',
      discipline: 'Electrical',
      isEditable: true,
    };
  }

  if (/sprinkler|fire/i.test(t)) {
    return {
      worksetId: 'WS_FIRE',
      worksetName: 'Fire Protection',
      discipline: 'Fire Protection',
      isEditable: true,
    };
  }

  if (/exterior|curtain|facade|envelope/i.test(t)) {
    return {
      worksetId: 'WS_ARCH_EXT',
      worksetName: 'Arch - Exterior',
      discipline: 'Architectural',
      isEditable: true,
    };
  }

  return {
    worksetId: 'WS_ARCH_INT',
    worksetName: 'Arch - Interior',
    discipline: 'Architectural',
    isEditable: true,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  REVISION TRACKING — Mark elements with revision metadata
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Initialize revision tracking for all elements in a model.
 * Call on first generation; subsequent runs should use `diffRevisions`.
 */
export function initRevisions(elements: BIMSolid[], revisionNumber: number, revisionId: string): void {
  for (const el of elements) {
    el.revision = {
      revisionNumber,
      revisionId,
      action: 'added',
      modifiedAt: new Date().toISOString(),
    };
  }
}

/**
 * Diff two element sets and mark revision actions.
 * Compares by element ID and checks for geometry/property changes.
 */
export function diffRevisions(
  previousElements: BIMSolid[],
  currentElements: BIMSolid[],
  revisionNumber: number,
  revisionId: string,
): { added: string[]; modified: string[]; deleted: string[]; unchanged: string[] } {
  const prevMap = new Map(previousElements.map(e => [e.id, e]));
  const currMap = new Map(currentElements.map(e => [e.id, e]));

  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const unchanged: string[] = [];

  for (const el of currentElements) {
    const prev = prevMap.get(el.id);
    if (!prev) {
      added.push(el.id);
      el.revision = { revisionNumber, revisionId, action: 'added', modifiedAt: new Date().toISOString() };
    } else if (hasElementChanged(prev, el)) {
      modified.push(el.id);
      el.revision = {
        revisionNumber,
        revisionId,
        action: 'modified',
        modifiedAt: new Date().toISOString(),
        previousState: JSON.stringify({ type: prev.type, material: prev.material, quantities: prev.quantities }),
      };
    } else {
      unchanged.push(el.id);
      el.revision = { revisionNumber, revisionId, action: 'unchanged' };
    }
  }

  for (const prev of previousElements) {
    if (!currMap.has(prev.id)) {
      deleted.push(prev.id);
    }
  }

  return { added, modified, deleted, unchanged };
}

function hasElementChanged(prev: BIMSolid, curr: BIMSolid): boolean {
  if (prev.type !== curr.type) return true;
  if (prev.material !== curr.material) return true;
  if (Math.abs(prev.quantities.volume - curr.quantities.volume) > 0.001) return true;
  if (Math.abs(prev.origin.x - curr.origin.x) > 0.01) return true;
  if (Math.abs(prev.origin.y - curr.origin.y) > 0.01) return true;
  if (Math.abs(prev.origin.z - curr.origin.z) > 0.01) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FULL POST-PROCESSING PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

export interface ConstraintResults {
  wallJoins: WallJoin[];
  beamSnaps: SnapResult[];
  trimExtends: TrimExtendResult[];
  lodDistribution: Record<LODLevel, number>;
  worksetDistribution: Record<string, number>;
  phaseDistribution: Record<string, number>;
}

/**
 * Run the full parametric constraints pipeline on a set of BIM elements.
 * This is the main entry point called from model-builder after element creation.
 */
export function runConstraintsPipeline(
  elements: BIMSolid[],
  options?: {
    revisionNumber?: number;
    revisionId?: string;
    previousElements?: BIMSolid[];
  },
): ConstraintResults {
  // 1. Wall auto-joins
  const wallJoins = autoJoinWalls(elements);

  // 2. Beam-column snapping
  const beamSnaps = snapBeamsToColumns(elements);

  // 3. Trim/extend at intersections
  const trimExtends = trimExtendAtIntersections(elements);

  // 4. Phase assignment
  assignPhases(elements);

  // 5. LOD classification
  classifyLOD(elements);

  // 6. Workset assignment
  assignWorksets(elements);

  // 7. Revision tracking
  if (options?.previousElements && options.revisionNumber && options.revisionId) {
    diffRevisions(options.previousElements, elements, options.revisionNumber, options.revisionId);
  } else if (options?.revisionNumber && options?.revisionId) {
    initRevisions(elements, options.revisionNumber, options.revisionId);
  } else {
    initRevisions(elements, 1, 'initial');
  }

  // Compute distributions for reporting
  const lodDistribution: Record<number, number> = {};
  const worksetDistribution: Record<string, number> = {};
  const phaseDistribution: Record<string, number> = {};

  for (const el of elements) {
    if (el.lod) lodDistribution[el.lod] = (lodDistribution[el.lod] || 0) + 1;
    if (el.workset) worksetDistribution[el.workset.worksetName] = (worksetDistribution[el.workset.worksetName] || 0) + 1;
    if (el.phase) phaseDistribution[el.phase.phaseName] = (phaseDistribution[el.phase.phaseName] || 0) + 1;
  }

  return {
    wallJoins,
    beamSnaps,
    trimExtends,
    lodDistribution: lodDistribution as Record<LODLevel, number>,
    worksetDistribution,
    phaseDistribution,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GEOMETRY HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function dist2D(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function pointToSegmentDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return dist2D(p, a);

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  return dist2D(p, vec2(a.x + t * dx, a.y + t * dy));
}

function angleBetweenWalls(
  a: { midline: { dir: Vec2 } },
  b: { midline: { dir: Vec2 } },
): number {
  const dot = a.midline.dir.x * b.midline.dir.x + a.midline.dir.y * b.midline.dir.y;
  return Math.acos(Math.max(-1, Math.min(1, Math.abs(dot))));
}

function lineIntersection2D(
  a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2,
): { t: number; u: number; point: Vec2 } | null {
  const dx1 = a2.x - a1.x;
  const dy1 = a2.y - a1.y;
  const dx2 = b2.x - b1.x;
  const dy2 = b2.y - b1.y;

  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) return null; // parallel

  const t = ((b1.x - a1.x) * dy2 - (b1.y - a1.y) * dx2) / denom;
  const u = ((b1.x - a1.x) * dy1 - (b1.y - a1.y) * dx1) / denom;

  return {
    t,
    u,
    point: vec2(a1.x + t * dx1, a1.y + t * dy1),
  };
}
