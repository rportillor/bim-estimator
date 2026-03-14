// server/routes/grid-detection.ts
// ═══════════════════════════════════════════════════════════════════════════════
// GRID DETECTION API ROUTES
// ═══════════════════════════════════════════════════════════════════════════════
//
// RESTful endpoints for grid detection data. Consumed by:
//   - Grid review UI (WP-7)
//   - BIM generator (grid system lookup for element placement)
//   - External integrations
//
// Base path: /api/grid-detection
//
// Endpoints:
//   GET    /runs/:projectId              — List detection runs for project
//   GET    /runs/:projectId/latest       — Get latest successful run
//   GET    /run/:runId                   — Get run details
//   GET    /run/:runId/full              — Get full grid data (review UI)
//   GET    /run/:runId/stats             — Get run statistics (dashboard)
//   GET    /run/:runId/needs-review      — Get items needing review
//   PUT    /axis/:axisId/status          — Update axis review status
//   PUT    /axis-label/:id/status        — Update label association status
//   GET    /project/:projectId/system    — Get project grid system (for CWP)
//   GET    /transforms/:projectId        — Get coordinate transforms
//
// Standards: CIQS Standard Method, v1.1 §10 (human-in-the-loop review)
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, Request, Response } from 'express';
import {
  getDetectionRunsByProject,
  getDetectionRun,
  getLatestRunForFile as _getLatestRunForFile,
  getFullGridDataForRun,
  getGridRunStats,
  getGridAxisLabelsNeedingReview,
  updateGridAxisStatus,
  updateGridAxisLabelStatus,
  getProjectGridSystem,
  getCoordinateTransforms,
} from '../services/grid-storage';
import {
  runGridDetection,
  getGridDetectionStatus,
  getProjectGridSpacing,
} from '../services/grid-detection-orchestrator';

export const gridDetectionRouter = Router();

// ─── Detection Runs ──────────────────────────────────────────────────────────

/**
 * GET /runs/:projectId — List all detection runs for a project.
 */
gridDetectionRouter.get('/runs/:projectId', async (req: Request, res: Response) => {
  try {
    const runs = await getDetectionRunsByProject(req.params.projectId);
    res.json({ success: true, runs });
  } catch (error: any) {
    console.error('Error fetching detection runs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /run/:runId — Get detection run details.
 */
gridDetectionRouter.get('/run/:runId', async (req: Request, res: Response) => {
  try {
    const run = await getDetectionRun(req.params.runId);
    if (!run) {
      return res.status(404).json({ success: false, error: 'Detection run not found' });
    }
    res.json({ success: true, run });
  } catch (error: any) {
    console.error('Error fetching detection run:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /run/:runId/full — Get full grid data hierarchy for review UI.
 * Returns: run → components → families → axes (with labels) → nodes.
 */
gridDetectionRouter.get('/run/:runId/full', async (req: Request, res: Response) => {
  try {
    const data = await getFullGridDataForRun(req.params.runId);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Detection run not found' });
    }
    res.json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching full grid data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /run/:runId/stats — Get detection run statistics for dashboard.
 */
gridDetectionRouter.get('/run/:runId/stats', async (req: Request, res: Response) => {
  try {
    const stats = await getGridRunStats(req.params.runId);
    if (!stats) {
      return res.status(404).json({ success: false, error: 'Detection run not found' });
    }
    res.json({ success: true, stats });
  } catch (error: any) {
    console.error('Error fetching run stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /run/:runId/needs-review — Get all axis-label associations needing review.
 * For human-in-the-loop workflow (v1.1 §10).
 */
gridDetectionRouter.get('/run/:runId/needs-review', async (req: Request, res: Response) => {
  try {
    const items = await getGridAxisLabelsNeedingReview(req.params.runId);
    res.json({ success: true, items, count: items.length });
  } catch (error: any) {
    console.error('Error fetching review items:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Review Actions (Human-in-the-Loop) ─────────────────────────────────────

/**
 * PUT /axis/:axisId/status — Update axis review status.
 * Body: { status: "CONFIRMED" | "REJECTED", reviewedBy?: string }
 */
gridDetectionRouter.put('/axis/:axisId/status', async (req: Request, res: Response) => {
  try {
    const { status, reviewedBy } = req.body;
    if (!['AUTO', 'NEEDS_REVIEW', 'CONFIRMED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    const updated = await updateGridAxisStatus(req.params.axisId, status, reviewedBy);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Axis not found' });
    }
    res.json({ success: true, axis: updated });
  } catch (error: any) {
    console.error('Error updating axis status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /axis-label/:id/status — Update label-axis association status.
 * Body: { status: "CONFIRMED" | "REJECTED", reviewedBy?: string, reviewNotes?: string }
 */
gridDetectionRouter.put('/axis-label/:id/status', async (req: Request, res: Response) => {
  try {
    const { status, reviewedBy, reviewNotes } = req.body;
    if (!['AUTO', 'NEEDS_REVIEW', 'CONFIRMED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }

    const updated = await updateGridAxisLabelStatus(
      req.params.id, status, reviewedBy, reviewNotes
    );
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Axis-label association not found' });
    }
    res.json({ success: true, axisLabel: updated });
  } catch (error: any) {
    console.error('Error updating axis-label status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Project Grid System (for downstream consumers) ─────────────────────────

/**
 * GET /project/:projectId/system — Get the detected grid system for a project.
 * This is the endpoint CWP should call to get real grid spacing
 * instead of using the hardcoded 8m default.
 */
gridDetectionRouter.get('/project/:projectId/system', async (req: Request, res: Response) => {
  try {
    const system = await getProjectGridSystem(req.params.projectId);
    if (!system) {
      return res.json({
        success: true,
        system: null,
        message: 'No grid detection data available for this project. Grid spacing must be determined from drawings.'
      });
    }
    res.json({ success: true, system });
  } catch (error: any) {
    console.error('Error fetching project grid system:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /transforms/:projectId — Get coordinate transforms for a project.
 */
gridDetectionRouter.get('/transforms/:projectId', async (req: Request, res: Response) => {
  try {
    const transforms = await getCoordinateTransforms(req.params.projectId);
    res.json({ success: true, transforms });
  } catch (error: any) {
    console.error('Error fetching transforms:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Orchestrator Endpoints ─────────────────────────────────────────────────

/**
 * POST /detect — Trigger grid detection on a document.
 * Body: { projectId, sourceFileId, filename, storageKey, sheetId?, pageNo?, triggeredBy?, profile? }
 * profile: Named parameter profile (e.g., "canadian-commercial", "the-moorings", "industrial")
 */
gridDetectionRouter.post('/detect', async (req: Request, res: Response) => {
  try {
    const { projectId, sourceFileId, filename, storageKey, sheetId, pageNo, triggeredBy, profile } = req.body;

    if (!projectId || !sourceFileId || !filename || !storageKey) {
      return res.status(400).json({
        success: false,
        error: 'Required: projectId, sourceFileId, filename, storageKey'
      });
    }

    // Resolve parameter profile (with env overrides)
    let parameterOverrides: any = undefined;
    if (profile) {
      try {
        const { getDetectionProfile } = await import('../services/grid-detection-profiles');
        parameterOverrides = getDetectionProfile(profile);
      } catch (_err) {
        console.warn(`Profile "${profile}" not found, using defaults`);
      }
    }

    const result = await runGridDetection({
      projectId,
      sourceFileId,
      filename,
      storageKey,
      sheetId,
      pageNo,
      triggeredBy: triggeredBy ?? 'manual',
      parameterOverrides,
    });

    const statusCode = result.errors.length > 0 && result.stats.axisCount === 0 ? 422 : 200;
    res.status(statusCode).json({ success: result.stats.axisCount > 0, result });
  } catch (error: any) {
    console.error('Error running grid detection:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /profiles — List available detection parameter profiles.
 */
gridDetectionRouter.get('/profiles', async (_req: Request, res: Response) => {
  try {
    const { listProfiles } = await import('../services/grid-detection-profiles');
    res.json({ success: true, profiles: listProfiles() });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /tuning-guide — Get parameter descriptions and recommended tuning ranges.
 */
gridDetectionRouter.get('/tuning-guide', async (_req: Request, res: Response) => {
  try {
    const { PARAMETER_GUIDE } = await import('../services/grid-detection-profiles');
    res.json({ success: true, parameters: PARAMETER_GUIDE });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /status — Check grid detection system capabilities.
 * Returns which extractors are registered and what input types are supported.
 */
gridDetectionRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = getGridDetectionStatus();
    res.json({ success: true, ...status });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /project/:projectId/spacing — Get computed grid spacing for CWP integration.
 * Returns xSpacing and ySpacing from detected grid, or null if unavailable.
 */
gridDetectionRouter.get('/project/:projectId/spacing', async (req: Request, res: Response) => {
  try {
    const spacing = await getProjectGridSpacing(req.params.projectId);
    res.json({
      success: true,
      spacing,
      message: spacing
        ? `Grid spacing detected: X=${spacing.xSpacing?.toFixed(3)}m, Y=${spacing.ySpacing?.toFixed(3)}m`
        : 'No grid spacing detected. Grid spacing must come from drawings — generate RFI if required.'
    });
  } catch (error: any) {
    console.error('Error fetching grid spacing:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /validate-pipeline — Run live validation of the complete grid pipeline.
 * Body: { projectId }
 * Returns structured validation report with pass/fail/warn per check.
 */
gridDetectionRouter.post('/validate-pipeline', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.body;
    if (!projectId) {
      return res.status(400).json({ success: false, error: 'Required: projectId' });
    }
    const { validateGridPipeline } = await import('../scripts/validate-grid-pipeline');
    const report = await validateGridPipeline(projectId);
    res.json({ success: report.summary.failed === 0, report });
  } catch (error: any) {
    console.error('Error validating grid pipeline:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
