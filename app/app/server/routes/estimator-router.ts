/**
 * EstimatorPro v2 — Master Estimator Router
 * ============================================================
 * Wires all 23 estimator modules to REST endpoints.
 * 
 * Architecture:
 *   estimate-engine.ts → buildEstimateForModel(modelId) → EstimateSummary
 *   budget-structure.ts → buildBudgetStructure(estimate, config) → BudgetStructure
 *   Everything else consumes EstimateSummary + BudgetStructure
 * 
 * Mount point: app.use("/api", estimatorRouter);
 * 
 * Endpoints:
 *   GET  /estimates/:modelId/full       — Full estimate + budget
 *   GET  /estimates/:modelId/budget     — 8-tier budget structure
 *   GET  /estimates/:modelId/uniformat  — Dual CSI/UNIFORMAT summary
 *   GET  /estimates/:modelId/boe        — Basis of Estimate
 *   GET  /estimates/:modelId/sov        — Schedule of Values
 *   GET  /estimates/:modelId/benchmark  — Benchmark validation
 *   GET  /estimates/:modelId/codes      — Codes & Standards register
 *   GET  /estimates/:modelId/labor      — Loaded labor rates
 *   GET  /estimates/:modelId/wbs        — WBS/CBS structure
 *   GET  /estimates/:modelId/rebar      — Rebar density calculations
 *   GET  /estimates/:modelId/variants   — Rate variance (PERT 3-point)
 *   GET  /estimates/:modelId/nrm2       — NRM1/NRM2 measurement annotations
 *   POST /estimates/:modelId/montecarlo — Monte Carlo probabilistic simulation
 *   POST /estimates/:modelId/bid-leveling — Bid leveling / tender reconciliation
 *   POST /estimates/:modelId/snapshot   — Create version snapshot
 *   GET  /estimates/:modelId/history    — Version history
 *   POST /estimates/:modelId/rfis       — Generate RFIs for missing data
 *   GET  /estimates/:modelId/rfis       — List RFIs
 *   POST /estimates/:modelId/quotes     — Register vendor quote
 *   GET  /estimates/:modelId/quotes     — Get quote register
 *   POST /estimates/:modelId/alternates — Create alternate / VE item
 *   GET  /estimates/:modelId/alternates — Get alternates summary
 *   GET  /estimator/status              — Health check
 * ============================================================
 */

import { Router, type Request, type Response } from "express";
import { storage } from "../storage";

// ─── Module Imports ──────────────────────────────────────────
import { buildEstimateForModel, type EstimateSummary } from "../estimator/estimate-engine";
import { buildBudgetStructure, formatBudgetSummary, type BudgetStructure, type BudgetConfig } from "../estimator/budget-structure";
import { generateDualSummary, formatDualSummaryReport, generateCrossWalkTable } from "../estimator/uniformat-mapping";
import { generateBasisOfEstimate, type BoeConfig } from "../estimator/boe-generator";
import { generateScheduleOfValues, formatSOVReport, type SOVConfig } from "../estimator/schedule-of-values";
import { runBenchmark, formatBenchmarkReport, registerBenchmarkPack, getAllPacks, type BenchmarkConfig } from "../estimator/benchmark-core";
import { buildCodesStandardsRegister, applyCodeAdders, type RegisterConfig } from "../estimator/codes-standards-register";
import { generateLaborBurdenSummary } from "../estimator/labor-burden";
import { buildWBSStructure } from "../estimator/wbs-cbs";
import { generateRebarSummary, type SeismicZone } from "../estimator/rebar-density";
import { generateRateVariants, formatRateVariantReport } from "../estimator/rate-variants";
import { createSnapshot, type RevisionMetadata, type EstimateSnapshot } from "../estimator/estimate-versioning";
import { registerMissingData, generateRFI, type MissingDataItem, type RFI } from "../estimator/rfi-generator";
import { registerQuote, generateQuoteRegister, formatQuoteRegisterReport, type VendorQuote } from "../estimator/vendor-quotes";
import { createAlternate, generateAlternateSummary } from "../estimator/alternates-tracking";
import { annotateWithNRM2, formatNRM2Report } from "../estimator/nrm2-measurement";
import { runMonteCarloSimulation, formatMonteCarloReport, type MonteCarloConfig } from "../estimator/monte-carlo";
import { generateBidLeveling, formatBidLevelingReport, type BidPackage, type BidLevelConfig } from "../estimator/bid-leveling";

// ─── Benchmark Pack Registration (runs once at import time) ──
import { BUILDING_PACK } from "../estimator/benchmark-pack-building";
import { CIVIL_PACK } from "../estimator/benchmark-pack-civil";
import { PIPELINE_PACK } from "../estimator/benchmark-pack-pipeline";
import { INFRASTRUCTURE_PACK } from "../estimator/benchmark-pack-infrastructure";
import { MINING_PACK } from "../estimator/benchmark-pack-mining";

try {
  registerBenchmarkPack(BUILDING_PACK);
  registerBenchmarkPack(CIVIL_PACK);
  registerBenchmarkPack(PIPELINE_PACK);
  registerBenchmarkPack(INFRASTRUCTURE_PACK);
  registerBenchmarkPack(MINING_PACK);
  console.log("✅ 5 benchmark packs registered (" + getAllPacks().length + " total)");
} catch (err) {
  console.warn("⚠️  Some benchmark packs failed to register:", err);
}

// ─── Est-3 FIX: All 4 stores are now persisted to DB via storage methods ──
// estimateSnapshots, estimateRfis, vendorQuotes, estimateAlternates tables
// created in schema.ts; npm run db:push required on first deploy after this fix.

// ─── Helpers ─────────────────────────────────────────────────

/** Build estimate + budget in one call (reused across endpoints) */
async function buildEstimateAndBudget(
  modelId: string,
  budgetConfig: BudgetConfig = {}
): Promise<{ estimate: EstimateSummary; budget: BudgetStructure }> {
  const estimate = await buildEstimateForModel(modelId);
  const budget = buildBudgetStructure(estimate, budgetConfig);
  return { estimate, budget };
}

/** Standard error handler */
function handleError(res: Response, action: string, error: unknown) {
  console.error(`❌ Estimator: ${action}:`, error);
  res.status(500).json({
    error: `Failed to ${action}`,
    message: error instanceof Error ? error.message : String(error)
  });
}

/**
 * Resolve project name from a BIM model ID.
 *
 * Walks: modelId → BimModel.projectId → Project.name
 * Returns an RFI flag string on any failure — never a hardcoded name.
 * Per EstimatorPro no-defaults policy.
 */
async function resolveProjectNameFromModel(modelId: string): Promise<string> {
  try {
    const { storage } = await import('../storage');
    const model = await storage.getBimModel(modelId);
    if (!model) {
      return `[PROJECT NAME — RFI REQUIRED: model "${modelId}" not found in storage]`;
    }
    if (!model.projectId) {
      return `[PROJECT NAME — RFI REQUIRED: model "${modelId}" has no projectId]`;
    }
    const project = await storage.getProject(model.projectId);
    if (!project) {
      return `[PROJECT NAME — RFI REQUIRED: project "${model.projectId}" not found in storage]`;
    }
    return project.name;
  } catch (err: any) {
    return `[PROJECT NAME — RFI REQUIRED: storage error resolving model "${modelId}": ${err.message}]`;
  }
}

/**
 * Resolve project location from a BIM model ID.
 * Walks: modelId → BimModel.projectId → Project.location
 * Returns RFI flag on any failure — never a hardcoded location.
 */
async function resolveProjectLocationFromModel(modelId: string): Promise<string> {
  try {
    const { storage } = await import('../storage');
    const model = await storage.getBimModel(modelId);
    if (!model) return `[LOCATION — RFI REQUIRED: model "${modelId}" not found]`;
    if (!model.projectId) return `[LOCATION — RFI REQUIRED: model "${modelId}" has no projectId]`;
    const project = await storage.getProject(model.projectId);
    if (!project) return `[LOCATION — RFI REQUIRED: project "${model.projectId}" not found]`;
    return project.location;
  } catch (err: any) {
    return `[LOCATION — RFI REQUIRED: storage error for model "${modelId}": ${err.message}]`;
  }
}

/**
 * Resolve project name directly from a project ID.
 *
 * Returns an RFI flag string on any failure — never a hardcoded name.
 * Per EstimatorPro no-defaults policy.
 */
async function resolveProjectNameFromProjectId(projectId: string | undefined): Promise<string> {
  if (!projectId) {
    return '[PROJECT NAME — RFI REQUIRED: projectId not supplied in request]';
  }
  try {
    const { storage } = await import('../storage');
    const project = await storage.getProject(projectId);
    if (!project) {
      return `[PROJECT NAME — RFI REQUIRED: project "${projectId}" not found in storage]`;
    }
    return project.name;
  } catch (err: any) {
    return `[PROJECT NAME — RFI REQUIRED: storage error resolving project "${projectId}": ${err.message}]`;
  }
}

// ─── Router ──────────────────────────────────────────────────

export const estimatorRouter = Router();


// ══════════════════════════════════════════════════════════════
//  CORE: Full Estimate + Budget
// ══════════════════════════════════════════════════════════════

/**
 * GET /estimates/:modelId/full
 * 
 * Returns the complete professional estimate:
 *   - EstimateSummary (212 CSI rates, per-floor breakdown)
 *   - BudgetStructure (8-tier: direct→tax)
 *   - AACE classification
 *   - Budget summary text
 * 
 * This is the PRIMARY estimate endpoint — replaces all dummies.
 */
estimatorRouter.get("/estimates/:modelId/full", async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const config: BudgetConfig = {
      projectName: (req.query.projectName as string) || "Estimate",
      region: (req.query.region as string) || undefined,
      taxRate: req.query.taxRate ? parseFloat(req.query.taxRate as string) : undefined,
      overheadPercent: req.query.ohPercent ? parseFloat(req.query.ohPercent as string) : undefined,
      profitPercent: req.query.profitPercent ? parseFloat(req.query.profitPercent as string) : undefined,
    };

    const { estimate, budget } = await buildEstimateAndBudget(modelId, config);
    const summary = formatBudgetSummary(budget);

    res.json({
      modelId,
      estimate,
      budget,
      summary,
      engine: "estimator/estimate-engine.ts",
    });
  } catch (e) { handleError(res, "generate full estimate", e); }
});


// ══════════════════════════════════════════════════════════════
//  BUDGET: 8-tier Structure Only
// ══════════════════════════════════════════════════════════════

estimatorRouter.get("/estimates/:modelId/budget", async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const config: BudgetConfig = {
      projectName: (req.query.projectName as string) || undefined,
      region: (req.query.region as string) || undefined,
      taxRate: req.query.taxRate ? parseFloat(req.query.taxRate as string) : undefined,
    };

    const { estimate, budget } = await buildEstimateAndBudget(modelId, config);
    const summary = formatBudgetSummary(budget);

    res.json({ modelId, budget, summary });
  } catch (e) { handleError(res, "build budget structure", e); }
});


// ══════════════════════════════════════════════════════════════
//  UNIFORMAT: Dual CSI/Elemental Summary
// ══════════════════════════════════════════════════════════════

estimatorRouter.get("/estimates/:modelId/uniformat", async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const estimate = await buildEstimateForModel(modelId);
    const dualSummary = generateDualSummary(estimate);
    const crossWalk = generateCrossWalkTable(estimate);
    const report = formatDualSummaryReport(dualSummary);

    res.json({ modelId, dualSummary, crossWalk, report });
  } catch (e) { handleError(res, "generate UNIFORMAT summary", e); }
});


// ══════════════════════════════════════════════════════════════
//  BOE: Basis of Estimate Document
// ══════════════════════════════════════════════════════════════

estimatorRouter.get("/estimates/:modelId/boe", async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const { estimate, budget } = await buildEstimateAndBudget(modelId);
    const dualSummary = generateDualSummary(estimate);

    const boeConfig: BoeConfig = {
      project: {
        projectName: (req.query.projectName as string) || await resolveProjectNameFromModel(modelId),
        location: (req.query.location as string) || await resolveProjectLocationFromModel(modelId),
        buildingType: (req.query.buildingType as string) || "Residential - Multi-Unit",
        client: (req.query.client as string) || "Project Owner",
        buildingCodeEdition: "OBC 2024",
      },
      preparedBy: (req.query.preparedBy as string) || "EstimatorPro v2 — CIQS Methodology",
      reviewedBy: (req.query.reviewedBy as string) || undefined,
      reportDate: (req.query.date as string) || undefined,
      documents: [],
      assumptions: [],
      exclusions: [],
      qualifications: [],
    };

    const boe = generateBasisOfEstimate(estimate, budget, dualSummary, boeConfig);
    res.json({ modelId, boe });
  } catch (e) { handleError(res, "generate Basis of Estimate", e); }
});


// ══════════════════════════════════════════════════════════════
//  SOV: Schedule of Values
// ══════════════════════════════════════════════════════════════

estimatorRouter.get("/estimates/:modelId/sov", async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const { estimate, budget } = await buildEstimateAndBudget(modelId);

    const sovConfig: SOVConfig = {
      projectName: (req.query.projectName as string) || await resolveProjectNameFromModel(modelId),
      retainagePercent: req.query.retainagePercent
        ? parseFloat(req.query.retainagePercent as string)
        : 10,
      detailLevel: (req.query.detailLevel as any) || "division",
      includeGeneralConditions: req.query.includeGC !== "false",
      includeOverheadProfit: req.query.includeOHP !== "false",
    };

    const sov = generateScheduleOfValues(estimate, { ...sovConfig, retainagePercent: sovConfig.retainagePercent });
    const report = formatSOVReport(sov);

    res.json({ modelId, sov, report });
  } catch (e) { handleError(res, "generate Schedule of Values", e); }
});


// ══════════════════════════════════════════════════════════════
//  BENCHMARK: Validation Against Industry Data
// ══════════════════════════════════════════════════════════════

estimatorRouter.get("/estimates/:modelId/benchmark", async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const { estimate, budget } = await buildEstimateAndBudget(modelId);

    const benchConfig: BenchmarkConfig = {
      projectCategory: (req.query.category as any) || "building",
      projectType: (req.query.type as string) || "residential-multi-family",
      projectQuantity: req.query.quantity ? parseFloat(req.query.quantity as string) : 0,
      projectName: (req.query.projectName as string) || await resolveProjectNameFromModel(modelId),
    };

    const report = runBenchmark(estimate, budget, benchConfig);
    const formatted = formatBenchmarkReport(report);

    res.json({
      modelId,
      report,
      formatted,
      registeredPacks: getAllPacks().map(p => ({
        category: p.category,
        name: p.categoryName,
        benchmarkCount: p.benchmarks.length,
      })),
    });
  } catch (e) { handleError(res, "run benchmark validation", e); }
});


// ══════════════════════════════════════════════════════════════
//  CODES: Codes & Standards Register
// ══════════════════════════════════════════════════════════════

estimatorRouter.get("/estimates/:modelId/codes", async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const estimate = await buildEstimateForModel(modelId);

    const registerConfig: RegisterConfig = {
      province: (req.query.province as any) || "ON",
      buildingType: (req.query.buildingType as string) || "residential-multi-family",
      constructionType: (req.query.constructionType as any) || "combustible",
      projectCategory: (req.query.projectCategory as any) || "building",
      occupancyGroup: (req.query.occupancyGroup as string) || "Group C - Residential",
      numberOfStoreys: req.query.storeys ? parseInt(req.query.storeys as string) : undefined,
      buildingArea: req.query.area ? parseFloat(req.query.area as string) : undefined,
      sprinklered: req.query.sprinklered !== "false",
      seismicCategory: (req.query.seismicCategory as string) || undefined,
      energyCode: (req.query.energyCode as any) || "SB-12",
    };

    const register = buildCodesStandardsRegister(registerConfig, estimate);
    const adderResults = applyCodeAdders(estimate, register.adders);

    res.json({ modelId, register, adderResults });
  } catch (e) { handleError(res, "build codes register", e); }
});


// ══════════════════════════════════════════════════════════════
//  LABOR: Loaded Labor Rates
// ══════════════════════════════════════════════════════════════

estimatorRouter.get("/estimates/:modelId/labor", async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;

    // generateLaborBurdenSummary uses Ontario 2025 defaults if no args passed
    // Custom trades/statutory can be passed via body in a POST variant later
    const summary = generateLaborBurdenSummary();

    res.json({ modelId, summary });
  } catch (e) { handleError(res, "generate labor burden summary", e); }
});


// ══════════════════════════════════════════════════════════════
//  WBS/CBS: Work & Cost Breakdown Structure
// ══════════════════════════════════════════════════════════════

estimatorRouter.get("/estimates/:modelId/wbs", async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const estimate = await buildEstimateForModel(modelId);

    const projectName = (req.query.projectName as string) || await resolveProjectNameFromModel(modelId);
    const projectCode = (req.query.projectCode as string) || "MOOR-2025";

    const structure = buildWBSStructure(projectName, projectCode, estimate);

    res.json({ modelId, structure });
  } catch (e) { handleError(res, "build WBS/CBS structure", e); }
});


// ══════════════════════════════════════════════════════════════
//  REBAR: Density Calculations
// ══════════════════════════════════════════════════════════════

estimatorRouter.get("/estimates/:modelId/rebar", async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const estimate = await buildEstimateForModel(modelId);

    const seismicZone: SeismicZone = (req.query.seismicZone as SeismicZone) || "low";
    const projectName = (req.query.projectName as string) || await resolveProjectNameFromModel(modelId);

    // Extract concrete elements from estimate line items
    const concreteElements: { elementType: any; concreteVolume: number }[] = [];
    for (const floor of estimate.floors) {
      for (const item of floor.lineItems) {
        // Match concrete items (Division 03)
        if (item.csiDivision === "03" && item.unit === "m³" && item.quantity > 0) {
          // Map description to element type
          const desc = (item.description || "").toLowerCase();
          let elementType = "slab-on-grade" as any;
          if (desc.includes("wall")) elementType = "shear-wall";
          else if (desc.includes("column")) elementType = "column-tied";
          else if (desc.includes("beam")) elementType = "beam";
          else if (desc.includes("foundation") || desc.includes("footing")) elementType = "strip-footing";
          else if (desc.includes("slab")) elementType = "slab-on-grade";
          else if (desc.includes("stair")) elementType = "stair";

          concreteElements.push({ elementType, concreteVolume: item.quantity });
        }
      }
    }

    const summary = generateRebarSummary(concreteElements, projectName, seismicZone);

    res.json({ modelId, summary, concreteElementsFound: concreteElements.length });
  } catch (e) { handleError(res, "generate rebar summary", e); }
});


// ══════════════════════════════════════════════════════════════
//  VARIANTS: Rate Variance / PERT 3-Point
// ══════════════════════════════════════════════════════════════

estimatorRouter.get("/estimates/:modelId/variants", async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const estimate = await buildEstimateForModel(modelId);

    const summary = generateRateVariants(estimate);
    const report = formatRateVariantReport(summary);

    res.json({ modelId, summary, report });
  } catch (e) { handleError(res, "generate rate variants", e); }
});


// ══════════════════════════════════════════════════════════════
//  VERSIONING: Snapshot & History
// ══════════════════════════════════════════════════════════════

estimatorRouter.post("/estimates/:modelId/snapshot", async (req: Request, res: Response) => {
  // Est-3 FIX: persisted to estimateSnapshots table instead of in-memory Map
  try {
    const { modelId } = req.params;
    const { estimate, budget } = await buildEstimateAndBudget(modelId);

    const existingCount = await storage.countEstimateRfis(modelId); // reuse count pattern
    const existing = await storage.getEstimateSnapshots(modelId);
    const revNum = existing.length + 1;
    const metadata: RevisionMetadata = {
      revisionNumber: revNum,
      revisionLabel: `Rev ${String.fromCharCode(64 + revNum)}`,
      description: req.body.description || "Estimate snapshot",
      createdBy: req.body.createdBy || "EstimatorPro",
      createdAt: new Date().toISOString(),
      status: req.body.status || "draft",
      reason: req.body.changeReason || req.body.reason || 'Snapshot',
    };

    const projectQty = req.body.projectQuantity ? parseFloat(req.body.projectQuantity) : 0;
    const measUnit = req.body.measurementUnit || "m\u00B2";

    const snapshot = createSnapshot(estimate, budget, metadata, projectQty, measUnit);

    const saved = await storage.createEstimateSnapshot({
      modelId,
      revisionNumber: revNum,
      revisionLabel: metadata.revisionLabel,
      note: metadata.description ?? null,
      snapshot: snapshot as any,
    });

    res.json({ modelId, snapshot, savedId: saved.id, totalSnapshots: revNum });
  } catch (e) { handleError(res, "create estimate snapshot", e); }
});

estimatorRouter.get("/estimates/:modelId/history", async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const snapshots = await storage.getEstimateSnapshots(modelId);

    res.json({
      modelId,
      snapshotCount: snapshots.length,
      snapshots: snapshots.map(s => {
        const snap = s.snapshot as any;
        return {
          id: s.id,
          revision: s.revisionNumber,
          revisionLabel: s.revisionLabel,
          description: s.note,
          createdAt: s.createdAt,
          grandTotal: snap?.grandTotal ?? 0,
          lineItemCount: snap?.totalLineItems ?? 0,
        };
      }),
    });
  } catch (e) { handleError(res, "retrieve estimate history", e); }
});


// ══════════════════════════════════════════════════════════════
//  RFI: Missing Data → RFI Generation
// ══════════════════════════════════════════════════════════════

estimatorRouter.post("/estimates/:modelId/rfis", async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const { items, projectName, createdBy } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: "Missing required field: items (array of MissingDataItem objects)"
      });
    }

    // Register missing data items
    const registered = items.map((item: Partial<MissingDataItem>) =>
      registerMissingData({
        category: item.category || "dimension",
        csiDivision: item.csiDivision || "01",
        description: item.description || "Missing data",
        impact: item.impact || "medium",
        discoveredBy: item.discoveredBy || createdBy || "EstimatorPro",
        floorLabel: item.floorLabel,
        drawingRef: item.drawingRef,
        specSection: item.specSection,
        costImpactLow: item.costImpactLow || 0,
        costImpactHigh: item.costImpactHigh || 0,
      })
    );

    // Generate RFI — resolve projectName from model if not supplied in body
    const existingRfis = await storage.getEstimateRfis(modelId);
    const rfiNumber = existingRfis.length + 1;
    const resolvedProjectName = projectName || await resolveProjectNameFromModel(modelId);
    const rfi = generateRFI(
      registered,
      resolvedProjectName,
      createdBy || "EstimatorPro",
      rfiNumber
    );

    // Store
    await storage.createEstimateRfi({
      modelId,
      rfiNumber,
      subject: rfi.subject,
      priority: rfi.priority || 'normal',
      status: rfi.status || 'draft',
      rfiData: rfi as any,
    });

    res.json({ modelId, rfi, totalRFIs: rfiNumber });
  } catch (e) { handleError(res, "generate RFI", e); }
});

estimatorRouter.get("/estimates/:modelId/rfis", async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const rfis = (await storage.getEstimateRfis(modelId)).map(r => r.rfiData as any);

    res.json({
      modelId,
      rfiCount: rfis.length,
      rfis: rfis.map((r: any) => ({
        id: r.rfiId,
        subject: r.subject,
        status: r.status,
        priority: r.priority,
        costImpactLow: r.costImpactLow,
        costImpactHigh: r.costImpactHigh,
      })),
    });
  } catch (e) { handleError(res, "retrieve RFIs", e); }
});


// ══════════════════════════════════════════════════════════════
//  VENDOR QUOTES: Quote Register
// ══════════════════════════════════════════════════════════════

estimatorRouter.post("/estimates/:modelId/quotes", async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const q = req.body;

    if (!q.vendorName || !q.csiDivision) {
      return res.status(400).json({
        error: "Required fields: vendorName, csiDivision, csiSubdivision, lineItemDescription"
      });
    }

    const estimate = await buildEstimateForModel(modelId);

    const quote = registerQuote({
      quoteId: "Q-" + Date.now().toString(36),
      vendorName: q.vendorName,
      vendorContact: q.vendorContact || "",
      vendorEmail: q.vendorEmail,
      vendorPhone: q.vendorPhone,
      csiDivision: q.csiDivision,
      csiSubdivision: q.csiSubdivision || q.csiDivision + "00",
      lineItemDescription: q.lineItemDescription || q.description || "",
      scopeDescription: q.scopeDescription || q.scope || "",
      quotedAmount: q.quotedAmount || 0,
      quotedUnitRate: q.quotedUnitRate,
      quotedUnit: q.quotedUnit,
      quotedQuantity: q.quotedQuantity,
      includesLabor: q.includesLabor ?? true,
      includesMaterial: q.includesMaterial ?? true,
      includesEquipment: q.includesEquipment ?? false,
      laborAmount: q.laborAmount,
      materialAmount: q.materialAmount,
      equipmentAmount: q.equipmentAmount,
      quoteDate: q.quoteDate || new Date().toISOString().split("T")[0],
      validUntil: q.validUntil || "",
      status: "received",
      conditions: q.conditions,
      exclusions: q.exclusions || [],
      estimateAmount: q.estimateAmount,
    }, estimate);

    // Store
    await storage.createVendorQuote({
      modelId,
      vendorName: quote.vendorName || 'Unknown',
      csiDivision: quote.csiDivision ?? null,
      description: quote.lineItemDescription ?? null,
      amount: String(quote.quotedAmount ?? 0),
      currency: 'CAD',
      validUntil: quote.validUntil ? new Date(quote.validUntil) : null,
      quoteData: quote as any,
    });

    const allQuotes = await storage.getVendorQuotes(modelId);
    res.json({ modelId, quote, totalQuotes: allQuotes.length });
  } catch (e) { handleError(res, "register vendor quote", e); }
});

estimatorRouter.get("/estimates/:modelId/quotes", async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const quotes = (await storage.getVendorQuotes(modelId)).map(q => q.quoteData as any) as VendorQuote[];
    const { buildEstimateForModel } = await import('../estimator/estimate-engine');
    const estimate = await buildEstimateForModel(modelId);
    const register = estimate ? generateQuoteRegister(quotes, estimate, '') : { comparisons: [], overallSavingsMin: 0, overallSavingsMax: 0 };
    const report = formatQuoteRegisterReport(register as any);

    res.json({ modelId, register, report });
  } catch (e) { handleError(res, "retrieve quote register", e); }
});


// ══════════════════════════════════════════════════════════════
//  ALTERNATES: VE Tracking
// ══════════════════════════════════════════════════════════════

estimatorRouter.post("/estimates/:modelId/alternates", async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const d = req.body;

    if (!d.description || d.alternateCost === undefined) {
      return res.status(400).json({
        error: "Required fields: description, name, alternateCost, baseBidCost"
      });
    }

    const existingAlts = await storage.getEstimateAlternates(modelId);
    const altNumber = existingAlts.length + 1;

    const alternate = createAlternate({
      alternateId: "ALT-" + String(altNumber).padStart(3, "0"),
      alternateNumber: altNumber,
      name: d.name || d.description.substring(0, 40),
      description: d.description,
      type: d.type || "substitution",
      origin: d.origin || "value-engineering",
      status: d.status || "proposed",
      affectedCSIDivisions: d.affectedCSIDivisions || [d.csiDivision || "01"],
      affectedFloors: d.affectedFloors,
      drawingRefs: d.drawingRefs,
      specRefs: d.specRefs,
      baseBidCost: d.baseBidCost || 0,
      alternateCost: d.alternateCost,
      laborImpact: d.laborImpact || 0,
      materialImpact: d.materialImpact || 0,
      equipmentImpact: d.equipmentImpact || 0,
      scheduleImpactDays: d.scheduleImpactDays || 0,
      leadTimeWeeks: d.leadTimeWeeks,
      qualityImpact: d.qualityImpact,
      performanceNotes: d.performanceNotes,
      lifeCycleImpact: d.lifeCycleImpact,
      proposedDate: d.proposedDate || new Date().toISOString().split("T")[0],
    });

    // Store
    await storage.createEstimateAlternate({
      modelId,
      title: alternate.name || alternate.alternateId || 'Alternate',
      description: alternate.description ?? null,
      deltaAmount: (alternate as any).netDelta != null ? String((alternate as any).netDelta) : null,
      currency: 'CAD',
      alternateData: alternate as any,
    });

    res.json({ modelId, alternate, totalAlternates: altNumber });
  } catch (e) { handleError(res, "create alternate", e); }
});

estimatorRouter.get("/estimates/:modelId/alternates", async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const alternates = (await storage.getEstimateAlternates(modelId)).map(a => a.alternateData as any);

    const { estimate, budget } = await buildEstimateAndBudget(modelId);
    const summary = generateAlternateSummary(
      alternates as any,
      budget.GRAND_TOTAL,
      (req.query.projectName as string) || await resolveProjectNameFromModel(modelId)
    );

    res.json({ modelId, summary, alternates });
  } catch (e) { handleError(res, "retrieve alternates", e); }
});


// ══════════════════════════════════════════════════════════════
//  STATUS: Module Health Check
// ══════════════════════════════════════════════════════════════

estimatorRouter.get("/estimator/status", async (_req: Request, res: Response) => {
  const modules = [
    "estimate-engine", "budget-structure", "uniformat-mapping",
    "boe-generator", "schedule-of-values", "benchmark-core",
    "benchmark-pack-building", "benchmark-pack-civil", "benchmark-pack-pipeline",
    "benchmark-pack-infrastructure", "benchmark-pack-mining",
    "codes-standards-register", "labor-burden", "wbs-cbs",
    "rebar-density", "rate-variants", "estimate-versioning",
    "rfi-generator", "vendor-quotes", "alternates-tracking",
    "nrm2-measurement", "monte-carlo", "bid-leveling",
  ];

  const packs = getAllPacks();

  res.json({
    engine: "EstimatorPro v2",
    version: "1.0.0",
    modulesWired: modules.length,
    modules,
    benchmarkPacks: packs.map(p => p.categoryName),
    inMemoryStores: { note: "Est-3: all 4 stores now persisted to DB" },
    status: "operational",
  });
});


// ══════════════════════════════════════════════════════════════
//  NRM2 MEASUREMENT ANNOTATION
// ══════════════════════════════════════════════════════════════

/**
 * GET /api/estimates/:modelId/nrm2
 * Annotates estimate with NRM1/NRM2 measurement rules per RICS standards.
 * Returns enriched line items with measurementBasis, nrm2Rule, and NRM1 groups.
 */
estimatorRouter.get("/estimates/:modelId/nrm2", async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const estimate = await buildEstimateForModel(modelId);
    const measured = annotateWithNRM2(estimate);
    const report = formatNRM2Report(measured);

    res.json({
      modelId,
      measured,
      report,
      engine: "estimator/nrm2-measurement.ts",
    });
  } catch (error) {
    handleError(res, "generate NRM2 annotations", error);
  }
});

// ══════════════════════════════════════════════════════════════
//  MONTE CARLO SIMULATION
// ══════════════════════════════════════════════════════════════

/**
 * POST /api/estimates/:modelId/montecarlo
 * Runs probabilistic cost simulation (P10/P25/P50/P75/P90).
 * Body (all optional): { iterations, seed, riskItems, quantityVariance }
 */
estimatorRouter.post("/estimates/:modelId/montecarlo", async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const estimate = await buildEstimateForModel(modelId);
    const budget = buildBudgetStructure(estimate);

    const mcConfig: MonteCarloConfig = {
      iterations: req.body?.iterations ?? 5000,
      seed: req.body?.seed,
      riskItems: req.body?.riskItems ?? budget.contingency?.riskRegister ?? [],
      quantityVariance: req.body?.quantityVariance ?? 0.05,
      includeRiskEvents: req.body?.includeRiskEvents ?? true,
    };

    const result = runMonteCarloSimulation(estimate, mcConfig);
    const report = formatMonteCarloReport(result);

    res.json({
      modelId,
      simulation: result,
      report,
      engine: "estimator/monte-carlo.ts",
    });
  } catch (error) {
    handleError(res, "run Monte Carlo simulation", error);
  }
});

// ══════════════════════════════════════════════════════════════
//  BID LEVELING
// ══════════════════════════════════════════════════════════════

/**
 * POST /api/estimates/:modelId/bid-leveling
 * Creates CSI Division × Bidder comparison matrix.
 * Body: { bids: BidPackage[], config?: BidLevelConfig }
 */
estimatorRouter.post("/estimates/:modelId/bid-leveling", async (req: Request, res: Response) => {
  try {
    const { modelId } = req.params;
    const { bids, config } = req.body || {};

    if (!bids || !Array.isArray(bids) || bids.length === 0) {
      return res.status(400).json({
        error: "Request body must include 'bids' array with at least one BidPackage",
      });
    }

    const estimate = await buildEstimateForModel(modelId);
    const budget = buildBudgetStructure(estimate);

    const levelConfig: BidLevelConfig = {
      varianceThreshold: config?.varianceThreshold ?? 15,
      significantGapThreshold: config?.significantGapThreshold ?? 10000,
      normaliseBids: config?.normaliseBids ?? true,
    };

    const result = generateBidLeveling(estimate, bids, levelConfig, budget);
    const report = formatBidLevelingReport(result);

    res.json({
      modelId,
      bidLeveling: result,
      report,
      engine: "estimator/bid-leveling.ts",
    });
  } catch (error) {
    handleError(res, "generate bid leveling report", error);
  }
});


// ══════════════════════════════════════════════════════════════
//  BACKWARD-COMPATIBLE ROUTES
//  These intercept old paths from routes.ts so the old
//  old engine.ts is never reached.
//  Mount this router BEFORE the legacy routes:
//    app.use("/api", estimatorRouter);   // NEW (first)
//    registerRoutes(app);                // OLD (second, shadowed)
// ══════════════════════════════════════════════════════════════

/**
 * GET /api/projects/:projectId/boq-with-costs
 * Est-7 FIX: Dual-engine support.
 *
 * Always computes BOTH engines and returns comparison data.
 * The `elements` array (used for official estimate) is driven by the project's
 * `rateSystem` setting:
 *   'ciqs'         → estimate-engine.ts CSI_RATES (218 entries, M+L+E breakdown, CIQS methodology)
 *   'quicktakeoff' → rates.ts keyword rules (60 entries, single all-in rate, fast QTO)
 *
 * The rateSystem preference is persisted via PUT /api/projects/:projectId/settings.
 */
estimatorRouter.get("/projects/:projectId/boq-with-costs", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { storage } = await import("../storage");
    const models = await storage.getBimModels(projectId);

    if (!models || models.length === 0) {
      return res.json({
        elements: [],
        rateSystem: "ciqs",
        summary: { totalElements: 0, totalValue: 0, hasIncompleteData: true },
        comparison: null,
        calculation: { method: "CIQS Professional Estimate", note: "No BIM model found for project" },
      });
    }

    const modelId = models[models.length - 1].id;
    const resolvedProject = await storage.getProject(projectId);
    const resolvedProjectName = resolvedProject?.name
      || `[PROJECT NAME — RFI REQUIRED: project "${projectId}" not found in storage]`;
    const resolvedRegion = resolvedProject?.location
      || `[LOCATION — RFI REQUIRED: project "${projectId}" not found in storage]`;

    // ── Determine active rate system ──────────────────────────────────────────
    const rateSystem: "ciqs" | "quicktakeoff" =
      ((resolvedProject as any)?.rateSystem === "quicktakeoff") ? "quicktakeoff" : "ciqs";

    // ── ENGINE A: CIQS Professional (estimate-engine.ts, 218 CSI rates) ───────
    const estimate = await buildEstimateForModel(modelId);
    const budget = buildBudgetStructure(estimate, {
      projectName: resolvedProjectName,
      region: resolvedRegion,
    });

    const ciqsElements = estimate.floors.flatMap((floor: any) =>
      floor.lineItems.map((item: any) => ({
        id: item.elementIds?.[0] || "",
        itemCode: item.csiCode,
        description: item.description,
        unit: item.unit,
        quantity: String(item.quantity),
        rate: String(item.totalRate.toFixed(2)),
        amount: String(item.totalCost.toFixed(2)),
        csiDivision: item.csiCode?.substring(0, 2) || "00",
        floor: floor.floorLabel,
        labor: item.laborCost,
        material: item.materialCost,
        equipment: item.equipmentCost,
        dataQuality: item.verificationStatus,
        rateEngine: "ciqs",
        rateNote: `M:$${item.materialRate.toFixed(2)} L:$${item.laborRate.toFixed(2)} E:$${item.equipmentRate.toFixed(2)} /unit`,
      }))
    );

    const ciqsTotals = {
      grandTotal: estimate.grandTotal,
      budgetGrandTotal: budget.GRAND_TOTAL,
      materialTotal: estimate.materialGrandTotal,
      laborTotal: estimate.laborGrandTotal,
      equipmentTotal: estimate.equipmentGrandTotal,
      lineItems: ciqsElements.length,
      aaceClass: budget.aaceClass.estimateClass,
      aaceClassName: budget.aaceClass.className,
      incompleteItems: ciqsElements.filter((e: any) => e.dataQuality === "estimated").length,
    };

    // ── ENGINE B: Quick Takeoff (rates.ts, 60 keyword rules) ──────────────────
    let qtElements: any[] = [];
    let qtTotals = { grandTotal: 0, lineItems: 0, incompleteItems: 0, note: "" };
    try {
      const { getRateProfile, pickRuleFor } = await import("../services/rates");
      const bimElements = await storage.getBimElements(modelId);
      const profile = getRateProfile(undefined, "metric");

      for (const elRaw of bimElements) {
        // Cast to any: BimElement stores geometry/quantities as runtime JSON blobs
        // that are not reflected in the static Drizzle type.
        const el = elRaw as any;
        const typeStr = String(el.elementType || el.type || el.category || "");
        const rule = pickRuleFor(typeStr, profile);
        if (!rule) {
          qtTotals.incompleteItems++;
          continue;
        }
        const dims = (typeof el.dimensions === "string" ? JSON.parse(el.dimensions) : el.dimensions) || {};
        const geomDims = (typeof el.geometry === "string" ? JSON.parse(el.geometry) : el.geometry)?.dimensions || {};
        const w = Number(dims.width || geomDims.width || 0);
        const h = Number(dims.height || geomDims.height || 0);
        const d = Number(dims.depth || geomDims.depth || dims.thickness || geomDims.thickness || 0);
        const qRaw = typeof el.quantities === "string" ? JSON.parse(el.quantities) : (el.quantities || {});

        let qty = 0;
        if (rule.unit === "m2") qty = Number(qRaw.area || 0) || (w > 0 && h > 0 ? w * h : 1);
        else if (rule.unit === "m3") qty = Number(qRaw.volume || 0) || (w > 0 && h > 0 && d > 0 ? w * h * d : 1);
        else if (rule.unit === "m") qty = Number(qRaw.length || 0) || w || 1;
        else qty = 1; // ea

        const amount = qty * rule.rate;
        qtElements.push({
          id: el.id || "",
          itemCode: typeStr.toUpperCase().replace(/\s+/g, "_").substring(0, 20),
          description: typeStr,
          unit: rule.unit,
          quantity: String(qty.toFixed(3)),
          rate: String(rule.rate.toFixed(2)),
          amount: String(amount.toFixed(2)),
          csiDivision: "00",
          floor: el.storeyName || el.floorName || (typeof el.properties === "string" ? JSON.parse(el.properties) : el.properties)?.floor || "Unassigned",
          labor: 0, material: amount, equipment: 0,
          dataQuality: "estimated",
          rateEngine: "quicktakeoff",
          rateNote: rule.note || "",
        });
        qtTotals.grandTotal += amount;
      }
      qtTotals.lineItems = qtElements.length;
      qtTotals.note = `60 keyword rules, all-in rates, no M/L/E breakdown`;
    } catch (qtErr) {
      console.warn("[estimator-router] Quick Takeoff engine error:", qtErr);
      qtTotals.note = "Quick Takeoff calculation failed — see server log";
    }

    // ── Compose response ──────────────────────────────────────────────────────
    const primaryElements = rateSystem === "quicktakeoff" ? qtElements : ciqsElements;
    const primaryTotals = rateSystem === "quicktakeoff"
      ? { totalValue: qtTotals.grandTotal, incompleteItems: qtTotals.incompleteItems }
      : { totalValue: estimate.grandTotal, incompleteItems: ciqsTotals.incompleteItems };

    res.json({
      rateSystem,
      elements: primaryElements,
      summary: {
        totalElements: primaryElements.length,
        boqItems: primaryElements.length,
        totalValue: primaryTotals.totalValue,
        budgetGrandTotal: rateSystem === "ciqs" ? budget.GRAND_TOTAL : qtTotals.grandTotal,
        incompleteItems: primaryTotals.incompleteItems,
        hasIncompleteData: primaryTotals.incompleteItems > 0,
        // v15.20: CIQS benchmark metrics surfaced to UI
        costPerM2: rateSystem === "ciqs" ? estimate.costPerM2 : undefined,
        totalLaborHours: rateSystem === "ciqs" ? estimate.totalLaborHours : undefined,
        regionalFactor: rateSystem === "ciqs" ? estimate.regionalFactor : undefined,
        csiDivisionsUsed: rateSystem === "ciqs" ? estimate.csiDivisionsUsed : undefined,
      },
      // ── Side-by-side comparison (always included) ──────────────────────────
      comparison: {
        ciqs: {
          label: "CIQS Professional",
          description: "218 CSI rates · M+L+E breakdown · AACE Class " + ciqsTotals.aaceClass + " (" + ciqsTotals.aaceClassName + ")",
          grandTotal: ciqsTotals.grandTotal,
          budgetGrandTotal: ciqsTotals.budgetGrandTotal,
          lineItems: ciqsTotals.lineItems,
          materialTotal: ciqsTotals.materialTotal,
          laborTotal: ciqsTotals.laborTotal,
          equipmentTotal: ciqsTotals.equipmentTotal,
          incompleteItems: ciqsTotals.incompleteItems,
          active: rateSystem === "ciqs",
        },
        quicktakeoff: {
          label: "Quick Takeoff",
          description: "60 keyword rules · single all-in rate · fast preliminary QTO",
          grandTotal: qtTotals.grandTotal,
          lineItems: qtTotals.lineItems,
          incompleteItems: qtTotals.incompleteItems,
          note: qtTotals.note,
          active: rateSystem === "quicktakeoff",
        },
      },
      calculation: {
        method: rateSystem === "ciqs"
          ? "CIQS Professional — estimate-engine.ts (218 CSI rates)"
          : "Quick Takeoff — rates.ts (60 keyword rules)",
        standards: rateSystem === "ciqs" ? ["CIQS", "CSA", "NBC", "OBC"] : ["Quick Takeoff"],
        region: resolvedRegion,
        confidence: rateSystem === "ciqs" ? budget.aaceClass.className : "Preliminary — for budgeting only",
        aaceClass: rateSystem === "ciqs" ? budget.aaceClass.estimateClass : null,
        dataSource: rateSystem === "ciqs"
          ? "BIM Elements via buildEstimateForModel()"
          : "BIM Elements via rates.ts keyword matching",
      },
      // ── v15.20: QTO sanity check surfaced to UI (drives the orange warning banner) ─
      sanityCheck: rateSystem === "ciqs" ? estimate.sanityCheck : undefined,
      // ── v15.20: Per-floor breakdown with costPerM2 and labour hours ──────────────
      floors: rateSystem === "ciqs" ? estimate.floors.map((fl: any) => ({
        floor: fl.floor,
        floorLabel: fl.floorLabel,
        subtotal: fl.subtotal,
        materialTotal: fl.materialTotal,
        laborTotal: fl.laborTotal,
        equipmentTotal: fl.equipmentTotal,
        costPerM2: fl.costPerM2,
        totalLaborHours: fl.totalLaborHours,
        lineItemCount: fl.lineItems.length,
      })) : undefined,
    });
  } catch (error) {
    console.error("Error generating BOQ with costs:", error);
    res.status(500).json({
      message: "Failed to generate BOQ with cost calculations",
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/cost/estimate/:projectId
 * Replaces: routes.ts line 4278 (returned hardcoded $2,850,000)
 * Now uses: real estimate from estimate-engine.ts + budget-structure.ts
 */
estimatorRouter.get("/cost/estimate/:projectId", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;

    const { storage } = await import("../storage");
    const models = await storage.getBimModels(projectId);

    if (!models || models.length === 0) {
      return res.json({
        totalCost: 0,
        breakdown: { materials: 0, labor: 0, equipment: 0 },
        confidence: 0,
        currency: "CAD",
        note: "No BIM model found — upload documents and generate a model first",
      });
    }

    const modelId = models[models.length - 1].id;
    const estimate = await buildEstimateForModel(modelId);
    const resolvedProject = await storage.getProject(projectId);
    const resolvedProjectName = resolvedProject?.name
      || `[PROJECT NAME — RFI REQUIRED: project "${projectId}" not found in storage]`;
    const resolvedRegion = resolvedProject?.location
      || `[LOCATION — RFI REQUIRED: project "${projectId}" not found in storage]`;
    const budget = buildBudgetStructure(estimate, {
      projectName: resolvedProjectName,
      region: resolvedRegion,
    });

    const total = estimate.grandTotal;
    const materialPct = total > 0 ? Math.round((estimate.materialGrandTotal / total) * 100) : 0;
    const laborPct = total > 0 ? Math.round((estimate.laborGrandTotal / total) * 100) : 0;
    const equipmentPct = total > 0 ? 100 - materialPct - laborPct : 0;

    res.json({
      totalCost: budget.GRAND_TOTAL,
      directCost: total,
      breakdown: {
        materials: materialPct,
        labor: laborPct,
        equipment: equipmentPct,
      },
      confidence: budget.aaceClass.estimateClass <= 2 ? 0.95 : budget.aaceClass.estimateClass <= 3 ? 0.87 : 0.70,
      currency: "CAD",
      aaceClass: budget.aaceClass.estimateClass,
      lineItems: estimate.lineItemCount,
      floors: estimate.floors.length,
      engine: "estimate-engine.ts (212 CSI rates)",
    });
  } catch (error) {
    console.error("Error generating cost estimate:", error);
    res.status(500).json({ error: "Failed to generate cost estimate" });
  }
});

/**
 * POST /api/cost/update/:projectId
 * Replaces: routes.ts line 4292 (was a no-op that echoed input)
 * Now: acknowledges adjustments and returns current estimate
 */
estimatorRouter.post("/cost/update/:projectId", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { adjustments } = req.body;

    const { storage } = await import("../storage");
    const models = await storage.getBimModels(projectId);

    if (!models || models.length === 0) {
      return res.json({ message: "No BIM model found for project", adjustments });
    }

    const modelId = models[models.length - 1].id;
    const estimate = await buildEstimateForModel(modelId);

    res.json({
      message: "Adjustments acknowledged. Re-run estimate via /api/estimates/:modelId/full for updated totals.",
      modelId,
      currentTotal: estimate.grandTotal,
      adjustments,
    });
  } catch (error) {
    console.error("Error updating cost estimates:", error);
    res.status(500).json({ error: "Failed to update cost estimates" });
  }
});

