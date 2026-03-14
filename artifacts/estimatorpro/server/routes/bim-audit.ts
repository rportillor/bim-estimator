// server/routes/bim-audit.ts
// ──────────────────────────────────────────────────────────────────────────────
// On-demand model audit and iterative refinement endpoints.
//
// GET  /api/bim/models/:modelId/audit          → Run audit, return findings
// POST /api/bim/models/:modelId/audit/refine   → Run iterative refinement loop
// ──────────────────────────────────────────────────────────────────────────────

import { Router, type Request, type Response } from 'express';
import { storage } from '../storage';
import { runModelAudit } from '../services/model-audit-engine';
import { runIterativeRefinement } from '../services/iterative-refinement';

export const bimAuditRouter = Router();

/**
 * GET /api/bim/models/:modelId/audit
 * Run all 8 audit checks on the model and return findings.
 * Does NOT modify any elements — read-only.
 */
bimAuditRouter.get(
  '/api/bim/models/:modelId/audit',
  async (req: Request, res: Response) => {
    try {
      const { modelId } = req.params;

      const allElements = await storage.getBimElements(modelId);
      if (!allElements || allElements.length === 0) {
        return res.status(404).json({ error: 'No elements found for model' });
      }

      // Parse geometry
      const elements = allElements.map((e: any) => ({
        ...e,
        geometry: typeof e.geometry === 'string' ? JSON.parse(e.geometry) : (e.geometry || {}),
        properties: typeof e.properties === 'string' ? JSON.parse(e.properties) : (e.properties || {}),
      }));

      const result = runModelAudit(elements, modelId);

      res.json({
        ...result,
        // Group findings by category for the frontend
        findingsByCategory: result.findings.reduce((acc: Record<string, any[]>, f) => {
          if (!acc[f.category]) acc[f.category] = [];
          acc[f.category].push(f);
          return acc;
        }, {}),
      });
    } catch (error: any) {
      console.error('Error running model audit:', error);
      res.status(500).json({ error: `Audit failed: ${error?.message}` });
    }
  },
);

/**
 * POST /api/bim/models/:modelId/audit/refine
 * Run the full iterative refinement loop (audit → fix → re-audit → repeat).
 * MODIFIES elements in the database.
 *
 * Body params:
 *   maxPasses?      — max audit+fix cycles (default 5)
 *   targetScore?    — stop at this score (default 85)
 *   dryRun?         — if true, audit only, don't save fixes (default false)
 */
bimAuditRouter.post(
  '/api/bim/models/:modelId/audit/refine',
  async (req: Request, res: Response) => {
    try {
      const { modelId } = req.params;
      const { maxPasses = 5, targetScore = 85, dryRun = false } = req.body || {};

      const allElements = await storage.getBimElements(modelId);
      if (!allElements || allElements.length === 0) {
        return res.status(404).json({ error: 'No elements found for model' });
      }

      // Parse geometry
      const elements = allElements.map((e: any) => ({
        ...e,
        geometry: typeof e.geometry === 'string' ? JSON.parse(e.geometry) : (e.geometry || {}),
        properties: typeof e.properties === 'string' ? JSON.parse(e.properties) : (e.properties || {}),
      }));

      const result = runIterativeRefinement(elements, modelId, {
        maxPasses: Math.min(maxPasses, 10),  // Safety cap
        targetScore,
      });

      // Save refined elements unless dry run
      if (!dryRun && result.totalFixesApplied > 0) {
        if ((storage as any).upsertBimElements) {
          await (storage as any).upsertBimElements(modelId, elements);
          console.log(`💾 Saved ${elements.length} refined elements for model ${modelId}`);
        }
      }

      res.json({
        ...result,
        dryRun,
        saved: !dryRun && result.totalFixesApplied > 0,
        // First and last pass summaries for quick comparison
        initialAudit: result.passes[0]?.summary,
        finalAudit: result.passes[result.passes.length - 1]?.summary,
      });
    } catch (error: any) {
      console.error('Error running refinement:', error);
      res.status(500).json({ error: `Refinement failed: ${error?.message}` });
    }
  },
);
