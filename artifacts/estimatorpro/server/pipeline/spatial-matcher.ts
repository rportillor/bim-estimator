// server/pipeline/spatial-matcher.ts
// Matches drawing candidates to projected model elements using geometric,
// semantic, and topological scoring. Works within grid bays for locality.

import type { BIMCandidate } from './candidate-types';
import type { Projected2DElement } from './view-projection';
import type { GridBay } from './grid-bay-zones';
import type { GridData } from './stage-types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MatchScore {
  geometryScore: number;    // 0-1: IoU, distance, size similarity
  semanticScore: number;    // 0-1: tag match, type match
  topologyScore: number;    // 0-1: adjacency, grid proximity
  totalScore: number;       // weighted combination
  details: string[];        // human-readable breakdown
}

export interface MatchResult {
  candidateId: string;
  matchedElementId: string | null;
  score: MatchScore;
  bay: string;  // grid bay where match occurred
  status: 'matched' | 'ambiguous' | 'unmatched';
  alternatives: Array<{ elementId: string; score: number }>;
}

// ---------------------------------------------------------------------------
// Score weights
// ---------------------------------------------------------------------------

const GEOMETRY_WEIGHT = 0.50;
const SEMANTIC_WEIGHT = 0.35;
const TOPOLOGY_WEIGHT = 0.15;

const MATCH_THRESHOLD = 0.6;
const AMBIGUOUS_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// Helpers: extract candidate metadata for comparison
// ---------------------------------------------------------------------------

function getCandidateCentroid(c: BIMCandidate): { x: number; y: number } | null {
  switch (c.type) {
    case 'wall':
      if (c.start_m && c.end_m) {
        return { x: (c.start_m.x + c.end_m.x) / 2, y: (c.start_m.y + c.end_m.y) / 2 };
      }
      return null;
    case 'door':
    case 'window':
    case 'stair':
    case 'mep':
      return c.position_m || null;
    case 'column':
      return c.position_m || null;
    case 'beam':
      if (c.start_m && c.end_m) {
        return { x: (c.start_m.x + c.end_m.x) / 2, y: (c.start_m.y + c.end_m.y) / 2 };
      }
      return null;
    case 'slab':
      if (c.boundary_m && c.boundary_m.length >= 3) {
        let cx = 0, cy = 0;
        for (const p of c.boundary_m) { cx += p.x; cy += p.y; }
        return { x: cx / c.boundary_m.length, y: cy / c.boundary_m.length };
      }
      return null;
    default:
      return null;
  }
}

function getCandidateSize(c: BIMCandidate): { width: number; height: number } {
  switch (c.type) {
    case 'wall':
      if (c.start_m && c.end_m) {
        const dx = c.end_m.x - c.start_m.x;
        const dy = c.end_m.y - c.start_m.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const thickness = (c.thickness_mm || 200) / 1000;
        return { width: length, height: thickness };
      }
      return { width: 1, height: 0.2 };
    case 'door':
      return {
        width: (c.width_mm || 900) / 1000,
        height: (c.thickness_mm || 50) / 1000,
      };
    case 'window':
      return {
        width: (c.width_mm || 1200) / 1000,
        height: 0.05,
      };
    case 'column':
      return {
        width: (c.width_mm || 400) / 1000,
        height: (c.depth_mm || 400) / 1000,
      };
    case 'beam':
      if (c.start_m && c.end_m) {
        const dx = c.end_m.x - c.start_m.x;
        const dy = c.end_m.y - c.start_m.y;
        return { width: Math.sqrt(dx * dx + dy * dy), height: (c.width_mm || 300) / 1000 };
      }
      return { width: 1, height: 0.3 };
    case 'slab':
      return { width: 10, height: 10 }; // slabs are large
    case 'stair':
      return {
        width: (c.width_mm || 1000) / 1000,
        height: (c.length_mm || 3000) / 1000,
      };
    case 'mep':
      return { width: 0.3, height: 0.3 };
    default:
      return { width: 1, height: 1 };
  }
}

function getCandidateMark(c: BIMCandidate): string | null {
  switch (c.type) {
    case 'wall': return c.wall_type_code || null;
    case 'door': return c.mark || null;
    case 'window': return c.mark || null;
    case 'column': return c.size_string || null;
    case 'beam': return c.size_string || null;
    default: return null;
  }
}

function getGridRef(c: BIMCandidate): string | null {
  switch (c.type) {
    case 'wall': {
      const parts: string[] = [];
      if (c.gridStart) parts.push(`${c.gridStart.alpha}-${c.gridStart.numeric}`);
      if (c.gridEnd) parts.push(`${c.gridEnd.alpha}-${c.gridEnd.numeric}`);
      return parts.length > 0 ? parts.join('/') : null;
    }
    case 'door': return c.gridNearest ? `${c.gridNearest.alpha}-${c.gridNearest.numeric}` : null;
    case 'window': return c.gridNearest ? `${c.gridNearest.alpha}-${c.gridNearest.numeric}` : null;
    case 'column': return c.gridPosition ? `${c.gridPosition.alpha}-${c.gridPosition.numeric}` : null;
    case 'beam': {
      const parts: string[] = [];
      if (c.gridStart) parts.push(`${c.gridStart.alpha}-${c.gridStart.numeric}`);
      if (c.gridEnd) parts.push(`${c.gridEnd.alpha}-${c.gridEnd.numeric}`);
      return parts.length > 0 ? parts.join('/') : null;
    }
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Geometry scoring
// ---------------------------------------------------------------------------

function computeGeometryScore(
  c: BIMCandidate,
  p: Projected2DElement,
): { score: number; details: string[] } {
  const details: string[] = [];
  let score = 0;

  const cCenter = getCandidateCentroid(c);
  const cSize = getCandidateSize(c);

  // 1. Centroid distance (normalized by bay size -- use 20m as reference scale)
  if (cCenter) {
    const dist = Math.sqrt(
      (cCenter.x - p.centroid.x) ** 2 + (cCenter.y - p.centroid.y) ** 2,
    );
    const normalizedDist = dist / 20; // 20m reference
    const distScore = Math.max(0, 1 - normalizedDist);
    score += distScore * 0.4;
    details.push(`centroid distance: ${dist.toFixed(2)}m (score: ${distScore.toFixed(2)})`);
  }

  // 2. Size similarity (width ratio)
  const widthRatio = Math.min(cSize.width, p.width) / Math.max(cSize.width, p.width, 0.01);
  score += widthRatio * 0.3;
  details.push(`width ratio: ${widthRatio.toFixed(2)}`);

  // 3. Height similarity in plan (depth/thickness)
  const heightRatio = Math.min(cSize.height, p.height) / Math.max(cSize.height, p.height, 0.01);
  score += heightRatio * 0.3;
  details.push(`height ratio: ${heightRatio.toFixed(2)}`);

  return { score: Math.min(1, score), details };
}

// ---------------------------------------------------------------------------
// Semantic scoring
// ---------------------------------------------------------------------------

function computeSemanticScore(
  c: BIMCandidate,
  p: Projected2DElement,
): { score: number; details: string[] } {
  const details: string[] = [];
  let score = 0;

  // 1. Type match
  const candidateType = c.type.toLowerCase();
  const projectedType = p.elementType.toLowerCase();
  if (candidateType === projectedType) {
    score += 0.3;
    details.push('type: exact match');
  } else {
    details.push(`type: mismatch (${candidateType} vs ${projectedType})`);
  }

  // 2. Mark/tag match
  const candidateMark = getCandidateMark(c);
  const projectedMark = String(p.properties.mark || p.properties.wall_type_code || p.properties.size_string || '');

  if (candidateMark && projectedMark) {
    const cNorm = candidateMark.toUpperCase().replace(/[\s-]/g, '');
    const pNorm = projectedMark.toUpperCase().replace(/[\s-]/g, '');

    if (cNorm === pNorm) {
      score += 0.7;
      details.push(`mark: exact match "${candidateMark}"`);
    } else if (cNorm.includes(pNorm) || pNorm.includes(cNorm)) {
      score += 0.5;
      details.push(`mark: partial match "${candidateMark}" ~ "${projectedMark}"`);
    } else {
      details.push(`mark: no match "${candidateMark}" vs "${projectedMark}"`);
    }
  } else if (candidateMark || projectedMark) {
    details.push(`mark: only one has mark`);
  }

  return { score: Math.min(1, score), details };
}

// ---------------------------------------------------------------------------
// Topology scoring
// ---------------------------------------------------------------------------

function computeTopologyScore(
  c: BIMCandidate,
  p: Projected2DElement,
  grid: GridData,
): { score: number; details: string[] } {
  const details: string[] = [];
  let score = 0;

  // 1. Grid line proximity: check if both are on the same grid line
  const gridRef = getGridRef(c);
  if (gridRef) {
    score += 0.3;
    details.push(`on grid: ${gridRef}`);
  }

  // 2. Same bay (always true when matching within a bay)
  score += 0.2;
  details.push('same bay: yes');

  // 3. Host relationship: door on wall, window on wall
  if (c.type === 'door' || c.type === 'window') {
    const hostWallType = c.type === 'door' ? c.host_wall_type : c.host_wall_type;
    if (hostWallType) {
      // Check if there's a matching wall in the projected elements' properties
      const pWallType = String(p.properties.wall_type_code || '');
      if (pWallType && hostWallType.toUpperCase() === pWallType.toUpperCase()) {
        score += 0.3;
        details.push(`host wall match: ${hostWallType}`);
      }
    }
  }

  // 4. Column at grid intersection
  if (c.type === 'column' && c.gridPosition) {
    // Columns at grid intersections get a topology bonus
    score += 0.2;
    details.push(`column at grid intersection: ${c.gridPosition.alpha}-${c.gridPosition.numeric}`);
  }

  return { score: Math.min(1, score), details };
}

// ---------------------------------------------------------------------------
// Public: compute match score
// ---------------------------------------------------------------------------

/**
 * Compute a composite match score between a candidate and a projected element.
 */
export function computeMatchScore(
  candidate: BIMCandidate,
  projected: Projected2DElement,
  grid?: GridData,
): MatchScore {
  const geom = computeGeometryScore(candidate, projected);
  const sem = computeSemanticScore(candidate, projected);
  const topo = grid
    ? computeTopologyScore(candidate, projected, grid)
    : { score: 0, details: ['no grid data'] };

  const totalScore =
    geom.score * GEOMETRY_WEIGHT +
    sem.score * SEMANTIC_WEIGHT +
    topo.score * TOPOLOGY_WEIGHT;

  return {
    geometryScore: geom.score,
    semanticScore: sem.score,
    topologyScore: topo.score,
    totalScore,
    details: [...geom.details, ...sem.details, ...topo.details],
  };
}

// ---------------------------------------------------------------------------
// Public: match candidates to projected elements
// ---------------------------------------------------------------------------

/**
 * Match candidates to projected elements within grid bays.
 * For each candidate, find the best-scoring projected element.
 */
export function matchCandidatesToElements(
  candidates: BIMCandidate[],
  projectedElements: Projected2DElement[],
  bays: GridBay[],
  grid: GridData,
): MatchResult[] {
  const results: MatchResult[] = [];

  for (const candidate of candidates) {
    const candidatePos = getCandidateCentroid(candidate);

    // Determine which bay(s) this candidate is in
    let candidateBay = '__unassigned';
    if (candidatePos) {
      for (const bay of bays) {
        if (
          candidatePos.x >= bay.bounds.minX &&
          candidatePos.x <= bay.bounds.maxX &&
          candidatePos.y >= bay.bounds.minY &&
          candidatePos.y <= bay.bounds.maxY
        ) {
          candidateBay = bay.id;
          break;
        }
      }
    }

    // Score this candidate against all projected elements
    const scoredMatches: Array<{ elementId: string; score: MatchScore }> = [];
    for (const projected of projectedElements) {
      const score = computeMatchScore(candidate, projected, grid);
      scoredMatches.push({ elementId: projected.elementId, score });
    }

    // Sort by total score descending
    scoredMatches.sort((a, b) => b.score.totalScore - a.score.totalScore);

    const best = scoredMatches[0];

    if (!best || best.score.totalScore < AMBIGUOUS_THRESHOLD) {
      // Unmatched
      results.push({
        candidateId: candidate.candidateId,
        matchedElementId: null,
        score: best?.score || {
          geometryScore: 0,
          semanticScore: 0,
          topologyScore: 0,
          totalScore: 0,
          details: ['no projected elements to match'],
        },
        bay: candidateBay,
        status: 'unmatched',
        alternatives: scoredMatches.slice(0, 3).map(m => ({
          elementId: m.elementId,
          score: m.score.totalScore,
        })),
      });
    } else if (best.score.totalScore >= MATCH_THRESHOLD) {
      // Matched
      results.push({
        candidateId: candidate.candidateId,
        matchedElementId: best.elementId,
        score: best.score,
        bay: candidateBay,
        status: 'matched',
        alternatives: scoredMatches.slice(1, 4).map(m => ({
          elementId: m.elementId,
          score: m.score.totalScore,
        })),
      });
    } else {
      // Ambiguous
      results.push({
        candidateId: candidate.candidateId,
        matchedElementId: best.elementId,
        score: best.score,
        bay: candidateBay,
        status: 'ambiguous',
        alternatives: scoredMatches.slice(0, 4).map(m => ({
          elementId: m.elementId,
          score: m.score.totalScore,
        })),
      });
    }
  }

  return results;
}
