/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  REPORT ROUTES — SOP Part 7
 *  EstimatorPro v3 — Professional QS Report API
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  REST endpoints for all 7 report types:
 *
 *  POST /api/reports/boq/:projectId               → Full BOQ report
 *  POST /api/reports/boq-summary/:projectId        → BOQ summary (divisions only)
 *  POST /api/reports/bid-leveling/:projectId       → Bid-leveling sheet
 *  POST /api/reports/clash/:projectId              → Clash detection report
 *  POST /api/reports/constructability/:projectId   → Constructability report
 *  POST /api/reports/executive-summary/:projectId  → Executive summary
 *  POST /api/reports/gap-register/:projectId       → Gap/RFI register
 *  POST /api/reports/schedule-of-values/:projectId → Schedule of values
 *  GET  /api/reports/:reportId                     → Retrieve cached report
 *  GET  /api/reports/:reportId/text                → Plain-text formatted report
 *  GET  /api/reports/project/:projectId            → List all reports for project
 *
 *  @module report-routes
 *  @version 1.0.0
 */

import { Router, Request, Response } from 'express';
import { storage } from '../storage';
import {
  generateBOQReport,
  generateBidLevelingSheet,
  generateClashReport,
  generateConstructabilityReport,
  generateExecutiveSummary,
  generateGapRegister,
  generateScheduleOfValues,
  formatBOQReportText,
  formatExecutiveSummaryText,
  type ReportType,
} from '../services/report-generator';


// ══════════════════════════════════════════════════════════════════════════════
//  IN-MEMORY REPORT CACHE
// ══════════════════════════════════════════════════════════════════════════════

interface CachedReport {
  reportId: string;
  projectId: string;
  reportType: ReportType;
  generatedAt: string;
  data: any;
}

const reportCache = new Map<string, CachedReport>();
const projectReportIndex = new Map<string, string[]>(); // projectId → reportId[]

function cacheReport(projectId: string, reportType: ReportType, data: any): string {
  const reportId = data?.metadata?.reportId || `RPT-${Date.now()}`;
  reportCache.set(reportId, {
    reportId,
    projectId,
    reportType,
    generatedAt: new Date().toISOString(),
    data,
  });
  const existing = projectReportIndex.get(projectId) || [];
  existing.push(reportId);
  projectReportIndex.set(projectId, existing);
  return reportId;
}


// ══════════════════════════════════════════════════════════════════════════════
//  SHARED HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/** Safely parse request body parameters with defaults */
function parseReportParams(body: any) {
  return {
    projectName: body.projectName || 'Untitled Project',
    overhead: Number(body.overhead) || 0.10,
    profit: Number(body.profit) || 0.08,
    contingency: Number(body.contingency) || 0.10,
    regionalFactor: Number(body.regionalFactor) || 1.0,
    regionName: body.regionName || '',
    taxRate: Number(body.taxRate) || 0.13,
    estimateClass: body.estimateClass || 'Class3',
    location: body.location || '',
    buildingType: body.buildingType || '',
    grossFloorArea_m2: Number(body.grossFloorArea_m2) || 0,
    storeyCount: Number(body.storeyCount) || 0,
    constructionType: body.constructionType || '',
    retainageRate: Number(body.retainageRate) || 0.10,
  };
}

/**
 * Retrieve estimate lines from the estimate engine.
 * Tries storage first, then falls back to building from BIM elements.
 */
async function getEstimateLines(projectId: string, modelId?: string): Promise<any[]> {
  // Attempt 1: Direct from storage (estimate-engine output)
  try {
    const estimate = await storage.getEstimateByProject?.(projectId);
    if (estimate?.lines && estimate.lines.length > 0) return estimate.lines;
  } catch { /* continue */ }

  // Attempt 2: Build from BIM elements (estimator/estimate-engine.ts buildEstimateForModel path)
  try {
    const mid = modelId || projectId;
    const elements = await storage.getBimElements(mid);
    if (elements && elements.length > 0) {
      // Import estimate engine dynamically to avoid circular deps
      const { buildEstimateForModel } = await import('../estimator/estimate-engine');
      const result = await buildEstimateForModel(mid);
      return result?.floors?.flatMap(f => f.lineItems) || [];
    }
  } catch { /* continue */ }

  return [];
}

/** Retrieve clash detection results */
async function getClashResults(projectId: string): Promise<any | null> {
  try {
    const result = await storage.getClashResults?.(projectId);
    return result || null;
  } catch { return null; }
}

/** Retrieve constructability analysis */
async function getConstructabilityAnalysis(projectId: string): Promise<any | null> {
  try {
    const result = await storage.getConstructabilityAnalysis?.(projectId);
    return result || null;
  } catch { return null; }
}

/** Retrieve Monte Carlo simulation result */
async function getMonteCarloResult(projectId: string): Promise<any | null> {
  try {
    const result = await storage.getMonteCarloResult?.(projectId);
    return result || null;
  } catch { return null; }
}

/** Retrieve 4D sequencing model */
async function getSequencingModel(projectId: string): Promise<any | null> {
  try {
    const result = await storage.getSequencingModel?.(projectId);
    return result || null;
  } catch { return null; }
}

/** Retrieve all gaps across all modules */
async function getAllGaps(projectId: string): Promise<any[]> {
  try {
    const gaps = await storage.getProjectGaps?.(projectId);
    return gaps || [];
  } catch { return []; }
}


// ══════════════════════════════════════════════════════════════════════════════
//  ROUTER
// ══════════════════════════════════════════════════════════════════════════════

export const reportRouter = Router();

// ─── 1. Full BOQ Report ──────────────────────────────────────────────────────

reportRouter.post('/reports/boq/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const params = parseReportParams(req.body);

    const estimateLines = await getEstimateLines(projectId, req.body.modelId);
    if (estimateLines.length === 0) {
      return res.status(404).json({
        error: 'No estimate data found for project',
        hint: 'Run estimate engine first: POST /api/bim/models/:modelId/estimate',
      });
    }

    const report = generateBOQReport(
      projectId,
      estimateLines,
      { overhead: params.overhead, profit: params.profit, contingency: params.contingency },
      params.regionalFactor,
      params.regionName,
      params.taxRate,
      params.projectName,
    );

    const reportId = cacheReport(projectId, 'BOQ_FULL', report);

    res.json({
      reportId,
      reportType: 'BOQ_FULL',
      summary: {
        lineCount: report.lines.length,
        divisionCount: report.divisionSubtotals.length,
        storeyCount: report.storeySubtotals.length,
        directCost: report.directCost,
        totalProjectCost: report.totalProjectCost,
        confidence: report.confidenceSummary.overallConfidence,
        gapCount: report.confidenceSummary.gapCount,
      },
      report,
    });
  } catch (error: any) {
    console.error('BOQ report generation failed:', error);
    res.status(500).json({ error: 'Failed to generate BOQ report', details: error?.message });
  }
});

// ─── 2. BOQ Summary (divisions only) ────────────────────────────────────────

reportRouter.post('/reports/boq-summary/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const params = parseReportParams(req.body);

    const estimateLines = await getEstimateLines(projectId, req.body.modelId);
    if (estimateLines.length === 0) {
      return res.status(404).json({ error: 'No estimate data found for project' });
    }

    const fullReport = generateBOQReport(
      projectId, estimateLines,
      { overhead: params.overhead, profit: params.profit, contingency: params.contingency },
      params.regionalFactor, params.regionName, params.taxRate, params.projectName,
    );

    // Return summary without individual line items
    const summary = {
      metadata: fullReport.metadata,
      divisionSubtotals: fullReport.divisionSubtotals,
      storeySubtotals: fullReport.storeySubtotals,
      tradePackageSubtotals: fullReport.tradePackageSubtotals,
      directCost: fullReport.directCost,
      overheadAmount: fullReport.overheadAmount,
      profitAmount: fullReport.profitAmount,
      contingencyAmount: fullReport.contingencyAmount,
      taxAmount: fullReport.taxAmount,
      totalProjectCost: fullReport.totalProjectCost,
      confidenceSummary: fullReport.confidenceSummary,
      gapWarnings: fullReport.gapWarnings,
    };

    const reportId = cacheReport(projectId, 'BOQ_SUMMARY', summary);
    res.json({ reportId, reportType: 'BOQ_SUMMARY', report: summary });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to generate BOQ summary', details: error?.message });
  }
});

// ─── 3. Bid-Leveling Sheet ──────────────────────────────────────────────────

reportRouter.post('/reports/bid-leveling/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const params = parseReportParams(req.body);

    const estimateLines = await getEstimateLines(projectId, req.body.modelId);
    if (estimateLines.length === 0) {
      return res.status(404).json({ error: 'No estimate data found for project' });
    }

    // Generate BOQ first (bid-leveling is built from BOQ)
    const boqReport = generateBOQReport(
      projectId, estimateLines,
      { overhead: params.overhead, profit: params.profit, contingency: params.contingency },
      params.regionalFactor, params.regionName, params.taxRate, params.projectName,
    );

    const sheet = generateBidLevelingSheet(boqReport, params.projectName);
    const reportId = cacheReport(projectId, 'BID_LEVELING', sheet);

    res.json({
      reportId,
      reportType: 'BID_LEVELING',
      summary: {
        tradePackageCount: sheet.tradePackages.length,
        totalBase: sheet.totalBase,
        totalAlternates: sheet.totalAlternates,
        totalAllowances: sheet.totalAllowances,
      },
      report: sheet,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to generate bid-leveling sheet', details: error?.message });
  }
});

// ─── 4. Clash Detection Report ──────────────────────────────────────────────

reportRouter.post('/reports/clash/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const params = parseReportParams(req.body);

    // Get clash detection results from SOP 6.4
    const clashResult = req.body.clashResult || await getClashResults(projectId);
    if (!clashResult) {
      return res.status(404).json({
        error: 'No clash detection results found',
        hint: 'Run clash detection first: POST /api/clash-detection/:projectId/run',
      });
    }

    const report = generateClashReport(projectId, clashResult, params.projectName);
    const reportId = cacheReport(projectId, 'CLASH_REPORT', report);

    res.json({
      reportId,
      reportType: 'CLASH_REPORT',
      summary: report.summary,
      report,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to generate clash report', details: error?.message });
  }
});

// ─── 5. Constructability Report ─────────────────────────────────────────────

reportRouter.post('/reports/constructability/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const params = parseReportParams(req.body);

    const analysis = req.body.analysis || await getConstructabilityAnalysis(projectId);
    if (!analysis) {
      return res.status(404).json({
        error: 'No constructability analysis found',
        hint: 'Run constructability engine first',
      });
    }

    const report = generateConstructabilityReport(projectId, analysis, params.projectName);
    const reportId = cacheReport(projectId, 'CONSTRUCTABILITY', report);

    res.json({
      reportId,
      reportType: 'CONSTRUCTABILITY',
      summary: {
        workAreaCount: report.workAreas.length,
        dependencyCount: report.tradeDependencies.length,
        safetyIssueCount: report.safetyIssues.length,
        holdPointCount: report.holdPoints.length,
        gapCount: report.gapCount,
        criticalIssueCount: report.criticalIssueCount,
      },
      report,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to generate constructability report', details: error?.message });
  }
});

// ─── 6. Executive Summary ───────────────────────────────────────────────────

reportRouter.post('/reports/executive-summary/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const params = parseReportParams(req.body);

    // Build BOQ report first
    const estimateLines = await getEstimateLines(projectId, req.body.modelId);
    if (estimateLines.length === 0) {
      return res.status(404).json({ error: 'No estimate data found for project' });
    }

    const boqReport = generateBOQReport(
      projectId, estimateLines,
      { overhead: params.overhead, profit: params.profit, contingency: params.contingency },
      params.regionalFactor, params.regionName, params.taxRate, params.projectName,
    );

    // Gather optional module outputs
    const clashData = await getClashResults(projectId);
    const clashRpt = clashData ? generateClashReport(projectId, clashData, params.projectName) : null;

    const constData = await getConstructabilityAnalysis(projectId);
    const constRpt = constData ? generateConstructabilityReport(projectId, constData, params.projectName) : null;

    const mcResult = await getMonteCarloResult(projectId);

    const summary = generateExecutiveSummary(
      projectId, params.projectName, boqReport, clashRpt, constRpt, mcResult,
      {
        location: params.location || params.regionName,
        buildingType: params.buildingType,
        grossFloorArea_m2: params.grossFloorArea_m2 || undefined,
        storeyCount: params.storeyCount || undefined,
        constructionType: params.constructionType,
        estimateClass: params.estimateClass,
      },
    );

    const reportId = cacheReport(projectId, 'EXECUTIVE_SUMMARY', summary);

    res.json({
      reportId,
      reportType: 'EXECUTIVE_SUMMARY',
      report: summary,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to generate executive summary', details: error?.message });
  }
});

// ─── 7. Gap/RFI Register ────────────────────────────────────────────────────

reportRouter.post('/reports/gap-register/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const params = parseReportParams(req.body);

    const gaps = req.body.gaps || await getAllGaps(projectId);

    const register = generateGapRegister(projectId, params.projectName, gaps);
    const reportId = cacheReport(projectId, 'GAP_REGISTER', register);

    res.json({
      reportId,
      reportType: 'GAP_REGISTER',
      summary: {
        totalGaps: register.totalGaps,
        criticalGaps: register.criticalGaps,
        rfisGenerated: register.rfisGenerated,
        byDiscipline: register.byDiscipline,
      },
      report: register,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to generate gap register', details: error?.message });
  }
});

// ─── 8. Schedule of Values ──────────────────────────────────────────────────

reportRouter.post('/reports/schedule-of-values/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const params = parseReportParams(req.body);

    const estimateLines = await getEstimateLines(projectId, req.body.modelId);
    if (estimateLines.length === 0) {
      return res.status(404).json({ error: 'No estimate data found for project' });
    }

    const boqReport = generateBOQReport(
      projectId, estimateLines,
      { overhead: params.overhead, profit: params.profit, contingency: params.contingency },
      params.regionalFactor, params.regionName, params.taxRate, params.projectName,
    );

    const seqModel = await getSequencingModel(projectId);

    const sov = generateScheduleOfValues(
      projectId, params.projectName, boqReport, seqModel, params.retainageRate,
    );

    const reportId = cacheReport(projectId, 'SCHEDULE_OF_VALUES', sov);

    res.json({
      reportId,
      reportType: 'SCHEDULE_OF_VALUES',
      summary: {
        phaseCount: sov.phases.length,
        totalContractValue: sov.totalContractValue,
        retainageRate: sov.retainageRate,
      },
      report: sov,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to generate schedule of values', details: error?.message });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
//  REPORT RETRIEVAL
// ══════════════════════════════════════════════════════════════════════════════

// Retrieve a cached report by ID
reportRouter.get('/reports/by-id/:reportId', async (req: Request, res: Response) => {
  const { reportId } = req.params;
  const cached = reportCache.get(reportId);
  if (!cached) {
    return res.status(404).json({ error: 'Report not found', reportId });
  }
  res.json(cached);
});

// Retrieve a report as formatted plain text
reportRouter.get('/reports/by-id/:reportId/text', async (req: Request, res: Response) => {
  const { reportId } = req.params;
  const cached = reportCache.get(reportId);
  if (!cached) {
    return res.status(404).json({ error: 'Report not found', reportId });
  }

  let text = '';
  switch (cached.reportType) {
    case 'BOQ_FULL':
      text = formatBOQReportText(cached.data);
      break;
    case 'EXECUTIVE_SUMMARY':
      text = formatExecutiveSummaryText(cached.data);
      break;
    default:
      text = JSON.stringify(cached.data, null, 2);
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(text);
});

// List all reports for a project
reportRouter.get('/reports/project/:projectId', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const reportIds = projectReportIndex.get(projectId) || [];
  const reports = reportIds
    .map(id => reportCache.get(id))
    .filter(Boolean)
    .map(r => ({
      reportId: r!.reportId,
      reportType: r!.reportType,
      generatedAt: r!.generatedAt,
    }));

  res.json({ projectId, count: reports.length, reports });
});
