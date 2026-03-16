// server/pipeline/candidate-review.ts
// Collects unresolved candidates and creates review items / RFIs.
// Integrates with the existing RFI system from rfi-generator.ts.

import type {
  CandidateSet,
  BIMCandidate,
  ResolutionStats,
  WallCandidate,
  DoorCandidate,
  WindowCandidate,
  ColumnCandidate,
  SlabCandidate,
  BeamCandidate,
  StairCandidate,
  MEPCandidate,
} from './candidate-types';

import {
  registerMissingData,
  generateAllRFIs,
  type MissingDataItem,
  type MissingDataCategory,
  type ImpactLevel,
} from '../estimator/rfi-generator';

import { storage } from '../storage';
import { logger } from '../utils/enterprise-logger';

// ---------------------------------------------------------------------------
// Collect all unresolved candidates
// ---------------------------------------------------------------------------

export function collectUnresolved(candidates: CandidateSet): BIMCandidate[] {
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

  return allCandidates.filter(c => c.status !== 'complete');
}

// ---------------------------------------------------------------------------
// Map candidate status to RFI missing data category
// ---------------------------------------------------------------------------

function statusToCategory(status: string, elementType: string): MissingDataCategory {
  switch (status) {
    case 'missing_thickness':
    case 'missing_height':
    case 'missing_width':
    case 'missing_position':
      return 'dimension';
    case 'needs_review':
      return 'detail';
    case 'unresolved':
      return 'detail';
    default:
      return 'dimension';
  }
}

function elementTypeToCSIDivision(type: string): string {
  switch (type) {
    case 'wall': return '09';       // Finishes / Gypsum
    case 'door': return '08';       // Openings
    case 'window': return '08';     // Openings
    case 'column': return '03';     // Concrete (or 05 for steel)
    case 'slab': return '03';       // Concrete
    case 'beam': return '05';       // Metals
    case 'stair': return '03';      // Concrete
    case 'mep': return '23';        // HVAC (default for MEP)
    default: return '01';           // General Requirements
  }
}

function statusToImpact(status: string): ImpactLevel {
  switch (status) {
    case 'missing_position':
      return 'critical';
    case 'missing_thickness':
    case 'missing_height':
    case 'missing_width':
      return 'high';
    case 'needs_review':
      return 'medium';
    case 'unresolved':
      return 'high';
    default:
      return 'medium';
  }
}

// ---------------------------------------------------------------------------
// Build human-readable description for an unresolved candidate
// ---------------------------------------------------------------------------

function buildDescription(candidate: BIMCandidate): string {
  const base = `${candidate.type} (${candidate.candidateId}) on ${candidate.storey}`;

  switch (candidate.status) {
    case 'missing_thickness':
      return `${base}: thickness could not be resolved from assembly data`;
    case 'missing_height':
      return `${base}: height could not be resolved from storey/section data`;
    case 'missing_width':
      return `${base}: width/size could not be resolved from schedule/structural data`;
    case 'missing_position':
      return `${base}: position could not be resolved from grid references`;
    case 'needs_review':
      return `${base}: resolved with low confidence evidence - needs manual verification`;
    case 'unresolved':
      return `${base}: multiple parameters missing - element could not be resolved`;
    default:
      return `${base}: status ${candidate.status}`;
  }
}

function buildDrawingRef(candidate: BIMCandidate): string | undefined {
  // Extract drawing references from evidence sources
  const docNames = candidate.evidence_sources
    .map(e => e.documentName)
    .filter(n => n !== 'grid' && n !== 'storey-data' && n !== 'assembly-data');

  if (docNames.length > 0) return docNames[0];
  return undefined;
}

// ---------------------------------------------------------------------------
// Generate review items (RFIs) from unresolved candidates
// ---------------------------------------------------------------------------

export async function generateReviewItems(
  unresolved: BIMCandidate[],
  projectId: string,
): Promise<number> {
  if (unresolved.length === 0) return 0;

  // Get project name for RFI generation
  let projectName = 'Unknown Project';
  try {
    const project = await storage.getProject(projectId);
    if (project) {
      projectName = project.name;
    }
  } catch {
    // Non-fatal — use default name
  }

  // Convert unresolved candidates to MissingDataItems
  const missingDataItems: MissingDataItem[] = unresolved.map(candidate => {
    return registerMissingData({
      category: statusToCategory(candidate.status, candidate.type),
      description: buildDescription(candidate),
      drawingRef: buildDrawingRef(candidate),
      csiDivision: elementTypeToCSIDivision(candidate.type),
      floorLabel: candidate.storey,
      impact: statusToImpact(candidate.status),
      costImpactLow: 0,   // Cannot estimate cost without dimensions
      costImpactHigh: 0,
      discoveredBy: 'IR Pipeline - Parameter Resolver',
    });
  });

  // Generate RFIs grouped by category + CSI division
  const rfis = generateAllRFIs(missingDataItems, projectName, 'IR Pipeline');

  logger.info('Candidate review: generated RFIs from unresolved candidates', {
    projectId,
    unresolvedCount: unresolved.length,
    rfiCount: rfis.length,
    missingDataCount: missingDataItems.length,
  });

  return rfis.length;
}

// ---------------------------------------------------------------------------
// Build resolution summary stats
// ---------------------------------------------------------------------------

export function buildReviewSummary(candidates: CandidateSet): ResolutionStats {
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

  const byType: Record<string, { total: number; resolved: number; unresolved: number }> = {};

  let resolved = 0;
  let needsReview = 0;
  let unresolved = 0;

  for (const c of allCandidates) {
    const typeName = c.type;
    if (!byType[typeName]) {
      byType[typeName] = { total: 0, resolved: 0, unresolved: 0 };
    }
    byType[typeName].total++;

    if (c.status === 'complete') {
      resolved++;
      byType[typeName].resolved++;
    } else if (c.status === 'needs_review') {
      needsReview++;
      byType[typeName].unresolved++;
    } else {
      unresolved++;
      byType[typeName].unresolved++;
    }
  }

  return {
    total: allCandidates.length,
    resolved,
    needsReview,
    unresolved,
    byType,
  };
}
