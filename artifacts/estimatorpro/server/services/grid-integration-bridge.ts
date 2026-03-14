// server/services/grid-integration-bridge.ts
// ═══════════════════════════════════════════════════════════════════════════════
// GRID INTEGRATION BRIDGE
// ═══════════════════════════════════════════════════════════════════════════════
//
// Converts detected grid data from the grid detection system (WP-0 through WP-7)
// into the formats expected by each downstream consumer module.
//
// PRINCIPLE: All consumers get REAL detected geometry from the grid schema.
//            When no detected data exists, consumers get null — never synthetic
//            fallbacks. Missing data triggers RFIs per QS standards.
//
// Consumers and their expected formats:
//   1. placement-snap.ts snapToGrid()       → { x: number[], y: number[] }
//   2. structural-seed.ts                   → gridSystem array for column seeding
//   3. geometry-validator.ts compareGrids()  → GridSystem { vertical, horizontal, spacing }
//   4. real-qto-processor.ts                → GridSystem + snap grid
//   5. issue-log.ts                         → GridFinding records
//   6. estimate BOQ                         → axis label references per element
//   7. rfi-service.ts                       → conflict results from validation
//   8. bim-generator.ts                     → spacing for CWP (already wired)
//
// Standards: CIQS Standard Method, v1.1 §9 (integration)
// ═══════════════════════════════════════════════════════════════════════════════

import {
  getProjectGridSystem,
  getDetectionRunsByProject,
  getFullGridDataForRun,
} from './grid-storage';

import {
  type ValidationIssue,
} from './grid-validation-engine';

import type { GridSystem } from '../helpers/geometry-validator';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. SNAP GRID — for placement-snap.ts snapToGrid()
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get snap grid from detected data.
 * Returns { x: number[], y: number[] } or null if no grid detected.
 *
 * Consumer: placement-snap.ts snapToGrid()
 * Replaces: synthetic 6×6 grid from grid-utils.ts (eliminated in WP-0)
 */
export async function getSnapGrid(
  projectId: string,
): Promise<{ x: number[]; y: number[] } | null> {
  const system = await getProjectGridSystem(projectId);
  if (!system || system.families.length < 2) return null;

  // Family with theta ≈ 90° (vertical lines) → x positions
  // Family with theta ≈ 0° or 180° (horizontal lines) → y positions
  const xPositions: number[] = [];
  const yPositions: number[] = [];

  for (const family of system.families) {
    const theta = family.thetaDeg;
    const isVertical = theta > 80 && theta < 100;
    const isHorizontal = theta < 10 || theta > 170;

    for (const axis of family.axes) {
      if (isVertical) {
        xPositions.push(axis.offsetD);
      } else if (isHorizontal) {
        yPositions.push(axis.offsetD);
      }
    }
  }

  if (xPositions.length === 0 && yPositions.length === 0) return null;

  return {
    x: xPositions.sort((a, b) => a - b),
    y: yPositions.sort((a, b) => a - b),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. STRUCTURAL SEED GRID — for structural-seed.ts column seeding
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get grid system in the format structural-seed.ts expects for column placement.
 * Returns array of { name, x, y, orientation } or null if no grid detected.
 *
 * Consumer: structural-seed.ts seedStructuralFromAnalysis()
 * Replaces: args.analysis?.gridSystem from Claude extraction
 */
export async function getStructuralSeedGrid(
  projectId: string,
): Promise<Array<{ name: string; x: number; y: number; orientation: string }> | null> {
  const system = await getProjectGridSystem(projectId);
  if (!system || system.families.length === 0) return null;

  const gridEntries: Array<{ name: string; x: number; y: number; orientation: string }> = [];

  for (const family of system.families) {
    const theta = family.thetaDeg;
    const isVertical = theta > 80 && theta < 100;
    const isHorizontal = theta < 10 || theta > 170;
    const orientation = isVertical ? 'VERTICAL' : isHorizontal ? 'HORIZONTAL' : `ANGLE_${theta.toFixed(0)}`;

    for (const axis of family.axes) {
      gridEntries.push({
        name: axis.label ?? `AXIS_${axis.axisId.substring(0, 8)}`,
        x: isVertical ? axis.offsetD : 0,
        y: isHorizontal ? axis.offsetD : 0,
        orientation,
      });
    }
  }

  return gridEntries.length > 0 ? gridEntries : null;
}

/**
 * Get grid intersection nodes for column placement.
 * Returns { x, y, label }[] or null.
 *
 * Consumer: structural-seed.ts (column placement at intersections)
 */
export async function getGridIntersectionNodes(
  projectId: string,
): Promise<Array<{ x: number; y: number; label: string | null }> | null> {
  const system = await getProjectGridSystem(projectId);
  if (!system || system.nodes.length === 0) return null;

  return system.nodes.map(n => ({
    x: n.x,
    y: n.y,
    label: n.label,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. GEOMETRY VALIDATOR GRID — for geometry-validator.ts compareGrids()
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get detected grid in GridSystem format for geometry validation.
 * Returns { vertical, horizontal, spacing, source } or null.
 *
 * Consumer: geometry-validator.ts compareGrids()
 * Replaces: Claude-interpreted grid systems
 */
export async function getGeometryValidatorGrid(
  projectId: string,
  source: 'architectural' | 'structural' | 'combined' = 'combined',
): Promise<GridSystem | null> {
  const system = await getProjectGridSystem(projectId);
  if (!system || system.families.length === 0) return null;

  const vertical: Array<{ position: number; label: string }> = [];
  const horizontal: Array<{ position: number; label: string }> = [];
  let xSpacing: number | null = null;
  let ySpacing: number | null = null;

  for (const family of system.families) {
    const theta = family.thetaDeg;
    const isVertical = theta > 80 && theta < 100;
    const isHorizontal = theta < 10 || theta > 170;

    for (const axis of family.axes) {
      const entry = {
        position: axis.offsetD,
        label: axis.label ?? `${axis.axisId.substring(0, 6)}`,
      };

      if (isVertical) vertical.push(entry);
      else if (isHorizontal) horizontal.push(entry);
    }

    if (isVertical && family.avgSpacing > 0) xSpacing = family.avgSpacing;
    if (isHorizontal && family.avgSpacing > 0) ySpacing = family.avgSpacing;
  }

  if (vertical.length === 0 && horizontal.length === 0) return null;

  return {
    vertical: vertical.sort((a, b) => a.position - b.position),
    horizontal: horizontal.sort((a, b) => a.position - b.position),
    spacing: { x: xSpacing, y: ySpacing },
    source,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. GRID ELEMENT REFERENCE — for BOQ/estimate grid traceability
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve a position to the nearest grid reference label.
 * Returns "A-3" style reference or null if no grid detected.
 *
 * Consumer: estimate-engine BOQ line items (grid reference column)
 * Replaces: approximate Claude-derived grid references
 */
export async function resolveGridReference(
  projectId: string,
  x: number,
  y: number,
  tolerance: number = 500, // max distance to consider (in file units)
): Promise<{ reference: string; confidence: number; distance: number } | null> {
  const system = await getProjectGridSystem(projectId);
  if (!system || system.nodes.length === 0) return null;

  let bestNode: typeof system.nodes[0] | null = null;
  let bestDist = Infinity;

  for (const node of system.nodes) {
    const d = Math.sqrt((node.x - x) ** 2 + (node.y - y) ** 2);
    if (d < bestDist) {
      bestDist = d;
      bestNode = node;
    }
  }

  if (!bestNode || bestDist > tolerance) return null;

  return {
    reference: bestNode.label ?? `(${bestNode.x.toFixed(0)}, ${bestNode.y.toFixed(0)})`,
    confidence: Math.max(0.1, 1.0 - bestDist / tolerance),
    distance: bestDist,
  };
}

/**
 * Resolve the nearest axis label for a given position along one family direction.
 * Returns "A" or "3" style label or null.
 *
 * Consumer: element placement and BOQ references
 */
export async function resolveNearestAxisLabel(
  projectId: string,
  position: number,   // offset in the family's normal direction
  familyIndex: number, // 0 = primary, 1 = secondary
): Promise<{ label: string; offset: number } | null> {
  const system = await getProjectGridSystem(projectId);
  if (!system || system.families.length <= familyIndex) return null;

  const family = system.families[familyIndex];
  let bestAxis: typeof family.axes[0] | null = null;
  let bestDist = Infinity;

  for (const axis of family.axes) {
    const d = Math.abs(axis.offsetD - position);
    if (d < bestDist) {
      bestDist = d;
      bestAxis = axis;
    }
  }

  if (!bestAxis || !bestAxis.label) return null;

  return {
    label: bestAxis.label,
    offset: bestDist,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. ISSUE LOG INTEGRATION — for issue-log.ts
// ═══════════════════════════════════════════════════════════════════════════════

export interface GridFinding {
  type: 'GRID_SPACING_ANOMALY' | 'GRID_MISSING_LABEL' | 'GRID_CROSS_SHEET_MISMATCH' |
        'GRID_LOW_CONFIDENCE' | 'GRID_SEQUENCE_GAP' | 'GRID_NON_ORTHOGONAL';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  affectedGridLines: string[];
  suggestedAction: string;
  sourceRunId: string;
}

/**
 * Convert validation issues to GridFinding records for the issue log.
 *
 * Consumer: issue-log.ts
 * Replaces: no grid-specific findings (gap in previous architecture)
 */
export function convertValidationToFindings(
  issues: ValidationIssue[],
  runId: string,
): GridFinding[] {
  return issues.map(issue => {
    let findingType: GridFinding['type'] = 'GRID_LOW_CONFIDENCE';

    if (issue.code.includes('SPACING')) findingType = 'GRID_SPACING_ANOMALY';
    else if (issue.code.includes('LABEL') || issue.code.includes('UNLABELED')) findingType = 'GRID_MISSING_LABEL';
    else if (issue.code.includes('ORTHOGONAL')) findingType = 'GRID_NON_ORTHOGONAL';
    else if (issue.code.includes('MISSING_LINE')) findingType = 'GRID_SEQUENCE_GAP';

    return {
      type: findingType,
      severity: issue.severity === 'info' ? 'low' : issue.severity as any,
      title: issue.title,
      description: issue.description,
      affectedGridLines: issue.affectedEntities,
      suggestedAction: issue.suggestedAction,
      sourceRunId: runId,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. RFI SERVICE INTEGRATION — for rfi-service.ts
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convert WP-6 validation issues to RFI-compatible conflict results.
 * Wraps issuesToConflictResults from grid-validation-engine.
 *
 * Consumer: rfi-service.ts generateRFIsFromAnalysis()
 * Enhances: Phase 3.1 (which only had storey-resolver warnings)
 *           Now includes full domain/topology/labeling/confidence issues
 */
export { issuesToConflictResults } from './grid-validation-engine';

// ═══════════════════════════════════════════════════════════════════════════════
// 7. CROSS-SHEET GRID COMPARISON
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compare grids detected from different source files (sheets).
 * Returns differences for cross-sheet verification per v1.1 §9.
 *
 * Consumer: geometry-validator.ts, issue-log.ts
 * Replaces: compareGrids() comparing two Claude interpretations
 */
export async function compareDetectedGrids(
  projectId: string,
): Promise<{
  consistent: boolean;
  comparisons: Array<{
    runIdA: string;
    runIdB: string;
    sourceFileA: string;
    sourceFileB: string;
    differences: string[];
  }>;
} | null> {
  const runs = await getDetectionRunsByProject(projectId);
  const successRuns = runs.filter(r => r.status === 'SUCCESS' || r.status === 'PARTIAL');

  if (successRuns.length < 2) return null;

  const comparisons: Array<{
    runIdA: string; runIdB: string;
    sourceFileA: string; sourceFileB: string;
    differences: string[];
  }> = [];

  // Compare each pair of runs
  for (let i = 0; i < Math.min(successRuns.length, 5); i++) {
    for (let j = i + 1; j < Math.min(successRuns.length, 5); j++) {
      const runA = successRuns[i];
      const runB = successRuns[j];

      // Skip same source file
      if (runA.sourceFileId === runB.sourceFileId) continue;

      const fullA = await getFullGridDataForRun(runA.id);
      const fullB = await getFullGridDataForRun(runB.id);
      if (!fullA || !fullB) continue;

      const differences: string[] = [];

      // Compare family count
      const famCountA = fullA.components.reduce((s, c) => s + c.families.length, 0);
      const famCountB = fullB.components.reduce((s, c) => s + c.families.length, 0);
      if (famCountA !== famCountB) {
        differences.push(`Family count differs: ${famCountA} vs ${famCountB}`);
      }

      // Compare axis count per family
      const axisCountA = fullA.components.reduce((s, c) =>
        s + c.families.reduce((fs, f) => fs + f.axes.length, 0), 0);
      const axisCountB = fullB.components.reduce((s, c) =>
        s + c.families.reduce((fs, f) => fs + f.axes.length, 0), 0);
      if (Math.abs(axisCountA - axisCountB) > 1) {
        differences.push(`Axis count differs significantly: ${axisCountA} vs ${axisCountB}`);
      }

      // Compare family angles
      const anglesA = fullA.components.flatMap(c => c.families.map(f => Number(f.family.thetaDeg)));
      const anglesB = fullB.components.flatMap(c => c.families.map(f => Number(f.family.thetaDeg)));
      for (const aA of anglesA) {
        const match = anglesB.find(aB => {
          let diff = Math.abs(aA - aB);
          if (diff > 90) diff = 180 - diff;
          return diff < 5;
        });
        if (!match) {
          differences.push(`Family at ${aA.toFixed(1)}° in run A has no match in run B`);
        }
      }

      comparisons.push({
        runIdA: runA.id,
        runIdB: runB.id,
        sourceFileA: runA.sourceFileId,
        sourceFileB: runB.sourceFileId,
        differences,
      });
    }
  }

  const consistent = comparisons.every(c => c.differences.length === 0);

  return { consistent, comparisons };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. AVAILABILITY CHECK
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check if detected grid data is available for a project.
 * All consumers should call this before attempting to use grid data.
 * Returns false → consumer must fall back to generating an RFI.
 */
export async function hasDetectedGrid(projectId: string): Promise<boolean> {
  const system = await getProjectGridSystem(projectId);
  return system !== null && system.families.length >= 1 && system.families.some(f => f.axes.length >= 2);
}
