// server/routes/pipeline-routes.ts
// Express router for the sequential BIM extraction pipeline.
//
// Endpoints:
//   POST /api/bim/pipeline/:projectId/start      - Start the sequential pipeline
//   GET  /api/bim/pipeline/:modelId/status       - Get current stage + progress
//   POST /api/bim/pipeline/:modelId/confirm-grid - Confirm grid and resume
//   POST /api/bim/pipeline/:modelId/enrich       - Run enrichment pass (Path B)
//   POST /api/bim/pipeline/:modelId/run-batch    - Run a named batch from batch config

import { Router, type Request, type Response } from 'express';
import { storage } from '../storage';
import { db } from '../db';
import { logger } from '../utils/enterprise-logger';
import { SequentialPipeline } from '../pipeline/sequential-pipeline';
import type { GridData, PipelineState } from '../pipeline/stage-types';
import { updateModelStatus } from '../services/model-status';
export const pipelineRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/bim/pipeline/:projectId/start
// Start the sequential pipeline for a project.
// Body: { modelName?: string }
// ---------------------------------------------------------------------------
pipelineRouter.post('/:projectId/start', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const { modelName } = req.body || {};

  try {
    // Verify project exists
    const project = await storage.getProject(projectId).catch(() => null);
    if (!project) {
      return res.status(404).json({ ok: false, message: `Project not found: ${projectId}` });
    }

    // Get documents
    const documents = await storage.getDocuments(projectId);
    if (documents.length === 0) {
      return res.status(422).json({
        ok: false,
        message: 'No documents linked to this project. Upload drawings/specifications first.',
      });
    }

    // Find or create BIM model
    const existingModels = await storage.getBimModels(projectId);
    let modelId: string;

    if (existingModels.length > 0) {
      modelId = existingModels[0].id;
      await storage.updateBimModel(modelId, { status: 'generating' });
      logger.info('Pipeline: using existing BIM model', { modelId, projectId });
    } else {
      const newModel = await storage.createBimModel({
        projectId,
        name: modelName || `Sequential Pipeline Model - ${new Date().toISOString().split('T')[0]}`,
        status: 'generating',
        geometryData: null,
      });
      modelId = newModel.id;
      logger.info('Pipeline: created new BIM model', { modelId, projectId });
    }

    // Respond immediately, run pipeline in background
    res.json({
      ok: true,
      modelId,
      message: 'Sequential pipeline started. Poll /api/bim/pipeline/:modelId/status for progress.',
    });

    // Run the pipeline asynchronously — always reset so a COMPLETE state doesn't skip all stages
    const pipeline = new SequentialPipeline(projectId, modelId);
    await pipeline.resetState();
    const statusCallback = async (progress: number, message: string) => {
      try {
        await updateModelStatus(storage, modelId, {
          status: progress >= 1.0 ? 'completed' : 'generating',
          progress,
          message,
        });
      } catch (err) {
        logger.warn('Pipeline status update failed', { error: (err as Error).message });
      }
    };

    pipeline.run(documents, statusCallback).catch((err) => {
      logger.error('Pipeline background run failed', {
        modelId,
        projectId,
        error: (err as Error).message,
      });
      updateModelStatus(storage, modelId, {
        status: 'failed',
        progress: 1.0,
        error: (err as Error).message,
      }).catch(() => {});
    });
  } catch (err) {
    logger.error('Pipeline start failed', { projectId, error: (err as Error).message });
    res.status(500).json({ ok: false, message: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/bim/pipeline/:modelId/status
// Returns the current pipeline state: stage, results, timings, errors.
// ---------------------------------------------------------------------------
pipelineRouter.get('/:modelId/status', async (req: Request, res: Response) => {
  const { modelId } = req.params;

  try {
    const model = await storage.getBimModel(modelId);
    if (!model) {
      return res.status(404).json({ ok: false, message: `Model not found: ${modelId}` });
    }

    const meta =
      typeof model.metadata === 'string'
        ? JSON.parse(model.metadata || '{}')
        : (model.metadata || {});

    const pipelineState: PipelineState | null = meta.pipelineState || null;

    res.json({
      ok: true,
      modelId,
      modelStatus: model.status,
      pipelineState,
      // Convenience fields
      currentStage: pipelineState?.currentStage || null,
      gridConfirmed: pipelineState?.stageResults?.grid?.confirmed || false,
      elementCount: pipelineState?.stageResults?.floorPlans?.elementCount || null,
      error: pipelineState?.error || null,
      stageTimings: pipelineState?.stageTimings || {},
    });
  } catch (err) {
    logger.error('Pipeline status fetch failed', { modelId, error: (err as Error).message });
    res.status(500).json({ ok: false, message: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/bim/pipeline/:modelId/confirm-grid
// Confirm (and optionally edit) the extracted grid, then resume the pipeline.
// Body: GridData (with confirmed: true)
// ---------------------------------------------------------------------------
pipelineRouter.post('/:modelId/confirm-grid', async (req: Request, res: Response) => {
  const { modelId } = req.params;
  const gridInput = req.body;

  try {
    const model = await storage.getBimModel(modelId);
    if (!model) {
      return res.status(404).json({ ok: false, message: `Model not found: ${modelId}` });
    }

    // Load current pipeline state
    const meta =
      typeof model.metadata === 'string'
        ? JSON.parse(model.metadata || '{}')
        : (model.metadata || {});

    const pipelineState: PipelineState | null = meta.pipelineState || null;

    if (!pipelineState || pipelineState.currentStage !== 'GRID_CONFIRMATION') {
      return res.status(409).json({
        ok: false,
        message: `Pipeline is not waiting for grid confirmation. Current stage: ${pipelineState?.currentStage || 'none'}`,
      });
    }

    // Validate the incoming grid data
    const confirmedGrid: GridData = {
      alphaGridlines: Array.isArray(gridInput.alphaGridlines)
        ? gridInput.alphaGridlines
        : pipelineState.stageResults.grid?.alphaGridlines || [],
      numericGridlines: Array.isArray(gridInput.numericGridlines)
        ? gridInput.numericGridlines
        : pipelineState.stageResults.grid?.numericGridlines || [],
      alphaDirection: gridInput.alphaDirection || pipelineState.stageResults.grid?.alphaDirection || 'left_to_right',
      numericDirection: gridInput.numericDirection || pipelineState.stageResults.grid?.numericDirection || 'bottom_to_top',
      originLabel: gridInput.originLabel || pipelineState.stageResults.grid?.originLabel || { letter: 'A', number: '1' },
      notes: Array.isArray(gridInput.notes) ? gridInput.notes : pipelineState.stageResults.grid?.notes || [],
      confirmed: true,
    };

    // Get project documents for Stage 5
    const documents = await storage.getDocuments(model.projectId);

    // Respond immediately
    res.json({
      ok: true,
      modelId,
      message: 'Grid confirmed. Pipeline resuming with Stage 5 (Floor Plans).',
      gridSummary: {
        alphaGridlines: confirmedGrid.alphaGridlines.length,
        numericGridlines: confirmedGrid.numericGridlines.length,
      },
    });

    // Resume pipeline in background
    const pipeline = new SequentialPipeline(model.projectId, modelId);
    // Load existing state so the pipeline has stages 1-4 results
    await pipeline.loadState();

    const statusCallback = async (progress: number, message: string) => {
      try {
        await updateModelStatus(storage, modelId, {
          status: progress >= 1.0 ? 'completed' : 'generating',
          progress,
          message,
        });
      } catch (err) {
        logger.warn('Pipeline status update failed', { error: (err as Error).message });
      }
    };

    pipeline.resume(confirmedGrid, statusCallback, documents).catch((err) => {
      logger.error('Pipeline resume failed', {
        modelId,
        error: (err as Error).message,
      });
      updateModelStatus(storage, modelId, {
        status: 'failed',
        progress: 1.0,
        error: (err as Error).message,
      }).catch(() => {});
    });
  } catch (err) {
    logger.error('Pipeline confirm-grid failed', { modelId, error: (err as Error).message });
    res.status(500).json({ ok: false, message: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/bim/pipeline/:modelId/enrich
// Run enrichment pass on existing elements (Path B - The Moorings).
// Extracts schedules/sections/specs, then matches to existing BIM elements.
// ---------------------------------------------------------------------------
pipelineRouter.post('/:modelId/enrich', async (req: Request, res: Response) => {
  const { modelId } = req.params;

  try {
    const model = await storage.getBimModel(modelId);
    if (!model) {
      return res.status(404).json({ ok: false, message: `Model not found: ${modelId}` });
    }

    // Check that the model has existing elements
    const elements = await storage.getBimElements(modelId);
    if (elements.length === 0) {
      return res.status(422).json({
        ok: false,
        message: 'No existing elements to enrich. Use /start for a full pipeline run instead.',
      });
    }

    // Respond immediately
    res.json({
      ok: true,
      modelId,
      message: `Enrichment started for ${elements.length} existing elements. Poll /status for progress.`,
      existingElementCount: elements.length,
    });

    // Run enrichment in background
    const pipeline = new SequentialPipeline(model.projectId, modelId);
    const statusCallback = async (progress: number, message: string) => {
      try {
        await updateModelStatus(storage, modelId, {
          status: progress >= 1.0 ? 'completed' : 'generating',
          progress,
          message,
        });
      } catch (err) {
        logger.warn('Enrichment status update failed', { error: (err as Error).message });
      }
    };

    pipeline.enrichExistingElements(statusCallback).catch((err) => {
      logger.error('Enrichment background run failed', {
        modelId,
        error: (err as Error).message,
      });
      updateModelStatus(storage, modelId, {
        status: 'failed',
        progress: 1.0,
        error: (err as Error).message,
      }).catch(() => {});
    });
  } catch (err) {
    logger.error('Enrichment start failed', { modelId, error: (err as Error).message });
    res.status(500).json({ ok: false, message: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/bim/pipeline/:modelId/run-batch
// Run a specific batch from the saved batch config.
// Body: { batch: 'batch1' | 'batch2' }
//
// batch1 (support docs): runs enrichExistingElements() with filtered docs
//   → extracts schedules/sections/specs, updates existing 652 elements
// batch2 (floor plans): runs full pipeline stages 4-5 with floor plan docs
//   → grid extraction + element placement using confirmed gridlines
// ---------------------------------------------------------------------------
pipelineRouter.post('/:modelId/run-batch', async (req: Request, res: Response) => {
  const { modelId } = req.params;
  const { batch } = req.body || {};

  const validBatches = ['batch1', 'batch2', 'batch_specs'];
  if (!batch || !validBatches.includes(batch)) {
    return res.status(400).json({ ok: false, message: `Body must include { batch: "${validBatches.join('" | "')}" }` });
  }

  try {
    const model = await storage.getBimModel(modelId);
    if (!model) {
      return res.status(404).json({ ok: false, message: `Model not found: ${modelId}` });
    }

    // Load batch config from DB using the shared pool
    const rows = await (db as any).$client.query(
      "SELECT value FROM app_settings WHERE key = $1",
      ['moorings_pipeline_batch_config']
    );
    let batchConfig: any = null;
    if (rows?.rows?.[0]?.value) {
      batchConfig = JSON.parse(rows.rows[0].value);
    }

    if (!batchConfig?.batches?.[batch]) {
      return res.status(422).json({ ok: false, message: `Batch "${batch}" not found in saved batch config. Save the config first.` });
    }

    const batchDef = batchConfig.batches[batch];
    const sheetNames: string[] = (batchDef.documents || []).map((d: any) => d.name as string);

    // Load all project documents
    const allDocs = await storage.getDocuments(model.projectId);

    // Match documents to the batch's sheet list
    function sheetMatchesFilename(sheetName: string, filename: string): boolean {
      const fn = filename.toLowerCase();
      const s = sheetName.toLowerCase();

      // Try "a002 r1" → "_a002_r1_" in filename
      const spaceToUnderscore = s.replace(/\s+/g, '_');
      if (fn.includes('_' + spaceToUnderscore + '_')) return true;

      // Try just the sheet number prefix (first token before space/hyphen)
      const sheetNum = s.split(/[\s]/)[0]; // "a002" from "a002 r1"
      if (sheetNum.length >= 3 && fn.includes('_' + sheetNum + '_')) return true;

      // Handle special chars (LE-1.0 → look for "le" as prefix token)
      const alphaPart = sheetNum.replace(/[^a-z0-9]/g, '_');
      if (alphaPart.length >= 2 && fn.includes('_' + alphaPart.split('_')[0] + '_')) return true;

      // Plain include for longer unique names like "landscape"
      if (s.length >= 8 && fn.includes(s)) return true;

      return false;
    }

    const filteredDocs = allDocs.filter((doc) =>
      sheetNames.some((name) => sheetMatchesFilename(name, doc.filename))
    );

    logger.info(`Batch runner: batch="${batch}" sheets=${sheetNames.length} matched=${filteredDocs.length}`, {
      modelId,
      sheets: sheetNames,
      matched: filteredDocs.map((d) => d.filename),
    });

    if (filteredDocs.length === 0) {
      return res.status(422).json({
        ok: false,
        message: `No documents matched for ${batch}. Check that documents are uploaded and filenames match.`,
        expectedSheets: sheetNames,
        availableFilenames: allDocs.map((d) => d.filename),
      });
    }

    if (batch === 'batch1' || batch === 'batch_specs') {
      // Enrichment pass — stages 1-3 (schedules, wall sections, specs) + element matching
      // batch1 = 20 support docs; batch_specs = A004 alone (Construction Assemblies)
      const elements = await storage.getBimElements(modelId);
      if (elements.length === 0) {
        return res.status(422).json({
          ok: false,
          message: `No existing elements to enrich. "${batch}" requires existing BIM elements.`,
        });
      }

      const batchLabel = batch === 'batch1' ? 'Batch 1' : 'Spec Batch';

      // Respond immediately
      res.json({
        ok: true,
        modelId,
        batch,
        message: `${batchLabel} enrichment started: ${filteredDocs.length} document(s) → ${elements.length} elements. Poll /status for progress.`,
        documentCount: filteredDocs.length,
        existingElementCount: elements.length,
        documents: filteredDocs.map((d) => d.filename),
      });

      // Run enrichment in background with filtered docs
      const pipeline = new SequentialPipeline(model.projectId, modelId);
      const statusCallback = async (progress: number, message: string) => {
        try {
          await updateModelStatus(storage, modelId, {
            status: progress >= 1.0 ? 'completed' : 'generating',
            progress,
            message,
          });
        } catch (err) {
          logger.warn(`${batchLabel} status update failed`, { error: (err as Error).message });
        }
      };

      pipeline.enrichExistingElements(statusCallback, filteredDocs).catch((err) => {
        logger.error(`${batchLabel} enrichment failed`, { modelId, error: (err as Error).message });
        updateModelStatus(storage, modelId, {
          status: 'failed',
          progress: 1.0,
          error: (err as Error).message,
        }).catch(() => {});
      });
    } else {
      // Batch 2: floor plans — run full pipeline (stages 1-5) with floor plan docs
      // These 5 docs (A101-A203) feed grid extraction + element placement
      await storage.updateBimModel(modelId, { status: 'generating' });

      res.json({
        ok: true,
        modelId,
        batch: 'batch2',
        message: `Batch 2 pipeline started: ${filteredDocs.length} floor plan documents. Poll /status for progress.`,
        documentCount: filteredDocs.length,
        documents: filteredDocs.map((d) => d.filename),
      });

      const pipeline = new SequentialPipeline(model.projectId, modelId);
      const statusCallback = async (progress: number, message: string) => {
        try {
          await updateModelStatus(storage, modelId, {
            status: progress >= 1.0 ? 'completed' : 'generating',
            progress,
            message,
          });
        } catch (err) {
          logger.warn('Batch2 status update failed', { error: (err as Error).message });
        }
      };

      // Reset any COMPLETE/FAILED state so all 5 stages run fresh on the floor plan docs
      pipeline.resetState()
        .then(() => pipeline.run(filteredDocs, statusCallback))
        .catch((err) => {
          logger.error('Batch 2 pipeline failed', { modelId, error: (err as Error).message });
          updateModelStatus(storage, modelId, {
            status: 'failed',
            progress: 1.0,
            error: (err as Error).message,
          }).catch(() => {});
        });
    }
  } catch (err) {
    logger.error('run-batch failed', { modelId, batch, error: (err as Error).message });
    res.status(500).json({ ok: false, message: (err as Error).message });
  }
});

// POST /api/bim/pipeline/:modelId/save-confirmed-gridlines
// ---------------------------------------------------------------------------
// POST /api/bim/pipeline/:modelId/apply-stage-data
// Apply Stage 1 (door dims) + Stage 2 (wall thicknesses) results to existing
// elements without re-running Claude. Reads stageResults from model metadata.
// ---------------------------------------------------------------------------
pipelineRouter.post('/:modelId/apply-stage-data', async (req: Request, res: Response) => {
  const { modelId } = req.params;

  try {
    const model = await storage.getBimModel(modelId);
    if (!model) return res.status(404).json({ ok: false, message: `Model ${modelId} not found` });

    const meta = typeof model.metadata === 'string'
      ? (() => { try { return JSON.parse(model.metadata as string); } catch { return {}; } })()
      : (model.metadata as any) ?? {};

    const stageResults = meta?.pipelineState?.stageResults ?? {};
    const doors: any[] = stageResults?.schedules?.doors ?? [];
    // wallTypes is a keyed object: { "EW1": { code, totalThickness_mm, layers, ... } }
    const wallTypesObj: Record<string, any> = stageResults?.sections?.wallTypes ?? {};

    if (doors.length === 0 && Object.keys(wallTypesObj).length === 0) {
      return res.status(422).json({ ok: false, message: 'No stage results found — run the pipeline first.' });
    }

    // Build door lookup: mark → door record
    const doorByMark = new Map<string, any>();
    for (const d of doors) {
      const mark = (d.mark || '').toString().trim().toUpperCase();
      if (mark) doorByMark.set(mark, d);
    }

    // Build wall type lookup: code → wallType record (key is the code like "EW1", "IW1a", etc.)
    const wallTypeByCode = new Map<string, any>();
    for (const [code, wt] of Object.entries(wallTypesObj)) {
      wallTypeByCode.set(code.toString().trim().toUpperCase(), wt);
    }

    const elements = await storage.getBimElements(modelId);
    let doorsUpdated = 0;
    let wallsUpdated = 0;

    for (const el of elements) {
      const elType = (el.elementType || '').toLowerCase();
      const existingGeom: any = (() => {
        try {
          return typeof el.geometry === 'string' ? JSON.parse(el.geometry as string) : (el.geometry as any) || {};
        } catch { return {}; }
      })();
      const existingProps: any = (() => {
        try {
          return typeof el.properties === 'string' ? JSON.parse(el.properties as string) : (el.properties as any) || {};
        } catch { return {}; }
      })();

      if (elType === 'door') {
        // Extract mark from elementId: "2F-D201" → "D201", "3F-WD302" → "WD302" then try "D302"
        const rawId = (el.elementId || '').toString();
        const afterPrefix = rawId.includes('-') ? rawId.split('-').slice(1).join('-') : rawId;
        const candidate1 = afterPrefix.toUpperCase();
        // Also try stripping leading non-digit alpha chars: "WD302" → "D302"
        const candidate2 = candidate1.replace(/^[A-Z]{1}(?=[A-Z]D?\d)/, '');

        const doorRecord = doorByMark.get(candidate1) || doorByMark.get(candidate2) || null;
        if (doorRecord) {
          const widthM = (doorRecord.width_mm ?? 965) / 1000;
          const heightM = (doorRecord.height_mm ?? 2135) / 1000;
          const depthM = (doorRecord.thickness_mm ?? 45) / 1000;
          const updatedGeom = {
            ...existingGeom,
            dimensions: {
              ...existingGeom.dimensions,
              width: widthM,
              height: heightM,
              depth: depthM,
            },
          };
          await storage.updateBimElement(el.id, { geometry: JSON.stringify(updatedGeom) as any });
          doorsUpdated++;
        }
      } else if (elType === 'wall') {
        // Match by assembly code in properties — strip " (extracted)" suffix
        const assemblyRaw = (existingProps.assembly || existingProps.material || '').toString();
        const assemblyCode = assemblyRaw.replace(/\s*\(extracted\)/i, '').trim().toUpperCase();
        const wtRecord = wallTypeByCode.get(assemblyCode) || null;
        const thicknessMm = wtRecord?.totalThickness_mm ?? wtRecord?.thickness_mm ?? null;

        if (thicknessMm && thicknessMm > 0) {
          const thicknessM = thicknessMm / 1000;
          const updatedGeom = {
            ...existingGeom,
            dimensions: { ...existingGeom.dimensions, depth: thicknessM },
          };
          await storage.updateBimElement(el.id, { geometry: JSON.stringify(updatedGeom) as any });
          wallsUpdated++;
        } else if ((existingGeom?.dimensions?.depth ?? 0) <= 0.01) {
          // Still a 1cm placeholder — apply the first available wall type as default
          const firstWt = Object.values(wallTypesObj)[0] as any;
          const defaultMm = firstWt?.totalThickness_mm ?? firstWt?.thickness_mm ?? 0;
          if (defaultMm > 0) {
            const updatedGeom = {
              ...existingGeom,
              dimensions: { ...existingGeom.dimensions, depth: defaultMm / 1000 },
            };
            await storage.updateBimElement(el.id, { geometry: JSON.stringify(updatedGeom) as any });
            wallsUpdated++;
          }
        }
      }
    }

    logger.info('apply-stage-data complete', { modelId, doorsUpdated, wallsUpdated, totalElements: elements.length });
    res.json({ ok: true, doorsUpdated, wallsUpdated, totalElements: elements.length,
      message: `Updated ${doorsUpdated} doors and ${wallsUpdated} walls with real dimensions from pipeline stage data.` });

  } catch (err) {
    logger.error('apply-stage-data failed', { modelId, error: (err as Error).message });
    res.status(500).json({ ok: false, message: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/bim/pipeline/:modelId/rerun-stage
// Reset a specific stage's stageResults and re-start the pipeline from that
// stage, preserving results from all other completed stages.
// Body: { stage: 'sections' | 'schedules' | 'specifications' | 'floorPlans' }
// ---------------------------------------------------------------------------
pipelineRouter.post('/:modelId/rerun-stage', async (req: Request, res: Response) => {
  const { modelId } = req.params;
  const { stage } = req.body as { stage?: string };

  const stageMap: Record<string, string> = {
    schedules: 'SCHEDULES',
    sections: 'SECTIONS',
    specifications: 'SPECIFICATIONS',
    floorPlans: 'FLOOR_PLANS',
  };

  if (!stage || !stageMap[stage]) {
    return res.status(400).json({
      ok: false,
      message: `Invalid stage. Must be one of: ${Object.keys(stageMap).join(', ')}`,
    });
  }

  try {
    const model = await storage.getBimModel(modelId);
    if (!model) return res.status(404).json({ ok: false, message: `Model ${modelId} not found` });

    const meta = typeof model.metadata === 'string'
      ? (() => { try { return JSON.parse(model.metadata as string); } catch { return {}; } })()
      : (model.metadata as any) ?? {};

    // Null out the target stage's stageResults and reset the currentStage
    const pipelineState = meta?.pipelineState ?? {};
    const stageResults = pipelineState?.stageResults ?? {};
    stageResults[stage] = null;

    const updatedState = {
      ...pipelineState,
      currentStage: stageMap[stage],
      status: 'idle',
      stageResults,
      error: null,
    };

    await storage.updateBimModelMetadata(modelId, {
      pipelineState: updatedState,
      progress: 0,
      lastMessage: `Re-running stage: ${stage}…`,
    });
    // Fetch project documents (same as /start endpoint)
    const documents = await storage.getDocuments(model.projectId);
    if (documents.length === 0) {
      return res.status(422).json({ ok: false, message: 'No documents linked to this project.' });
    }

    await storage.updateBimModel(modelId, { status: 'generating' } as any);

    // Build status callback (same pattern as /start and /confirm-grid)
    const statusCallback = async (progress: number, message: string) => {
      try {
        await updateModelStatus(storage, modelId, {
          status: progress >= 1.0 ? 'completed' : 'generating',
          progress,
          message,
        });
      } catch (err) {
        logger.warn('rerun-stage status update failed', { error: (err as Error).message });
      }
    };

    // Load existing state (preserves other stage results) — done before responding so any load error returns a 500
    const pipeline = new SequentialPipeline(model.projectId, modelId);
    await pipeline.loadState();

    // Respond immediately, then kick off background run
    res.json({ ok: true, message: `Resetting ${stage} and re-running pipeline from that stage.` });

    pipeline.run(documents, statusCallback).catch((err: Error) => {
      logger.error('rerun-stage pipeline error', { modelId, stage, error: err.message });
      updateModelStatus(storage, modelId, { status: 'failed', progress: 1.0, error: err.message }).catch(() => {});
    });
  } catch (err) {
    logger.error('rerun-stage failed', { modelId, error: (err as Error).message });
    res.status(500).json({ ok: false, message: (err as Error).message });
  }
});

// Inserts the 47 user-confirmed gridlines (28 alpha + 19 numeric) into the 10-table
// grid hierarchy, using the BIM element bounding box to derive real-world coordinates.
// Idempotent — deletes and rebuilds if called more than once on the same model.
pipelineRouter.post('/:modelId/save-confirmed-gridlines', async (req: Request, res: Response) => {
  const { modelId } = req.params;

  // These are the user-verified gridlines for The Moorings (confirmed from drawings).
  // Alpha lines run parallel to Y-axis (vertical in plan, labelled A→Y + CL variants).
  // Numeric lines run parallel to X-axis (horizontal in plan, Grid 9 absent).
  // The caller may override either list by providing alphaLabels / numericLabels in the body.
  const DEFAULT_ALPHA_LABELS = [
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'Ga',
    'H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q',
    'R', 'S', 'Sa', 'T', 'U', 'V', 'W', 'X', 'Y',
    'CL', 'CLa', 'CLb',
  ];
  const DEFAULT_NUMERIC_LABELS = [
    '1', '2', '3', '4', '5', '6', '7', '8',
    '10', '11', '12', '13', '14', '15', '16', '17', '18', '19',
  ];

  try {
    const model = await storage.getBimModel(modelId);
    if (!model) {
      return res.status(404).json({ ok: false, message: `Model ${modelId} not found` });
    }

    const alphaLabels: string[] = Array.isArray(req.body?.alphaLabels)
      ? req.body.alphaLabels
      : DEFAULT_ALPHA_LABELS;
    const numericLabels: string[] = Array.isArray(req.body?.numericLabels)
      ? req.body.numericLabels
      : DEFAULT_NUMERIC_LABELS;

    // Use the Ground Floor plan (A102) as the canonical source document reference.
    // This is the primary drawing from which the confirmed gridlines were verified.
    const sourceDocId: string = req.body?.sourceDocId ?? 'f25049e8-e0be-4ced-ae25-4f364448f802';

    logger.info(`Saving ${alphaLabels.length} alpha + ${numericLabels.length} numeric confirmed gridlines`, { modelId });

    const result = await storage.saveConfirmedGridlines(
      modelId,
      sourceDocId,
      model.projectId,
      alphaLabels,
      numericLabels,
    );

    logger.info(`Confirmed gridlines saved`, { modelId, ...result });
    res.json({
      ok: true,
      runId: result.runId,
      axisCount: result.axisCount,
      sparse: result.sparse,
      message: result.sparse
        ? `${result.axisCount} gridlines saved with placeholder spacing (no element coordinates available yet — re-run after BIM generation completes)`
        : `${result.axisCount} gridlines saved with coordinates derived from ${(await storage.getBimElements(modelId)).length} BIM elements`,
    });
  } catch (err) {
    logger.error('save-confirmed-gridlines failed', { modelId, error: (err as Error).message });
    res.status(500).json({ ok: false, message: (err as Error).message });
  }
});
