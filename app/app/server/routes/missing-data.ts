// server/routes/missing-data.ts
// ────────────────────────────────────────────────────────────────────────────
// "No Default Values" enforcement: API endpoints for MissingDataTracker
// + interactive resolution + RFI generation from gaps.
//
// Consumer: client/src/components/dialogs/MissingDataDialog.tsx
//   → GET  /api/projects/:projectId/missing-data
//   → POST /api/projects/:projectId/resolve-missing-data
//   → POST /api/projects/:projectId/rfis/from-gaps
// ────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { MissingDataTracker } from '../services/missing-data-tracker';
import { storage } from '../storage';

const router = Router();

/**
 * GET /projects/:projectId/missing-data
 * Retrieve the current gap summary for a project.
 * If no estimation session has run yet, returns an empty summary.
 */
router.get('/projects/:projectId/missing-data', async (req, res) => {
  try {
    const { projectId } = req.params;
    const tracker = MissingDataTracker.getForProject(projectId);

    if (!tracker) {
      // No estimation session has run — return empty but valid summary
      return res.json({
        totalGaps: 0,
        criticalCount: 0,
        warningCount: 0,
        infoCount: 0,
        openCount: 0,
        resolvedCount: 0,
        rfiIssuedCount: 0,
        estimateBlocked: false,
        byDetectionPoint: {},
        byDivision: {},
        gaps: [],
      });
    }

    const summary = tracker.getSummary();
    const gaps = tracker.getAll().map(item => ({
      elementId: item.elementId || item.id,
      elementType: item.csiDivision || 'unknown',
      missingFields: [item.parameter],
      sourceDocument: item.drawingRef || null,
      message: item.description,
      severity: item.severity,
    }));

    res.json({ ...summary, gaps });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /projects/:projectId/resolve-missing-data
 * User provides dimensions/values for elements flagged as missing data.
 * Updates BIM element dimensions and marks as user-verified.
 */
router.post('/projects/:projectId/resolve-missing-data', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { modelId, updates } = req.body;

    if (!modelId || !updates) {
      return res.status(400).json({ error: 'modelId and updates required' });
    }

    let updatedCount = 0;
    for (const [elementId, fields] of Object.entries(updates as Record<string, Record<string, string>>)) {
      try {
        const elements = await storage.getBimElements(modelId);
        const element = elements.find(
          (e: any) => e.id?.toString() === elementId || e.elementId === elementId
        );
        if (element) {
          const currentDims =
            typeof (element as any).dimensions === 'string'
              ? JSON.parse((element as any).dimensions)
              : (element as any).dimensions || {};

          const updatedDims = { ...currentDims };
          for (const [field, value] of Object.entries(fields)) {
            const numVal = parseFloat(value);
            if (!isNaN(numVal) && numVal > 0) {
              updatedDims[field] = numVal;
            }
          }

          await storage.updateBimElement(element.id, {
            properties: JSON.stringify(updatedDims),
          } as any);
          updatedCount++;

          // Resolve the corresponding gap in the tracker
          const tracker = MissingDataTracker.getForProject(projectId);
          if (tracker) {
            const gap = tracker.getAll().find(g => g.elementId === elementId);
            if (gap) tracker.resolve(gap.id, JSON.stringify(updatedDims), 'user');
          }
        }
      } catch (err) {
        console.warn(`Failed to update element ${elementId}:`, err);
      }
    }

    res.json({ ok: true, updatedCount });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /projects/:projectId/rfis/from-gaps
 * Generate formal RFIs from all open critical/warning gaps.
 * Uses MissingDataTracker.generateRFIs() for professional RFI content.
 */
router.post('/projects/:projectId/rfis/from-gaps', async (req, res) => {
  try {
    const { projectId } = req.params;
    const tracker = MissingDataTracker.getForProject(projectId);

    if (!tracker) {
      return res.json({ ok: true, rfisCreated: 0, rfis: [], message: 'No gaps registered for this project' });
    }

    const generatedRfis = tracker.generateRFIs();

    const createdRFIs = [];
    for (const rfi of generatedRfis) {
      try {
        const created = await (storage as any).createRfi?.({
          projectId,
          subject: rfi.subject,
          description: rfi.description,
          priority: rfi.priority,
          status: 'draft',
          category: 'missing_dimensions',
          createdAt: new Date(),
        });
        if (created) {
          // Mark the gap as RFI-issued
          const gapId = rfi.relatedGapIds?.[0];
          if (gapId) tracker.markRFIIssued(gapId, created.id || `RFI-${Date.now()}`);
          createdRFIs.push(created);
        }
      } catch (err) {
        console.warn('Failed to create RFI:', err);
      }
    }

    res.json({ ok: true, rfisCreated: createdRFIs.length, rfis: createdRFIs });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
