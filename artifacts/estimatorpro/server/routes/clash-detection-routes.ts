// server/routes/clash-detection-routes.ts
// ═══════════════════════════════════════════════════════════════════════════════
// SOP 6.4 — CLASH DETECTION API ROUTES
// ═══════════════════════════════════════════════════════════════════════════════
//
// 4 endpoints for clash detection workflow:
//   POST /api/projects/:projectId/clash-detection/run
//   GET  /api/projects/:projectId/clash-detection/results
//   GET  /api/bim/models/:modelId/discipline-breakdown
//   POST /api/projects/:projectId/clash-detection/resolve/:clashId
//
// Integrates with: routes.ts (register via app.use), storage.ts, clash-detection-engine.ts
// ═══════════════════════════════════════════════════════════════════════════════

import { Router, Request, Response } from 'express';
import {
  runClashDetectionForProject,
  runClashDetection,
  getModelDisciplineBreakdown,
  emptyClearanceRequirements,
  type ClearanceRequirements,
  type ClashDetectionResult,
} from '../services/clash-detection-engine';

const router = Router();

// In-memory results cache (production: move to storage table)
const resultsCache = new Map<string, ClashDetectionResult>();

// ─── POST /api/projects/:projectId/clash-detection/run ──────────────────────
//
// Run full clash detection against the project's latest BIM model.
//
// Body (optional):
//   clearances: Partial<ClearanceRequirements>  — from project specs or user input
//   tolerance_mm: number                        — proximity threshold (default 50)
//   modelId: string                             — specific model (default: latest)
//
// Returns: ClashDetectionResult
// ─────────────────────────────────────────────────────────────────────────────

router.post('/api/projects/:projectId/clash-detection/run', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { clearances, tolerance_mm, modelId } = req.body || {};

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    // Merge user-provided clearances with empty defaults
    const mergedClearances: Partial<ClearanceRequirements> = {
      ...emptyClearanceRequirements(),
      ...(clearances || {}),
    };

    const tolerance = typeof tolerance_mm === 'number' && tolerance_mm > 0 ? tolerance_mm : 50;

    let result: ClashDetectionResult;

    if (modelId) {
      result = await runClashDetection(modelId, mergedClearances, tolerance);
    } else {
      result = await runClashDetectionForProject(projectId, mergedClearances, tolerance);
    }

    // Cache result
    resultsCache.set(projectId, result);

    // Return summary for large result sets, full data otherwise
    const clashCount = result.clashes.length;
    console.log(`✅ Clash detection complete for project ${projectId}: ${clashCount} clashes found`);

    res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('❌ Clash detection failed:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      suggestion: error.message.includes('No BIM')
        ? 'Generate a BIM model first via POST /api/projects/:projectId/bim-models/generate'
        : 'Check server logs for details',
    });
  }
});

// ─── GET /api/projects/:projectId/clash-detection/results ───────────────────
//
// Retrieve the most recent clash detection results for a project.
// Query params:
//   severity: filter by severity (critical, high, medium, low, info)
//   category: filter by category (hard, soft, workflow, code_compliance, tolerance)
//   storey:   filter by storey
//   rfiOnly:  if 'true', only return clashes requiring RFIs
//
// ─────────────────────────────────────────────────────────────────────────────

router.get('/api/projects/:projectId/clash-detection/results', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { severity, category, storey, rfiOnly } = req.query;

    const cached = resultsCache.get(projectId);
    if (!cached) {
      return res.status(404).json({
        error: 'No clash detection results found',
        suggestion: 'Run clash detection first via POST /api/projects/:projectId/clash-detection/run',
      });
    }

    // Apply filters
    let filtered = cached.clashes;

    if (severity && typeof severity === 'string') {
      filtered = filtered.filter(c => c.severity === severity);
    }
    if (category && typeof category === 'string') {
      filtered = filtered.filter(c => c.category === category);
    }
    if (storey && typeof storey === 'string') {
      filtered = filtered.filter(c => c.elementA.storey === storey || c.elementB.storey === storey);
    }
    if (rfiOnly === 'true') {
      filtered = filtered.filter(c => c.rfiRequired);
    }

    res.json({
      success: true,
      projectId,
      runDate: cached.runDate,
      totalElements: cached.totalElements,
      resolvedElements: cached.resolvedElements,
      skippedElements: cached.skippedElements,
      summary: cached.summary,
      missingClearanceData: cached.missingClearanceData,
      clashes: filtered,
      filteredCount: filtered.length,
      totalCount: cached.clashes.length,
    });
  } catch (error: any) {
    console.error('❌ Error retrieving clash results:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /api/bim/models/:modelId/discipline-breakdown ──────────────────────
//
// Quick model analysis before running full detection.
// Returns element counts by discipline, CSI division, storey, and geometry status.
//
// ─────────────────────────────────────────────────────────────────────────────

router.get('/api/bim/models/:modelId/discipline-breakdown', async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;

    if (!modelId) {
      return res.status(400).json({ error: 'Model ID is required' });
    }

    const breakdown = await getModelDisciplineBreakdown(modelId);

    res.json({
      success: true,
      modelId,
      ...breakdown,
    });
  } catch (error: any) {
    console.error('❌ Discipline breakdown failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /api/projects/:projectId/clash-detection/resolve/:clashId ─────────
//
// Update a clash status (resolve, accept, or issue RFI).
// Body:
//   status: 'resolved' | 'accepted' | 'rfi_issued'
//   resolution: string — description of how it was resolved
//
// ─────────────────────────────────────────────────────────────────────────────

router.post('/api/projects/:projectId/clash-detection/resolve/:clashId', async (req: Request, res: Response) => {
  try {
    const { projectId, clashId } = req.params;
    const { status, resolution } = req.body || {};

    if (!['resolved', 'accepted', 'rfi_issued'].includes(status)) {
      return res.status(400).json({
        error: 'Invalid status. Must be: resolved, accepted, or rfi_issued',
      });
    }

    const cached = resultsCache.get(projectId);
    if (!cached) {
      return res.status(404).json({ error: 'No clash detection results found for this project' });
    }

    const clash = cached.clashes.find(c => c.id === clashId);
    if (!clash) {
      return res.status(404).json({ error: `Clash ${clashId} not found` });
    }

    clash.status = status;
    if (resolution) {
      clash.recommendation = `[RESOLVED] ${resolution}`;
    }

    // Rebuild summary
    cached.summary = {
      ...cached.summary,
      totalClashes: cached.clashes.filter(c => c.status === 'open').length,
    };

    res.json({
      success: true,
      clashId,
      newStatus: status,
      resolution: resolution || null,
    });
  } catch (error: any) {
    console.error('❌ Clash resolution failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export { router as clashDetectionRouter };
