// server/routes/qs-level5-supplement.ts
// =============================================================================
// SUPPLEMENTARY ENDPOINTS — LABOR BURDEN, REBAR DATA, FULL ESTIMATE
// =============================================================================
//
// Closes remaining backend gaps:
//   - GET /api/qs5/labor-burden      — Ontario statutory rates + union fringes
//   - GET /api/qs5/rebar/:modelId    — Rebar-specific rate data from estimate
//   - GET /api/qs5/models/:id/full   — Combined full estimate with all enrichments
//
// Canadian Labor Burden data per CIQS / Ontario statutory rates 2025:
//   CPP: 5.95%, EI: 2.28%, WSIB: by trade classification
//   Vacation pay: 4-6%, Union fringes: varies by trade
//
// Integration: Import and spread into qsLevel5Router or mount separately.
// =============================================================================

import { Router, type Request, type Response } from 'express';
import type { EstimateSummary } from '../estimator/estimate-engine';
import { buildEstimateForModel } from '../estimator/estimate-engine';
import {
  enrichEstimateLineItems,
  generateUniformatSummary,
  generateCSIDivisionSummary,
  reconcileElementDivision,
} from '../estimator/uniformat-crosswalk';
import { getBenchmark, getCompleteness } from '../estimator/benchmark-engine';
import { getResult as getMCResult } from '../estimator/monte-carlo-engine';
import { getResult as getCodeResult } from '../estimator/code-driven-adders';
import { getSOV } from '../estimator/schedule-of-values';
import { getLatestVersion } from '../estimator/estimate-workflow';
import { getBoE } from '../estimator/boe-generator';

export const qs5SupplementRouter = Router();


// ─── CANADIAN LABOR BURDEN DATA (Ontario 2025) ─────────────────────────────

export interface StatutoryRate {
  code: string;
  description: string;
  rate: number;         // % of gross wages
  maxInsurable?: number; // annual maximum insurable earnings
  notes: string;
}

export interface WSIBRate {
  classCode: string;
  trade: string;
  ratePerHundred: number;   // $ per $100 of insurable earnings
  effectiveDate: string;
}

export interface UnionTradeRate {
  trade: string;
  localUnion: string;
  baseWage: number;           // $/hr
  vacationPay: number;        // % of gross
  healthWelfare: number;      // $/hr
  pension: number;            // $/hr
  trainingFund: number;       // $/hr
  industryFund: number;       // $/hr
  totalFringe: number;        // $/hr all fringes
  totalPackage: number;       // base + fringes
  burdenPercent: number;      // total fringes as % of base
}

export const ONTARIO_STATUTORY_RATES: StatutoryRate[] = [
  { code: 'CPP', description: 'Canada Pension Plan (employer portion)', rate: 5.95, maxInsurable: 68500, notes: 'Employer matches employee contribution; rate on pensionable earnings above $3,500' },
  { code: 'CPP2', description: 'CPP2 (second ceiling)', rate: 4.00, maxInsurable: 73200, notes: 'Applies to earnings between CPP1 max and CPP2 max' },
  { code: 'EI', description: 'Employment Insurance (employer premium)', rate: 2.28, maxInsurable: 63200, notes: 'Employer pays 1.4× employee rate; reduced rate available for some employers' },
  { code: 'EHT', description: 'Employer Health Tax (Ontario)', rate: 1.95, notes: 'Payroll over $5M: 1.95%; $2.5-5M: graduated; under $2.5M: exempt' },
  { code: 'WSIB', description: 'WSIB Premium (by trade — see separate table)', rate: 0.00, notes: 'Rate varies by NAICS classification; see WSIB rate table below' },
  { code: 'VAC-CONSTRUCTION', description: 'Vacation pay (construction trades)', rate: 6.00, notes: '6% for construction; 4% standard; 6% after 5 years per ESA' },
  { code: 'HOLIDAY', description: 'Public holiday pay (Ontario)', rate: 3.85, notes: '10 statutory holidays ÷ 260 working days = 3.85%' },
];

export const WSIB_RATES_BY_TRADE: WSIBRate[] = [
  { classCode: '764', trade: 'General Contracting', ratePerHundred: 4.04, effectiveDate: '2025-01-01' },
  { classCode: '711', trade: 'Residential Construction', ratePerHundred: 5.89, effectiveDate: '2025-01-01' },
  { classCode: '723', trade: 'Electrical', ratePerHundred: 1.78, effectiveDate: '2025-01-01' },
  { classCode: '707', trade: 'Plumbing / HVAC', ratePerHundred: 3.20, effectiveDate: '2025-01-01' },
  { classCode: '704', trade: 'Concrete Forming/Placing', ratePerHundred: 7.49, effectiveDate: '2025-01-01' },
  { classCode: '748', trade: 'Structural Steel Erection', ratePerHundred: 7.82, effectiveDate: '2025-01-01' },
  { classCode: '737', trade: 'Masonry', ratePerHundred: 8.75, effectiveDate: '2025-01-01' },
  { classCode: '719', trade: 'Carpentry / Framing', ratePerHundred: 6.37, effectiveDate: '2025-01-01' },
  { classCode: '751', trade: 'Roofing / Sheet Metal', ratePerHundred: 8.09, effectiveDate: '2025-01-01' },
  { classCode: '738', trade: 'Drywall / Plastering', ratePerHundred: 5.18, effectiveDate: '2025-01-01' },
  { classCode: '740', trade: 'Painting / Decorating', ratePerHundred: 3.57, effectiveDate: '2025-01-01' },
  { classCode: '714', trade: 'Excavation / Grading', ratePerHundred: 4.66, effectiveDate: '2025-01-01' },
  { classCode: '736', trade: 'Tile / Terrazzo', ratePerHundred: 3.90, effectiveDate: '2025-01-01' },
  { classCode: '727', trade: 'Glazing', ratePerHundred: 5.74, effectiveDate: '2025-01-01' },
  { classCode: '729', trade: 'Insulation', ratePerHundred: 4.25, effectiveDate: '2025-01-01' },
  { classCode: '753', trade: 'Fire Protection / Sprinkler', ratePerHundred: 2.41, effectiveDate: '2025-01-01' },
  { classCode: '725', trade: 'Elevator Installation', ratePerHundred: 1.62, effectiveDate: '2025-01-01' },
  { classCode: '745', trade: 'Flooring', ratePerHundred: 2.83, effectiveDate: '2025-01-01' },
];

export const UNION_TRADE_RATES: UnionTradeRate[] = [
  { trade: 'Carpenter', localUnion: 'UBCJA Local 27', baseWage: 42.52, vacationPay: 6, healthWelfare: 3.98, pension: 7.62, trainingFund: 0.74, industryFund: 0.52, totalFringe: 12.86, totalPackage: 55.38, burdenPercent: 30.2 },
  { trade: 'Ironworker (Structural)', localUnion: 'IW Local 721', baseWage: 44.80, vacationPay: 6, healthWelfare: 3.25, pension: 8.50, trainingFund: 0.80, industryFund: 0.55, totalFringe: 13.10, totalPackage: 57.90, burdenPercent: 29.2 },
  { trade: 'Electrician', localUnion: 'IBEW Local 353', baseWage: 46.18, vacationPay: 6, healthWelfare: 3.45, pension: 7.85, trainingFund: 0.92, industryFund: 0.38, totalFringe: 12.60, totalPackage: 58.78, burdenPercent: 27.3 },
  { trade: 'Plumber', localUnion: 'UA Local 46', baseWage: 45.73, vacationPay: 6, healthWelfare: 3.80, pension: 8.20, trainingFund: 0.85, industryFund: 0.45, totalFringe: 13.30, totalPackage: 59.03, burdenPercent: 29.1 },
  { trade: 'Sheetmetal Worker', localUnion: 'SMWIA Local 30', baseWage: 43.60, vacationPay: 6, healthWelfare: 3.55, pension: 7.40, trainingFund: 0.70, industryFund: 0.45, totalFringe: 12.10, totalPackage: 55.70, burdenPercent: 27.8 },
  { trade: 'Laborer', localUnion: 'LIUNA Local 183', baseWage: 37.24, vacationPay: 6, healthWelfare: 3.10, pension: 5.50, trainingFund: 0.55, industryFund: 0.35, totalFringe: 9.50, totalPackage: 46.74, burdenPercent: 25.5 },
  { trade: 'Operating Engineer', localUnion: 'IUOE Local 793', baseWage: 44.15, vacationPay: 6, healthWelfare: 3.70, pension: 8.05, trainingFund: 0.82, industryFund: 0.48, totalFringe: 13.05, totalPackage: 57.20, burdenPercent: 29.6 },
  { trade: 'Cement Mason', localUnion: 'OPCMIA Local 598', baseWage: 40.90, vacationPay: 6, healthWelfare: 3.15, pension: 6.80, trainingFund: 0.65, industryFund: 0.40, totalFringe: 11.00, totalPackage: 51.90, burdenPercent: 26.9 },
  { trade: 'Bricklayer', localUnion: 'BAC Local 2', baseWage: 41.85, vacationPay: 6, healthWelfare: 3.35, pension: 7.15, trainingFund: 0.72, industryFund: 0.43, totalFringe: 11.65, totalPackage: 53.50, burdenPercent: 27.8 },
  { trade: 'Painter', localUnion: 'IUPAT DC 46', baseWage: 38.60, vacationPay: 6, healthWelfare: 2.95, pension: 5.85, trainingFund: 0.55, industryFund: 0.35, totalFringe: 9.70, totalPackage: 48.30, burdenPercent: 25.1 },
  { trade: 'Roofer', localUnion: 'UURWAW Local 30', baseWage: 40.25, vacationPay: 6, healthWelfare: 3.20, pension: 6.45, trainingFund: 0.60, industryFund: 0.40, totalFringe: 10.65, totalPackage: 50.90, burdenPercent: 26.5 },
  { trade: 'Glazier', localUnion: 'IUPAT Local 1819', baseWage: 41.10, vacationPay: 6, healthWelfare: 3.25, pension: 6.90, trainingFund: 0.68, industryFund: 0.42, totalFringe: 11.25, totalPackage: 52.35, burdenPercent: 27.4 },
];

/** Combined burden calculation for a given base wage */
export function calculateTotalBurden(baseWage: number, wsibRatePerHundred: number): {
  statutory: { cpp: number; ei: number; eht: number; wsib: number; vacationPay: number; holidayPay: number; totalStatutory: number };
  totalBurdenPercent: number;
  totalBurdenDollar: number;
  fullyLoadedRate: number;
} {
  const cpp = baseWage * 0.0595;
  const ei = baseWage * 0.0228;
  const eht = baseWage * 0.0195;
  const wsib = baseWage * (wsibRatePerHundred / 100);
  const vacationPay = baseWage * 0.06;
  const holidayPay = baseWage * 0.0385;
  const totalStatutory = cpp + ei + eht + wsib + vacationPay + holidayPay;
  const totalBurdenPercent = (totalStatutory / baseWage) * 100;

  return {
    statutory: {
      cpp: Math.round(cpp * 100) / 100,
      ei: Math.round(ei * 100) / 100,
      eht: Math.round(eht * 100) / 100,
      wsib: Math.round(wsib * 100) / 100,
      vacationPay: Math.round(vacationPay * 100) / 100,
      holidayPay: Math.round(holidayPay * 100) / 100,
      totalStatutory: Math.round(totalStatutory * 100) / 100,
    },
    totalBurdenPercent: Math.round(totalBurdenPercent * 100) / 100,
    totalBurdenDollar: Math.round(totalStatutory * 100) / 100,
    fullyLoadedRate: Math.round((baseWage + totalStatutory) * 100) / 100,
  };
}


// ─── REBAR SPECIFICATION DATA (CSA G30.18) ──────────────────────────────────

export interface RebarSpecification {
  designation: string;     // e.g., "10M", "15M"
  nominalDiameter: number; // mm
  crossSectionalArea: number; // mm²
  massPerMetre: number;    // kg/m
  standardLengths: number[]; // metres
  grade: string;           // "400W" or "500W"
  standard: string;        // "CSA G30.18"
}

export const CSA_REBAR_SPECS: RebarSpecification[] = [
  { designation: '10M', nominalDiameter: 11.3, crossSectionalArea: 100, massPerMetre: 0.785, standardLengths: [6, 12], grade: '400W', standard: 'CSA G30.18' },
  { designation: '15M', nominalDiameter: 16.0, crossSectionalArea: 200, massPerMetre: 1.570, standardLengths: [6, 12], grade: '400W', standard: 'CSA G30.18' },
  { designation: '20M', nominalDiameter: 19.5, crossSectionalArea: 300, massPerMetre: 2.355, standardLengths: [6, 12], grade: '400W', standard: 'CSA G30.18' },
  { designation: '25M', nominalDiameter: 25.2, crossSectionalArea: 500, massPerMetre: 3.925, standardLengths: [6, 12, 18], grade: '400W', standard: 'CSA G30.18' },
  { designation: '30M', nominalDiameter: 29.9, crossSectionalArea: 700, massPerMetre: 5.495, standardLengths: [6, 12, 18], grade: '400W', standard: 'CSA G30.18' },
  { designation: '35M', nominalDiameter: 35.7, crossSectionalArea: 1000, massPerMetre: 7.850, standardLengths: [12, 18], grade: '400W', standard: 'CSA G30.18' },
  { designation: '45M', nominalDiameter: 43.7, crossSectionalArea: 1500, massPerMetre: 11.775, standardLengths: [12, 18], grade: '400W', standard: 'CSA G30.18' },
  { designation: '55M', nominalDiameter: 56.4, crossSectionalArea: 2500, massPerMetre: 19.625, standardLengths: [12, 18], grade: '400W', standard: 'CSA G30.18' },
];

export const REBAR_RATE_DATA = {
  csiCode: '033000-REBAR',
  materialRate: 2.85,          // $/kg (fabricated, delivered)
  laborRate: 1.50,             // $/kg (placing)
  equipmentRate: 0.15,         // $/kg (crane time, etc.)
  totalRate: 4.50,             // $/kg all-in
  unit: 'kg',
  wastePercent: 3,             // lap splices, cutting loss
  source: 'RSMeans Canadian 2025 + CIQS standard',
  typicalDensities: {
    slabs: { kgPerM3: 90, description: 'Typical slab reinforcement density' },
    walls: { kgPerM3: 100, description: 'Typical wall reinforcement density' },
    columns: { kgPerM3: 120, description: 'Typical column reinforcement density' },
    beams: { kgPerM3: 110, description: 'Typical beam reinforcement density' },
    foundations: { kgPerM3: 80, description: 'Typical footing reinforcement density' },
  },
};


// ─── ENDPOINTS ──────────────────────────────────────────────────────────────

/** GET /api/qs5/labor-burden — Full Ontario labor burden data */
qs5SupplementRouter.get('/labor-burden', (_req: Request, res: Response) => {
  res.json({
    statutoryRates: ONTARIO_STATUTORY_RATES,
    wsibRatesByTrade: WSIB_RATES_BY_TRADE,
    unionTradeRates: UNION_TRADE_RATES,
    totalTrades: UNION_TRADE_RATES.length,
    totalWSIBClassifications: WSIB_RATES_BY_TRADE.length,
    averageBurdenPercent: Math.round(
      UNION_TRADE_RATES.reduce((s, t) => s + t.burdenPercent, 0) / UNION_TRADE_RATES.length * 100
    ) / 100,
    source: 'Ontario 2025 — CIQS / WSIB Rate Group Framework / Collective Agreements',
    notes: 'Statutory rates are employer-side only. Union fringes per applicable collective agreement.',
  });
});

/** GET /api/qs5/labor-burden/:trade — Burden calc for specific trade */
qs5SupplementRouter.get('/labor-burden/:trade', (req: Request, res: Response) => {
  const tradeName = req.params.trade.toLowerCase().replace(/-/g, ' ');
  const union = UNION_TRADE_RATES.find(t => t.trade.toLowerCase().includes(tradeName));
  const wsib = WSIB_RATES_BY_TRADE.find(w => w.trade.toLowerCase().includes(tradeName));

  if (!union && !wsib) {
    return res.status(404).json({ error: `Trade '${req.params.trade}' not found. Available: ${UNION_TRADE_RATES.map(t => t.trade).join(', ')}` });
  }

  const baseWage = union?.baseWage ?? 40;
  const wsibRate = wsib?.ratePerHundred ?? 4.04;
  const burden = calculateTotalBurden(baseWage, wsibRate);

  res.json({
    trade: union?.trade ?? wsib?.trade ?? req.params.trade,
    unionRate: union ?? null,
    wsibRate: wsib ?? null,
    burden,
  });
});

/** GET /api/qs5/rebar — CSA G30.18 rebar specifications + rates */
qs5SupplementRouter.get('/rebar', (_req: Request, res: Response) => {
  res.json({
    specifications: CSA_REBAR_SPECS,
    rateData: REBAR_RATE_DATA,
    standard: 'CSA G30.18-09 (R2019)',
    notes: 'All designations per Canadian standard "M" series. Grade 400W typical; 500W available for high-strength applications.',
  });
});

/** GET /api/qs5/rebar/:modelId — Rebar quantities from a model estimate */
qs5SupplementRouter.get('/rebar/:modelId', async (req: Request, res: Response) => {
  try {
    const estimate = await buildEstimateForModel(req.params.modelId);
    if (!estimate) return res.status(404).json({ error: 'Model not found' });

    const rebarItems = estimate.floors.flatMap(f =>
      f.lineItems.filter(li => li.csiCode === '033000-REBAR' || li.description.toLowerCase().includes('rebar') || li.description.toLowerCase().includes('reinforc'))
    );

    const totalKg = rebarItems.reduce((s, li) => s + li.quantity, 0);
    const totalCost = rebarItems.reduce((s, li) => s + li.totalCost, 0);

    res.json({
      modelId: req.params.modelId,
      rebarLineItems: rebarItems,
      summary: {
        totalQuantityKg: Math.round(totalKg * 100) / 100,
        totalCostCAD: Math.round(totalCost * 100) / 100,
        averageRatePerKg: totalKg > 0 ? Math.round((totalCost / totalKg) * 100) / 100 : 0,
        wastePercent: 3,
        lineItemCount: rebarItems.length,
        floorDistribution: Object.fromEntries(
          [...new Set(rebarItems.map(li => li.floor))].map(floor => [
            floor,
            Math.round(rebarItems.filter(li => li.floor === floor).reduce((s, li) => s + li.quantity, 0) * 100) / 100,
          ])
        ),
      },
      specifications: CSA_REBAR_SPECS,
      rateData: REBAR_RATE_DATA,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to extract rebar data' });
  }
});

/** GET /api/qs5/models/:modelId/full — Combined full estimate with all enrichments */
qs5SupplementRouter.get('/models/:modelId/full', async (req: Request, res: Response) => {
  try {
    const modelId = req.params.modelId;
    const estimate = await buildEstimateForModel(modelId);
    if (!estimate) return res.status(404).json({ error: 'Model not found or estimate failed' });

    // Enrich all line items with UNIFORMAT, NRM, WBS
    const allItems = estimate.floors.flatMap(f => f.lineItems);
    const enrichedItems = enrichEstimateLineItems(allItems);

    // Generate dual summaries
    const uniformatSummary = generateUniformatSummary(estimate);
    const divisionSummary = generateCSIDivisionSummary(estimate);
    const reconciliation = reconcileElementDivision(estimate);

    // Gather stored analysis results (may or may not exist)
    // Use a pseudo-projectId derived from modelId
    const projectId = modelId;
    const benchmark = getBenchmark(projectId);
    const completeness = getCompleteness(projectId);
    const monteCarlo = getMCResult(projectId);
    const codeAdders = getCodeResult(projectId);
    const sov = getSOV(projectId);
    const latestVersion = getLatestVersion(projectId);
    const boe = getBoE(projectId);

    res.json({
      estimate: {
        ...estimate,
        enrichedItems,
      },
      summaries: {
        byDivision: divisionSummary,
        byElement: uniformatSummary,
        reconciliation,
      },
      analysis: {
        benchmark: benchmark ?? null,
        completeness: completeness ?? null,
        monteCarlo: monteCarlo ?? null,
        codeAdders: codeAdders ?? null,
      },
      outputs: {
        scheduleOfValues: sov ?? null,
        latestVersion: latestVersion ? {
          versionId: latestVersion.versionId,
          versionNumber: latestVersion.versionNumber,
          status: latestVersion.status,
          maker: latestVersion.maker,
          checker: latestVersion.checker,
        } : null,
        basisOfEstimate: boe ? { status: boe.status, estimateClass: boe.estimateClass, revision: boe.revision } : null,
      },
      meta: {
        modelId,
        generatedAt: new Date().toISOString(),
        methodology: 'CIQS',
        currency: 'CAD',
        standards: ['CSI MasterFormat 2018', 'UNIFORMAT II (ASTM E1557)', 'NRM1/NRM2 (RICS)', 'AACE RP 34R-05', 'CSA G30.18'],
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to build full estimate' });
  }
});
