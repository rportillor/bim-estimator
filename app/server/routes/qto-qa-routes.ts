/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  QTO QA ROUTES — SOP Part 5
 *  Model QTO Extraction and Quality Assurance
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Wires qto-qa-engine.ts (1,553 lines) into the REST API.
 *  Mount point: app.use('/api', authenticateToken, qtoQaRouter)  [routes.ts]
 *
 *  Endpoints:
 *    POST /api/projects/:projectId/qto-qa                Run full QTO extraction + QA
 *    GET  /api/projects/:projectId/qto-qa                Get stored QTO QA result
 *    GET  /api/projects/:projectId/qto-qa/summary        Text summary for meeting packs
 *    GET  /api/projects/:projectId/qto-qa/categories     Category/type rollups only
 *    GET  /api/projects/:projectId/qto-qa/materials      Materials table only
 *    GET  /api/projects/:projectId/qto-qa/mep            MEP connectivity only
 *    GET  /api/projects/:projectId/qto-qa/gaps           QA-generated gaps only
 *    GET  /api/projects/:projectId/qto-qa/gate           Model drop gate assessment
 *    DELETE /api/projects/:projectId/qto-qa              Clear stored result
 *
 *  SOP Part 5 QA Rules enforced:
 *    Rule 1: ID stability (≤5% IDs changed across drops)
 *    Rule 2: Level assignment (≥90% elements have level)
 *    Rule 3: SystemType/Service metadata (≥80% MEP elements)
 *    Rule 4: Placeholder material detection (By Category/Default → flagged)
 *    Rule 5: Orphan detection (hosted elements with missing host IDs)
 *    Rule 6: MEP connectivity (unconnected connectors)
 *
 *  Standards: CIQS, SOP Part 5, ISO 19650, CSI MasterFormat 2018
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { Router, type Request, type Response } from 'express';
import { storage } from '../storage';
import {
  runQTOExtraction,
  checkModelDropGate,
  formatQAReportSummary,
  generateGapsFromQA,
  type QTOExtractionResult,
} from '../services/qto-qa-engine';

export const qtoQaRouter = Router();

// ── In-memory store (keyed by projectId) ────────────────────────────────────
// Production: persist to DB. For now matches pattern of bim-coordination-router.
const qtoResultStore = new Map<string, QTOExtractionResult>();

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Map a BimElement (DB shape) → CoordinationElement (qto-qa-engine shape).
 * Follows the same mapping pattern used in bim-coordination-router.ts /discipline-test.
 * SOP 6.3: never invent data — missing fields produce undefined/false, not defaults.
 */
function toCoordinationElement(el: any): any {
  const props: Record<string, any> = el.properties || el.rawProperties || {};
  const geom: Record<string, any> = el.geometry || {};
  const bbox = el.bbox
    || geom.bbox
    || { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };

  const level   = el.storey || el.level || props['Level'] || props['storey'] || undefined;
  const sysType = el.systemType || props['SystemType'] || props['system_type'] || undefined;
  const mat     = el.material || props['Material'] || props['material'] || undefined;
  const hostId  = el.hostId || props['HostId'] || props['host_id'] || undefined;
  const isHosted = Boolean(hostId || el.isHosted || props['isHosted']);

  return {
    id:          String(el.id),
    idType:      el.idType || 'internal',
    category:    el.category    || el.elementType || 'Generic',
    familyType:  el.familyType  || el.elementType || el.name || 'Unknown',
    tag:         el.tag         || props['Mark']  || undefined,
    discipline:  el.discipline  || 'other',
    level,
    zone:        el.zone        || props['Zone']  || undefined,
    workset:     el.workset     || props['Workset'] || undefined,
    systemType:  sysType,
    systemName:  el.systemName  || props['SystemName'] || undefined,
    hostId,
    material:    mat,
    fireRating:  el.fireRating  || props['FireRating'] || undefined,
    serviceClearanceMm: props['ServiceClearance_mm'] ? Number(props['ServiceClearance_mm']) : undefined,
    bbox,
    connectors:  el.connectors  || [],
    hasLevel:    Boolean(level),
    hasSystemType: Boolean(sysType),
    hasMaterial: Boolean(mat),
    hasHostId:   Boolean(hostId),
    isHosted,
    modelVersion: el.modelVersion || el.version || 'unknown',
    modelDropDate: el.updatedAt  ? String(el.updatedAt) : undefined,
    rawProperties: props,
  };
}

// ── 1. POST /projects/:projectId/qto-qa — Run full extraction + QA ──────────
qtoQaRouter.post('/projects/:projectId/qto-qa', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { modelId, modelVersion, priorModelId, priorVersionLabel } = req.body;

    if (!modelId) {
      return res.status(400).json({
        error: 'modelId required in request body.',
        hint: 'POST body: { modelId: string, modelVersion?: string, priorModelId?: string }',
      });
    }

    // Fetch current model elements
    const rawElements = await storage.getBimElements(String(modelId));
    if (!rawElements || rawElements.length === 0) {
      return res.status(404).json({
        error: 'No BIM elements found for modelId.',
        hint: 'Run BIM generation first: POST /api/bim/generate',
      });
    }

    const currentElements = rawElements.map(toCoordinationElement);

    // Optionally fetch prior model elements for ID stability check (Rule 1)
    let priorElements: any[] | null = null;
    if (priorModelId) {
      const rawPrior = await storage.getBimElements(String(priorModelId));
      priorElements = rawPrior ? rawPrior.map(toCoordinationElement) : null;
    }

    const version = modelVersion || `v${new Date().toISOString().slice(0, 10)}`;

    // Run SOP Part 5 — full extraction + all 6 QA rules + maturity scoring
    const result = runQTOExtraction(
      currentElements,
      String(modelId),
      version,
      priorElements,
      priorVersionLabel,
    );

    // Store keyed by projectId (most recent run wins)
    qtoResultStore.set(projectId, result);

    // Gate assessment
    const gate = checkModelDropGate(result.qaResults);

    res.status(201).json({
      projectId,
      modelId: String(modelId),
      modelVersion: version,
      elementCount: result.elementCount,
      overallMaturity: result.overallMaturity,
      quantityReliability: result.quantityReliability,
      quantityReliabilityReason: result.quantityReliabilityReason ?? null,
      qaRulesPassed: [
        result.qaResults.rule1_idStability.pass,
        result.qaResults.rule2_levelAssignment.pass,
        result.qaResults.rule3_systemMetadata.pass,
        result.qaResults.rule4_placeholderMaterials.pass,
        result.qaResults.rule5_orphanDetection.pass,
        result.qaResults.rule6_connectivity.pass,
      ].filter(Boolean).length,
      qaRulesTotal: 6,
      gapCount: result.gaps.length,
      modelDropGate: gate,
      result,
    });

  } catch (err: any) {
    console.error('QTO QA error:', err);
    res.status(500).json({ error: 'QTO QA extraction failed', details: err?.message });
  }
});

// ── 2. GET /projects/:projectId/qto-qa — Retrieve stored result ─────────────
qtoQaRouter.get('/projects/:projectId/qto-qa', (req: Request, res: Response) => {
  const result = qtoResultStore.get(req.params.projectId);
  if (!result) {
    return res.status(404).json({
      error: 'No QTO QA result found for this project.',
      hint: `POST /api/projects/${req.params.projectId}/qto-qa to run extraction.`,
    });
  }
  const gate = checkModelDropGate(result.qaResults);
  res.json({ projectId: req.params.projectId, gate, result });
});

// ── 3. GET /projects/:projectId/qto-qa/summary — Text summary ───────────────
qtoQaRouter.get('/projects/:projectId/qto-qa/summary', (req: Request, res: Response) => {
  const result = qtoResultStore.get(req.params.projectId);
  if (!result) return res.status(404).json({ error: 'No QTO QA result found.' });

  const text = formatQAReportSummary(result);

  if (req.query.format === 'text') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="qto-qa-${req.params.projectId}.txt"`);
    return res.send(text);
  }

  res.json({ projectId: req.params.projectId, summary: text });
});

// ── 4. GET /projects/:projectId/qto-qa/categories — Category rollups ────────
qtoQaRouter.get('/projects/:projectId/qto-qa/categories', (req: Request, res: Response) => {
  const result = qtoResultStore.get(req.params.projectId);
  if (!result) return res.status(404).json({ error: 'No QTO QA result found.' });

  const discipline = req.query.discipline as string | undefined;
  const rollups = discipline
    ? result.categoryRollups.filter((r: any) => r.discipline === discipline)
    : result.categoryRollups;

  res.json({
    projectId: req.params.projectId,
    discipline: discipline ?? 'all',
    count: rollups.length,
    categoryRollups: rollups,
    maturityScores: result.maturityScores,
    overallMaturity: result.overallMaturity,
  });
});

// ── 5. GET /projects/:projectId/qto-qa/materials — Materials table ───────────
qtoQaRouter.get('/projects/:projectId/qto-qa/materials', (req: Request, res: Response) => {
  const result = qtoResultStore.get(req.params.projectId);
  if (!result) return res.status(404).json({ error: 'No QTO QA result found.' });

  // Optionally filter out placeholders
  const excludePlaceholders = req.query.excludePlaceholders === 'true';
  const placeholderTerms = ['by category', 'default', 'placeholder', 'unknown', '<by category>'];
  const materials = excludePlaceholders
    ? result.materialsTable.filter((m: any) =>
        !placeholderTerms.some(t => (m.material || '').toLowerCase().includes(t))
      )
    : result.materialsTable;

  res.json({
    projectId: req.params.projectId,
    excludePlaceholders,
    placeholderCount: result.qaResults.rule4_placeholderMaterials.withPlaceholder,
    count: materials.length,
    materialsTable: materials,
  });
});

// ── 6. GET /projects/:projectId/qto-qa/mep — MEP connectivity ───────────────
qtoQaRouter.get('/projects/:projectId/qto-qa/mep', (req: Request, res: Response) => {
  const result = qtoResultStore.get(req.params.projectId);
  if (!result) return res.status(404).json({ error: 'No QTO QA result found.' });

  const r3 = result.qaResults.rule3_systemMetadata;
  const r6 = result.qaResults.rule6_connectivity;

  res.json({
    projectId: req.params.projectId,
    mepConnectivity: result.mepConnectivity,
    systemMetadata: {
      pass: r3.pass,
      totalMEPElements: r3.totalMEPElements,
      withSystemType: r3.withSystemType,
      systemTypePercentage: r3.systemTypePercentage,
      threshold: r3.threshold,
      missingSystemType: r3.withoutSystemType,
    },
    connectivity: {
      pass: r6.pass,
      totalConnectors: r6.totalConnectors,
      unconnectedCount: r6.unconnectedCount,
      unconnectedConnectors: r6.unconnectedCount,  // alias — interface uses unconnectedCount
    },
  });
});

// ── 7. GET /projects/:projectId/qto-qa/gaps — QA-generated gaps ─────────────
qtoQaRouter.get('/projects/:projectId/qto-qa/gaps', (req: Request, res: Response) => {
  const result = qtoResultStore.get(req.params.projectId);
  if (!result) return res.status(404).json({ error: 'No QTO QA result found.' });

  const impact = req.query.impact as string | undefined;
  const gaps = impact
    ? result.gaps.filter((g: any) => g.impact === impact)
    : result.gaps;

  res.json({
    projectId: req.params.projectId,
    impact: impact ?? 'all',
    totalGaps: result.gaps.length,
    filteredCount: gaps.length,
    gaps,
  });
});

// ── 8. GET /projects/:projectId/qto-qa/gate — Model drop gate ───────────────
qtoQaRouter.get('/projects/:projectId/qto-qa/gate', (req: Request, res: Response) => {
  const result = qtoResultStore.get(req.params.projectId);
  if (!result) return res.status(404).json({ error: 'No QTO QA result found.' });

  const gate = checkModelDropGate(result.qaResults);

  res.json({
    projectId: req.params.projectId,
    modelId: result.modelId,
    modelVersion: result.modelVersion,
    accepted: gate.accepted,
    blockedBy: gate.blockedBy,
    recommendation: gate.recommendation,
    gateChecks: gate.gateChecks,
    quantityReliability: result.quantityReliability,
  });
});

// ── 9. DELETE /projects/:projectId/qto-qa — Clear stored result ─────────────
qtoQaRouter.delete('/projects/:projectId/qto-qa', (req: Request, res: Response) => {
  const existed = qtoResultStore.has(req.params.projectId);
  if (!existed) return res.status(404).json({ error: 'No QTO QA result found.' });
  qtoResultStore.delete(req.params.projectId);
  res.json({ ok: true, projectId: req.params.projectId, message: 'QTO QA result cleared.' });
});
