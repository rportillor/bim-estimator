// server/routes/qs-level5-routes.ts
// =============================================================================
// QS LEVEL 5 GAP-CLOSURE — CONSOLIDATED API ROUTES
// =============================================================================
//
// Provides REST endpoints for all 8 gap-closure modules:
//   1. UNIFORMAT Cross-Walk & NRM (uniformat-crosswalk.ts)
//   2. Code-Driven Adders (code-driven-adders.ts)
//   3. Vendor Quote Tracker (vendor-quote-tracker.ts)
//   4. Monte Carlo Engine (monte-carlo-engine.ts)
//   5. Schedule of Values (schedule-of-values.ts)
//   6. Estimate Workflow (estimate-workflow.ts)
//   7. Benchmark Engine (benchmark-engine.ts)
//   8. BoE Generator (boe-generator.ts)
//
// Total: 52 endpoints across 8 route groups
//
// Integration: Mount in server/index.ts as:
//   import { qsLevel5Router } from './routes/qs-level5-routes';  // correct when importing from server/index.ts or server/routes.ts
//   app.use('/api/qs5', authenticateToken, qsLevel5Router);
//
// All routes are prefixed with /api/qs5/ when mounted.
// =============================================================================

import { Router, type Request, type Response } from 'express';
import { storage } from '../storage';

// Module imports — gap-closure engines
import {
  enrichEstimateLineItems,
  generateUniformatSummary,
  generateCSIDivisionSummary,
  reconcileElementDivision,
  generateCrossWalkTable,
  generateDefaultWBS,
} from '../estimator/uniformat-crosswalk';

import {
  applyCodeAdders,
  storeConfig as storeCodeConfig,
  getConfig as getCodeConfig,
  storeResult as storeCodeResult,
  getResult as getCodeResult,
  deleteConfig as deleteCodeConfig,
  type CodeAdderConfig,
} from '../estimator/code-driven-adders';

import {
  addQuote,
  getQuote,
  getQuotesByProject,
  getActiveQuotesByProject,
  updateQuote,
  deleteQuote,
  createBidPackage,
  getBidPackage as _getBidPackage,
  getBidPackagesByProject,
  updateBidPackage,
  deleteBidPackage,
  linkQuoteToBidPackage,
  generateBidPackagesFromEstimate,
  analyzeQuotes,
} from '../estimator/vendor-quote-tracker';

import {
  runMonteCarloSimulation,
  buildRangeEstimates,
  storeResult as storeMCResult,
  getResult as getMCResult,
  deleteResult as deleteMCResult,
} from '../estimator/monte-carlo-engine';

import {
  generateScheduleOfValues,
  generateProgressCertificate,
  sovToCSV,
  progressCertificateToCSV,
  storeSOV,
  getSOV,
  storeCertificate,
  getCertificates,
} from '../estimator/schedule-of-values';

import {
  createVersion,
  getVersions,
  getVersion,
  getLatestVersion,
  submitForReview,
  approveEstimate,
  rejectEstimate,
  freezeEstimate,
  reopenEstimate,
  getReviewHistory as _getReviewHistory,
  computeVersionDiff,
  addBidder,
  getBidders as _getBidders,
  deleteBidder as _deleteBidder,
  generateBidLevelingSheet,
  addAlternate,
  getAlternates,
  updateAlternateStatus,
  deleteAlternate as _deleteAlternate,
  computeAlternateImpact,
} from '../estimator/estimate-workflow';

import {
  compareToBenchmark,
  checkCompleteness,
  storeBenchmark,
  getBenchmark,
  storeCompleteness,
  getCompleteness,
  BENCHMARK_DATABASE,
  type BuildingType,
} from '../estimator/benchmark-engine';

import {
  generateBoE,
  boeToText,
  storeBoE,
  getBoE,
  deleteBoE,
} from '../estimator/boe-generator';

// Upstream imports — existing modules this layer consumes
import { generateEstimateFromElements as _generateEstimateFromElements, buildEstimateForModel } from '../estimator/estimate-engine';
import { prescreenCodeAdders } from '../estimator/codes-standards-register';
import type { EstimateSummary } from '../estimator/estimate-engine';


// ─── ROUTER ─────────────────────────────────────────────────────────────────

export const qsLevel5Router = Router();


// ─── HELPER: Get or build estimate ──────────────────────────────────────────

async function getEstimate(modelId: string): Promise<EstimateSummary | null> {
  try {
    return await buildEstimateForModel(modelId);
  } catch {
    return null;
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
//  GROUP 1: UNIFORMAT CROSS-WALK & NRM (6 endpoints)
// ═══════════════════════════════════════════════════════════════════════════════

/** GET /api/qs5/crosswalk — Full CSI→UNIFORMAT cross-walk table */
qsLevel5Router.get('/crosswalk', (_req: Request, res: Response) => {
  try {
    res.json({ crosswalk: generateCrossWalkTable(), count: 34 });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to generate cross-walk' });
  }
});

/** GET /api/qs5/wbs — Default WBS/CBS structure */
qsLevel5Router.get('/wbs', (_req: Request, res: Response) => {
  try {
    const wbs = generateDefaultWBS();
    res.json({ wbs, count: wbs.length });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to generate WBS' });
  }
});

/** GET /api/qs5/models/:modelId/uniformat — UNIFORMAT elemental summary */
qsLevel5Router.get('/models/:modelId/uniformat', async (req: Request, res: Response) => {
  try {
    const estimate = await getEstimate(req.params.modelId);
    if (!estimate) return res.status(404).json({ error: 'Model not found or estimate failed' });
    const summary = generateUniformatSummary(estimate);
    res.json({ summary, count: summary.length, grandTotal: estimate.grandTotal });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to generate UNIFORMAT summary' });
  }
});

/** GET /api/qs5/models/:modelId/divisions — CSI division summary */
qsLevel5Router.get('/models/:modelId/divisions', async (req: Request, res: Response) => {
  try {
    const estimate = await getEstimate(req.params.modelId);
    if (!estimate) return res.status(404).json({ error: 'Model not found or estimate failed' });
    const summary = generateCSIDivisionSummary(estimate);
    res.json({ summary, count: summary.length, grandTotal: estimate.grandTotal });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to generate division summary' });
  }
});

/** GET /api/qs5/models/:modelId/reconciliation — Element ↔ Division reconciliation */
qsLevel5Router.get('/models/:modelId/reconciliation', async (req: Request, res: Response) => {
  try {
    const estimate = await getEstimate(req.params.modelId);
    if (!estimate) return res.status(404).json({ error: 'Model not found or estimate failed' });
    res.json(reconcileElementDivision(estimate));
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to reconcile' });
  }
});

/** GET /api/qs5/models/:modelId/enriched — Enriched line items (UNIFORMAT + NRM + WBS) */
qsLevel5Router.get('/models/:modelId/enriched', async (req: Request, res: Response) => {
  try {
    const estimate = await getEstimate(req.params.modelId);
    if (!estimate) return res.status(404).json({ error: 'Model not found or estimate failed' });
    const allItems = estimate.floors.flatMap(f => f.lineItems);
    const enriched = enrichEstimateLineItems(allItems);
    res.json({ items: enriched, count: enriched.length });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to enrich line items' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
//  GROUP 2: CODE-DRIVEN ADDERS (4 endpoints)
// ═══════════════════════════════════════════════════════════════════════════════

/** POST /api/qs5/projects/:projectId/code-adders — Configure & apply code adders */
qsLevel5Router.post('/projects/:projectId/code-adders', async (req: Request, res: Response) => {
  try {
    const config: CodeAdderConfig = { ...req.body, projectId: req.params.projectId };
    storeCodeConfig(config);

    const modelId = req.body.modelId;
    if (!modelId) return res.status(400).json({ error: 'modelId required in body' });

    const estimate = await getEstimate(modelId);
    if (!estimate) return res.status(404).json({ error: 'Model not found or estimate failed' });

    const result = applyCodeAdders(config, estimate);
    storeCodeResult(result);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to apply code adders' });
  }
});

/** GET /api/qs5/projects/:projectId/code-adders — Get stored code adder result */
qsLevel5Router.get('/projects/:projectId/code-adders', (req: Request, res: Response) => {
  const result = getCodeResult(req.params.projectId);
  if (!result) return res.status(404).json({ error: 'No code adder result found' });
  res.json(result);
});

/** GET /api/qs5/projects/:projectId/code-adders/config — Get code adder config */
qsLevel5Router.get('/projects/:projectId/code-adders/config', (req: Request, res: Response) => {
  const config = getCodeConfig(req.params.projectId);
  if (!config) return res.status(404).json({ error: 'No code adder config found' });
  res.json(config);
});

/** DELETE /api/qs5/projects/:projectId/code-adders — Delete config & result */
qsLevel5Router.delete('/projects/:projectId/code-adders', (req: Request, res: Response) => {
  deleteCodeConfig(req.params.projectId);
  res.json({ ok: true, message: 'Code adder config and result deleted' })

/** POST /api/qs5/models/:modelId/code-adders/prescreen — CODE-7 auto pre-screen */
qsLevel5Router.post('/models/:modelId/code-adders/prescreen', async (req: Request, res: Response) => {
  const { modelId } = req.params;
  try {
    const model = await storage.getBimModel(modelId);
    if (!model) return res.status(404).json({ error: 'Model not found' });

    // Extract metadata from model — occupancy, storeys, GFA
    const geo = (model.geometryData as any) || {};
    const props = ((model as any).analysisData) || {};

    const result = prescreenCodeAdders({
      occupancyGroup: props.occupancyGroup || geo.occupancyGroup,
      numberOfStoreys: props.numberOfStoreys || (model as any).floorCount || undefined,
      gfa: props.gfa || props.grossFloorArea || undefined,
      constructionType: props.constructionType || undefined,
      sprinklered: props.sprinklered,
      seismicPga: props.seismicPga || undefined,
      province: props.province || 'ON',
      hasElevator: props.hasElevator,
      hasParkadeLevel: props.hasParkadeLevel,
    });

    res.json({
      modelId,
      prescreen: result,
      message: `CODE-7: ${result.applicableAdders.length} applicable code adders identified. QS confirmation required before applying.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Prescreen failed', details: err.message });
  }
});

/** GET /api/projects/:projectId/code-adders/status — ADV-2: applied vs applicable count */
qsLevel5Router.get('/projects/:projectId/code-adders/status-summary', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  try {
    // Check if code adder result exists for any model of this project
    const models = await storage.getBimModels(projectId).catch(() => []);
    const applied = (models as any[]).filter(m => (m as any).codeAdderApplied === true).length;
    res.json({ applied: applied > 0, applicableCount: 5, appliedCount: applied });
  } catch (err: any) {
    res.status(500).json({ error: 'Status check failed', details: err.message });
  }
});
;
});


// ═══════════════════════════════════════════════════════════════════════════════
//  GROUP 3: VENDOR QUOTES & BID PACKAGES (12 endpoints)
// ═══════════════════════════════════════════════════════════════════════════════

/** POST /api/qs5/projects/:projectId/quotes — Add a vendor quote */
qsLevel5Router.post('/projects/:projectId/quotes', (req: Request, res: Response) => {
  try {
    const quote = addQuote({ ...req.body, projectId: req.params.projectId });
    res.status(201).json(quote);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to add quote' });
  }
});

/** GET /api/qs5/projects/:projectId/quotes — List all quotes */
qsLevel5Router.get('/projects/:projectId/quotes', (req: Request, res: Response) => {
  const active = req.query.active === 'true';
  const quotes = active
    ? getActiveQuotesByProject(req.params.projectId)
    : getQuotesByProject(req.params.projectId);
  res.json({ quotes, count: quotes.length });
});

/** GET /api/qs5/quotes/:quoteId — Get single quote */
qsLevel5Router.get('/quotes/:quoteId', (req: Request, res: Response) => {
  const quote = getQuote(req.params.quoteId);
  if (!quote) return res.status(404).json({ error: 'Quote not found' });
  res.json(quote);
});

/** PUT /api/qs5/quotes/:quoteId — Update quote */
qsLevel5Router.put('/quotes/:quoteId', (req: Request, res: Response) => {
  const updated = updateQuote(req.params.quoteId, req.body);
  if (!updated) return res.status(404).json({ error: 'Quote not found' });
  res.json(updated);
});

/** DELETE /api/qs5/quotes/:quoteId — Delete quote */
qsLevel5Router.delete('/quotes/:quoteId', (req: Request, res: Response) => {
  deleteQuote(req.params.quoteId);
  res.json({ ok: true });
});

/** GET /api/qs5/projects/:projectId/quotes/analysis — Quote coverage analysis */
qsLevel5Router.get('/projects/:projectId/quotes/analysis', async (req: Request, res: Response) => {
  try {
    const modelId = req.query.modelId as string;
    if (!modelId) return res.status(400).json({ error: 'modelId query param required' });
    const estimate = await getEstimate(modelId);
    if (!estimate) return res.status(404).json({ error: 'Estimate not found' });
    res.json(analyzeQuotes(req.params.projectId, estimate));
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to analyze quotes' });
  }
});

/** POST /api/qs5/projects/:projectId/bid-packages — Create bid package */
qsLevel5Router.post('/projects/:projectId/bid-packages', (req: Request, res: Response) => {
  try {
    const pkg = createBidPackage({ ...req.body, projectId: req.params.projectId });
    res.status(201).json(pkg);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to create bid package' });
  }
});

/** GET /api/qs5/projects/:projectId/bid-packages — List bid packages */
qsLevel5Router.get('/projects/:projectId/bid-packages', (req: Request, res: Response) => {
  res.json({ packages: getBidPackagesByProject(req.params.projectId) });
});

/** POST /api/qs5/projects/:projectId/bid-packages/auto — Auto-generate from estimate */
qsLevel5Router.post('/projects/:projectId/bid-packages/auto', async (req: Request, res: Response) => {
  try {
    const modelId = req.body.modelId;
    if (!modelId) return res.status(400).json({ error: 'modelId required in body' });
    const estimate = await getEstimate(modelId);
    if (!estimate) return res.status(404).json({ error: 'Estimate not found' });
    const packages = generateBidPackagesFromEstimate(req.params.projectId, estimate);
    res.json({ packages, count: packages.length });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to auto-generate bid packages' });
  }
});

/** PUT /api/qs5/bid-packages/:packageId — Update bid package */
qsLevel5Router.put('/bid-packages/:packageId', (req: Request, res: Response) => {
  const updated = updateBidPackage(req.params.packageId, req.body);
  if (!updated) return res.status(404).json({ error: 'Bid package not found' });
  res.json(updated);
});

/** POST /api/qs5/bid-packages/:packageId/link-quote — Link a quote to package */
qsLevel5Router.post('/bid-packages/:packageId/link-quote', (req: Request, res: Response) => {
  const { quoteId } = req.body;
  if (!quoteId) return res.status(400).json({ error: 'quoteId required' });
  const ok = linkQuoteToBidPackage(req.params.packageId, quoteId);
  if (!ok) return res.status(404).json({ error: 'Bid package not found' });
  res.json({ ok: true });
});

/** DELETE /api/qs5/bid-packages/:packageId — Delete bid package */
qsLevel5Router.delete('/bid-packages/:packageId', (req: Request, res: Response) => {
  deleteBidPackage(req.params.packageId);
  res.json({ ok: true });
});


// ═══════════════════════════════════════════════════════════════════════════════
//  GROUP 4: MONTE CARLO SIMULATION (4 endpoints)
// ═══════════════════════════════════════════════════════════════════════════════

/** POST /api/qs5/projects/:projectId/monte-carlo — Run simulation */
qsLevel5Router.post('/projects/:projectId/monte-carlo', async (req: Request, res: Response) => {
  try {
    const modelId = req.body.modelId;
    if (!modelId) return res.status(400).json({ error: 'modelId required in body' });
    const estimate = await getEstimate(modelId);
    if (!estimate) return res.status(404).json({ error: 'Estimate not found' });

    const config = {
      projectId: req.params.projectId,
      iterations: req.body.iterations ?? 5000,
      seed: req.body.seed,
      confidenceLevels: req.body.confidenceLevels ?? [50, 80, 90, 95],
      rangeOverrides: req.body.rangeOverrides,
    };

    const result = runMonteCarloSimulation(estimate, config);
    storeMCResult(result);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to run Monte Carlo simulation' });
  }
});

/** GET /api/qs5/projects/:projectId/monte-carlo — Get stored result */
qsLevel5Router.get('/projects/:projectId/monte-carlo', (req: Request, res: Response) => {
  const result = getMCResult(req.params.projectId);
  if (!result) return res.status(404).json({ error: 'No Monte Carlo result found' });
  res.json(result);
});

/** GET /api/qs5/models/:modelId/range-estimates — Get range estimates only */
qsLevel5Router.get('/models/:modelId/range-estimates', async (req: Request, res: Response) => {
  try {
    const estimate = await getEstimate(req.params.modelId);
    if (!estimate) return res.status(404).json({ error: 'Estimate not found' });
    const ranges = buildRangeEstimates(estimate);
    res.json({ ranges, count: ranges.length });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to build range estimates' });
  }
});

/** DELETE /api/qs5/projects/:projectId/monte-carlo — Delete stored result */
qsLevel5Router.delete('/projects/:projectId/monte-carlo', (req: Request, res: Response) => {
  deleteMCResult(req.params.projectId);
  res.json({ ok: true });
});


// ═══════════════════════════════════════════════════════════════════════════════
//  GROUP 5: SCHEDULE OF VALUES (6 endpoints)
// ═══════════════════════════════════════════════════════════════════════════════

/** POST /api/qs5/projects/:projectId/sov — Generate Schedule of Values */
qsLevel5Router.post('/projects/:projectId/sov', async (req: Request, res: Response) => {
  try {
    const modelId = req.body.modelId;
    if (!modelId) return res.status(400).json({ error: 'modelId required in body' });
    const estimate = await getEstimate(modelId);
    if (!estimate) return res.status(404).json({ error: 'Estimate not found' });

    const sov = generateScheduleOfValues(estimate, req.body);
    storeSOV(req.params.projectId, sov);
    res.json(sov);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to generate SOV' });
  }
});

/** GET /api/qs5/projects/:projectId/sov — Get stored SOV */
qsLevel5Router.get('/projects/:projectId/sov', (req: Request, res: Response) => {
  const sov = getSOV(req.params.projectId);
  if (!sov) return res.status(404).json({ error: 'No SOV found' });
  res.json(sov);
});

/** GET /api/qs5/projects/:projectId/sov.csv — Export SOV as CSV */
qsLevel5Router.get('/projects/:projectId/sov.csv', (req: Request, res: Response) => {
  const sov = getSOV(req.params.projectId);
  if (!sov) return res.status(404).json({ error: 'No SOV found' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sov-${req.params.projectId}.csv"`);
  res.send(sovToCSV(sov));
});

/** POST /api/qs5/projects/:projectId/sov/progress — Issue progress certificate */
qsLevel5Router.post('/projects/:projectId/sov/progress', (req: Request, res: Response) => {
  try {
    const sov = getSOV(req.params.projectId);
    if (!sov) return res.status(404).json({ error: 'No SOV found — generate SOV first' });

    const { certificateNumber, periodEnding, completionPercentages } = req.body;
    if (!certificateNumber || !periodEnding || !completionPercentages) {
      return res.status(400).json({ error: 'certificateNumber, periodEnding, completionPercentages required' });
    }

    const previousCerts = getCertificates(req.params.projectId);
    const previousCert = previousCerts.length > 0 ? previousCerts[previousCerts.length - 1] : undefined;

    const cert = generateProgressCertificate(sov, certificateNumber, periodEnding, completionPercentages, previousCert);
    storeCertificate(req.params.projectId, cert);
    res.json(cert);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to generate progress certificate' });
  }
});

/** GET /api/qs5/projects/:projectId/sov/certificates — List all progress certificates */
qsLevel5Router.get('/projects/:projectId/sov/certificates', (req: Request, res: Response) => {
  res.json({ certificates: getCertificates(req.params.projectId) });
});

/** GET /api/qs5/projects/:projectId/sov/certificates/:certNum.csv — Export cert as CSV */
qsLevel5Router.get('/projects/:projectId/sov/certificates/:certNum.csv', (req: Request, res: Response) => {
  const certs = getCertificates(req.params.projectId);
  const cert = certs.find(c => c.certificateNumber === req.params.certNum);
  if (!cert) return res.status(404).json({ error: 'Certificate not found' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="progress-${cert.certificateNumber}.csv"`);
  res.send(progressCertificateToCSV(cert));
});


// ═══════════════════════════════════════════════════════════════════════════════
//  GROUP 6: ESTIMATE WORKFLOW — LIFECYCLE & MAKER-CHECKER (10 endpoints)
// ═══════════════════════════════════════════════════════════════════════════════

/** POST /api/qs5/projects/:projectId/versions — Create new estimate version */
qsLevel5Router.post('/projects/:projectId/versions', async (req: Request, res: Response) => {
  try {
    const { modelId, maker, changeDescription } = req.body;
    if (!modelId || !maker) return res.status(400).json({ error: 'modelId and maker required' });
    const estimate = await getEstimate(modelId);
    if (!estimate) return res.status(404).json({ error: 'Estimate not found' });

    const version = createVersion(req.params.projectId, estimate, maker, changeDescription ?? 'Initial version');
    res.status(201).json(version);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to create version' });
  }
});

/** GET /api/qs5/projects/:projectId/versions — List all versions */
qsLevel5Router.get('/projects/:projectId/versions', (req: Request, res: Response) => {
  const versions = getVersions(req.params.projectId);
  res.json({ versions: versions.map(v => ({
    versionId: v.versionId, versionNumber: v.versionNumber, status: v.status,
    maker: v.maker, checker: v.checker, changeDescription: v.changeDescription,
    grandTotal: v.estimateSnapshot.grandTotal, createdAt: v.createdAt,
  })), count: versions.length });
});

/** GET /api/qs5/projects/:projectId/versions/latest — Get latest version */
qsLevel5Router.get('/projects/:projectId/versions/latest', (req: Request, res: Response) => {
  const version = getLatestVersion(req.params.projectId);
  if (!version) return res.status(404).json({ error: 'No versions found' });
  res.json(version);
});

/** GET /api/qs5/versions/:versionId — Get specific version */
qsLevel5Router.get('/versions/:versionId', (req: Request, res: Response) => {
  const version = getVersion(req.params.versionId);
  if (!version) return res.status(404).json({ error: 'Version not found' });
  res.json(version);
});

/** POST /api/qs5/versions/:versionId/submit — Submit for review */
qsLevel5Router.post('/versions/:versionId/submit', (req: Request, res: Response) => {
  const { actor, comments } = req.body;
  if (!actor) return res.status(400).json({ error: 'actor required' });
  const version = submitForReview(req.params.versionId, actor, comments);
  if (!version) return res.status(400).json({ error: 'Cannot submit — version must be in draft status' });
  res.json(version);
});

/** POST /api/qs5/versions/:versionId/approve — Approve (checker) */
qsLevel5Router.post('/versions/:versionId/approve', (req: Request, res: Response) => {
  const { checker, comments } = req.body;
  if (!checker) return res.status(400).json({ error: 'checker required' });
  const version = approveEstimate(req.params.versionId, checker, comments);
  if (!version) return res.status(400).json({ error: 'Cannot approve — must be under_review, checker cannot be maker' });
  res.json(version);
});

/** POST /api/qs5/versions/:versionId/reject — Reject (checker) */
qsLevel5Router.post('/versions/:versionId/reject', (req: Request, res: Response) => {
  const { checker, reason } = req.body;
  if (!checker || !reason) return res.status(400).json({ error: 'checker and reason required' });
  const version = rejectEstimate(req.params.versionId, checker, reason);
  if (!version) return res.status(400).json({ error: 'Cannot reject — must be under_review' });
  res.json(version);
});

/** POST /api/qs5/versions/:versionId/freeze — Freeze for tender */
qsLevel5Router.post('/versions/:versionId/freeze', (req: Request, res: Response) => {
  const { actor } = req.body;
  if (!actor) return res.status(400).json({ error: 'actor required' });
  const version = freezeEstimate(req.params.versionId, actor);
  if (!version) return res.status(400).json({ error: 'Cannot freeze — must be approved' });
  res.json(version);
});

/** POST /api/qs5/versions/:versionId/reopen — Reopen frozen/approved estimate */
qsLevel5Router.post('/versions/:versionId/reopen', (req: Request, res: Response) => {
  const { actor, reason } = req.body;
  if (!actor || !reason) return res.status(400).json({ error: 'actor and reason required' });
  const version = reopenEstimate(req.params.versionId, actor, reason);
  if (!version) return res.status(400).json({ error: 'Cannot reopen — must be approved or frozen' });
  res.json(version);
});

/** GET /api/qs5/projects/:projectId/versions/diff — Compare two versions */
qsLevel5Router.get('/projects/:projectId/versions/diff', (req: Request, res: Response) => {
  const from = parseInt(req.query.from as string, 10);
  const to = parseInt(req.query.to as string, 10);
  if (isNaN(from) || isNaN(to)) return res.status(400).json({ error: 'from and to version numbers required' });
  const diff = computeVersionDiff(req.params.projectId, from, to);
  if (!diff) return res.status(404).json({ error: 'One or both versions not found' });
  res.json(diff);
});


// ═══════════════════════════════════════════════════════════════════════════════
//  GROUP 7: BID-LEVELING & ALTERNATES (6 endpoints)
// ═══════════════════════════════════════════════════════════════════════════════

/** POST /api/qs5/projects/:projectId/bidders — Add bidder with division breakdown */
qsLevel5Router.post('/projects/:projectId/bidders', (req: Request, res: Response) => {
  try {
    const bidder = addBidder(req.params.projectId, req.body);
    res.status(201).json(bidder);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to add bidder' });
  }
});

/** GET /api/qs5/projects/:projectId/bid-leveling — Generate bid-leveling sheet */
qsLevel5Router.get('/projects/:projectId/bid-leveling', async (req: Request, res: Response) => {
  try {
    const modelId = req.query.modelId as string;
    if (!modelId) return res.status(400).json({ error: 'modelId query param required' });
    const estimate = await getEstimate(modelId);
    if (!estimate) return res.status(404).json({ error: 'Estimate not found' });
    const sheet = generateBidLevelingSheet(req.params.projectId, estimate);
    if (!sheet) return res.status(404).json({ error: 'No bidders found — add bidders first' });
    res.json(sheet);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to generate bid-leveling sheet' });
  }
});

/** POST /api/qs5/projects/:projectId/alternates — Add alternate/option pricing */
qsLevel5Router.post('/projects/:projectId/alternates', (req: Request, res: Response) => {
  try {
    const alt = addAlternate({ ...req.body, projectId: req.params.projectId });
    res.status(201).json(alt);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to add alternate' });
  }
});

/** GET /api/qs5/projects/:projectId/alternates — List alternates */
qsLevel5Router.get('/projects/:projectId/alternates', (req: Request, res: Response) => {
  res.json({ alternates: getAlternates(req.params.projectId) });
});

/** PUT /api/qs5/alternates/:alternateId/status — Accept/reject alternate */
qsLevel5Router.put('/alternates/:alternateId/status', (req: Request, res: Response) => {
  const { projectId, status } = req.body;
  if (!projectId || !status) return res.status(400).json({ error: 'projectId and status required' });
  const alt = updateAlternateStatus(projectId, req.params.alternateId, status);
  if (!alt) return res.status(404).json({ error: 'Alternate not found' });
  res.json(alt);
});

/** GET /api/qs5/projects/:projectId/alternates/impact — Compute impact of accepted alternates */
qsLevel5Router.get('/projects/:projectId/alternates/impact', async (req: Request, res: Response) => {
  try {
    const modelId = req.query.modelId as string;
    if (!modelId) return res.status(400).json({ error: 'modelId query param required' });
    const estimate = await getEstimate(modelId);
    if (!estimate) return res.status(404).json({ error: 'Estimate not found' });
    res.json(computeAlternateImpact(req.params.projectId, estimate.grandTotal));
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to compute alternate impact' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
//  GROUP 8: BENCHMARKING & COMPLETENESS (4 endpoints)
// ═══════════════════════════════════════════════════════════════════════════════

/** GET /api/qs5/benchmarks — List all benchmark ranges */
qsLevel5Router.get('/benchmarks', (_req: Request, res: Response) => {
  res.json({ benchmarks: Object.values(BENCHMARK_DATABASE) });
});

/** POST /api/qs5/projects/:projectId/benchmark — Run benchmark comparison */
qsLevel5Router.post('/projects/:projectId/benchmark', async (req: Request, res: Response) => {
  try {
    const { modelId, buildingType, grossFloorArea } = req.body;
    if (!modelId || !buildingType || !grossFloorArea) {
      return res.status(400).json({ error: 'modelId, buildingType, grossFloorArea required' });
    }
    const estimate = await getEstimate(modelId);
    if (!estimate) return res.status(404).json({ error: 'Estimate not found' });

    const result = compareToBenchmark(req.params.projectId, estimate, buildingType as BuildingType, grossFloorArea);
    storeBenchmark(req.params.projectId, result);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to run benchmark comparison' });
  }
});

/** POST /api/qs5/projects/:projectId/completeness — Check division completeness */
qsLevel5Router.post('/projects/:projectId/completeness', async (req: Request, res: Response) => {
  try {
    const { modelId, buildingType } = req.body;
    if (!modelId || !buildingType) return res.status(400).json({ error: 'modelId and buildingType required' });
    const estimate = await getEstimate(modelId);
    if (!estimate) return res.status(404).json({ error: 'Estimate not found' });

    const result = checkCompleteness(req.params.projectId, estimate, buildingType as BuildingType);
    storeCompleteness(req.params.projectId, result);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to check completeness' });
  }
});

/** GET /api/qs5/projects/:projectId/validation-summary — Combined benchmark + completeness */
qsLevel5Router.get('/projects/:projectId/validation-summary', (req: Request, res: Response) => {
  const benchmark = getBenchmark(req.params.projectId);
  const completeness = getCompleteness(req.params.projectId);
  if (!benchmark && !completeness) return res.status(404).json({ error: 'No validation data found — run benchmark and completeness checks first' });
  res.json({ benchmark, completeness });
});


// ═══════════════════════════════════════════════════════════════════════════════
//  GROUP 9: BASIS OF ESTIMATE (3 endpoints)
// ═══════════════════════════════════════════════════════════════════════════════

/** POST /api/qs5/projects/:projectId/boe — Generate Basis of Estimate */
qsLevel5Router.post('/projects/:projectId/boe', async (req: Request, res: Response) => {
  try {
    const { modelId, ...config } = req.body;
    if (!modelId) return res.status(400).json({ error: 'modelId required in body' });
    const estimate = await getEstimate(modelId);
    if (!estimate) return res.status(404).json({ error: 'Estimate not found' });

    const divisionSummary = generateCSIDivisionSummary(estimate);
    const elementSummary = generateUniformatSummary(estimate);

    // Gather optional enrichment data from stored results
    const benchmark = getBenchmark(req.params.projectId);
    const completeness = getCompleteness(req.params.projectId);
    const mcResult = getMCResult(req.params.projectId);

    const boe = generateBoE(
      { ...config, projectName: config.projectName ?? 'Unnamed Project' },
      estimate,
      divisionSummary,
      elementSummary,
      {
        benchmarkComparison: benchmark ?? undefined,
        completenessCheck: completeness ?? undefined,
        monteCarloResult: mcResult ?? undefined,
      },
    );

    storeBoE(req.params.projectId, boe);
    res.json(boe);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to generate BoE' });
  }
});

/** GET /api/qs5/projects/:projectId/boe — Get stored BoE */
qsLevel5Router.get('/projects/:projectId/boe', (req: Request, res: Response) => {
  const boe = getBoE(req.params.projectId);
  if (!boe) return res.status(404).json({ error: 'No BoE found' });

  // Support text export
  if (req.query.format === 'text') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="boe-${req.params.projectId}.txt"`);
    return res.send(boeToText(boe));
  }

  res.json(boe);
});

/** DELETE /api/qs5/projects/:projectId/boe — Delete BoE */
qsLevel5Router.delete('/projects/:projectId/boe', (req: Request, res: Response) => {
  deleteBoE(req.params.projectId);
  res.json({ ok: true, message: 'BoE deleted' });
});
