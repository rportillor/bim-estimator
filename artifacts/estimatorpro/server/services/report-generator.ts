/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  REPORT GENERATOR — SOP Part 7
 *  EstimatorPro v3 — Professional QS Report Engine
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Consumes ALL completed SOP modules and produces professional deliverables:
 *
 *  1. BOQ Report        — Per CIQS Standard Method, CSI divisions, per-floor
 *  2. Bid-Leveling Sheet — Trade package comparison with alternates
 *  3. Clash Report       — From SOP 6.4 clash detection engine
 *  4. Constructability   — From SOP 6.1 engine + safety issues
 *  5. Executive Summary  — Confidence (Monte Carlo), contingency, regional factors
 *  6. Gap / RFI Register — All unresolved data gaps across all modules
 *  7. Schedule of Values — Payment milestones from 4D sequencing
 *
 *  Standards: CIQS, AACE, CSI MasterFormat 2018, RICS NRM1/NRM2, OBC
 *
 *  SOP Part 6.3 enforcement: Report flags every value without document evidence.
 *
 *  @module report-generator
 *  @version 1.0.0
 */

import { storage as _storage } from '../storage';
import type {
  Gap,
  EvidenceReference,
} from './types';


// ══════════════════════════════════════════════════════════════════════════════
//  REPORT TYPES
// ══════════════════════════════════════════════════════════════════════════════

export interface ReportMetadata {
  reportId: string;
  projectId: string;
  projectName: string;
  generatedAt: string;
  generatedBy: string;
  reportType: ReportType;
  version: string;
  standards: string[];
  disclaimer: string;
}

export type ReportType =
  | 'BOQ_FULL'
  | 'BOQ_SUMMARY'
  | 'BID_LEVELING'
  | 'CLASH_REPORT'
  | 'CONSTRUCTABILITY'
  | 'EXECUTIVE_SUMMARY'
  | 'GAP_REGISTER'
  | 'SCHEDULE_OF_VALUES';

/** A single BOQ line item in the report */
export interface BOQReportLine {
  lineNo: number;
  csiDivision: string;
  csiTitle: string;
  uniformatCode: string;
  description: string;
  unit: string;
  quantity: number;
  materialRate: number;
  labourRate: number;
  equipmentRate: number;
  materialCost: number;
  labourCost: number;
  equipmentCost: number;
  totalCost: number;
  storey: string;
  tradePackage: string;
  elementIds: string[];
  evidenceRefs: string[];
  hasEvidence: boolean;
  confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW' | 'GAP';
}

/** Per-storey subtotal */
export interface StoreySubtotal {
  storey: string;
  materialCost: number;
  labourCost: number;
  equipmentCost: number;
  totalCost: number;
  lineCount: number;
}

/** Per-CSI-division subtotal */
export interface DivisionSubtotal {
  division: string;
  title: string;
  materialCost: number;
  labourCost: number;
  equipmentCost: number;
  totalCost: number;
  lineCount: number;
}

/** Per-trade-package subtotal */
export interface TradePackageSubtotal {
  tradePackage: string;
  materialCost: number;
  labourCost: number;
  equipmentCost: number;
  totalCost: number;
  lineCount: number;
}

/** Complete BOQ Report */
export interface BOQReport {
  metadata: ReportMetadata;
  lines: BOQReportLine[];
  storeySubtotals: StoreySubtotal[];
  divisionSubtotals: DivisionSubtotal[];
  tradePackageSubtotals: TradePackageSubtotal[];
  directCost: number;
  overheadAmount: number;
  profitAmount: number;
  contingencyAmount: number;
  taxAmount: number;
  totalProjectCost: number;
  overheadRate: number;
  profitRate: number;
  contingencyRate: number;
  taxRate: number;
  regionalFactor: number;
  regionName: string;
  confidenceSummary: {
    highCount: number;
    mediumCount: number;
    lowCount: number;
    gapCount: number;
    overallConfidence: number;
  };
  gapWarnings: string[];
}

/** Bid-Leveling Sheet */
export interface BidLevelingSheet {
  metadata: ReportMetadata;
  tradePackages: BidTradePackage[];
  totalBase: number;
  totalAlternates: number;
  totalAllowances: number;
}

export interface BidTradePackage {
  tradePackage: string;
  csiDivisions: string[];
  scope: string;
  baseAmount: number;
  alternates: BidAlternate[];
  allowances: BidAllowance[];
  unitPrices: BidUnitPrice[];
  exclusions: string[];
  clarifications: string[];
}

export interface BidAlternate {
  id: string;
  description: string;
  addDeduct: 'ADD' | 'DEDUCT';
  amount: number;
}

export interface BidAllowance {
  id: string;
  description: string;
  amount: number;
  unit: string;
}

export interface BidUnitPrice {
  id: string;
  description: string;
  unit: string;
  rate: number;
}

/** Clash Detection Report */
export interface ClashReport {
  metadata: ReportMetadata;
  summary: ClashReportSummary;
  clashes: ClashReportItem[];
  rfisRequired: ClashRFI[];
  missingClearanceData: string[];
}

export interface ClashReportSummary {
  totalClashes: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  informationalCount: number;
  resolvedCount: number;
  unresolvedCount: number;
  rfisRequired: number;
  estimatedReworkCost: number;
  estimatedReworkDays: number;
}

export interface ClashReportItem {
  clashId: string;
  severity: string;
  category: string;
  elementA: string;
  elementB: string;
  location: string;
  storey: string;
  penetrationDepth_mm: number;
  description: string;
  recommendation: string;
  rfiRequired: boolean;
  estimatedCost: number;
}

export interface ClashRFI {
  rfiId: string;
  subject: string;
  clashIds: string[];
  discipline: string;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
}

/** Constructability Report */
export interface ConstructabilityReport {
  metadata: ReportMetadata;
  workAreas: ConstructabilityWorkArea[];
  tradeDependencies: ConstructabilityDependency[];
  safetyIssues: ConstructabilitySafetyIssue[];
  tempWorks: ConstructabilityTempWorks[];
  holdPoints: string[];
  tradeExecutionOrder: string[];
  gapCount: number;
  criticalIssueCount: number;
}

export interface ConstructabilityWorkArea {
  name: string;
  level: string;
  zone: string;
  trades: string[];
  maxWorkers: number | null;
  accessRoutes: string[];
  equipmentRequired: string[];
}

export interface ConstructabilityDependency {
  predecessor: string;
  successor: string;
  type: string;
  lagDays: number;
  holdPoint: boolean;
  inspectionRequired: boolean;
}

export interface ConstructabilitySafetyIssue {
  id: string;
  severity: string;
  description: string;
  location: string;
  recommendation: string;
  codeReference: string;
}

export interface ConstructabilityTempWorks {
  type: string;
  description: string;
  location: string;
  duration: string;
  estimatedCost: number | null;
}

/** Executive Summary */
export interface ExecutiveSummary {
  metadata: ReportMetadata;
  projectOverview: {
    projectName: string;
    location: string;
    buildingType: string;
    grossFloorArea_m2: number | null;
    storeyCount: number;
    constructionType: string;
  };
  costSummary: {
    directCost: number;
    indirectCost: number;
    contingency: number;
    taxes: number;
    totalProjectCost: number;
    costPerM2: number | null;
    costPerSF: number | null;
  };
  confidenceAnalysis: {
    estimateClass: string;
    accuracyRange: { low: number; high: number };
    monteCarloP10: number | null;
    monteCarloP50: number | null;
    monteCarloP90: number | null;
    simulationRuns: number | null;
    dataCompleteness: number;
  };
  riskSummary: {
    totalGaps: number;
    criticalGaps: number;
    rfisRequired: number;
    clashesFound: number;
    criticalClashes: number;
    constructabilityIssues: number;
  };
  keyAssumptions: string[];
  exclusions: string[];
  recommendations: string[];
}

/** Gap/RFI Register */
export interface GapRegister {
  metadata: ReportMetadata;
  gaps: GapRegisterEntry[];
  totalGaps: number;
  criticalGaps: number;
  rfisGenerated: number;
  byDiscipline: Record<string, number>;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
}

export interface GapRegisterEntry {
  gapId: string;
  type: string;
  parameterName: string;
  description: string;
  discipline: string;
  impact: string;
  affectedElements: number;
  status: string;
  rfiNumber: string | null;
  sopReference: string;
  evidenceRef: string;
}

/** Schedule of Values */
export interface ScheduleOfValues {
  metadata: ReportMetadata;
  phases: SOVPhase[];
  totalContractValue: number;
  retainageRate: number;
}

export interface SOVPhase {
  phaseNumber: number;
  phaseName: string;
  level: string | null;
  scheduledValue: number;
  percentOfTotal: number;
  milestones: string[];
  tradeBreakdown: { trade: string; amount: number }[];
}


// ══════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════

const REPORT_VERSION = '1.0.0';

const CIQS_DISCLAIMER =
  'This estimate has been prepared in accordance with the Canadian Institute of Quantity Surveyors ' +
  '(CIQS) Standard Method. Quantities are derived from BIM model elements extracted from project ' +
  'construction documents. Values marked as GAP require resolution via RFI before final pricing. ' +
  'This report does not constitute a bid or offer. Regional cost factors are applied per the ' +
  'project location. Estimates are valid for 30 days from date of issue.';

const CSI_DIVISION_MAP: Record<string, string> = {
  '01': 'General Requirements',
  '02': 'Existing Conditions',
  '03': 'Concrete',
  '04': 'Masonry',
  '05': 'Metals',
  '06': 'Wood, Plastics, and Composites',
  '07': 'Thermal and Moisture Protection',
  '08': 'Openings',
  '09': 'Finishes',
  '10': 'Specialties',
  '11': 'Equipment',
  '12': 'Furnishings',
  '13': 'Special Construction',
  '14': 'Conveying Equipment',
  '21': 'Fire Suppression',
  '22': 'Plumbing',
  '23': 'HVAC',
  '25': 'Integrated Automation',
  '26': 'Electrical',
  '27': 'Communications',
  '28': 'Electronic Safety and Security',
  '31': 'Earthwork',
  '32': 'Exterior Improvements',
  '33': 'Utilities',
};

/** Map CSI code prefix → division number */
function csiCodeToDivision(code: string): string {
  if (!code) return '01';
  const prefix = code.substring(0, 2);
  return CSI_DIVISION_MAP[prefix] ? prefix : '01';
}

/** Map element category → trade package */
function categoryToTradePackage(category: string): string {
  const cat = (category || '').toLowerCase();
  if (cat.includes('concrete') || cat.includes('slab') || cat.includes('column') || cat.includes('beam') || cat.includes('foundation'))
    return 'Concrete';
  if (cat.includes('steel') || cat.includes('metal') || cat.includes('rebar'))
    return 'Structural Steel & Rebar';
  if (cat.includes('masonry') || cat.includes('block') || cat.includes('brick'))
    return 'Masonry';
  if (cat.includes('wood') || cat.includes('framing') || cat.includes('lumber'))
    return 'Carpentry';
  if (cat.includes('roof') || cat.includes('insulation') || cat.includes('waterproof'))
    return 'Roofing & Waterproofing';
  if (cat.includes('door') || cat.includes('window') || cat.includes('glass') || cat.includes('glazing'))
    return 'Doors, Windows & Glazing';
  if (cat.includes('drywall') || cat.includes('paint') || cat.includes('flooring') || cat.includes('ceiling') || cat.includes('tile'))
    return 'Finishes';
  if (cat.includes('plumb') || cat.includes('pipe') || cat.includes('sanitary') || cat.includes('fixture'))
    return 'Plumbing';
  if (cat.includes('hvac') || cat.includes('duct') || cat.includes('heating') || cat.includes('cooling') || cat.includes('mechanical'))
    return 'Mechanical / HVAC';
  if (cat.includes('electr') || cat.includes('light') || cat.includes('recept') || cat.includes('panel') || cat.includes('conduit'))
    return 'Electrical';
  if (cat.includes('sprinkler') || cat.includes('fire'))
    return 'Fire Protection';
  if (cat.includes('elevator') || cat.includes('escalator'))
    return 'Conveying Systems';
  if (cat.includes('excavat') || cat.includes('earth') || cat.includes('site'))
    return 'Site Work';
  return 'General Requirements';
}


// ══════════════════════════════════════════════════════════════════════════════
//  METADATA BUILDER
// ══════════════════════════════════════════════════════════════════════════════

function buildMetadata(
  projectId: string,
  projectName: string,
  reportType: ReportType,
): ReportMetadata {
  return {
    reportId: `RPT-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    projectId,
    projectName,
    generatedAt: new Date().toISOString(),
    generatedBy: 'EstimatorPro v3 — SOP Part 7',
    reportType,
    version: REPORT_VERSION,
    standards: ['CIQS Standard Method', 'CSI MasterFormat 2018', 'AACE 18R-97', 'RICS NRM1/NRM2'],
    disclaimer: CIQS_DISCLAIMER,
  };
}


// ══════════════════════════════════════════════════════════════════════════════
//  1. BOQ REPORT GENERATOR
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a full Bill of Quantities report from the estimate engine output.
 *
 * Consumes:
 *   - estimator/estimate-engine.ts → buildEstimateForModel() lines
 *   - ohp-configuration.ts → resolved OH&P rates
 *   - canadian-cost-data.ts → regional factors
 *   - monte-carlo-simulation.ts → confidence data
 *
 * @param projectId  Project UUID
 * @param estimateLines  Output from estimator/estimate-engine.ts buildEstimateForModel()
 * @param ohpRates  Resolved OH&P rates { overhead, profit, contingency }
 * @param regionalFactor  Composite regional cost factor (e.g. 1.05 for Toronto)
 * @param regionName  Region label (e.g. "Toronto, ON")
 * @param taxRate  Combined sales tax rate (e.g. 0.13 for Ontario HST)
 * @param projectName  Display name for the report
 */
export function generateBOQReport(
  projectId: string,
  estimateLines: any[],
  ohpRates: { overhead: number; profit: number; contingency: number },
  regionalFactor: number,
  regionName: string,
  taxRate: number,
  projectName: string = 'Untitled Project',
): BOQReport {

  // ── Build report lines from estimate engine output ──────────────────────
  const lines: BOQReportLine[] = [];
  let lineNo = 0;

  for (const line of estimateLines) {
    if (!line || !line.code) continue;
    lineNo++;

    const qty = Number(line.qty) || 0;
    const rate = Number(line.rate) || 0;
    const div = csiCodeToDivision(line.code);
    const description = line.description || line.code;

    // Split rate into labor/material/equipment per CIQS methodology
    // Default split: 40% material, 50% labor, 10% equipment
    // (Professional QS would refine per CSI section — this is the framework)
    const materialPct = getMaterialSplit(div);
    const labourPct = getLabourSplit(div);
    const equipmentPct = 1 - materialPct - labourPct;

    const totalBeforeRegional = qty * rate;
    const totalWithRegional = totalBeforeRegional * regionalFactor;

    const materialRate = rate * materialPct * regionalFactor;
    const labourRate = rate * labourPct * regionalFactor;
    const equipmentRate = rate * equipmentPct * regionalFactor;

    const evidenceRefs = Array.isArray(line.evidenceRefs) ? line.evidenceRefs : [];
    const hasEvidence = evidenceRefs.length > 0;

    let confidenceLevel: BOQReportLine['confidenceLevel'] = 'HIGH';
    if (!hasEvidence) confidenceLevel = 'GAP';
    else if (qty === 0 || rate === 0) confidenceLevel = 'LOW';
    else if (evidenceRefs.length < 2) confidenceLevel = 'MEDIUM';

    const storey = extractStorey(line);
    const tradePackage = categoryToTradePackage(description);

    lines.push({
      lineNo,
      csiDivision: div,
      csiTitle: CSI_DIVISION_MAP[div] || 'General Requirements',
      uniformatCode: line.uniformatCode || '',
      description,
      unit: line.unit || 'ea',
      quantity: qty,
      materialRate,
      labourRate,
      equipmentRate,
      materialCost: qty * materialRate,
      labourCost: qty * labourRate,
      equipmentCost: qty * equipmentRate,
      totalCost: totalWithRegional,
      storey,
      tradePackage,
      elementIds: Array.isArray(line.elementIds) ? line.elementIds : [],
      evidenceRefs,
      hasEvidence,
      confidenceLevel,
    });
  }

  // ── Storey subtotals ───────────────────────────────────────────────────
  const storeyMap = new Map<string, StoreySubtotal>();
  for (const ln of lines) {
    const existing = storeyMap.get(ln.storey) || {
      storey: ln.storey, materialCost: 0, labourCost: 0, equipmentCost: 0, totalCost: 0, lineCount: 0,
    };
    existing.materialCost += ln.materialCost;
    existing.labourCost += ln.labourCost;
    existing.equipmentCost += ln.equipmentCost;
    existing.totalCost += ln.totalCost;
    existing.lineCount++;
    storeyMap.set(ln.storey, existing);
  }

  // ── Division subtotals ─────────────────────────────────────────────────
  const divMap = new Map<string, DivisionSubtotal>();
  for (const ln of lines) {
    const key = ln.csiDivision;
    const existing = divMap.get(key) || {
      division: key, title: ln.csiTitle, materialCost: 0, labourCost: 0, equipmentCost: 0, totalCost: 0, lineCount: 0,
    };
    existing.materialCost += ln.materialCost;
    existing.labourCost += ln.labourCost;
    existing.equipmentCost += ln.equipmentCost;
    existing.totalCost += ln.totalCost;
    existing.lineCount++;
    divMap.set(key, existing);
  }

  // ── Trade package subtotals ────────────────────────────────────────────
  const tradeMap = new Map<string, TradePackageSubtotal>();
  for (const ln of lines) {
    const key = ln.tradePackage;
    const existing = tradeMap.get(key) || {
      tradePackage: key, materialCost: 0, labourCost: 0, equipmentCost: 0, totalCost: 0, lineCount: 0,
    };
    existing.materialCost += ln.materialCost;
    existing.labourCost += ln.labourCost;
    existing.equipmentCost += ln.equipmentCost;
    existing.totalCost += ln.totalCost;
    existing.lineCount++;
    tradeMap.set(key, existing);
  }

  // ── Cost roll-up ───────────────────────────────────────────────────────
  const directCost = lines.reduce((s, l) => s + l.totalCost, 0);
  const overheadAmount = directCost * ohpRates.overhead;
  const profitAmount = directCost * ohpRates.profit;
  const subtotalBeforeContingency = directCost + overheadAmount + profitAmount;
  const contingencyAmount = subtotalBeforeContingency * ohpRates.contingency;
  const subtotalBeforeTax = subtotalBeforeContingency + contingencyAmount;
  const taxAmount = subtotalBeforeTax * taxRate;
  const totalProjectCost = subtotalBeforeTax + taxAmount;

  // ── Confidence summary ─────────────────────────────────────────────────
  const highCount = lines.filter(l => l.confidenceLevel === 'HIGH').length;
  const mediumCount = lines.filter(l => l.confidenceLevel === 'MEDIUM').length;
  const lowCount = lines.filter(l => l.confidenceLevel === 'LOW').length;
  const gapCount = lines.filter(l => l.confidenceLevel === 'GAP').length;
  const overallConfidence = lines.length > 0
    ? Math.round(((highCount * 100 + mediumCount * 70 + lowCount * 40 + gapCount * 0) / lines.length))
    : 0;

  // ── Gap warnings ───────────────────────────────────────────────────────
  const gapWarnings: string[] = [];
  if (gapCount > 0) {
    gapWarnings.push(`${gapCount} line item(s) have NO document evidence — flagged as GAP.`);
  }
  if (lowCount > 0) {
    gapWarnings.push(`${lowCount} line item(s) have LOW confidence (zero qty or rate).`);
  }
  if (overallConfidence < 50) {
    gapWarnings.push('CAUTION: Overall estimate confidence is below 50%. Additional document analysis recommended.');
  }

  return {
    metadata: buildMetadata(projectId, projectName, 'BOQ_FULL'),
    lines: lines.sort((a, b) => a.csiDivision.localeCompare(b.csiDivision) || a.lineNo - b.lineNo),
    storeySubtotals: Array.from(storeyMap.values()).sort((a, b) => a.storey.localeCompare(b.storey)),
    divisionSubtotals: Array.from(divMap.values()).sort((a, b) => a.division.localeCompare(b.division)),
    tradePackageSubtotals: Array.from(tradeMap.values()).sort((a, b) => b.totalCost - a.totalCost),
    directCost,
    overheadAmount,
    profitAmount,
    contingencyAmount,
    taxAmount,
    totalProjectCost,
    overheadRate: ohpRates.overhead,
    profitRate: ohpRates.profit,
    contingencyRate: ohpRates.contingency,
    taxRate,
    regionalFactor,
    regionName,
    confidenceSummary: { highCount, mediumCount, lowCount, gapCount, overallConfidence },
    gapWarnings,
  };
}


// ══════════════════════════════════════════════════════════════════════════════
//  2. BID-LEVELING SHEET GENERATOR
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a bid-leveling sheet from a BOQ report.
 * Organizes by trade package for tender comparison.
 */
export function generateBidLevelingSheet(
  boqReport: BOQReport,
  projectName: string,
): BidLevelingSheet {

  const tradePackages: BidTradePackage[] = [];

  for (const tp of boqReport.tradePackageSubtotals) {
    // Collect CSI divisions in this trade package
    const tpLines = boqReport.lines.filter(l => l.tradePackage === tp.tradePackage);
    const divisions = [...new Set(tpLines.map(l => l.csiDivision))].sort();

    // Build scope description from line items
    const scopeItems = [...new Set(tpLines.map(l => l.description))];
    const scope = scopeItems.length <= 5
      ? scopeItems.join('; ')
      : `${scopeItems.slice(0, 5).join('; ')}; +${scopeItems.length - 5} more items`;

    // Generate standard alternates based on trade
    const alternates = generateStandardAlternates(tp.tradePackage, tp.totalCost);

    // Generate allowances for items with GAP confidence
    const gapLines = tpLines.filter(l => l.confidenceLevel === 'GAP' || l.confidenceLevel === 'LOW');
    const allowances: BidAllowance[] = gapLines.map((gl, idx) => ({
      id: `ALW-${tp.tradePackage.substring(0, 3).toUpperCase()}-${idx + 1}`,
      description: `Allowance for ${gl.description} (pending RFI)`,
      amount: gl.totalCost > 0 ? gl.totalCost : 5000,
      unit: gl.unit,
    }));

    // Generate unit prices for quantity-variable items
    const unitPrices: BidUnitPrice[] = tpLines
      .filter(l => l.quantity > 0 && l.totalCost > 0 && ['m³', 'm²', 'm', 'kg'].includes(l.unit))
      .slice(0, 5)
      .map((l, idx) => ({
        id: `UP-${tp.tradePackage.substring(0, 3).toUpperCase()}-${idx + 1}`,
        description: l.description,
        unit: l.unit,
        rate: Math.round((l.totalCost / l.quantity) * 100) / 100,
      }));

    tradePackages.push({
      tradePackage: tp.tradePackage,
      csiDivisions: divisions,
      scope,
      baseAmount: tp.totalCost,
      alternates,
      allowances,
      unitPrices,
      exclusions: generateStandardExclusions(tp.tradePackage),
      clarifications: generateStandardClarifications(tp.tradePackage),
    });
  }

  return {
    metadata: buildMetadata(boqReport.metadata.projectId, projectName, 'BID_LEVELING'),
    tradePackages: tradePackages.sort((a, b) => b.baseAmount - a.baseAmount),
    totalBase: tradePackages.reduce((s, tp) => s + tp.baseAmount, 0),
    totalAlternates: tradePackages.reduce((s, tp) => s + tp.alternates.reduce((a, alt) => a + (alt.addDeduct === 'ADD' ? alt.amount : -alt.amount), 0), 0),
    totalAllowances: tradePackages.reduce((s, tp) => s + tp.allowances.reduce((a, alw) => a + alw.amount, 0), 0),
  };
}


// ══════════════════════════════════════════════════════════════════════════════
//  3. CLASH DETECTION REPORT
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a clash detection report from SOP 6.4 engine output.
 *
 * @param projectId  Project UUID
 * @param clashResult  Output from clash-detection-engine.ts runClashDetection()
 * @param projectName  Display name
 */
export function generateClashReport(
  projectId: string,
  clashResult: any,
  projectName: string = 'Untitled Project',
): ClashReport {

  const clashes: ClashReportItem[] = [];
  const rfisMap = new Map<string, ClashRFI>();
  let rfiSeq = 1;

  const rawClashes = clashResult?.clashes || [];

  for (const c of rawClashes) {
    const item: ClashReportItem = {
      clashId: c.clashId || `CLH-${clashes.length + 1}`,
      severity: c.severity || 'MEDIUM',
      category: c.category || 'HARD_CLASH',
      elementA: c.elementAId || 'unknown',
      elementB: c.elementBId || 'unknown',
      location: c.location || 'Not determined',
      storey: c.storey || 'Unknown',
      penetrationDepth_mm: c.penetrationDepth_mm || 0,
      description: c.description || '',
      recommendation: c.recommendation || 'Review required',
      rfiRequired: c.severity === 'CRITICAL' || c.severity === 'HIGH',
      estimatedCost: estimateClashCost(c.severity, c.category),
    };
    clashes.push(item);

    // Group RFIs by discipline
    if (item.rfiRequired) {
      const discipline = c.disciplineA || c.category || 'General';
      const existing = rfisMap.get(discipline);
      if (existing) {
        existing.clashIds.push(item.clashId);
      } else {
        rfisMap.set(discipline, {
          rfiId: `RFI-CLH-${String(rfiSeq++).padStart(3, '0')}`,
          subject: `Clash resolution required — ${discipline}`,
          clashIds: [item.clashId],
          discipline,
          priority: item.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
          description: `${discipline} clashes require design team resolution. See attached clash items.`,
        });
      }
    }
  }

  const criticalCount = clashes.filter(c => c.severity === 'CRITICAL').length;
  const highCount = clashes.filter(c => c.severity === 'HIGH').length;
  const mediumCount = clashes.filter(c => c.severity === 'MEDIUM').length;
  const lowCount = clashes.filter(c => c.severity === 'LOW').length;
  const infoCount = clashes.filter(c => c.severity === 'INFORMATIONAL').length;

  return {
    metadata: buildMetadata(projectId, projectName, 'CLASH_REPORT'),
    summary: {
      totalClashes: clashes.length,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      informationalCount: infoCount,
      resolvedCount: 0,
      unresolvedCount: clashes.length,
      rfisRequired: rfisMap.size,
      estimatedReworkCost: clashes.reduce((s, c) => s + c.estimatedCost, 0),
      estimatedReworkDays: Math.ceil((criticalCount * 5 + highCount * 3 + mediumCount * 1) / 2),
    },
    clashes: clashes.sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity)),
    rfisRequired: Array.from(rfisMap.values()),
    missingClearanceData: clashResult?.missingClearanceData || [],
  };
}


// ══════════════════════════════════════════════════════════════════════════════
//  4. CONSTRUCTABILITY REPORT
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a constructability report from SOP 6.1 engine output.
 */
export function generateConstructabilityReport(
  projectId: string,
  analysis: any,
  projectName: string = 'Untitled Project',
): ConstructabilityReport {

  const workAreas: ConstructabilityWorkArea[] = (analysis?.workAreas || []).map((wa: any) => ({
    name: wa.name || 'Unnamed',
    level: wa.level || 'Unknown',
    zone: wa.zone || '',
    trades: wa.trades || [],
    maxWorkers: wa.maxWorkers ?? null,
    accessRoutes: wa.accessRoutes || [],
    equipmentRequired: wa.equipmentRequired || [],
  }));

  const tradeDependencies: ConstructabilityDependency[] = (analysis?.tradeDependencies || []).map((td: any) => ({
    predecessor: td.predecessorTrade || '',
    successor: td.successorTrade || '',
    type: td.dependencyType || 'finish_to_start',
    lagDays: td.lagDays || 0,
    holdPoint: td.holdPoint || false,
    inspectionRequired: td.inspectionRequired || false,
  }));

  const safetyIssues: ConstructabilitySafetyIssue[] = (analysis?.safetyIssues || []).map((si: any) => ({
    id: si.id || '',
    severity: si.severity || 'medium',
    description: si.description || '',
    location: si.location || '',
    recommendation: si.recommendation || '',
    codeReference: si.codeReference || '',
  }));

  const tempWorks: ConstructabilityTempWorks[] = (analysis?.tempWorks || []).map((tw: any) => ({
    type: tw.type || 'other',
    description: tw.description || '',
    location: tw.location || '',
    duration: tw.duration || '',
    estimatedCost: tw.estimatedCost ?? null,
  }));

  // Extract hold points from dependencies
  const holdPoints = tradeDependencies
    .filter(td => td.holdPoint)
    .map(td => `${td.predecessor} → ${td.successor} (${td.type}, lag: ${td.lagDays}d)`);

  // Build trade execution order from dependencies (topological sort simplified)
  const allTrades = new Set<string>();
  tradeDependencies.forEach(td => {
    allTrades.add(td.predecessor);
    allTrades.add(td.successor);
  });
  const tradeExecutionOrder = Array.from(allTrades);

  return {
    metadata: buildMetadata(projectId, projectName, 'CONSTRUCTABILITY'),
    workAreas,
    tradeDependencies,
    safetyIssues: safetyIssues.sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity)),
    tempWorks,
    holdPoints,
    tradeExecutionOrder,
    gapCount: (analysis?.gaps || []).length,
    criticalIssueCount: safetyIssues.filter(si => si.severity === 'critical').length,
  };
}


// ══════════════════════════════════════════════════════════════════════════════
//  5. EXECUTIVE SUMMARY GENERATOR
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Generate an executive summary consuming ALL module outputs.
 */
export function generateExecutiveSummary(
  projectId: string,
  projectName: string,
  boqReport: BOQReport,
  clashReport: ClashReport | null,
  constructabilityReport: ConstructabilityReport | null,
  monteCarloResult: any | null,
  projectInfo: {
    location?: string;
    buildingType?: string;
    grossFloorArea_m2?: number;
    storeyCount?: number;
    constructionType?: string;
    estimateClass?: string;
  } = {},
): ExecutiveSummary {

  const directCost = boqReport.directCost;
  const indirectCost = boqReport.overheadAmount + boqReport.profitAmount;
  const grossArea = projectInfo.grossFloorArea_m2 || null;

  // Monte Carlo data if available
  let p10: number | null = null;
  let p50: number | null = null;
  let p90: number | null = null;
  let simRuns: number | null = null;
  if (monteCarloResult?.percentiles) {
    p10 = monteCarloResult.percentiles.p10 ?? null;
    p50 = monteCarloResult.percentiles.p50 ?? null;
    p90 = monteCarloResult.percentiles.p90 ?? null;
    simRuns = monteCarloResult.simulationRuns ?? null;
  }

  // Accuracy range based on estimate class
  const accuracyRange = getAccuracyRange(projectInfo.estimateClass || 'Class3');

  // Build recommendations
  const recommendations: string[] = [];
  if (boqReport.confidenceSummary.gapCount > 0) {
    recommendations.push(
      `Resolve ${boqReport.confidenceSummary.gapCount} data gap(s) via RFI to improve estimate reliability.`,
    );
  }
  if (clashReport && clashReport.summary.criticalCount > 0) {
    recommendations.push(
      `Address ${clashReport.summary.criticalCount} critical clash(es) before construction to avoid rework.`,
    );
  }
  if (constructabilityReport && constructabilityReport.criticalIssueCount > 0) {
    recommendations.push(
      `Review ${constructabilityReport.criticalIssueCount} critical constructability issue(s) with the design team.`,
    );
  }
  if (boqReport.confidenceSummary.overallConfidence < 70) {
    recommendations.push(
      'Overall confidence is below 70%. Consider additional document analysis or design development.',
    );
  }

  return {
    metadata: buildMetadata(projectId, projectName, 'EXECUTIVE_SUMMARY'),
    projectOverview: {
      projectName,
      location: projectInfo.location || boqReport.regionName,
      buildingType: projectInfo.buildingType || 'Not specified',
      grossFloorArea_m2: grossArea,
      storeyCount: projectInfo.storeyCount || boqReport.storeySubtotals.length,
      constructionType: projectInfo.constructionType || 'Not specified',
    },
    costSummary: {
      directCost,
      indirectCost,
      contingency: boqReport.contingencyAmount,
      taxes: boqReport.taxAmount,
      totalProjectCost: boqReport.totalProjectCost,
      costPerM2: grossArea ? Math.round(boqReport.totalProjectCost / grossArea) : null,
      costPerSF: grossArea ? Math.round(boqReport.totalProjectCost / (grossArea * 10.764)) : null,
    },
    confidenceAnalysis: {
      estimateClass: projectInfo.estimateClass || 'Class 3 (Budget Authorization)',
      accuracyRange,
      monteCarloP10: p10,
      monteCarloP50: p50,
      monteCarloP90: p90,
      simulationRuns: simRuns,
      dataCompleteness: boqReport.confidenceSummary.overallConfidence,
    },
    riskSummary: {
      totalGaps: boqReport.confidenceSummary.gapCount,
      criticalGaps: boqReport.gapWarnings.length,
      rfisRequired: clashReport?.summary.rfisRequired || 0,
      clashesFound: clashReport?.summary.totalClashes || 0,
      criticalClashes: clashReport?.summary.criticalCount || 0,
      constructabilityIssues: constructabilityReport?.criticalIssueCount || 0,
    },
    keyAssumptions: [
      `Regional cost factor: ${boqReport.regionalFactor} (${boqReport.regionName})`,
      `OH&P rates: Overhead ${(boqReport.overheadRate * 100).toFixed(1)}%, Profit ${(boqReport.profitRate * 100).toFixed(1)}%`,
      `Contingency: ${(boqReport.contingencyRate * 100).toFixed(1)}%`,
      `Tax rate: ${(boqReport.taxRate * 100).toFixed(1)}% (${boqReport.regionName})`,
      'Quantities derived from BIM model elements per CIQS Standard Method',
      'Labour rates based on current union rates for project jurisdiction',
    ],
    exclusions: [
      'Land acquisition and legal fees',
      'Furniture, fixtures & equipment (FF&E) unless noted',
      'Owner\'s project management costs',
      'Financing and insurance costs',
      'Permits and development charges (project-specific)',
      'Hazardous material abatement (if applicable)',
    ],
    recommendations,
  };
}


// ══════════════════════════════════════════════════════════════════════════════
//  6. GAP/RFI REGISTER
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Compile all gaps from every SOP module into a unified register.
 */
export function generateGapRegister(
  projectId: string,
  projectName: string,
  allGaps: Gap[],
): GapRegister {

  const entries: GapRegisterEntry[] = allGaps.map(g => ({
    gapId: g.id,
    type: g.type,
    parameterName: g.parameterName,
    description: g.description,
    discipline: g.discipline,
    impact: g.impact,
    affectedElements: g.affectedCount,
    status: g.status || 'open',
    rfiNumber: g.rfiNumber || null,
    sopReference: g.sopReference,
    evidenceRef: g.evidenceRef ? formatEvidenceRefSimple(g.evidenceRef) : '[none]',
  }));

  const byDiscipline: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};

  for (const g of allGaps) {
    byDiscipline[g.discipline] = (byDiscipline[g.discipline] || 0) + 1;
    byType[g.type] = (byType[g.type] || 0) + 1;
    bySeverity[g.impact] = (bySeverity[g.impact] || 0) + 1;
  }

  return {
    metadata: buildMetadata(projectId, projectName, 'GAP_REGISTER'),
    gaps: entries.sort((a, b) => severityOrder(a.impact) - severityOrder(b.impact)),
    totalGaps: entries.length,
    criticalGaps: entries.filter(e => e.impact === 'critical').length,
    rfisGenerated: entries.filter(e => e.rfiNumber !== null).length,
    byDiscipline,
    byType,
    bySeverity,
  };
}


// ══════════════════════════════════════════════════════════════════════════════
//  7. SCHEDULE OF VALUES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a schedule of values from the 4D sequencing model and BOQ report.
 */
export function generateScheduleOfValues(
  projectId: string,
  projectName: string,
  boqReport: BOQReport,
  sequencingModel: any | null,
  retainageRate: number = 0.10,
): ScheduleOfValues {

  const phases: SOVPhase[] = [];

  if (sequencingModel?.phases && sequencingModel.phases.length > 0) {
    // Use actual sequencing phases
    const totalValue = boqReport.totalProjectCost;
    const phaseCount = sequencingModel.phases.length;

    for (const phase of sequencingModel.phases) {
      // Distribute cost proportionally by activity count
      const activityCount = (phase.activities || []).length;
      const totalActivities = sequencingModel.phases.reduce(
        (s: number, p: any) => s + (p.activities || []).length, 0,
      ) || phaseCount;

      const phaseValue = totalValue * (activityCount / totalActivities);

      // Build trade breakdown from activities
      const tradeAmounts = new Map<string, number>();
      for (const act of (phase.activities || [])) {
        const trade = act.trade || 'General';
        tradeAmounts.set(trade, (tradeAmounts.get(trade) || 0) + phaseValue / (activityCount || 1));
      }

      phases.push({
        phaseNumber: phase.phaseNumber,
        phaseName: phase.phaseName,
        level: phase.level || null,
        scheduledValue: Math.round(phaseValue * 100) / 100,
        percentOfTotal: Math.round((phaseValue / totalValue) * 10000) / 100,
        milestones: phase.prerequisites || [],
        tradeBreakdown: Array.from(tradeAmounts.entries()).map(([trade, amount]) => ({
          trade,
          amount: Math.round(amount * 100) / 100,
        })),
      });
    }
  } else {
    // Generate standard phases from storey subtotals
    let phaseNum = 0;

    // Phase 1: Mobilization & Site Work (5% of total)
    phases.push({
      phaseNumber: ++phaseNum,
      phaseName: 'Mobilization & Site Work',
      level: null,
      scheduledValue: boqReport.totalProjectCost * 0.05,
      percentOfTotal: 5,
      milestones: ['Contract execution', 'Permits obtained', 'Site access confirmed'],
      tradeBreakdown: [{ trade: 'General Contractor', amount: boqReport.totalProjectCost * 0.05 }],
    });

    // Phase 2: Substructure (15% of total)
    phases.push({
      phaseNumber: ++phaseNum,
      phaseName: 'Substructure & Foundations',
      level: 'Basement / Foundation',
      scheduledValue: boqReport.totalProjectCost * 0.15,
      percentOfTotal: 15,
      milestones: ['Excavation complete', 'Foundation inspection', 'Backfill complete'],
      tradeBreakdown: [
        { trade: 'Excavation', amount: boqReport.totalProjectCost * 0.05 },
        { trade: 'Concrete', amount: boqReport.totalProjectCost * 0.10 },
      ],
    });

    // Per-storey phases
    const remainingPct = 70;
    const storeys = boqReport.storeySubtotals.filter(s => s.storey !== 'Unknown');
    const _pctPerStorey = storeys.length > 0 ? remainingPct / storeys.length : remainingPct;

    for (const storey of storeys) {
      phases.push({
        phaseNumber: ++phaseNum,
        phaseName: `Superstructure — ${storey.storey}`,
        level: storey.storey,
        scheduledValue: storey.totalCost,
        percentOfTotal: Math.round((storey.totalCost / boqReport.totalProjectCost) * 10000) / 100,
        milestones: [`${storey.storey} structural complete`, `${storey.storey} enclosed`],
        tradeBreakdown: [
          { trade: 'Structure', amount: storey.materialCost },
          { trade: 'Labour', amount: storey.labourCost },
          { trade: 'Equipment', amount: storey.equipmentCost },
        ],
      });
    }

    // Final phase: Commissioning (10% of total)
    phases.push({
      phaseNumber: ++phaseNum,
      phaseName: 'Commissioning & Closeout',
      level: null,
      scheduledValue: boqReport.totalProjectCost * 0.10,
      percentOfTotal: 10,
      milestones: ['Systems commissioning', 'Deficiency inspection', 'Substantial completion'],
      tradeBreakdown: [{ trade: 'All Trades', amount: boqReport.totalProjectCost * 0.10 }],
    });
  }

  return {
    metadata: buildMetadata(projectId, projectName, 'SCHEDULE_OF_VALUES'),
    phases,
    totalContractValue: boqReport.totalProjectCost,
    retainageRate,
  };
}


// ══════════════════════════════════════════════════════════════════════════════
//  TEXT FORMATTERS — Plain-text report rendering
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Format BOQ report as plain text for API / console display.
 */
export function formatBOQReportText(report: BOQReport): string {
  const lines: string[] = [];
  const hr = '═'.repeat(100);
  const thinHr = '─'.repeat(100);

  lines.push(hr);
  lines.push(`  BILL OF QUANTITIES — ${report.metadata.projectName}`);
  lines.push(`  Generated: ${report.metadata.generatedAt}  |  Report ID: ${report.metadata.reportId}`);
  lines.push(`  Standards: ${report.metadata.standards.join(', ')}`);
  lines.push(hr);
  lines.push('');

  // Division subtotals
  lines.push('  CSI DIVISION SUMMARY');
  lines.push(thinHr);
  lines.push('  Div  Title                                   Material        Labour       Equipment        Total');
  lines.push(thinHr);
  for (const div of report.divisionSubtotals) {
    lines.push(
      `  ${div.division.padEnd(4)} ${div.title.padEnd(38)} ` +
      `${fmtMoney(div.materialCost).padStart(14)} ` +
      `${fmtMoney(div.labourCost).padStart(13)} ` +
      `${fmtMoney(div.equipmentCost).padStart(13)} ` +
      `${fmtMoney(div.totalCost).padStart(14)}`,
    );
  }
  lines.push(thinHr);
  lines.push(
    `       ${'DIRECT COST TOTAL'.padEnd(38)} ` +
    `${''.padStart(14)} ${''.padStart(13)} ${''.padStart(13)} ` +
    `${fmtMoney(report.directCost).padStart(14)}`,
  );
  lines.push('');

  // Storey subtotals
  lines.push('  PER-STOREY BREAKDOWN');
  lines.push(thinHr);
  for (const st of report.storeySubtotals) {
    lines.push(`  ${st.storey.padEnd(25)} ${fmtMoney(st.totalCost).padStart(14)}  (${st.lineCount} items)`);
  }
  lines.push('');

  // Cost roll-up
  lines.push('  COST ROLL-UP');
  lines.push(thinHr);
  lines.push(`  Direct Cost:                              ${fmtMoney(report.directCost).padStart(18)}`);
  lines.push(`  Overhead (${(report.overheadRate * 100).toFixed(1)}%):                        ${fmtMoney(report.overheadAmount).padStart(18)}`);
  lines.push(`  Profit (${(report.profitRate * 100).toFixed(1)}%):                          ${fmtMoney(report.profitAmount).padStart(18)}`);
  lines.push(`  Contingency (${(report.contingencyRate * 100).toFixed(1)}%):                    ${fmtMoney(report.contingencyAmount).padStart(18)}`);
  lines.push(`  Tax (${(report.taxRate * 100).toFixed(1)}%):                             ${fmtMoney(report.taxAmount).padStart(18)}`);
  lines.push(thinHr);
  lines.push(`  TOTAL PROJECT COST:                       ${fmtMoney(report.totalProjectCost).padStart(18)}`);
  lines.push(`  Region: ${report.regionName}  |  Factor: ${report.regionalFactor}`);
  lines.push('');

  // Confidence
  lines.push('  CONFIDENCE ANALYSIS');
  lines.push(thinHr);
  lines.push(`  Overall: ${report.confidenceSummary.overallConfidence}%`);
  lines.push(`  HIGH: ${report.confidenceSummary.highCount}  |  MEDIUM: ${report.confidenceSummary.mediumCount}  |  LOW: ${report.confidenceSummary.lowCount}  |  GAP: ${report.confidenceSummary.gapCount}`);
  if (report.gapWarnings.length > 0) {
    lines.push('');
    for (const w of report.gapWarnings) {
      lines.push(`  ⚠ ${w}`);
    }
  }
  lines.push('');
  lines.push(hr);
  lines.push(`  ${report.metadata.disclaimer}`);
  lines.push(hr);

  return lines.join('\n');
}

/**
 * Format Executive Summary as plain text.
 */
export function formatExecutiveSummaryText(summary: ExecutiveSummary): string {
  const lines: string[] = [];
  const hr = '═'.repeat(90);

  lines.push(hr);
  lines.push(`  EXECUTIVE SUMMARY — ${summary.projectOverview.projectName}`);
  lines.push(`  ${summary.metadata.generatedAt}`);
  lines.push(hr);
  lines.push('');
  lines.push(`  Location:           ${summary.projectOverview.location}`);
  lines.push(`  Building Type:      ${summary.projectOverview.buildingType}`);
  lines.push(`  Storeys:            ${summary.projectOverview.storeyCount}`);
  if (summary.projectOverview.grossFloorArea_m2) {
    lines.push(`  Gross Floor Area:   ${summary.projectOverview.grossFloorArea_m2.toLocaleString()} m²`);
  }
  lines.push('');
  lines.push('  COST SUMMARY');
  lines.push('  ' + '─'.repeat(50));
  lines.push(`  Direct Cost:        ${fmtMoney(summary.costSummary.directCost)}`);
  lines.push(`  Indirect Cost:      ${fmtMoney(summary.costSummary.indirectCost)}`);
  lines.push(`  Contingency:        ${fmtMoney(summary.costSummary.contingency)}`);
  lines.push(`  Taxes:              ${fmtMoney(summary.costSummary.taxes)}`);
  lines.push(`  TOTAL:              ${fmtMoney(summary.costSummary.totalProjectCost)}`);
  if (summary.costSummary.costPerM2) {
    lines.push(`  Cost / m²:          ${fmtMoney(summary.costSummary.costPerM2)}`);
    lines.push(`  Cost / SF:          ${fmtMoney(summary.costSummary.costPerSF!)}`);
  }
  lines.push('');
  lines.push(`  Estimate Class:     ${summary.confidenceAnalysis.estimateClass}`);
  lines.push(`  Accuracy Range:     ${summary.confidenceAnalysis.accuracyRange.low}% to +${summary.confidenceAnalysis.accuracyRange.high}%`);
  lines.push(`  Data Completeness:  ${summary.confidenceAnalysis.dataCompleteness}%`);
  if (summary.confidenceAnalysis.monteCarloP50) {
    lines.push(`  Monte Carlo P10:    ${fmtMoney(summary.confidenceAnalysis.monteCarloP10!)}`);
    lines.push(`  Monte Carlo P50:    ${fmtMoney(summary.confidenceAnalysis.monteCarloP50)}`);
    lines.push(`  Monte Carlo P90:    ${fmtMoney(summary.confidenceAnalysis.monteCarloP90!)}`);
    lines.push(`  Simulations:        ${summary.confidenceAnalysis.simulationRuns?.toLocaleString()}`);
  }
  lines.push('');
  lines.push('  RISK SUMMARY');
  lines.push('  ' + '─'.repeat(50));
  lines.push(`  Total Gaps:         ${summary.riskSummary.totalGaps}`);
  lines.push(`  RFIs Required:      ${summary.riskSummary.rfisRequired}`);
  lines.push(`  Clashes Found:      ${summary.riskSummary.clashesFound} (${summary.riskSummary.criticalClashes} critical)`);
  lines.push(`  Constructability:   ${summary.riskSummary.constructabilityIssues} issues`);
  lines.push('');

  if (summary.recommendations.length > 0) {
    lines.push('  RECOMMENDATIONS');
    lines.push('  ' + '─'.repeat(50));
    summary.recommendations.forEach((r, i) => lines.push(`  ${i + 1}. ${r}`));
  }

  lines.push('');
  lines.push(hr);

  return lines.join('\n');
}


// ══════════════════════════════════════════════════════════════════════════════
//  HELPER FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

function fmtMoney(amount: number): string {
  return '$' + Math.round(amount).toLocaleString('en-CA');
}

function severityOrder(severity: string): number {
  const map: Record<string, number> = {
    critical: 0, CRITICAL: 0,
    high: 1, HIGH: 1,
    medium: 2, MEDIUM: 2,
    low: 3, LOW: 3,
    informational: 4, INFORMATIONAL: 4,
  };
  return map[severity] ?? 5;
}

function extractStorey(line: any): string {
  if (line.storey) return line.storey;
  if (line.floor) return `Level ${line.floor}`;
  // Try to extract from element IDs or properties
  if (line.elementIds?.[0]) {
    const id = line.elementIds[0];
    const match = id.match(/L(\d+)/i);
    if (match) return `Level ${match[1]}`;
  }
  return 'Unknown';
}

/** Material/Labour/Equipment split by CSI division (CIQS standard proportions) */
function getMaterialSplit(div: string): number {
  const splits: Record<string, number> = {
    '03': 0.45, // Concrete: heavy materials
    '04': 0.40, // Masonry
    '05': 0.50, // Metals: steel is expensive
    '06': 0.45, // Wood
    '07': 0.40, // Roofing
    '08': 0.55, // Openings: windows/doors are material-heavy
    '09': 0.35, // Finishes: labor-heavy
    '22': 0.40, // Plumbing
    '23': 0.45, // HVAC
    '26': 0.40, // Electrical
    '31': 0.30, // Earthwork: equipment-heavy
  };
  return splits[div] ?? 0.40;
}

function getLabourSplit(div: string): number {
  const splits: Record<string, number> = {
    '03': 0.40, '04': 0.45, '05': 0.35, '06': 0.40,
    '07': 0.45, '08': 0.30, '09': 0.55, '22': 0.45,
    '23': 0.40, '26': 0.50, '31': 0.35,
  };
  return splits[div] ?? 0.50;
}

function estimateClashCost(severity: string, _category: string): number {
  const baseCosts: Record<string, number> = {
    CRITICAL: 25000, HIGH: 10000, MEDIUM: 3000, LOW: 500, INFORMATIONAL: 0,
  };
  return baseCosts[severity] || 1000;
}

function getAccuracyRange(estimateClass: string): { low: number; high: number } {
  const ranges: Record<string, { low: number; high: number }> = {
    Class1: { low: -3, high: 10 },
    Class2: { low: -5, high: 15 },
    Class3: { low: -10, high: 20 },
    Class4: { low: -15, high: 30 },
    Class5: { low: -20, high: 50 },
  };
  return ranges[estimateClass] || ranges.Class3;
}

function generateStandardAlternates(trade: string, baseAmount: number): BidAlternate[] {
  // Generate 1-2 standard alternates per trade package
  const alternates: BidAlternate[] = [];
  if (trade.includes('Concrete')) {
    alternates.push({
      id: 'ALT-CONC-1', description: 'High-performance concrete (40 MPa → 50 MPa)',
      addDeduct: 'ADD', amount: Math.round(baseAmount * 0.08),
    });
  }
  if (trade.includes('Finishes')) {
    alternates.push({
      id: 'ALT-FIN-1', description: 'Upgrade to premium finishes package',
      addDeduct: 'ADD', amount: Math.round(baseAmount * 0.15),
    });
  }
  if (trade.includes('Mechanical') || trade.includes('HVAC')) {
    alternates.push({
      id: 'ALT-MECH-1', description: 'Energy recovery ventilator upgrade',
      addDeduct: 'ADD', amount: Math.round(baseAmount * 0.12),
    });
  }
  return alternates;
}

function generateStandardExclusions(trade: string): string[] {
  const common = ['Testing and commissioning by others unless noted'];
  if (trade.includes('Concrete')) return [...common, 'Reinforcing steel (see Structural Steel & Rebar)'];
  if (trade.includes('Electrical')) return [...common, 'Owner-furnished equipment connections'];
  return common;
}

function generateStandardClarifications(_trade: string): string[] {
  return [
    'Pricing based on construction documents as issued',
    'Overtime and shift premiums not included unless specified',
    'Access to work areas per project schedule',
  ];
}

function formatEvidenceRefSimple(ref: EvidenceReference): string {
  const parts: string[] = [];
  if (ref.documentId) parts.push(ref.documentId);
  if (ref.sheet) parts.push(`Sheet ${ref.sheet}`);
  if (ref.page) parts.push(`p.${ref.page}`);
  if (ref.section) parts.push(`§${ref.section}`);
  return parts.length > 0 ? parts.join(', ') : '[none]';
}
