// server/pipeline/grid-bay-zones.ts
// Partitions the building into grid bays and assigns candidates to zones
// for local matching. A grid bay is the rectangle formed by two adjacent
// alpha gridlines and two adjacent numeric gridlines.

import type { GridData, GridAxis } from './stage-types';
import type { BIMCandidate, CandidateSet } from './candidate-types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GridBay {
  id: string;  // e.g. "A-B/1-2"
  alphaStart: string;
  alphaEnd: string;
  numericStart: string;
  numericEnd: string;
  bounds: {
    minX: number; maxX: number;
    minY: number; maxY: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get the effective position of a gridline, accounting for angle.
 * For orthogonal gridlines, this is just position_m.
 * For angled gridlines, we use the base position (the position where
 * the gridline crosses its own axis).
 */
function effectivePosition(g: GridAxis): number {
  return g.position_m;
}

/**
 * Sort gridlines by position, returning a new sorted array.
 */
function sortedByPosition(gridlines: GridAxis[]): GridAxis[] {
  return [...gridlines].sort((a, b) => effectivePosition(a) - effectivePosition(b));
}

/**
 * Get the position of a candidate in model space.
 * Returns null if position cannot be determined.
 */
function getCandidatePosition(candidate: BIMCandidate): { x: number; y: number } | null {
  switch (candidate.type) {
    case 'wall': {
      // Use the midpoint of start/end if available
      if (candidate.start_m && candidate.end_m) {
        return {
          x: (candidate.start_m.x + candidate.end_m.x) / 2,
          y: (candidate.start_m.y + candidate.end_m.y) / 2,
        };
      }
      return null;
    }
    case 'door':
    case 'window':
    case 'stair':
    case 'mep':
      return candidate.position_m || null;
    case 'column':
      return candidate.position_m || null;
    case 'beam': {
      if (candidate.start_m && candidate.end_m) {
        return {
          x: (candidate.start_m.x + candidate.end_m.x) / 2,
          y: (candidate.start_m.y + candidate.end_m.y) / 2,
        };
      }
      return null;
    }
    case 'slab': {
      // Use centroid of boundary if available
      if (candidate.boundary_m && candidate.boundary_m.length >= 3) {
        let cx = 0, cy = 0;
        for (const p of candidate.boundary_m) { cx += p.x; cy += p.y; }
        return { x: cx / candidate.boundary_m.length, y: cy / candidate.boundary_m.length };
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Check if a point falls within a bay's bounds (with tolerance for
 * elements near boundaries).
 */
function isPointInBay(
  point: { x: number; y: number },
  bay: GridBay,
  tolerance = 0.01,
): boolean {
  return (
    point.x >= bay.bounds.minX - tolerance &&
    point.x <= bay.bounds.maxX + tolerance &&
    point.y >= bay.bounds.minY - tolerance &&
    point.y <= bay.bounds.maxY + tolerance
  );
}

/**
 * Check if a line segment (start to end) passes through a bay.
 * Uses AABB intersection test.
 */
function doesSegmentIntersectBay(
  start: { x: number; y: number },
  end: { x: number; y: number },
  bay: GridBay,
  tolerance = 0.01,
): boolean {
  // AABB of the segment
  const segMinX = Math.min(start.x, end.x);
  const segMaxX = Math.max(start.x, end.x);
  const segMinY = Math.min(start.y, end.y);
  const segMaxY = Math.max(start.y, end.y);

  // AABB overlap test
  return (
    segMaxX >= bay.bounds.minX - tolerance &&
    segMinX <= bay.bounds.maxX + tolerance &&
    segMaxY >= bay.bounds.minY - tolerance &&
    segMinY <= bay.bounds.maxY + tolerance
  );
}

// ---------------------------------------------------------------------------
// Core: generate grid bays
// ---------------------------------------------------------------------------

/**
 * Generate grid bays from confirmed grid data.
 * A bay is the rectangle between two adjacent alpha gridlines and
 * two adjacent numeric gridlines.
 */
export function generateGridBays(grid: GridData): GridBay[] {
  const bays: GridBay[] = [];

  const sortedAlpha = sortedByPosition(grid.alphaGridlines);
  const sortedNumeric = sortedByPosition(grid.numericGridlines);

  if (sortedAlpha.length < 2 || sortedNumeric.length < 2) {
    return bays;
  }

  for (let ai = 0; ai < sortedAlpha.length - 1; ai++) {
    const a0 = sortedAlpha[ai];
    const a1 = sortedAlpha[ai + 1];

    for (let ni = 0; ni < sortedNumeric.length - 1; ni++) {
      const n0 = sortedNumeric[ni];
      const n1 = sortedNumeric[ni + 1];

      const minX = effectivePosition(a0);
      const maxX = effectivePosition(a1);
      const minY = effectivePosition(n0);
      const maxY = effectivePosition(n1);

      bays.push({
        id: `${a0.label}-${a1.label}/${n0.label}-${n1.label}`,
        alphaStart: a0.label,
        alphaEnd: a1.label,
        numericStart: n0.label,
        numericEnd: n1.label,
        bounds: { minX, maxX, minY, maxY },
      });
    }
  }

  return bays;
}

// ---------------------------------------------------------------------------
// Assign candidates to bays
// ---------------------------------------------------------------------------

/**
 * Assign a single candidate to its grid bay(s).
 * A candidate may belong to multiple bays if it spans across bay boundaries
 * (e.g., a long wall).
 */
export function assignCandidateToBay(
  candidate: BIMCandidate,
  bays: GridBay[],
  _grid: GridData,
): string[] {
  const matchedBays: string[] = [];
  const pos = getCandidatePosition(candidate);

  // For linear elements (walls, beams), check segment intersection
  if (candidate.type === 'wall' || candidate.type === 'beam') {
    const c = candidate as { start_m: { x: number; y: number } | null; end_m: { x: number; y: number } | null };
    if (c.start_m && c.end_m) {
      for (const bay of bays) {
        if (doesSegmentIntersectBay(c.start_m, c.end_m, bay)) {
          matchedBays.push(bay.id);
        }
      }
      if (matchedBays.length > 0) return matchedBays;
    }
  }

  // For slab elements, check if any boundary point is in the bay
  if (candidate.type === 'slab' && candidate.boundary_m && candidate.boundary_m.length >= 3) {
    for (const bay of bays) {
      const anyInside = candidate.boundary_m.some(p => isPointInBay(p, bay));
      if (anyInside) matchedBays.push(bay.id);
    }
    if (matchedBays.length > 0) return matchedBays;
  }

  // For point-positioned elements, check containment
  if (pos) {
    for (const bay of bays) {
      if (isPointInBay(pos, bay)) {
        matchedBays.push(bay.id);
      }
    }
  }

  return matchedBays;
}

// ---------------------------------------------------------------------------
// Partition all candidates by bay
// ---------------------------------------------------------------------------

/**
 * Partition all candidates across all types into grid bays.
 * Returns a Map from bay ID to the list of candidates in that bay.
 * Candidates that cannot be assigned to any bay are placed in a
 * special "__unassigned" bucket.
 */
export function partitionByBay(
  candidates: CandidateSet,
  grid: GridData,
): Map<string, BIMCandidate[]> {
  const bays = generateGridBays(grid);
  const result = new Map<string, BIMCandidate[]>();

  // Initialize all bays
  for (const bay of bays) {
    result.set(bay.id, []);
  }
  result.set('__unassigned', []);

  // Collect all candidates into a single array
  const allCandidates: BIMCandidate[] = [
    ...candidates.walls,
    ...candidates.doors,
    ...candidates.windows,
    ...candidates.columns,
    ...candidates.slabs,
    ...candidates.beams,
    ...candidates.stairs,
    ...candidates.mep,
  ];

  for (const candidate of allCandidates) {
    const bayIds = assignCandidateToBay(candidate, bays, grid);
    if (bayIds.length === 0) {
      result.get('__unassigned')!.push(candidate);
    } else {
      for (const bayId of bayIds) {
        const list = result.get(bayId);
        if (list) {
          list.push(candidate);
        }
      }
    }
  }

  return result;
}
