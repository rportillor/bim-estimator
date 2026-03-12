/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  EXPORT ROUTES — SOP Part 8
 *  EstimatorPro v3 — Professional Export API
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  REST endpoints for all export formats:
 *
 *  POST /api/export/ifc/:projectId               → IFC4 STEP file download
 *  POST /api/export/ms-project/:projectId         → MS Project XML download
 *  POST /api/export/xlsx/:projectId               → Multi-sheet SpreadsheetML
 *  POST /api/export/csv/boq/:projectId            → BOQ detail CSV
 *  POST /api/export/csv/divisions/:projectId      → Division summary CSV
 *  POST /api/export/csv/trades/:projectId         → Trade package CSV
 *  POST /api/export/csv/bid-leveling/:projectId   → Bid-leveling CSV
 *  POST /api/export/csv/clashes/:projectId        → Clash report CSV
 *  POST /api/export/csv/gaps/:projectId           → Gap register CSV
 *  POST /api/export/json/:projectId/:reportType   → Structured JSON
 *
 *  @module export-routes
 *  @version 1.0.0
 */

import { Router, Request, Response } from 'express';
import { storage } from '../storage';
import {
  generateBOQReport,
  generateBidLevelingSheet,
  generateClashReport,
  generateGapRegister,
  generateScheduleOfValues,
} from '../services/report-generator';
import {
  convertToIFCElements,
  generateIFC4File,
  generateMSProjectXML,
  buildBOQExportSheets,
  sheetsToSpreadsheetML,
  sheetToCSV,
  exportBOQtoCSV,
  exportDivisionSummaryCSV,
  exportTradePackageCSV,
  exportBidLevelingCSV,
  exportClashReportCSV,
  exportGapRegisterCSV,
  exportReportJSON,
} from '../services/integration-export-engine';


// ══════════════════════════════════════════════════════════════════════════════
//  SHARED HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function parseExportParams(body: any) {
  return {
    projectName: body.projectName || 'Untitled Project',
    overhead: Number(body.overhead) || 0.10,
    profit: Number(body.profit) || 0.08,
    contingency: Number(body.contingency) || 0.10,
    regionalFactor: Number(body.regionalFactor) || 1.0,
    regionName: body.regionName || '',
    taxRate: Number(body.taxRate) || 0.13,
    startDate: body.startDate || new Date().toISOString().substring(0, 10),
    authorName: body.authorName || 'EstimatorPro v3',
    retainageRate: Number(body.retainageRate) || 0.10,
  };
}

async function getEstimateLines(projectId: string, modelId?: string): Promise<any[]> {
  try {
    const estimate = await storage.getEstimateByProject?.(projectId);
    if (estimate?.lines && estimate.lines.length > 0) return estimate.lines;
  } catch { /* fallthrough */ }
  try {
    const mid = modelId || projectId;
    const elements = await storage.getBimElements(mid);
    if (elements && elements.length > 0) {
      const { buildEstimateForModel } = await import('../estimator/estimate-engine');
      const result = await buildEstimateForModel(mid);
      return result?.floors?.flatMap(f => f.lineItems) || [];
    }
  } catch { /* fallthrough */ }
  return [];
}

async function getBimElements(projectId: string, modelId?: string): Promise<any[]> {
  try {
    const elements = await storage.getBimElements(modelId || projectId);
    return elements || [];
  } catch { return []; }
}

function sendFile(res: Response, content: string, filename: string, mimeType: string) {
  const buf = Buffer.from(content, 'utf-8');
  res.setHeader('Content-Type', `${mimeType}; charset=utf-8`);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buf.length);
  res.send(buf);
}


// ══════════════════════════════════════════════════════════════════════════════
//  ROUTER
// ══════════════════════════════════════════════════════════════════════════════

export const exportRouter = Router();


// ─── 1. IFC4 STEP File ──────────────────────────────────────────────────────

exportRouter.post('/export/ifc/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const params = parseExportParams(req.body);

    const rawElements = await getBimElements(projectId, req.body.modelId);
    if (rawElements.length === 0) {
      return res.status(404).json({
        error: 'No BIM elements found for project',
        hint: 'Generate BIM model first: POST /api/bim/generate',
      });
    }

    const ifcElements = convertToIFCElements(rawElements);
    const ifc = generateIFC4File(ifcElements, params.projectName, params.authorName);

    const filename = `${params.projectName.replace(/[^a-zA-Z0-9]/g, '_')}.ifc`;
    sendFile(res, ifc, filename, 'application/x-step');
  } catch (error: any) {
    console.error('IFC export failed:', error);
    res.status(500).json({ error: 'Failed to export IFC file', details: error?.message });
  }
});

// ─── 2. MS Project XML ──────────────────────────────────────────────────────

exportRouter.post('/export/ms-project/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const params = parseExportParams(req.body);

    // Build BOQ → SOV → MS Project XML
    const estimateLines = await getEstimateLines(projectId, req.body.modelId);
    if (estimateLines.length === 0) {
      return res.status(404).json({ error: 'No estimate data found' });
    }

    const boqReport = generateBOQReport(
      projectId, estimateLines,
      { overhead: params.overhead, profit: params.profit, contingency: params.contingency },
      params.regionalFactor, params.regionName, params.taxRate, params.projectName,
    );

    let seqModel = null;
    try { seqModel = await storage.getSequencingModel?.(projectId); } catch {}
    const sov = generateScheduleOfValues(projectId, params.projectName, boqReport, seqModel, params.retainageRate);
    const xml = generateMSProjectXML(sov, params.projectName, params.startDate);

    const filename = `${params.projectName.replace(/[^a-zA-Z0-9]/g, '_')}_Schedule.xml`;
    sendFile(res, xml, filename, 'application/xml');
  } catch (error: any) {
    console.error('MS Project export failed:', error);
    res.status(500).json({ error: 'Failed to export MS Project file', details: error?.message });
  }
});

// ─── 3. Multi-Sheet SpreadsheetML XLSX ──────────────────────────────────────

exportRouter.post('/export/xlsx/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const params = parseExportParams(req.body);

    const estimateLines = await getEstimateLines(projectId, req.body.modelId);
    if (estimateLines.length === 0) {
      return res.status(404).json({ error: 'No estimate data found' });
    }

    const boqReport = generateBOQReport(
      projectId, estimateLines,
      { overhead: params.overhead, profit: params.profit, contingency: params.contingency },
      params.regionalFactor, params.regionName, params.taxRate, params.projectName,
    );

    const sheets = buildBOQExportSheets(boqReport);
    const xml = sheetsToSpreadsheetML(sheets, params.projectName);

    const filename = `${params.projectName.replace(/[^a-zA-Z0-9]/g, '_')}_BOQ.xml`;
    sendFile(res, xml, filename, 'application/vnd.ms-excel');
  } catch (error: any) {
    console.error('XLSX export failed:', error);
    res.status(500).json({ error: 'Failed to export spreadsheet', details: error?.message });
  }
});

// ─── 4. CSV Exports ─────────────────────────────────────────────────────────

// BOQ Detail CSV
exportRouter.post('/export/csv/boq/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const params = parseExportParams(req.body);
    const estimateLines = await getEstimateLines(projectId, req.body.modelId);
    if (estimateLines.length === 0) return res.status(404).json({ error: 'No estimate data found' });

    const boqReport = generateBOQReport(
      projectId, estimateLines,
      { overhead: params.overhead, profit: params.profit, contingency: params.contingency },
      params.regionalFactor, params.regionName, params.taxRate, params.projectName,
    );

    const csv = exportBOQtoCSV(boqReport);
    sendFile(res, csv, `BOQ_Detail_${projectId}.csv`, 'text/csv');
  } catch (error: any) {
    res.status(500).json({ error: 'CSV export failed', details: error?.message });
  }
});

// Division Summary CSV
exportRouter.post('/export/csv/divisions/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const params = parseExportParams(req.body);
    const estimateLines = await getEstimateLines(projectId, req.body.modelId);
    if (estimateLines.length === 0) return res.status(404).json({ error: 'No estimate data found' });

    const boqReport = generateBOQReport(
      projectId, estimateLines,
      { overhead: params.overhead, profit: params.profit, contingency: params.contingency },
      params.regionalFactor, params.regionName, params.taxRate, params.projectName,
    );

    const csv = exportDivisionSummaryCSV(boqReport);
    sendFile(res, csv, `Division_Summary_${projectId}.csv`, 'text/csv');
  } catch (error: any) {
    res.status(500).json({ error: 'CSV export failed', details: error?.message });
  }
});

// Trade Package CSV
exportRouter.post('/export/csv/trades/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const params = parseExportParams(req.body);
    const estimateLines = await getEstimateLines(projectId, req.body.modelId);
    if (estimateLines.length === 0) return res.status(404).json({ error: 'No estimate data found' });

    const boqReport = generateBOQReport(
      projectId, estimateLines,
      { overhead: params.overhead, profit: params.profit, contingency: params.contingency },
      params.regionalFactor, params.regionName, params.taxRate, params.projectName,
    );

    const csv = exportTradePackageCSV(boqReport);
    sendFile(res, csv, `Trade_Packages_${projectId}.csv`, 'text/csv');
  } catch (error: any) {
    res.status(500).json({ error: 'CSV export failed', details: error?.message });
  }
});

// Bid-Leveling CSV
exportRouter.post('/export/csv/bid-leveling/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const params = parseExportParams(req.body);
    const estimateLines = await getEstimateLines(projectId, req.body.modelId);
    if (estimateLines.length === 0) return res.status(404).json({ error: 'No estimate data found' });

    const boqReport = generateBOQReport(
      projectId, estimateLines,
      { overhead: params.overhead, profit: params.profit, contingency: params.contingency },
      params.regionalFactor, params.regionName, params.taxRate, params.projectName,
    );

    const sheet = generateBidLevelingSheet(boqReport, params.projectName);
    const csv = exportBidLevelingCSV(sheet);
    sendFile(res, csv, `Bid_Leveling_${projectId}.csv`, 'text/csv');
  } catch (error: any) {
    res.status(500).json({ error: 'CSV export failed', details: error?.message });
  }
});

// Clash Report CSV
exportRouter.post('/export/csv/clashes/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const params = parseExportParams(req.body);

    let clashResult = req.body.clashResult;
    if (!clashResult) {
      try { clashResult = await storage.getClashResults?.(projectId); } catch {}
    }
    if (!clashResult) return res.status(404).json({ error: 'No clash detection results found' });

    const report = generateClashReport(projectId, clashResult, params.projectName);
    const csv = exportClashReportCSV(report);
    sendFile(res, csv, `Clash_Report_${projectId}.csv`, 'text/csv');
  } catch (error: any) {
    res.status(500).json({ error: 'CSV export failed', details: error?.message });
  }
});

// Gap Register CSV
exportRouter.post('/export/csv/gaps/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const params = parseExportParams(req.body);

    let gaps = req.body.gaps;
    if (!gaps) {
      try { gaps = await storage.getProjectGaps?.(projectId); } catch {}
    }

    const register = generateGapRegister(projectId, params.projectName, gaps || []);
    const csv = exportGapRegisterCSV(register);
    sendFile(res, csv, `Gap_Register_${projectId}.csv`, 'text/csv');
  } catch (error: any) {
    res.status(500).json({ error: 'CSV export failed', details: error?.message });
  }
});

// ─── 5. Structured JSON Export ──────────────────────────────────────────────

exportRouter.post('/export/json/:projectId/:reportType', async (req: Request, res: Response) => {
  try {
    const { projectId, reportType } = req.params;
    const params = parseExportParams(req.body);

    // For JSON export, the caller can pass the report data directly
    if (req.body.reportData) {
      const json = exportReportJSON(req.body.reportData, reportType);
      return sendFile(res, json, `${reportType}_${projectId}.json`, 'application/json');
    }

    // Otherwise generate fresh based on reportType
    const estimateLines = await getEstimateLines(projectId, req.body.modelId);

    if (reportType === 'boq' && estimateLines.length > 0) {
      const boqReport = generateBOQReport(
        projectId, estimateLines,
        { overhead: params.overhead, profit: params.profit, contingency: params.contingency },
        params.regionalFactor, params.regionName, params.taxRate, params.projectName,
      );
      const json = exportReportJSON(boqReport, 'BOQ_FULL');
      return sendFile(res, json, `BOQ_${projectId}.json`, 'application/json');
    }

    res.status(400).json({
      error: 'Unsupported report type or no data available',
      hint: 'Pass reportData in body, or use reportType: boq',
    });
  } catch (error: any) {
    res.status(500).json({ error: 'JSON export failed', details: error?.message });
  }
});


// ─── 6. Export Catalog (list available formats) ─────────────────────────────

exportRouter.get('/export/formats', (_req: Request, res: Response) => {
  res.json({
    formats: [
      { id: 'ifc', name: 'IFC4 STEP', extension: '.ifc', mimeType: 'application/x-step', description: 'BIM model for Navisworks, Solibri, BIM 360' },
      { id: 'ms-project', name: 'MS Project XML', extension: '.xml', mimeType: 'application/xml', description: 'Schedule for MS Project / Primavera P6' },
      { id: 'xlsx', name: 'SpreadsheetML', extension: '.xml', mimeType: 'application/vnd.ms-excel', description: 'Multi-sheet BOQ workbook for Excel' },
      { id: 'csv-boq', name: 'BOQ CSV', extension: '.csv', mimeType: 'text/csv', description: 'Full BOQ detail with all columns' },
      { id: 'csv-divisions', name: 'Division Summary CSV', extension: '.csv', mimeType: 'text/csv', description: 'CSI division cost summary' },
      { id: 'csv-trades', name: 'Trade Package CSV', extension: '.csv', mimeType: 'text/csv', description: 'Trade package breakdown for tender' },
      { id: 'csv-bid-leveling', name: 'Bid-Leveling CSV', extension: '.csv', mimeType: 'text/csv', description: 'Bid comparison by trade' },
      { id: 'csv-clashes', name: 'Clash Report CSV', extension: '.csv', mimeType: 'text/csv', description: 'Clash detection results' },
      { id: 'csv-gaps', name: 'Gap Register CSV', extension: '.csv', mimeType: 'text/csv', description: 'RFI/gap register' },
      { id: 'json', name: 'Structured JSON', extension: '.json', mimeType: 'application/json', description: 'Machine-readable report data' },
    ],
  });
});
