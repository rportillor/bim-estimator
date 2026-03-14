// server/services/grid-storage.ts
// ═══════════════════════════════════════════════════════════════════════════════
// GRID DETECTION STORAGE SERVICE
// ═══════════════════════════════════════════════════════════════════════════════
//
// Complete CRUD operations for the 10-table grid detection schema (v1.1 §12).
// Supports:
//   - Single and batch inserts for pipeline efficiency
//   - Full query capabilities with joins for review UI
//   - Detection run lifecycle management
//   - Grid data retrieval by project, run, component, or individual entities
//
// Consumed by: grid-detection-orchestrator (WP-2), grid-geometry-engine (WP-3),
//              label-detector (WP-4), confidence-engine (WP-6), review UI (WP-7)
//
// Standards: CIQS Standard Method, v1.1 Grid Line Recognition Specification §12
// ═══════════════════════════════════════════════════════════════════════════════

import { db } from '../db';
import { eq, and, desc, asc, inArray } from 'drizzle-orm';
import {
  gridDetectionRuns,
  gridComponents,
  gridFamilies,
  gridAxes,
  gridMarkers,
  gridLabels,
  gridAxisLabels,
  gridNodes,
  gridNodeAxes,
  gridCoordinateTransforms,
  type InsertGridDetectionRun,
  type InsertGridComponent,
  type InsertGridFamily,
  type InsertGridAxis,
  type InsertGridMarker,
  type InsertGridLabel,
  type InsertGridAxisLabel,
  type InsertGridNode,
  type InsertGridNodeAxis,
  type InsertGridCoordinateTransform,
  type GridDetectionRun,
  type GridComponent,
  type GridFamily,
  type GridAxis,
  type GridMarker,
  type GridLabel,
  type GridAxisLabel,
  type GridNode,
  type GridNodeAxis,
  type GridCoordinateTransform,
} from '@shared/schema';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. DETECTION RUNS — Lifecycle Management
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a new detection run. Call this at the start of grid detection.
 */
export async function createDetectionRun(
  data: InsertGridDetectionRun
): Promise<GridDetectionRun> {
  const [run] = await db.insert(gridDetectionRuns).values(data).returning();
  return run;
}

/**
 * Update detection run status (e.g., SUCCESS, PARTIAL, FAILED).
 */
export async function updateDetectionRunStatus(
  runId: string,
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED',
  finishedAt?: Date
): Promise<GridDetectionRun | undefined> {
  const [updated] = await db.update(gridDetectionRuns)
    .set({ status, finishedAt: finishedAt ?? new Date() })
    .where(eq(gridDetectionRuns.id, runId))
    .returning();
  return updated;
}

/**
 * Get detection run by ID.
 */
export async function getDetectionRun(runId: string): Promise<GridDetectionRun | undefined> {
  const [run] = await db.select().from(gridDetectionRuns)
    .where(eq(gridDetectionRuns.id, runId));
  return run;
}

/**
 * Get all detection runs for a project, newest first.
 */
export async function getDetectionRunsByProject(projectId: string): Promise<GridDetectionRun[]> {
  return db.select().from(gridDetectionRuns)
    .where(eq(gridDetectionRuns.projectId, projectId))
    .orderBy(desc(gridDetectionRuns.createdAt));
}

/**
 * Get the latest successful detection run for a source file.
 */
export async function getLatestRunForFile(
  sourceFileId: string
): Promise<GridDetectionRun | undefined> {
  const [run] = await db.select().from(gridDetectionRuns)
    .where(and(
      eq(gridDetectionRuns.sourceFileId, sourceFileId),
      eq(gridDetectionRuns.status, 'SUCCESS')
    ))
    .orderBy(desc(gridDetectionRuns.createdAt))
    .limit(1);
  return run;
}

/**
 * Delete a detection run and all child data (cascades via FK).
 */
export async function deleteDetectionRun(runId: string): Promise<boolean> {
  const result = await db.delete(gridDetectionRuns)
    .where(eq(gridDetectionRuns.id, runId));
  return (result?.rowCount ?? 0) > 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. GRID COMPONENTS — Connected Grid Networks
// ═══════════════════════════════════════════════════════════════════════════════

export async function createGridComponent(
  data: InsertGridComponent
): Promise<GridComponent> {
  const [comp] = await db.insert(gridComponents).values(data).returning();
  return comp;
}

export async function createGridComponents(
  data: InsertGridComponent[]
): Promise<GridComponent[]> {
  if (data.length === 0) return [];
  return db.insert(gridComponents).values(data).returning();
}

export async function getGridComponentsByRun(runId: string): Promise<GridComponent[]> {
  return db.select().from(gridComponents)
    .where(eq(gridComponents.runId, runId));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. GRID FAMILIES — Orientation Clusters
// ═══════════════════════════════════════════════════════════════════════════════

export async function createGridFamily(
  data: InsertGridFamily
): Promise<GridFamily> {
  const [family] = await db.insert(gridFamilies).values(data).returning();
  return family;
}

export async function createGridFamilies(
  data: InsertGridFamily[]
): Promise<GridFamily[]> {
  if (data.length === 0) return [];
  return db.insert(gridFamilies).values(data).returning();
}

export async function getGridFamiliesByComponent(componentId: string): Promise<GridFamily[]> {
  return db.select().from(gridFamilies)
    .where(eq(gridFamilies.componentId, componentId))
    .orderBy(asc(gridFamilies.familyRank));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. GRID AXES — Consolidated Grid Lines
// ═══════════════════════════════════════════════════════════════════════════════

export async function createGridAxis(
  data: InsertGridAxis
): Promise<GridAxis> {
  const [axis] = await db.insert(gridAxes).values(data).returning();
  return axis;
}

export async function createGridAxes(
  data: InsertGridAxis[]
): Promise<GridAxis[]> {
  if (data.length === 0) return [];
  return db.insert(gridAxes).values(data).returning();
}

export async function getGridAxesByFamily(familyId: string): Promise<GridAxis[]> {
  return db.select().from(gridAxes)
    .where(eq(gridAxes.familyId, familyId))
    .orderBy(asc(gridAxes.offsetD));
}

/**
 * Get all axes for a component (across all families), ordered by family rank then offset.
 */
export async function getGridAxesByComponent(componentId: string): Promise<GridAxis[]> {
  // Get family IDs first
  const families = await getGridFamiliesByComponent(componentId);
  if (families.length === 0) return [];

  const familyIds = families.map(f => f.id);
  return db.select().from(gridAxes)
    .where(inArray(gridAxes.familyId, familyIds))
    .orderBy(asc(gridAxes.offsetD));
}

/**
 * Update axis review status (human-in-the-loop).
 */
export async function updateGridAxisStatus(
  axisId: string,
  status: 'AUTO' | 'NEEDS_REVIEW' | 'CONFIRMED' | 'REJECTED',
  _reviewedBy?: string
): Promise<GridAxis | undefined> {
  const [updated] = await db.update(gridAxes)
    .set({ status, updatedAt: new Date() })
    .where(eq(gridAxes.id, axisId))
    .returning();
  return updated;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. GRID MARKERS — Bubble/Tag Detection
// ═══════════════════════════════════════════════════════════════════════════════

export async function createGridMarker(
  data: InsertGridMarker
): Promise<GridMarker> {
  const [marker] = await db.insert(gridMarkers).values(data).returning();
  return marker;
}

export async function createGridMarkers(
  data: InsertGridMarker[]
): Promise<GridMarker[]> {
  if (data.length === 0) return [];
  return db.insert(gridMarkers).values(data).returning();
}

export async function getGridMarkersByAxis(axisId: string): Promise<GridMarker[]> {
  return db.select().from(gridMarkers)
    .where(eq(gridMarkers.axisId, axisId));
}

/**
 * Associate a marker with an axis.
 */
export async function setMarkerAxisAssociation(
  markerId: string,
  axisId: string | null
): Promise<GridMarker | undefined> {
  const [updated] = await db.update(gridMarkers)
    .set({ axisId })
    .where(eq(gridMarkers.id, markerId))
    .returning();
  return updated;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. GRID LABELS — Extracted Text Tokens
// ═══════════════════════════════════════════════════════════════════════════════

export async function createGridLabel(
  data: InsertGridLabel
): Promise<GridLabel> {
  const [label] = await db.insert(gridLabels).values(data).returning();
  return label;
}

export async function createGridLabels(
  data: InsertGridLabel[]
): Promise<GridLabel[]> {
  if (data.length === 0) return [];
  return db.insert(gridLabels).values(data).returning();
}

export async function getGridLabelsByMarker(markerId: string): Promise<GridLabel[]> {
  return db.select().from(gridLabels)
    .where(eq(gridLabels.markerId, markerId));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. GRID AXIS LABELS — Association Table with Scoring
// ═══════════════════════════════════════════════════════════════════════════════

export async function createGridAxisLabel(
  data: InsertGridAxisLabel
): Promise<GridAxisLabel> {
  const [assoc] = await db.insert(gridAxisLabels).values(data).returning();
  return assoc;
}

export async function createGridAxisLabels(
  data: InsertGridAxisLabel[]
): Promise<GridAxisLabel[]> {
  if (data.length === 0) return [];
  return db.insert(gridAxisLabels).values(data).returning();
}

/**
 * Get all label associations for an axis, ordered by score descending.
 */
export async function getGridAxisLabelsByAxis(axisId: string): Promise<GridAxisLabel[]> {
  return db.select().from(gridAxisLabels)
    .where(eq(gridAxisLabels.axisId, axisId))
    .orderBy(desc(gridAxisLabels.scoreTotal));
}

/**
 * Get the confirmed or highest-scoring label for an axis.
 */
export async function getAxisPrimaryLabel(axisId: string): Promise<GridAxisLabel | undefined> {
  // First try CONFIRMED
  const [confirmed] = await db.select().from(gridAxisLabels)
    .where(and(
      eq(gridAxisLabels.axisId, axisId),
      eq(gridAxisLabels.status, 'CONFIRMED')
    ))
    .limit(1);

  if (confirmed) return confirmed;

  // Fall back to highest-scoring AUTO
  const [best] = await db.select().from(gridAxisLabels)
    .where(and(
      eq(gridAxisLabels.axisId, axisId),
      eq(gridAxisLabels.status, 'AUTO')
    ))
    .orderBy(desc(gridAxisLabels.scoreTotal))
    .limit(1);

  return best;
}

/**
 * Update axis-label association status (human-in-the-loop).
 */
export async function updateGridAxisLabelStatus(
  axisLabelId: string,
  status: 'AUTO' | 'NEEDS_REVIEW' | 'CONFIRMED' | 'REJECTED',
  reviewedBy?: string,
  reviewNotes?: string
): Promise<GridAxisLabel | undefined> {
  const [updated] = await db.update(gridAxisLabels)
    .set({
      status,
      reviewedBy: reviewedBy ?? null,
      reviewedAt: reviewedBy ? new Date() : null,
      reviewNotes: reviewNotes ?? null,
      updatedAt: new Date()
    })
    .where(eq(gridAxisLabels.id, axisLabelId))
    .returning();
  return updated;
}

/**
 * Get all associations needing review.
 */
export async function getGridAxisLabelsNeedingReview(
  runId: string
): Promise<GridAxisLabel[]> {
  // Walk: run → components → families → axes → axis_labels
  const components = await getGridComponentsByRun(runId);
  if (components.length === 0) return [];

  const allAxes: GridAxis[] = [];
  for (const comp of components) {
    const axes = await getGridAxesByComponent(comp.id);
    allAxes.push(...axes);
  }

  if (allAxes.length === 0) return [];

  const axisIds = allAxes.map(a => a.id);
  return db.select().from(gridAxisLabels)
    .where(and(
      inArray(gridAxisLabels.axisId, axisIds),
      eq(gridAxisLabels.status, 'NEEDS_REVIEW')
    ))
    .orderBy(asc(gridAxisLabels.scoreTotal));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. GRID NODES — Intersection Points
// ═══════════════════════════════════════════════════════════════════════════════

export async function createGridNode(
  data: InsertGridNode
): Promise<GridNode> {
  const [node] = await db.insert(gridNodes).values(data).returning();
  return node;
}

export async function createGridNodes(
  data: InsertGridNode[]
): Promise<GridNode[]> {
  if (data.length === 0) return [];
  return db.insert(gridNodes).values(data).returning();
}

export async function getGridNodesByComponent(componentId: string): Promise<GridNode[]> {
  return db.select().from(gridNodes)
    .where(eq(gridNodes.componentId, componentId))
    .orderBy(asc(gridNodes.referenceLabel));
}

/**
 * Find a grid node by reference label (e.g., "A-1", "B-04").
 */
export async function getGridNodeByLabel(
  componentId: string,
  referenceLabel: string
): Promise<GridNode | undefined> {
  const [node] = await db.select().from(gridNodes)
    .where(and(
      eq(gridNodes.componentId, componentId),
      eq(gridNodes.referenceLabel, referenceLabel)
    ));
  return node;
}

/**
 * Update node reference label (after label association is resolved).
 */
export async function updateGridNodeLabel(
  nodeId: string,
  referenceLabel: string
): Promise<GridNode | undefined> {
  const [updated] = await db.update(gridNodes)
    .set({ referenceLabel })
    .where(eq(gridNodes.id, nodeId))
    .returning();
  return updated;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. GRID NODE AXES — Link Table
// ═══════════════════════════════════════════════════════════════════════════════

export async function createGridNodeAxis(
  data: InsertGridNodeAxis
): Promise<GridNodeAxis> {
  const [link] = await db.insert(gridNodeAxes).values(data).returning();
  return link;
}

export async function createGridNodeAxesBatch(
  data: InsertGridNodeAxis[]
): Promise<GridNodeAxis[]> {
  if (data.length === 0) return [];
  return db.insert(gridNodeAxes).values(data).returning();
}

export async function getAxesForNode(nodeId: string): Promise<GridNodeAxis[]> {
  return db.select().from(gridNodeAxes)
    .where(eq(gridNodeAxes.nodeId, nodeId));
}

export async function getNodesForAxis(axisId: string): Promise<GridNodeAxis[]> {
  return db.select().from(gridNodeAxes)
    .where(eq(gridNodeAxes.axisId, axisId));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. COORDINATE TRANSFORMS
// ═══════════════════════════════════════════════════════════════════════════════

export async function createCoordinateTransform(
  data: InsertGridCoordinateTransform
): Promise<GridCoordinateTransform> {
  const [transform] = await db.insert(gridCoordinateTransforms).values(data).returning();
  return transform;
}

export async function getCoordinateTransforms(
  projectId: string
): Promise<GridCoordinateTransform[]> {
  return db.select().from(gridCoordinateTransforms)
    .where(eq(gridCoordinateTransforms.projectId, projectId));
}

export async function getTransformForFile(
  sourceFileId: string,
  fromFrame: string,
  toFrame: string
): Promise<GridCoordinateTransform | undefined> {
  const [transform] = await db.select().from(gridCoordinateTransforms)
    .where(and(
      eq(gridCoordinateTransforms.sourceFileId, sourceFileId),
      eq(gridCoordinateTransforms.fromFrame, fromFrame as any),
      eq(gridCoordinateTransforms.toFrame, toFrame as any)
    ));
  return transform;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPOSITE QUERIES — Full Grid Retrieval for Review UI and Downstream
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Full grid data structure for a detection run.
 * Returns the complete hierarchy: components → families → axes (with labels) → nodes.
 */
export interface FullGridData {
  run: GridDetectionRun;
  components: Array<{
    component: GridComponent;
    families: Array<{
      family: GridFamily;
      axes: Array<{
        axis: GridAxis;
        labels: Array<{
          association: GridAxisLabel;
          label: GridLabel;
          marker: GridMarker | null;
        }>;
      }>;
    }>;
    nodes: Array<{
      node: GridNode;
      axisIds: string[];
    }>;
  }>;
  transforms: GridCoordinateTransform[];
}

/**
 * Retrieve complete grid data for a detection run.
 * This is the primary query for the review UI (WP-7).
 */
export async function getFullGridDataForRun(runId: string): Promise<FullGridData | null> {
  const run = await getDetectionRun(runId);
  if (!run) return null;

  const components = await getGridComponentsByRun(runId);
  const transforms = await getCoordinateTransforms(run.projectId);

  const componentData = await Promise.all(components.map(async (component) => {
    const families = await getGridFamiliesByComponent(component.id);

    const familyData = await Promise.all(families.map(async (family) => {
      const axes = await getGridAxesByFamily(family.id);

      const axisData = await Promise.all(axes.map(async (axis) => {
        const associations = await getGridAxisLabelsByAxis(axis.id);

        const labelData = await Promise.all(associations.map(async (assoc) => {
          const [label] = await db.select().from(gridLabels)
            .where(eq(gridLabels.id, assoc.labelId));

          let marker: GridMarker | null = null;
          if (label?.markerId) {
            const [m] = await db.select().from(gridMarkers)
              .where(eq(gridMarkers.id, label.markerId));
            marker = m ?? null;
          }

          return { association: assoc, label, marker };
        }));

        return { axis, labels: labelData };
      }));

      return { family, axes: axisData };
    }));

    // Get nodes for this component
    const nodes = await getGridNodesByComponent(component.id);
    const nodeData = await Promise.all(nodes.map(async (node) => {
      const links = await getAxesForNode(node.id);
      return { node, axisIds: links.map(l => l.axisId) };
    }));

    return { component, families: familyData, nodes: nodeData };
  }));

  return { run, components: componentData, transforms };
}

/**
 * Get grid statistics for a detection run (for dashboard display).
 */
export interface GridRunStats {
  runId: string;
  status: string;
  componentCount: number;
  familyCount: number;
  axisCount: number;
  labeledAxisCount: number;
  nodeCount: number;
  markerCount: number;
  needsReviewCount: number;
  avgConfidence: number;
}

export async function getGridRunStats(runId: string): Promise<GridRunStats | null> {
  const run = await getDetectionRun(runId);
  if (!run) return null;

  const components = await getGridComponentsByRun(runId);
  let familyCount = 0;
  let axisCount = 0;
  let labeledAxisCount = 0;
  let nodeCount = 0;
  let markerCount = 0;
  let needsReviewCount = 0;
  let totalConfidence = 0;
  let confidenceItems = 0;

  for (const comp of components) {
    const families = await getGridFamiliesByComponent(comp.id);
    familyCount += families.length;

    for (const family of families) {
      const axes = await getGridAxesByFamily(family.id);
      axisCount += axes.length;

      for (const axis of axes) {
        totalConfidence += Number(axis.confidence);
        confidenceItems++;

        if (axis.status === 'NEEDS_REVIEW') needsReviewCount++;

        const labels = await getGridAxisLabelsByAxis(axis.id);
        if (labels.length > 0) labeledAxisCount++;

        const markers = await getGridMarkersByAxis(axis.id);
        markerCount += markers.length;
      }
    }

    const nodes = await getGridNodesByComponent(comp.id);
    nodeCount += nodes.length;
  }

  return {
    runId,
    status: run.status,
    componentCount: components.length,
    familyCount,
    axisCount,
    labeledAxisCount,
    nodeCount,
    markerCount,
    needsReviewCount,
    avgConfidence: confidenceItems > 0 ? totalConfidence / confidenceItems : 0,
  };
}

/**
 * Get the latest confirmed grid system for a project.
 * Returns simplified grid spacing data suitable for element placement.
 * This replaces the hardcoded 8m fallback in CWP.
 */
export interface ProjectGridSystem {
  runId: string;
  sourceFileId: string;
  families: Array<{
    familyId: string;
    thetaDeg: number;
    axes: Array<{
      axisId: string;
      label: string | null;
      offsetD: number;
      confidence: number;
    }>;
    spacings: number[];    // Calculated from consecutive axis offsets
    avgSpacing: number;
  }>;
  nodes: Array<{
    label: string | null;
    x: number;
    y: number;
  }>;
}

export async function getProjectGridSystem(
  projectId: string
): Promise<ProjectGridSystem | null> {
  // Get latest successful run
  const runs = await getDetectionRunsByProject(projectId);
  const latestRun = runs.find(r => r.status === 'SUCCESS' || r.status === 'PARTIAL');
  if (!latestRun) return null;

  const components = await getGridComponentsByRun(latestRun.id);
  if (components.length === 0) return null;

  // Use first (main) component
  const mainComponent = components[0];
  const families = await getGridFamiliesByComponent(mainComponent.id);

  const familyData = await Promise.all(families.map(async (family) => {
    const axes = await getGridAxesByFamily(family.id);

    const axisData = await Promise.all(axes.map(async (axis) => {
      const primaryLabel = await getAxisPrimaryLabel(axis.id);
      let labelText: string | null = null;
      if (primaryLabel) {
        const [label] = await db.select().from(gridLabels)
          .where(eq(gridLabels.id, primaryLabel.labelId));
        labelText = label?.normText ?? label?.rawText ?? null;
      }

      return {
        axisId: axis.id,
        label: labelText,
        offsetD: Number(axis.offsetD),
        confidence: Number(axis.confidence),
      };
    }));

    // Calculate spacings from consecutive offsets
    const offsets = axisData.map(a => a.offsetD).sort((a, b) => a - b);
    const spacings: number[] = [];
    for (let i = 1; i < offsets.length; i++) {
      spacings.push(Math.abs(offsets[i] - offsets[i - 1]));
    }
    const avgSpacing = spacings.length > 0
      ? spacings.reduce((s, v) => s + v, 0) / spacings.length
      : 0;

    return {
      familyId: family.id,
      thetaDeg: Number(family.thetaDeg),
      axes: axisData,
      spacings,
      avgSpacing,
    };
  }));

  const nodes = await getGridNodesByComponent(mainComponent.id);
  const nodeData = nodes.map(n => ({
    label: n.referenceLabel,
    x: Number(n.x),
    y: Number(n.y),
  }));

  return {
    runId: latestRun.id,
    sourceFileId: latestRun.sourceFileId,
    families: familyData,
    nodes: nodeData,
  };
}
