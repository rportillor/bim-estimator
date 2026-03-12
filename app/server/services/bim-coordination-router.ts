/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  BIM COORDINATION ROUTER — SOP Parts 7-13 API
 *  EstimatorPro v14.33 — Project-agnostic; projectName resolved from storage
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  ~20 REST endpoints connecting all BIM coordination SOP modules:
 *
 *  POST   /api/bim-coordination/clash-run           Run full clash detection
 *  GET    /api/bim-coordination/clashes/:runId       Get clashes for a run
 *  POST   /api/bim-coordination/issues               Create issue from clash group
 *  GET    /api/bim-coordination/issues               List/filter issues
 *  PUT    /api/bim-coordination/issues/:id           Update issue
 *  PUT    /api/bim-coordination/issues/:id/status    Transition issue status
 *  POST   /api/bim-coordination/issues/:id/rfi       Generate RFI from issue
 *  POST   /api/bim-coordination/bcf-export           Export BCF 2.1 package
 *  GET    /api/bim-coordination/viewpoints/:groupId  Get viewpoints for group
 *  POST   /api/bim-coordination/delta                Compute delta between runs
 *  GET    /api/bim-coordination/trends               Get trend analytics
 *  GET    /api/bim-coordination/schedule-linkage     Get schedule linkage
 *  GET    /api/bim-coordination/milestones           Get milestone protection
 *  POST   /api/bim-coordination/discipline-test      Run discipline-specific tests
 *  GET    /api/bim-coordination/penetrations         Get penetrations matrix
 *  GET    /api/bim-coordination/governance           Get governance status
 *  POST   /api/bim-coordination/meeting-pack         Generate meeting pack
 *  POST   /api/bim-coordination/model-gate           Run model drop gating
 *  GET    /api/bim-coordination/gaps                 Get gap register
 *  GET    /api/bim-coordination/sla                  Get SLA tracking
 *  GET    /api/bim-coordination/summary              Get coordination summary
 *
 *  POST   /api/bim-coordination/constructability/:projectId   Run constructability analysis (SOP 6.1/6.3)
 *  GET    /api/bim-coordination/constructability/:projectId   Get stored analysis
 *  GET    /api/bim-coordination/constructability/:projectId/work-areas    Work areas by level
 *  GET    /api/bim-coordination/constructability/:projectId/temp-works    Temporary works register
 *  GET    /api/bim-coordination/constructability/:projectId/trade-sequence  Trade execution order
 *  GET    /api/bim-coordination/constructability/:projectId/safety         Safety issues by severity
 *  GET    /api/bim-coordination/constructability/:projectId/summary        Text summary
 *  DELETE /api/bim-coordination/constructability/:projectId   Delete analysis
 *
 *  Standards: CIQS, ISO 19650, BCF 2.1, CSI MasterFormat 2018
 *  Depends on: All SOP Part 7-13 modules
 *
 *  C-1 FIX (v14.33): projectName is now resolved from storage.getProject() in
 *  all API responses. Missing projectId or unresolvable project generates an
 *  RFI flag — never falls back to a hardcoded project name string.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { Router, type Request, type Response } from 'express';
import { storage } from '../storage';

// ── Module imports ────────────────────────────────────────────────────────
import { runClashDetection, runClashDetectionForProject, emptyClearanceRequirements } from './clash-detection-engine';
import type { ClearanceRequirements, ClashDetectionResult } from './clash-detection-engine';
import { getEnabledTemplates, validateTemplateIntegrity } from './clash-test-templates';
import { runSpatialClashTests, type SpatialClashRunResult } from './spatial-clash-engine';
import { filterFalsePositives, type FilterResult } from './false-positive-filter';
import { deduplicateClashes, type DedupResult, type ClashGroup } from './dedup-engine';
import { IssueLogManager, type IssueRecord, type IssuePriority, type IssueStatus, isValidTransition } from './issue-log';
import { generateBCFTopics, serializeBCFToXML, generateIssueCSV, generateClashCSV, generateHTMLMeetingSummary } from './bcf-export';
import { generateViewpointSet, generateAllViewpoints, type ViewpointSet } from './viewpoint-generator';
import { computeDelta, DropHistory, type DeltaSummary, type DropSnapshot } from './delta-tracker';
import { generateTrendReport, type TrendReport, type MilestoneDefinition } from './trend-analytics';
import { linkIssuesToSchedule, type ScheduleActivity, type ScheduleLinkageResult } from './schedule-linkage';
import { assessMilestoneProtection, type ProjectMilestone, type MilestoneProtectionReport } from './milestone-protection';
import { runDisciplineTests, type DisciplineTestResult } from './discipline-tests';
import { buildPenetrationMatrix, exportPenetrationMatrixCSV, type PenetrationMatrix } from './penetrations-matrix';
import { getCurrentPhase, trackSLAs, generateMeetingPack, verifyClosures, type MeetingPack, type ActionItem, DEFAULT_CADENCE } from './governance-engine';
import { calculatePriorityScores, quickScoreFromSeverity, type ScoringInput } from './priority-scoring';
import { detectBatchGaps, buildGapRegister, createToleranceGap, type GapRecord, type GapRegister } from './gap-policy-engine';
import { runModelDropGate, type GateResult, DEFAULT_THRESHOLDS } from './model-drop-gating';
import { runBEPValidation, MOORINGS_BEP } from './bep-rules-engine';
import type { DisciplineCode } from './discipline-sop';
import {
  getAnalysis as getConstructabilityAnalysis,
  storeAnalysis as storeConstructabilityAnalysis,
  deleteAnalysis as deleteConstructabilityAnalysis,
  createEmptyAnalysis,
  getWorkAreasByLevel,
  getWorkAreaLevels,
  getTempWorksByType,
  buildTradeExecutionOrder,
  getSafetyIssuesBySeverity,
  runSafetyChecks,
  validateAnalysis as validateConstructabilityAnalysis,
  formatConstructabilitySummary,
  type ConstructabilityAnalysis,
} from './constructability-engine';

// ═══════════════════════════════════════════════════════════════════════════════
// IN-MEMORY STATE (production would use database)
// ═══════════════════════════════════════════════════════════════════════════════

const issueLog = new IssueLogManager();
const dropHistory = new DropHistory();
const gapRecords: GapRecord[] = [];
const clashRunResults = new Map<string, { result: ClashDetectionResult; dedupResult: DedupResult; filterResult: FilterResult }>();
const scheduleActivities: ScheduleActivity[] = [];
const projectMilestones: ProjectMilestone[] = [];
const trendMilestones: MilestoneDefinition[] = [];
const previousActions: ActionItem[] = [];
let meetingCounter = 0;
let latestPenetrationMatrix: PenetrationMatrix | null = null;

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve a project's display name from storage.
 *
 * Returns the project name when found. Returns an RFI flag string when:
 *   - projectId is absent from the request, OR
 *   - the project cannot be found in storage.
 *
 * The caller is responsible for propagating the RFI flag in the API response
 * so that downstream consumers know the name was not resolved.
 *
 * NO hardcoded project name fallback — per EstimatorPro no-defaults policy.
 */
async function resolveProjectName(projectId: string | undefined): Promise<string> {
  if (!projectId) {
    return '[PROJECT NAME — RFI REQUIRED: projectId not supplied in request]';
  }
  try {
    const project = await storage.getProject(projectId);
    if (!project) {
      return `[PROJECT NAME — RFI REQUIRED: project "${projectId}" not found in storage]`;
    }
    return project.name;
  } catch (err: any) {
    return `[PROJECT NAME — RFI REQUIRED: storage error resolving project "${projectId}": ${err.message}]`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

export const bimCoordinationRouter = Router();

// ── 1. POST /clash-run — Run full clash detection ────────────────────────
bimCoordinationRouter.post('/clash-run', async (req: Request, res: Response) => {
  try {
    const { modelId, projectId, clearances } = req.body;
    if (!modelId || !projectId) {
      return res.status(400).json({ error: 'modelId and projectId required' });
    }

    const projectClearances: ClearanceRequirements = clearances || emptyClearanceRequirements();

    // Run base clash detection
    const result = await runClashDetectionForProject(projectId, projectClearances);

    // Filter false positives
    const filterResult = filterFalsePositives(
      result.clashes.map(c => ({
        id: c.id,
        testId: 'CD-001',
        category: c.category,
        severity: c.severity,
        elementA: c.elementA as any,
        elementB: c.elementB as any,
        overlapVolume_m3: c.overlapVolume,
        clearanceRequired_mm: c.clearanceRequired,
        clearanceActual_mm: c.clearanceActual,
        penetrationDepth_mm: (c as any).penetrationDepth_mm || 0,
        location: c.location,
        description: c.description,
        codeReferences: [c.codeReference],
        toleranceSource: 'spec' as const,
        isHard: c.category === 'hard',
      }))
    );

    // Deduplicate
    const dedupResult = deduplicateClashes(filterResult.passed);

    // Store results
    const runId = `RUN-${Date.now()}`;
    clashRunResults.set(runId, { result, dedupResult, filterResult });

    // Add to drop history
    dropHistory.addSnapshot({
      runId,
      runDate: new Date().toISOString(),
      clashes: filterResult.passed,
      groups: dedupResult.groups,
    });

    // Check for gap tolerances from templates
    const templates = getEnabledTemplates();
    for (const t of templates) {
      if (t.tolerance_mm === null) {
        gapRecords.push(createToleranceGap(t.id, t.name, `${t.setA}_to_${t.setB}_clearance_mm`));
      }
    }

    // Auto-create issues from clash groups
    const newIssues = issueLog.createFromClashGroups(dedupResult.groups);

    res.json({
      runId,
      totalClashes: result.clashes.length,
      afterFilter: filterResult.passed.length,
      filtered: filterResult.filtered.length,
      uniqueGroups: dedupResult.groups.length,
      issuesCreated: newIssues.length,
      gapsDetected: gapRecords.length,
      summary: result.summary,
      filterSummary: filterResult.summary,
      dedupSummary: dedupResult.summary,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 2. GET /clashes/:runId — Get clashes for a run ──────────────────────
bimCoordinationRouter.get('/clashes/:runId', (req: Request, res: Response) => {
  const data = clashRunResults.get(req.params.runId);
  if (!data) return res.status(404).json({ error: 'Run not found' });

  res.json({
    clashes: data.result.clashes,
    groups: data.dedupResult.groups,
    filterSummary: data.filterResult.summary,
    dedupSummary: data.dedupResult.summary,
  });
});

// ── 3. POST /issues — Create issue ──────────────────────────────────────
bimCoordinationRouter.post('/issues', (req: Request, res: Response) => {
  try {
    const issue = issueLog.createManual(req.body);
    res.status(201).json(issue);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── 4. GET /issues — List/filter issues ─────────────────────────────────
bimCoordinationRouter.get('/issues', (req: Request, res: Response) => {
  const { status, priority, zone, discipline, owner } = req.query;
  const issues = issueLog.filter({
    status: status as IssueStatus | undefined,
    priority: priority as IssuePriority | undefined,
    zone: zone as string | undefined,
    discipline: discipline as any,
    owner: owner as string | undefined,
  });
  res.json({ total: issues.length, issues });
});

// ── 5. PUT /issues/:id — Update issue fields ────────────────────────────
bimCoordinationRouter.put('/issues/:id', (req: Request, res: Response) => {
  const updated = issueLog.updateFields(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Issue not found' });
  res.json(updated);
});

// ── 6. PUT /issues/:id/status — Transition issue status ─────────────────
bimCoordinationRouter.put('/issues/:id/status', (req: Request, res: Response) => {
  const { newStatus, user, comment } = req.body;
  if (!newStatus || !user) {
    return res.status(400).json({ error: 'newStatus and user required' });
  }
  const result = issueLog.updateStatus(req.params.id, newStatus, user, comment || '');
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json(result.issue);
});

// ── 7. POST /issues/:id/rfi — Generate RFI from issue ──────────────────
bimCoordinationRouter.post('/issues/:id/rfi', (req: Request, res: Response) => {
  const { toParty, fromParty, additionalQuestions } = req.body;
  const rfi = issueLog.generateRFI(
    req.params.id,
    toParty || 'Design Team',
    fromParty || 'BIM Coordinator',
    additionalQuestions || [],
  );
  if (!rfi) return res.status(404).json({ error: 'Issue not found' });
  res.status(201).json(rfi);
});

// ── 8. POST /bcf-export — Export BCF 2.1 package ────────────────────────
//
//  C-1 FIX (extended): projectName resolved from storage.getProject().
//  Caller SHOULD supply projectId in the request body. If absent or
//  unresolvable, the BCF <n> tag will contain an RFI flag — no hardcoded fallback.
//
bimCoordinationRouter.post('/bcf-export', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.body;
    const projectName = await resolveProjectName(projectId);

    const issues = issueLog.getAll();
    const topics = generateBCFTopics(issues);
    const xmlFiles = serializeBCFToXML(topics, projectName);

    // Also generate CSV
    const issueCSV = generateIssueCSV(issues);

    res.json({
      topicCount: topics.length,
      files: Object.fromEntries(xmlFiles),
      issueCSV,
      format: 'BCF 2.1',
      projectName,
      projectNameResolved: !projectName.startsWith('[PROJECT NAME — RFI'),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 9. GET /viewpoints/:groupId — Get viewpoints for clash group ────────
bimCoordinationRouter.get('/viewpoints/:groupId', (req: Request, res: Response) => {
  const groupId = req.params.groupId;

  // Find group across all runs
  let group: ClashGroup | undefined;
  for (const [, data] of clashRunResults) {
    group = data.dedupResult.groups.find(g => g.groupId === groupId);
    if (group) break;
  }

  if (!group) return res.status(404).json({ error: 'Clash group not found' });

  const viewpointSet = generateViewpointSet(group);
  res.json(viewpointSet);
});

// ── 10. POST /delta — Compute delta between runs ────────────────────────
bimCoordinationRouter.post('/delta', (req: Request, res: Response) => {
  const latestDelta = dropHistory.getLatestDelta();
  if (!latestDelta) {
    return res.status(400).json({ error: 'Need at least 2 model drops to compute delta' });
  }
  res.json(latestDelta);
});

// ── 11. GET /trends — Get trend analytics ───────────────────────────────
bimCoordinationRouter.get('/trends', (req: Request, res: Response) => {
  const deltas = dropHistory.getDeltas();
  const issues = issueLog.getAll();
  const report = generateTrendReport(deltas, issues, trendMilestones);
  res.json(report);
});

// ── 12. GET /schedule-linkage — Get schedule linkage ────────────────────
bimCoordinationRouter.get('/schedule-linkage', (req: Request, res: Response) => {
  if (scheduleActivities.length === 0) {
    return res.json({ message: 'No schedule activities loaded', links: [] });
  }

  // Get all clash groups across runs
  const allGroups: ClashGroup[] = [];
  for (const [, data] of clashRunResults) {
    allGroups.push(...data.dedupResult.groups);
  }

  const issues = issueLog.getAll();
  const result = linkIssuesToSchedule(issues, scheduleActivities);
  res.json(result);
});

// ── 13. GET /milestones — Get milestone protection ──────────────────────
bimCoordinationRouter.get('/milestones', (req: Request, res: Response) => {
  if (projectMilestones.length === 0) {
    return res.json({ message: 'No milestones configured', milestones: [] });
  }

  const issues = issueLog.getAll();
  const allGroups: ClashGroup[] = [];
  for (const [, data] of clashRunResults) {
    allGroups.push(...data.dedupResult.groups);
  }

  const linkageResult = linkIssuesToSchedule(issues, scheduleActivities);
  const report = assessMilestoneProtection(projectMilestones, issues, linkageResult);
  res.json(report);
});

// ── 14. POST /discipline-test — Run discipline-specific tests ───────────
bimCoordinationRouter.post('/discipline-test', async (req: Request, res: Response) => {
  try {
    const { modelId, projectId: dtProjectId } = req.body;
    if (!modelId) return res.status(400).json({ error: 'modelId required' });

    const bimElements = await storage.getBimElements(modelId);
    if (!bimElements || bimElements.length === 0) {
      return res.status(404).json({ error: 'No BIM elements found' });
    }

    // Convert to ResolvedElements (simplified)
    const resolved = bimElements.map((el: any) => ({
      id: String(el.id),
      elementId: String(el.id),
      name: el.name || 'Unknown',
      elementType: el.elementType || 'Generic',
      category: el.category || 'Other',
      discipline: el.discipline || 'other',
      material: el.material || '',
      storey: el.storey || '',
      elevation: el.elevation || 0,
      bbox: el.bbox || { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
      dimensions: el.dimensions || { length: 0, width: 0, height: 0, area: 0, volume: 0 },
      csiDivision: el.csiDivision || '',
      properties: el.properties || {},
      raw: el,
    }));

    const result = runDisciplineTests(resolved);

    // Build penetrations matrix — resolve projectName from optional projectId in body
    if (result.penetrations.length > 0) {
      const dtProjectName = await resolveProjectName(dtProjectId);
      latestPenetrationMatrix = buildPenetrationMatrix(result.penetrations, dtProjectName);
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 15. GET /penetrations — Get penetrations matrix ─────────────────────
bimCoordinationRouter.get('/penetrations', (req: Request, res: Response) => {
  if (!latestPenetrationMatrix) {
    return res.json({ message: 'No penetration data — run discipline-test first' });
  }

  const format = req.query.format;
  if (format === 'csv') {
    const csv = exportPenetrationMatrixCSV(latestPenetrationMatrix);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="penetrations-matrix.csv"');
    return res.send(csv);
  }

  res.json(latestPenetrationMatrix);
});

// ── 16. GET /governance — Get governance status ─────────────────────────
bimCoordinationRouter.get('/governance', (req: Request, res: Response) => {
  const phase = getCurrentPhase();
  const slaItems = trackSLAs(issueLog.getAll());
  const issueSummary = issueLog.getSummary();

  res.json({
    currentPhase: phase,
    issueSummary,
    sla: {
      onTrack: slaItems.filter(s => s.slaStatus === 'ON_TRACK').length,
      atRisk: slaItems.filter(s => s.slaStatus === 'AT_RISK').length,
      breached: slaItems.filter(s => s.slaStatus === 'BREACHED').length,
      escalationsRequired: slaItems.filter(s => s.escalationRequired).length,
    },
    templateIntegrity: validateTemplateIntegrity(),
  });
});

// ── 17. POST /meeting-pack — Generate meeting pack ──────────────────────
//
//  C-1 FIX: projectName is now resolved from storage.getProject().
//  Callers SHOULD supply projectId in the request body. If absent or the
//  project cannot be found, the response will contain an RFI flag in the
//  projectName field — no hardcoded fallback.
//
bimCoordinationRouter.post('/meeting-pack', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.body;

    // Resolve project name from storage — RFI flag if unresolvable
    const projectName = await resolveProjectName(projectId);

    meetingCounter++;
    const issues = issueLog.getAll();
    const latestDelta = dropHistory.getLatestDelta();
    const deltas = dropHistory.getDeltas();
    const trendReport = generateTrendReport(deltas, issues, trendMilestones);

    let milestoneReport: MilestoneProtectionReport | null = null;
    if (projectMilestones.length > 0) {
      const allGroups: ClashGroup[] = [];
      for (const [, data] of clashRunResults) allGroups.push(...data.dedupResult.groups);
      const linkageResult = linkIssuesToSchedule(issues, scheduleActivities);
      milestoneReport = assessMilestoneProtection(projectMilestones, issues, linkageResult);
    }

    const pack = generateMeetingPack(
      meetingCounter, issues, latestDelta, trendReport,
      milestoneReport, previousActions, projectName,
    );

    // Generate HTML summary using the storage-resolved project name
    const html = generateHTMLMeetingSummary({
      projectName,
      meetingDate: pack.meetingDate,
      attendees: [],
      issues,
      clashGroups: [],
      deltaHighlights: latestDelta ? [
        `New: ${latestDelta.newCount}`,
        `Resolved: ${latestDelta.resolvedCount}`,
        `Persistent: ${latestDelta.persistentCount}`,
        `Regressions: ${latestDelta.regressionCount}`,
      ] : undefined,
    });

    res.json({
      pack,
      htmlSummary: html,
      projectName,
      projectNameResolved: !projectName.startsWith('[PROJECT NAME — RFI'),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 18. POST /model-gate — Run model drop gating ────────────────────────
bimCoordinationRouter.post('/model-gate', async (req: Request, res: Response) => {
  try {
    const { modelId, discipline } = req.body;
    if (!modelId || !discipline) {
      return res.status(400).json({ error: 'modelId and discipline required' });
    }

    const bimElements = await storage.getBimElements(modelId);
    if (!bimElements) return res.status(404).json({ error: 'Model not found' });

    const gateResult = runModelDropGate(
      String(modelId),
      bimElements as any[],
      discipline as DisciplineCode,
    );

    // Detect gaps in gated elements
    const newGaps = detectBatchGaps(
      (bimElements as any[]).map(el => ({
        elementId: String(el.id),
        elementName: el.name || 'Unknown',
        discipline: discipline as DisciplineCode,
        level: el.storey || '',
        zone: el.properties?.zone || '',
        properties: el.properties || {},
      }))
    );
    gapRecords.push(...newGaps);

    res.json({ gate: gateResult, newGaps: newGaps.length, totalGaps: gapRecords.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 19. GET /gaps — Get gap register ────────────────────────────────────
//
//  C-1 FIX (extended): projectName resolved from storage.getProject().
//  Caller SHOULD supply ?projectId= as a query parameter. RFI flag if absent.
//
bimCoordinationRouter.get('/gaps', async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    const projectName = await resolveProjectName(projectId);
    const register = buildGapRegister(gapRecords, projectName);
    res.json({ ...register, projectNameResolved: !projectName.startsWith('[PROJECT NAME — RFI') });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 20. GET /sla — Get SLA tracking ─────────────────────────────────────
bimCoordinationRouter.get('/sla', (req: Request, res: Response) => {
  const items = trackSLAs(issueLog.getAll());
  res.json({
    total: items.length,
    onTrack: items.filter(s => s.slaStatus === 'ON_TRACK').length,
    atRisk: items.filter(s => s.slaStatus === 'AT_RISK').length,
    breached: items.filter(s => s.slaStatus === 'BREACHED').length,
    items,
  });
});

// ── 21. GET /summary — Full coordination summary ────────────────────────
//
//  C-1 FIX: project name is now resolved from storage.getProject().
//  Callers SHOULD supply ?projectId= as a query parameter. If absent or
//  the project cannot be found, the response will contain an RFI flag in
//  the project field — no hardcoded fallback.
//
bimCoordinationRouter.get('/summary', async (req: Request, res: Response) => {
  try {
    const projectId = req.query.projectId as string | undefined;

    // Resolve project name from storage — RFI flag if unresolvable
    const projectName = await resolveProjectName(projectId);

    const issues = issueLog.getAll();
    const issueSummary = issueLog.getSummary();
    const phase = getCurrentPhase();
    const slaItems = trackSLAs(issues);
    const deltas = dropHistory.getDeltas();
    const trendReport = deltas.length > 0 ? generateTrendReport(deltas, issues, trendMilestones) : null;
    const gapRegister = buildGapRegister(gapRecords, projectName);

    res.json({
      project: projectName,
      projectNameResolved: !projectName.startsWith('[PROJECT NAME — RFI'),
      engine: 'EstimatorPro-BIMCoordination-v1',
      standards: ['CIQS', 'ISO 19650', 'BCF 2.1', 'CSI MasterFormat 2018', 'NBC 2020', 'OBC 2024'],
      currentPhase: phase,
      issues: issueSummary,
      sla: {
        onTrack: slaItems.filter(s => s.slaStatus === 'ON_TRACK').length,
        atRisk: slaItems.filter(s => s.slaStatus === 'AT_RISK').length,
        breached: slaItems.filter(s => s.slaStatus === 'BREACHED').length,
      },
      clashRuns: clashRunResults.size,
      modelDrops: dropHistory.getSnapshots().length,
      gaps: gapRegister.summary,
      trends: trendReport ? {
        velocity: trendReport.velocity,
        alertCount: trendReport.alerts.length,
        hotspotCount: trendReport.hotspots.length,
      } : null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTRUCTABILITY ANALYSIS — SOP Parts 6.1, 6.3
// ═══════════════════════════════════════════════════════════════════════════════

/** POST /constructability/:projectId
 *  Initialise a fresh constructability analysis, run automated safety checks,
 *  store the result, and return the analysis + validation report.
 *  Body (all optional): workAreas[], tempWorks[], tradeDependencies[]
 *  SOP 6.3: missing clearances/access routes are flagged as GAPs — never assumed.
 */
bimCoordinationRouter.post('/constructability/:projectId', (req: Request, res: Response) => {
  const { projectId } = req.params;

  const analysis = createEmptyAnalysis(projectId);

  // Seed any caller-supplied data (e.g. from document extraction)
  if (Array.isArray(req.body.workAreas)) {
    analysis.workAreas.push(...req.body.workAreas);
  }
  if (Array.isArray(req.body.tempWorks)) {
    analysis.tempWorks.push(...req.body.tempWorks);
  }
  if (Array.isArray(req.body.tradeDependencies)) {
    analysis.tradeDependencies.push(...req.body.tradeDependencies);
  }

  // Run automated safety checks (egress, electrical clearance, access routes)
  runSafetyChecks(analysis, projectId);

  // Persist
  storeConstructabilityAnalysis(analysis);

  const validation = validateConstructabilityAnalysis(analysis);

  res.status(201).json({
    projectId,
    analysis,
    validation,
    message: validation.isComplete
      ? 'Constructability analysis complete.'
      : `Analysis initialised — ${validation.missingItems.length} item(s) require attention.`,
  });
});

/** GET /constructability/:projectId
 *  Return the stored constructability analysis for a project.
 */
bimCoordinationRouter.get('/constructability/:projectId', (req: Request, res: Response) => {
  const analysis = getConstructabilityAnalysis(req.params.projectId);
  if (!analysis) {
    return res.status(404).json({
      error: 'No constructability analysis found.',
      hint: `POST /api/bim-coordination/constructability/${req.params.projectId} to run one.`,
    });
  }
  res.json({ analysis, validation: validateConstructabilityAnalysis(analysis) });
});

/** GET /constructability/:projectId/work-areas
 *  Return work areas, optionally filtered by ?level= query param.
 */
bimCoordinationRouter.get('/constructability/:projectId/work-areas', (req: Request, res: Response) => {
  const analysis = getConstructabilityAnalysis(req.params.projectId);
  if (!analysis) return res.status(404).json({ error: 'No constructability analysis found.' });

  const level = req.query.level as string | undefined;
  const workAreas = level ? getWorkAreasByLevel(analysis, level) : analysis.workAreas;
  const levels = getWorkAreaLevels(analysis);

  res.json({ projectId: req.params.projectId, level: level ?? 'all', levels, workAreas, count: workAreas.length });
});

/** GET /constructability/:projectId/temp-works
 *  Return the temporary works register, optionally filtered by ?type= query param.
 */
bimCoordinationRouter.get('/constructability/:projectId/temp-works', (req: Request, res: Response) => {
  const analysis = getConstructabilityAnalysis(req.params.projectId);
  if (!analysis) return res.status(404).json({ error: 'No constructability analysis found.' });

  const type = req.query.type as string | undefined;
  const tempWorks = type ? getTempWorksByType(analysis, type as any) : analysis.tempWorks;

  res.json({ projectId: req.params.projectId, type: type ?? 'all', tempWorks, count: tempWorks.length });
});

/** GET /constructability/:projectId/trade-sequence
 *  Return the computed trade execution order from the dependency matrix.
 */
bimCoordinationRouter.get('/constructability/:projectId/trade-sequence', (req: Request, res: Response) => {
  const analysis = getConstructabilityAnalysis(req.params.projectId);
  if (!analysis) return res.status(404).json({ error: 'No constructability analysis found.' });

  const sequence = buildTradeExecutionOrder(analysis);

  res.json({
    projectId: req.params.projectId,
    tradeCount: sequence.order.length,
    sequence: sequence.order,
    circularDependencies: sequence.circularDependencies,
    holdPoints: analysis.tradeDependencies.filter(d => d.holdPoint),
    inspectionPoints: analysis.tradeDependencies.filter(d => d.inspectionRequired),
  });
});

/** GET /constructability/:projectId/safety
 *  Return safety issues, optionally filtered by ?severity= (critical|major|minor).
 */
bimCoordinationRouter.get('/constructability/:projectId/safety', (req: Request, res: Response) => {
  const analysis = getConstructabilityAnalysis(req.params.projectId);
  if (!analysis) return res.status(404).json({ error: 'No constructability analysis found.' });

  const severity = req.query.severity as 'critical' | 'major' | 'minor' | undefined;
  if (severity && !['critical', 'major', 'minor'].includes(severity)) {
    return res.status(400).json({ error: `Invalid severity "${severity}". Use: critical, major, minor` });
  }

  const issues = severity ? getSafetyIssuesBySeverity(analysis, severity) : analysis.safetyIssues;

  res.json({
    projectId: req.params.projectId,
    severity: severity ?? 'all',
    issues,
    count: issues.length,
    gaps: analysis.gaps.filter(g =>
      g.parameterName.includes('safety') || g.parameterName.includes('clearance')
    ),
  });
});

/** GET /constructability/:projectId/summary
 *  Return a formatted text summary suitable for meeting packs / dashboards.
 */
bimCoordinationRouter.get('/constructability/:projectId/summary', (req: Request, res: Response) => {
  const analysis = getConstructabilityAnalysis(req.params.projectId);
  if (!analysis) return res.status(404).json({ error: 'No constructability analysis found.' });

  const text = formatConstructabilitySummary(req.params.projectId);
  const validation = validateConstructabilityAnalysis(analysis);

  if (req.query.format === 'text') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(text);
  }

  res.json({ projectId: req.params.projectId, summary: text, validation });
});

/** DELETE /constructability/:projectId
 *  Delete the stored constructability analysis for a project.
 */
bimCoordinationRouter.delete('/constructability/:projectId', (req: Request, res: Response) => {
  const deleted = deleteConstructabilityAnalysis(req.params.projectId);
  if (!deleted) return res.status(404).json({ error: 'No constructability analysis found.' });
  res.json({ ok: true, projectId: req.params.projectId, message: 'Constructability analysis deleted.' });
});
