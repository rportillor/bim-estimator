// server/routes/pipeline-routes.ts
// Express router for the sequential BIM extraction pipeline.
//
// Endpoints:
//   POST /api/bim/pipeline/:projectId/start    - Start the sequential pipeline
//   GET  /api/bim/pipeline/:modelId/status      - Get current stage + progress
//   POST /api/bim/pipeline/:modelId/confirm-grid - Confirm grid and resume
//   POST /api/bim/pipeline/:modelId/enrich      - Run enrichment pass (Path B)

import { Router, type Request, type Response } from 'express';
import { storage } from '../storage';
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
pipelineRouter.post('/api/bim/pipeline/:projectId/start', async (req: Request, res: Response) => {
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

    // Run the pipeline asynchronously
    const pipeline = new SequentialPipeline(projectId, modelId);
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
pipelineRouter.get('/api/bim/pipeline/:modelId/status', async (req: Request, res: Response) => {
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
pipelineRouter.post('/api/bim/pipeline/:modelId/confirm-grid', async (req: Request, res: Response) => {
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

    pipeline.resume(confirmedGrid, statusCallback).catch((err) => {
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
pipelineRouter.post('/api/bim/pipeline/:modelId/enrich', async (req: Request, res: Response) => {
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
