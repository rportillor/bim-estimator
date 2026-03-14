/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  ADVANCED BIM ROUTES — API endpoints for Phase 1-6 features
 *  - BREP operations (CSG booleans, fillet, revolution)
 *  - Parameter editing (undo/redo, constraints, validation)
 *  - IFC 4.3 export/import (enhanced)
 *  - Clash resolution (AI-powered)
 *  - Sheet production (SVG 2D views)
 *  - Model refinement (incremental AI updates)
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { Router, type Request, type Response } from 'express';
import { storage } from '../storage';

// Phase 1: BREP Kernel
import {
  csgUnion, csgSubtract, csgIntersect,
  revolutionSolid, createDome, createSphere, createTorus,
  filletProfile, chamferProfile, loftProfiles, offsetProfile,
  extrudeAlongPath2D, createPipeElbow, createPipeReducer,
  decimateMesh, smoothMesh, meshCentroid,
} from '../bim/brep-kernel';

// Phase 2: Parameter Engine
import {
  createTransactionStack, applyEdit, applyBatchEdit,
  undoTransaction, redoTransaction, canUndo, canRedo,
  getTransactionHistory, exportTransactionLog,
  filterElements, solveConstraints, propagateWithGraph,
  type TransactionStack, type Constraint, type SelectionFilter,
} from '../bim/parameter-engine';

import { buildGraphFromElements, type RelationshipGraph } from '../bim/relationship-graph';

// Phase 4: Clash Resolution
import {
  generateResolutions, applyResolutions, generateResolutionReport,
  buildResolutionPrompt, parseAIResolutions,
  type ResolutionProposal,
} from '../bim/clash-resolver';

// Phase 5: Sheet Production
import {
  generateSheet, generateStandardSheetSet,
  type SheetConfig, type ViewOnSheet, type ViewConfig,
} from '../bim/sheet-engine';

// Phase 6: Model Refinement
import {
  diffModels, mergeModels, generateRevisionReport,
  type MergeOptions,
} from '../bim/model-refinement';

// Existing imports
import { runClashDetection, summarizeClashes } from '../bim/clash-detection';
import { exportBIMToIFC4 } from '../bim/ifc-export-v2';
import { importIFC } from '../bim/ifc-import-engine';
import type { BIMSolid } from '../bim/parametric-elements';
import { vec2 } from '../bim/geometry-kernel';

export const advancedBimRouter = Router();

// ═══════════════════════════════════════════════════════════════════════════════
//  IN-MEMORY STATE — Per-model transaction stacks and constraints
// ═══════════════════════════════════════════════════════════════════════════════

const modelTransactionStacks = new Map<string, TransactionStack>();
const modelConstraints = new Map<string, Constraint[]>();
const modelElements = new Map<string, Map<string, BIMSolid>>();
const modelGraphs = new Map<string, RelationshipGraph>();

function getOrCreateStack(modelId: string): TransactionStack {
  if (!modelTransactionStacks.has(modelId)) {
    modelTransactionStacks.set(modelId, createTransactionStack(200));
  }
  return modelTransactionStacks.get(modelId)!;
}

function getOrCreateConstraints(modelId: string): Constraint[] {
  if (!modelConstraints.has(modelId)) {
    modelConstraints.set(modelId, []);
  }
  return modelConstraints.get(modelId)!;
}

async function loadElementsMap(modelId: string): Promise<Map<string, BIMSolid>> {
  if (modelElements.has(modelId)) return modelElements.get(modelId)!;

  const dbElements = await storage.getBimElements(modelId);
  const map = new Map<string, BIMSolid>();

  for (const dbEl of dbElements) {
    const geom = dbEl.geometry as any;
    const props = dbEl.properties as any;
    const loc = dbEl.location as any;

    if (!geom) continue;

    const solid: BIMSolid = {
      id: dbEl.id,
      type: dbEl.elementType || 'Unknown',
      name: dbEl.name || '',
      category: (dbEl.category as BIMSolid['category']) || 'Architectural',
      storey: dbEl.storeyName || dbEl.level || 'Level 1',
      elevation: Number(dbEl.elevation) || 0,
      mesh: geom.mesh || { triangles: [] },
      boundingBox: geom.boundingBox || { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
      quantities: {
        volume: Number(dbEl.quantity) || 0,
        surfaceArea: props?.surfaceArea || 0,
        lateralArea: props?.lateralArea || 0,
        length: props?.length,
        width: props?.width,
        height: props?.height,
        thickness: props?.thickness,
      },
      material: dbEl.material || 'Unknown',
      hostedIds: Array.isArray(props?.hostedElementIds) ? props.hostedElementIds : [],
      connectedIds: [
        ...(Array.isArray(props?.connectedWallIds) ? props.connectedWallIds : []),
        ...(Array.isArray(props?.connectedColumnIds) ? props.connectedColumnIds : []),
        ...(Array.isArray(props?.supportedBeamIds) ? props.supportedBeamIds : []),
        ...(Array.isArray(props?.boundingWallIds) ? props.boundingWallIds : []),
      ],
      origin: loc?.origin || { x: 0, y: 0, z: 0 },
      rotation: loc?.rotation || 0,
      ifcClass: props?.ifcClass || 'IFCBUILDINGELEMENTPROXY',
      ifcGuid: dbEl.ifcGuid || dbEl.id,
      source: 'ai_modeled',
      lod: (dbEl.lod as BIMSolid['lod']) || undefined,
      phase: dbEl.phaseId ? {
        phaseId: dbEl.phaseId,
        phaseName: dbEl.phaseName || '',
        createdPhase: dbEl.createdPhase || undefined,
        demolishedPhase: dbEl.demolishedPhase || undefined,
      } : undefined,
      workset: dbEl.worksetId ? {
        worksetId: dbEl.worksetId,
        worksetName: dbEl.worksetName || '',
        discipline: (dbEl.discipline as any) || 'Architectural',
        isEditable: true,
      } : undefined,
      revision: dbEl.revisionNumber != null ? {
        revisionNumber: dbEl.revisionNumber,
        revisionId: `rev_${dbEl.revisionNumber}`,
        action: (dbEl.revisionAction as any) || 'unchanged',
      } : undefined,
    };

    map.set(dbEl.id, solid);
  }

  // Second pass: populate hostedIds on host elements by reverse-looking up hostWallId
  for (const dbEl of dbElements) {
    const props = dbEl.properties as any;
    const hostId = props?.hostWallId;
    if (hostId && map.has(hostId)) {
      const host = map.get(hostId)!;
      if (!host.hostedIds.includes(dbEl.id)) {
        host.hostedIds.push(dbEl.id);
      }
    }
  }

  // Auto-create constraints from established relationships
  const autoConstraints = buildConstraintsFromRelationships(map);
  if (autoConstraints.length > 0) {
    const existing = modelConstraints.get(modelId) || [];
    // Merge: only add constraints not already present (by id)
    const existingIds = new Set(existing.map(c => c.id));
    for (const c of autoConstraints) {
      if (!existingIds.has(c.id)) existing.push(c);
    }
    modelConstraints.set(modelId, existing);
  }

  // Build and cache the relationship graph for constraint propagation
  const graph = buildGraphFromElements(map);
  modelGraphs.set(modelId, graph);
  console.log(`🔗 [GRAPH] Built relationship graph: ${graph.nodeCount} nodes, ${graph.edgeCount} edges`);

  modelElements.set(modelId, map);
  return map;
}

/**
 * Auto-create active constraints from the relationships established by
 * relationship-engine.ts. This bridges the gap between descriptive
 * relationships and active constraint propagation.
 */
function buildConstraintsFromRelationships(elements: Map<string, BIMSolid>): Constraint[] {
  const constraints: Constraint[] = [];

  for (const [id, el] of elements) {
    // Hosted constraints: doors/windows in walls
    for (const hostedId of el.hostedIds) {
      constraints.push({
        id: `hosted_${id}_${hostedId}`,
        type: 'hosted',
        elementIds: [id, hostedId],
        parameters: {},
        priority: 8,
        isActive: true,
      });
    }

    // Wall-wall coincident constraints at join points
    const elType = el.type.toLowerCase();
    if (/wall|partition/i.test(elType)) {
      for (const connId of el.connectedIds) {
        const conn = elements.get(connId);
        if (!conn || !/wall|partition/i.test(conn.type.toLowerCase())) continue;
        // Only create once per pair (sorted ID order)
        if (id > connId) continue;
        constraints.push({
          id: `wall_join_${id}_${connId}`,
          type: 'coincident',
          elementIds: [id, connId],
          parameters: {},
          priority: 6,
          isActive: true,
        });
      }
    }

    // Beam-column distance constraints (beam endpoint stays at column center)
    if (/beam|girder|joist/i.test(elType)) {
      for (const connId of el.connectedIds) {
        const conn = elements.get(connId);
        if (!conn || !/column|pillar|pier/i.test(conn.type.toLowerCase())) continue;
        const dist = Math.hypot(el.origin.x - conn.origin.x, el.origin.y - conn.origin.y);
        constraints.push({
          id: `beam_col_${id}_${connId}`,
          type: 'distance',
          elementIds: [connId, id], // column is anchor, beam adjusts
          parameters: { distance: dist },
          priority: 5,
          isActive: true,
        });
      }
    }
  }

  return constraints;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PHASE 2: PARAMETER EDITING ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/bim/models/:modelId/edit
 * Edit a single property on an element.
 */
advancedBimRouter.post('/bim/models/:modelId/edit', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const { elementId, property, value } = req.body;

    if (!elementId || !property) {
      return res.status(400).json({ error: 'elementId and property are required' });
    }

    const elements = await loadElementsMap(modelId);
    const stack = getOrCreateStack(modelId);
    const constraints = getOrCreateConstraints(modelId);
    const userId = (req as any).user?.id || 'anonymous';

    const result = applyEdit(elementId, property, value, elements, stack, constraints, userId);

    if (!result.success) {
      return res.status(400).json({ error: 'Validation failed', errors: result.validationErrors });
    }

    res.json({
      success: true,
      transaction: result.transaction ? {
        id: result.transaction.id,
        description: result.transaction.description,
        changeCount: result.transaction.changes.length,
        propagatedCount: result.transaction.propagatedChanges.length,
      } : null,
      affectedElements: result.affectedElementIds,
      constraintResult: result.constraintResult,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bim/models/:modelId/batch-edit
 * Edit multiple properties in a single transaction.
 */
advancedBimRouter.post('/bim/models/:modelId/batch-edit', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const { edits, description } = req.body;

    if (!Array.isArray(edits) || edits.length === 0) {
      return res.status(400).json({ error: 'edits array is required' });
    }

    const elements = await loadElementsMap(modelId);
    const stack = getOrCreateStack(modelId);
    const constraints = getOrCreateConstraints(modelId);
    const userId = (req as any).user?.id || 'anonymous';

    const result = applyBatchEdit(edits, elements, stack, constraints, userId, description);

    if (!result.success) {
      return res.status(400).json({ error: 'Validation failed', errors: result.validationErrors });
    }

    res.json({
      success: true,
      affectedElements: result.affectedElementIds,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bim/models/:modelId/undo
 */
advancedBimRouter.post('/bim/models/:modelId/undo', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const elements = await loadElementsMap(modelId);
    const stack = getOrCreateStack(modelId);

    if (!canUndo(stack)) {
      return res.status(400).json({ error: 'Nothing to undo' });
    }

    const tx = undoTransaction(stack, elements);
    res.json({
      success: true,
      undone: tx ? { id: tx.id, description: tx.description } : null,
      canUndo: canUndo(stack),
      canRedo: canRedo(stack),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bim/models/:modelId/redo
 */
advancedBimRouter.post('/bim/models/:modelId/redo', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const elements = await loadElementsMap(modelId);
    const stack = getOrCreateStack(modelId);

    if (!canRedo(stack)) {
      return res.status(400).json({ error: 'Nothing to redo' });
    }

    const tx = redoTransaction(stack, elements);
    res.json({
      success: true,
      redone: tx ? { id: tx.id, description: tx.description } : null,
      canUndo: canUndo(stack),
      canRedo: canRedo(stack),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/bim/models/:modelId/history
 * Get transaction history.
 */
advancedBimRouter.get('/bim/models/:modelId/history', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const stack = getOrCreateStack(modelId);
    const history = getTransactionHistory(stack);

    res.json({
      history,
      canUndo: canUndo(stack),
      canRedo: canRedo(stack),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bim/models/:modelId/constraints
 * Add or update constraints.
 */
advancedBimRouter.post('/bim/models/:modelId/constraints', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const { constraints: newConstraints } = req.body;

    if (!Array.isArray(newConstraints)) {
      return res.status(400).json({ error: 'constraints array is required' });
    }

    const existing = getOrCreateConstraints(modelId);
    for (const c of newConstraints) {
      const idx = existing.findIndex(e => e.id === c.id);
      if (idx >= 0) existing[idx] = c;
      else existing.push(c);
    }
    modelConstraints.set(modelId, existing);

    // Solve constraints
    const elements = await loadElementsMap(modelId);
    const result = solveConstraints(existing, elements);

    res.json({ success: true, constraintCount: existing.length, solverResult: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bim/models/:modelId/filter
 * Filter elements by criteria.
 */
advancedBimRouter.post('/bim/models/:modelId/filter', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const filter: SelectionFilter = req.body;

    const elements = await loadElementsMap(modelId);
    const filtered = filterElements(elements, filter);

    res.json({
      count: filtered.length,
      elements: filtered.map(el => ({
        id: el.id,
        type: el.type,
        name: el.name,
        category: el.category,
        storey: el.storey,
        material: el.material,
        lod: el.lod,
        phase: el.phase,
        workset: el.workset,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PHASE 4: CLASH RESOLUTION ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/bim/models/:modelId/clash-resolve
 * Detect clashes and generate resolution proposals.
 */
advancedBimRouter.post('/bim/models/:modelId/clash-resolve', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const config = req.body.config || {};

    const elements = await loadElementsMap(modelId);
    const elArray = [...elements.values()];

    // Run clash detection
    const clashes = runClashDetection(elArray, config);

    // Generate resolution proposals
    const batch = generateResolutions(clashes, elements);

    res.json({
      clashes: summarizeClashes(clashes),
      resolutions: {
        proposalCount: batch.proposalCount,
        autoResolvable: batch.autoResolvable,
        requiresReview: batch.requiresReview,
        unresolvable: batch.unresolvable,
        estimatedTotalCost: batch.estimatedTotalCost,
        proposals: batch.proposals,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bim/models/:modelId/clash-apply
 * Apply approved resolution proposals.
 */
advancedBimRouter.post('/bim/models/:modelId/clash-apply', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const { proposals } = req.body;

    if (!Array.isArray(proposals)) {
      return res.status(400).json({ error: 'proposals array is required' });
    }

    const elements = await loadElementsMap(modelId);
    const result = applyResolutions(proposals, elements);

    res.json({
      applied: result.applied.length,
      skipped: result.skipped.length,
      modifications: result.modifications.length,
      newElements: result.newElements.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PHASE 5: SHEET PRODUCTION ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/bim/models/:modelId/sheets/generate
 * Generate a custom sheet with specified views.
 */
advancedBimRouter.post('/bim/models/:modelId/sheets/generate', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const { config, views } = req.body;

    if (!config || !views) {
      return res.status(400).json({ error: 'config and views are required' });
    }

    const elements = await loadElementsMap(modelId);
    const elArray = [...elements.values()];

    const sheet = generateSheet(elArray, config, views);

    res.setHeader('Content-Type', 'application/json');
    res.json({
      id: sheet.id,
      svg: sheet.svg,
      svgLength: sheet.svg.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bim/models/:modelId/sheets/standard-set
 * Generate a complete standard sheet set (plans, sections, elevations).
 */
advancedBimRouter.post('/bim/models/:modelId/sheets/standard-set', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const { projectName, projectNumber } = req.body;

    const elements = await loadElementsMap(modelId);
    const elArray = [...elements.values()];

    // Get storeys from elements
    const storeyMap = new Map<string, number>();
    for (const el of elArray) {
      if (!storeyMap.has(el.storey)) {
        storeyMap.set(el.storey, el.elevation);
      }
    }
    const storeys = [...storeyMap.entries()]
      .sort(([, a], [, b]) => a - b)
      .map(([name, elevation]) => ({ name, elevation }));

    const sheets = generateStandardSheetSet(
      elArray,
      projectName || 'Project',
      projectNumber || 'P001',
      storeys,
    );

    res.json({
      sheetCount: sheets.length,
      sheets: sheets.map(s => ({
        id: s.id,
        title: s.config.titleBlock.sheetTitle,
        number: s.config.titleBlock.sheetNumber,
        svgLength: s.svg.length,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/bim/models/:modelId/sheets/:sheetId/svg
 * Download a specific sheet as SVG.
 */
advancedBimRouter.get('/bim/models/:modelId/sheets/:sheetId/svg', async (req: Request, res: Response) => {
  try {
    // Sheets are generated on-the-fly; this endpoint re-generates
    // In production, sheets would be cached
    return res.status(501).json({
      error: 'Sheet caching not yet implemented. Use POST /sheets/generate to get SVG inline.',
      hint: 'The generate endpoint returns the SVG content directly in the response.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PHASE 6: MODEL REFINEMENT ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/bim/models/:modelId/diff
 * Compare current model against a new set of elements.
 */
advancedBimRouter.post('/bim/models/:modelId/diff', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const { newElements, revisionNumber, revisionId } = req.body;

    if (!Array.isArray(newElements)) {
      return res.status(400).json({ error: 'newElements array is required' });
    }

    const elements = await loadElementsMap(modelId);
    const oldArray = [...elements.values()];

    const diff = diffModels(oldArray, newElements, revisionNumber || 1, revisionId || `rev_${Date.now()}`);

    res.json({
      summary: diff.summary,
      timestamp: diff.timestamp,
      diffs: diff.diffs.filter(d => d.action !== 'unchanged'),
      unmatched: diff.unmatched,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bim/models/:modelId/merge
 * Merge new model data into existing model.
 */
advancedBimRouter.post('/bim/models/:modelId/merge', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const { newElements, revisionNumber, revisionId, options, userEditedProperties } = req.body;

    if (!Array.isArray(newElements)) {
      return res.status(400).json({ error: 'newElements array is required' });
    }

    const elements = await loadElementsMap(modelId);
    const oldArray = [...elements.values()];

    // Convert user edited properties from JSON to Map<string, Set<string>>
    const editMap = new Map<string, Set<string>>();
    if (userEditedProperties && typeof userEditedProperties === 'object') {
      for (const [elId, props] of Object.entries(userEditedProperties)) {
        editMap.set(elId, new Set(props as string[]));
      }
    }

    const result = mergeModels(
      oldArray,
      newElements,
      editMap,
      revisionNumber || 1,
      revisionId || `rev_${Date.now()}`,
      options,
    );

    // Update element cache
    const newMap = new Map(result.mergedElements.map(e => [e.id, e]));
    modelElements.set(modelId, newMap);

    res.json({
      summary: result.diffResult.summary,
      appliedChanges: result.appliedChanges,
      preservedEdits: result.preservedEdits,
      conflicts: result.conflicts,
      mergedElementCount: result.mergedElements.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/bim/models/:modelId/revision-report
 * Get the latest revision report.
 */
advancedBimRouter.get('/bim/models/:modelId/revision-report', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const elements = await loadElementsMap(modelId);

    // Generate report from element revision states
    const revElements = [...elements.values()].filter(e => e.revision);
    const latestRevision = revElements.length > 0
      ? Math.max(...revElements.map(e => e.revision!.revisionNumber))
      : 0;

    res.json({
      latestRevision,
      elementCount: elements.size,
      byRevisionAction: {
        added: revElements.filter(e => e.revision?.action === 'added').length,
        modified: revElements.filter(e => e.revision?.action === 'modified').length,
        deleted: revElements.filter(e => e.revision?.action === 'deleted').length,
        unchanged: revElements.filter(e => e.revision?.action === 'unchanged').length,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PHASE 1: BREP OPERATIONS ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/bim/brep/boolean
 * Perform CSG boolean operation between two meshes.
 */
advancedBimRouter.post('/bim/brep/boolean', async (req: Request, res: Response) => {
  try {
    const { operation, meshA, meshB } = req.body;

    if (!operation || !meshA || !meshB) {
      return res.status(400).json({ error: 'operation, meshA, and meshB are required' });
    }

    // Reconstruct meshes from serialized format
    const { deserializeMesh, serializeMesh } = await import('../bim/geometry-kernel');
    const mA = deserializeMesh(meshA);
    const mB = deserializeMesh(meshB);

    let result;
    switch (operation) {
      case 'union': result = csgUnion(mA, mB); break;
      case 'subtract': result = csgSubtract(mA, mB); break;
      case 'intersect': result = csgIntersect(mA, mB); break;
      default: return res.status(400).json({ error: `Unknown operation: ${operation}` });
    }

    res.json({
      mesh: serializeMesh(result),
      triangleCount: result.triangles.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  IFC ENHANCED ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/bim/models/:modelId/ifc/export
 * Export model to IFC4 STEP file.
 */
advancedBimRouter.post('/bim/models/:modelId/ifc/export', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const options = req.body.options || {};

    const elements = await loadElementsMap(modelId);
    const elArray = [...elements.values()];

    const ifc = exportBIMToIFC4(elArray, options);

    res.setHeader('Content-Type', 'application/x-step');
    res.setHeader('Content-Disposition', `attachment; filename="model_${modelId}.ifc"`);
    res.send(ifc);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bim/models/:modelId/ifc/import
 * Import IFC file into model.
 */
advancedBimRouter.post('/bim/models/:modelId/ifc/import', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'IFC content string is required' });
    }

    const result = importIFC(content);

    // Store imported elements
    const elements = await loadElementsMap(modelId);
    for (const el of result.elements) {
      elements.set(el.id, el);
    }

    res.json({
      imported: result.elements.length,
      storeys: result.storeys,
      projectName: result.projectName,
      stats: result.stats,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  UTILITY ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/bim/models/:modelId/save
 * Persist in-memory element changes back to database.
 */
advancedBimRouter.post('/bim/models/:modelId/save', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const elements = modelElements.get(modelId);

    if (!elements) {
      return res.status(404).json({ error: 'No model loaded in memory' });
    }

    const dbElements = [...elements.values()].map(el => ({
      id: el.id,
      modelId,
      elementType: el.type,
      elementId: el.id,
      name: el.name,
      geometry: { mesh: null, boundingBox: el.boundingBox }, // mesh too large for jsonb
      properties: {
        ifcClass: el.ifcClass,
        height: el.quantities.height,
        width: el.quantities.width,
        length: el.quantities.length,
        thickness: el.quantities.thickness,
        surfaceArea: el.quantities.surfaceArea,
        lateralArea: el.quantities.lateralArea,
      },
      location: { origin: el.origin, rotation: el.rotation },
      category: el.category,
      material: el.material,
      quantity: el.quantities.volume?.toString(),
      unit: 'm³',
      storeyName: el.storey,
      elevation: el.elevation?.toString(),
      ifcGuid: el.ifcGuid,
      lod: el.lod,
      phaseId: el.phase?.phaseId,
      phaseName: el.phase?.phaseName,
      createdPhase: el.phase?.createdPhase,
      demolishedPhase: el.phase?.demolishedPhase,
      worksetId: el.workset?.worksetId,
      worksetName: el.workset?.worksetName,
      discipline: el.workset?.discipline,
      revisionNumber: el.revision?.revisionNumber,
      revisionAction: el.revision?.action,
      rebarData: el.rebar,
      connectionData: el.connections,
    }));

    await storage.upsertBimElements(modelId, dbElements);

    res.json({ saved: dbElements.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/bim/models/:modelId/cache
 * Clear in-memory cache for a model.
 */
advancedBimRouter.delete('/bim/models/:modelId/cache', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    modelElements.delete(modelId);
    modelTransactionStacks.delete(modelId);
    modelConstraints.delete(modelId);
    res.json({ cleared: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  STRUCTURAL & ENERGY ANALYSIS ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

import {
  extractStructuralModel, runStructuralAnalysis,
  runEnergyAnalysis, generateAnalysisReport,
} from '../bim/structural-analysis';

/**
 * POST /api/bim/models/:modelId/analyze/structural
 * Run structural frame analysis on the model
 */
advancedBimRouter.post('/bim/models/:modelId/analyze/structural', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const { loadCase = 'envelope' } = req.body;
    const elements = await loadElementsMap(modelId);

    const { nodes, members } = extractStructuralModel([...elements.values()]);
    const result = runStructuralAnalysis(nodes, members, loadCase);

    res.json({
      nodes: nodes.length,
      members: members.length,
      loadCombination: result.loadCombination,
      maxUtilization: result.maxUtilization,
      maxDisplacement: result.maxDisplacement,
      isStable: result.isStable,
      memberForces: result.memberForces,
      displacements: result.displacements,
      reactions: result.reactions,
      warnings: result.warnings,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bim/models/:modelId/analyze/energy
 * Run envelope energy/thermal analysis
 */
advancedBimRouter.post('/bim/models/:modelId/analyze/energy', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const { climateZone, heatingDegreeDays, coolingDegreeDays, designTempDiff } = req.body;
    const elements = await loadElementsMap(modelId);

    const result = runEnergyAnalysis([...elements.values()], {
      climateZone, heatingDegreeDays, coolingDegreeDays, designTempDiff,
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bim/models/:modelId/analyze/full
 * Run combined structural + energy analysis
 */
advancedBimRouter.post('/bim/models/:modelId/analyze/full', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const { climateZone, loadCase = 'envelope' } = req.body;
    const elements = await loadElementsMap(modelId);
    const solids = [...elements.values()];

    const { nodes, members } = extractStructuralModel(solids);
    const structural = runStructuralAnalysis(nodes, members, loadCase);
    const energy = runEnergyAnalysis(solids, { climateZone });
    const report = generateAnalysisReport(structural, energy);

    res.json({
      structural: {
        nodes: nodes.length,
        members: members.length,
        maxUtilization: structural.maxUtilization,
        maxDisplacement: structural.maxDisplacement,
        isStable: structural.isStable,
        memberForces: structural.memberForces,
        warnings: structural.warnings,
      },
      energy: {
        totalEnvelopeArea: energy.totalEnvelopeArea,
        averageUValue: energy.averageUValue,
        peakHeatingLoad: energy.peakHeatingLoad,
        annualHeatingEnergy: energy.annualHeatingEnergy,
        complianceStatus: energy.complianceStatus,
        complianceNotes: energy.complianceNotes,
      },
      report,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  ROUND-TRIP ELEMENT EDITING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * PATCH /api/bim/models/:modelId/elements/:elementId
 * Update a single element's properties (round-trip editing from 3D viewer).
 * Propagates constraints (wall auto-joins, hosted elements move with hosts).
 */
advancedBimRouter.patch('/bim/models/:modelId/elements/:elementId', async (req: Request, res: Response) => {
  try {
    const { modelId, elementId } = req.params;
    const updates = req.body; // { property, value } or { edits: [{property, value}] }
    const elements = await loadElementsMap(modelId);
    const element = elements.get(elementId);

    if (!element) {
      return res.status(404).json({ error: `Element ${elementId} not found` });
    }

    // Record transaction for undo
    let stack = modelTransactionStacks.get(modelId);
    if (!stack) {
      stack = createTransactionStack();
      modelTransactionStacks.set(modelId, stack);
    }

    const constraints = modelConstraints.get(modelId) || [];

    // Apply edits - support single or batch
    const edits: Array<{ property: string; value: any }> = updates.edits
      || [{ property: updates.property || 'material', value: updates.value }];

    let lastResult: any = null;
    for (const edit of edits) {
      lastResult = applyEdit(
        edit.property === 'material' ? elementId : elementId,
        edit.property,
        edit.value,
        elements,
        stack,
        constraints,
      );
    }

    // Return updated element
    const updatedElement = elements.get(elementId);

    res.json({
      element: updatedElement,
      success: lastResult?.success ?? true,
      affectedElementIds: lastResult?.affectedElementIds || [],
      canUndo: canUndo(stack),
      canRedo: canRedo(stack),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bim/models/:modelId/elements/:elementId/move
 * Move an element with full graph-based constraint propagation.
 * Returns all affected elements with their updated positions so the
 * client can update meshes in bulk — like Revit's move tool.
 */
advancedBimRouter.post('/bim/models/:modelId/elements/:elementId/move', async (req: Request, res: Response) => {
  try {
    const { modelId, elementId } = req.params;
    const { position, rotation } = req.body; // { position: {x,y,z}, rotation?: number }
    const elements = await loadElementsMap(modelId);
    const element = elements.get(elementId);

    if (!element) {
      return res.status(404).json({ error: `Element ${elementId} not found` });
    }

    const graph = modelGraphs.get(modelId);
    const oldOrigin = { ...element.origin };
    const oldRotation = element.rotation;
    const newOrigin = {
      x: position?.x ?? oldOrigin.x,
      y: position?.y ?? oldOrigin.y,
      z: position?.z ?? oldOrigin.z,
    };
    const newRotation = rotation ?? oldRotation;

    // Record transaction
    let stack = modelTransactionStacks.get(modelId);
    if (!stack) {
      stack = createTransactionStack();
      modelTransactionStacks.set(modelId, stack);
    }

    // Apply the primary move
    const primaryChanges: Array<{ elementId: string; property: string; oldValue: any; newValue: any }> = [];
    if (newOrigin.x !== oldOrigin.x) {
      primaryChanges.push({ elementId, property: 'origin.x', oldValue: oldOrigin.x, newValue: newOrigin.x });
      element.origin = { ...element.origin, x: newOrigin.x };
    }
    if (newOrigin.y !== oldOrigin.y) {
      primaryChanges.push({ elementId, property: 'origin.y', oldValue: oldOrigin.y, newValue: newOrigin.y });
      element.origin = { ...element.origin, y: newOrigin.y };
    }
    if (newOrigin.z !== oldOrigin.z) {
      primaryChanges.push({ elementId, property: 'origin.z', oldValue: oldOrigin.z, newValue: newOrigin.z });
      element.origin = { ...element.origin, z: newOrigin.z };
    }
    if (newRotation !== oldRotation) {
      primaryChanges.push({ elementId, property: 'rotation', oldValue: oldRotation, newValue: newRotation });
      element.rotation = newRotation;
    }

    // Propagate through relationship graph (BFS with loop prevention)
    let propagatedChanges: Array<{ elementId: string; property: string; oldValue: any; newValue: any }> = [];
    if (graph) {
      propagatedChanges = propagateWithGraph(
        elementId, oldOrigin, newOrigin, oldRotation, newRotation,
        elements, graph, 5,
      );
    }

    // Also run constraint solver for any remaining constraint types
    const constraints = modelConstraints.get(modelId) || [];
    const constraintResult = solveConstraints(constraints, elements, 5, 0.01);

    // Collect all affected elements with their new positions
    const affectedIds = new Set<string>([elementId]);
    for (const c of propagatedChanges) affectedIds.add(c.elementId);
    for (const c of constraintResult.adjustments) affectedIds.add(c.elementId);

    const affectedElements: Record<string, { origin: any; rotation: number }> = {};
    for (const aid of affectedIds) {
      const el = elements.get(aid);
      if (el) affectedElements[aid] = { origin: { ...el.origin }, rotation: el.rotation };
    }

    res.json({
      success: true,
      movedElement: { origin: { ...element.origin }, rotation: element.rotation },
      affectedElementIds: [...affectedIds],
      affectedElements,
      propagatedCount: propagatedChanges.length,
      constraintAdjustments: constraintResult.adjustments.length,
      converged: constraintResult.converged,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/bim/models/:modelId/elements/:elementId
 * Get a single element's full data (for property panel)
 */
advancedBimRouter.get('/bim/models/:modelId/elements/:elementId', async (req: Request, res: Response) => {
  try {
    const { modelId, elementId } = req.params;
    const elements = await loadElementsMap(modelId);
    const element = elements.get(elementId);

    if (!element) {
      return res.status(404).json({ error: `Element ${elementId} not found` });
    }

    res.json({ element });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
