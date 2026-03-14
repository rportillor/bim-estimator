// server/estimator/boe-generator.ts
// =============================================================================
// BASIS OF ESTIMATE (BoE) GENERATOR
// =============================================================================
//
// Implements QS Level 5 Phase 1: Mobilization & Document Intake
// Per AACE RP 34R-05 (Basis of Estimate) and CIQS best practice.
//
// Purpose:
//   Auto-generates a professional Basis of Estimate document from the
//   estimate-engine output, budget-structure layers, and UNIFORMAT mapping.
//   The BoE is the single most important document accompanying a professional
//   estimate — it records WHAT was estimated, HOW it was estimated, and
//   WHAT ASSUMPTIONS were made.
//
// BoE Sections (per AACE RP 34R-05):
//   1. Executive Summary
//   2. Project Description
//   3. Estimate Classification & Accuracy
//   4. Documents Referenced
//   5. Methodology
//   6. Assumptions, Qualifications & Exclusions
//   7. Cost Summary — by CSI Division
//   8. Cost Summary — by UNIFORMAT Element
//   9. Budget Layer Summary (8 tiers)
//  10. Risk & Contingency
//  11. Rate Basis & Sources
//  12. Reconciliation & QA
//
// API:
//   NEW (v14.32+): generateBasisOfEstimate() -> BasisOfEstimate
//   LEGACY (v14.x compat): generateBoE() -> BoEDocument
//     Consumers: qs-level5-routes.ts, qs-level5-supplement.ts
//
// Standards: AACE RP 34R-05, AACE RP 18R-97, CIQS, CSI MasterFormat 2018
// =============================================================================

import type { EstimateSummary } from './estimate-engine';
import type { BudgetStructure, RiskItem } from './budget-structure';
import type { DualSummaryReport } from './uniformat-mapping';

// Legacy compatibility imports — required by generateBoE() shim
import type { CodeAdderResult } from './code-driven-adders';
import type { MonteCarloResult } from './monte-carlo-engine';
import type { BenchmarkComparison, CompletenessCheck } from './benchmark-engine';
import type { UniformatSummaryRow, CSIDivisionSummaryRow } from './uniformat-crosswalk';

// ─── BoE Interfaces ──────────────────────────────────────────────────────────

export interface ProjectDescription {
  projectName: string;
  projectNumber?: string;
  location: string;
  client?: string;
  architect?: string;
  structuralEngineer?: string;
  mechanicalEngineer?: string;
  electricalEngineer?: string;
  buildingType: string;          // e.g., 'Residential', 'Commercial', 'Institutional'
  grossFloorArea?: number;       // m²
  numberOfStoreys?: number;
  constructionType?: string;     // e.g., 'Type V-B wood frame', 'Type I-A steel/concrete'
  sitArea?: number;              // m²
  zoning?: string;
  buildingCodeEdition?: string;  // e.g., 'OBC 2024'
  occupancyClassification?: string;
}

export interface DocumentReference {
  id: string;
  title: string;
  discipline: 'Architectural' | 'Structural' | 'Mechanical' | 'Electrical' | 'Civil' | 'Specifications' | 'Geotechnical' | 'Other';
  revisionDate: string;
  revisionNumber?: string;
  drawingNumbers?: string[];
  notes?: string;
}

export interface Assumption {
  id: string;
  category: 'scope' | 'design' | 'pricing' | 'schedule' | 'site' | 'regulatory';
  description: string;
  impact: 'high' | 'medium' | 'low';
  source?: string;               // e.g., "Client verbal direction 2026-01-15"
  relatedCSI?: string[];
}

export interface Exclusion {
  id: string;
  description: string;
  reason: string;
  suggestedAllowance?: number;   // If owner may want to add later
}

export interface Qualification {
  id: string;
  description: string;
  costImpact?: string;           // e.g., "Could add $50K-$100K if required"
}

export interface BoeConfig {
  project: ProjectDescription;
  documents: DocumentReference[];
  assumptions: Assumption[];
  exclusions: Exclusion[];
  qualifications: Qualification[];
  preparedBy: string;
  reviewedBy?: string;
  approvedBy?: string;
  reportDate?: string;
  clientRef?: string;
  confidentiality?: string;
}

export interface BasisOfEstimate {
  // Metadata
  projectName: string;
  reportDate: string;
  preparedBy: string;
  reviewedBy: string;
  approvedBy: string;
  confidentiality: string;

  // Sections
  executiveSummary: string;
  projectDescription: ProjectDescription;
  estimateClassification: {
    aaceClass: number;
    className: string;
    scopeMaturity: number;
    accuracyRange: string;
    contingencyApplied: number;
  };
  documentsReferenced: DocumentReference[];
  methodology: string;
  assumptions: Assumption[];
  exclusions: Exclusion[];
  qualifications: Qualification[];
  costSummaryByDivision: { division: string; name: string; amount: number; percent: number }[];
  costSummaryByElement: { code: string; name: string; amount: number; percent: number }[];
  budgetLayerSummary: { layer: string; amount: number; percent: number }[];
  riskSummary: {
    totalContingency: number;
    managementReserve: number;
    riskItems: RiskItem[];
  };
  rateBasis: string;
  reconciliation: {
    csiTotal: number;
    uniformatTotal: number;
    delta: number;
    passed: boolean;
  };

  // Full formatted document
  formattedDocument: string;
  generatedAt: string;
}

// ─── BoE Generation ──────────────────────────────────────────────────────────

/**
 * Generate a complete Basis of Estimate document.
 *
 * Takes the three major outputs (estimate, budget, UNIFORMAT dual summary)
 * plus project-specific configuration, and produces a professional BoE
 * per AACE RP 34R-05.
 */
export function generateBasisOfEstimate(
  estimate: EstimateSummary,
  budget: BudgetStructure,
  dualSummary: DualSummaryReport,
  config: BoeConfig
): BasisOfEstimate {
  const reportDate = config.reportDate ?? new Date().toISOString().split('T')[0];
  const f = (n: number) => '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (n: number) => (n * 100).toFixed(1) + '%';

  // --- Executive Summary ---
  const execLines: string[] = [];
  execLines.push('This Basis of Estimate documents the ' + budget.aaceClass.className +
    ' prepared for ' + config.project.projectName + ' located in ' + config.project.location + '.');
  execLines.push('');
  execLines.push('The estimate was prepared using CIQS methodology with CSI MasterFormat 2018 ' +
    'coding and UNIFORMAT II elemental classification per ASTM E1557. All rates are ' +
    'Canadian dollars (CAD) with Ontario 2025 as the base pricing date.');
  execLines.push('');
  execLines.push('The estimated GRAND TOTAL is ' + f(budget.GRAND_TOTAL) +
    ' (including ' + pct(budget.taxes.rate) + ' HST).');
  execLines.push('');
  execLines.push('Scope maturity is assessed at ' + budget.aaceClass.scopeMaturity.toFixed(1) +
    '%, yielding an AACE ' + budget.aaceClass.className + ' with expected accuracy of ' +
    budget.aaceClass.expectedAccuracyLow + '% to +' + budget.aaceClass.expectedAccuracyHigh + '%.');
  execLines.push('');
  execLines.push('Key metrics:');
  execLines.push('  Direct cost: ' + f(budget.directCost.subtotal) +
    ' (' + budget.directCost.lineItemCount + ' line items across ' +
    budget.directCost.csiDivisionsUsed + ' CSI divisions)');
  execLines.push('  Construction cost: ' + f(budget.constructionCost));
  execLines.push('  Total project cost: ' + f(budget.totalProjectCost));
  execLines.push('  GRAND TOTAL (incl. taxes): ' + f(budget.GRAND_TOTAL));

  const executiveSummary = execLines.join('\n');

  // --- Estimate Classification ---
  const estimateClassification = {
    aaceClass: budget.aaceClass.estimateClass,
    className: budget.aaceClass.className,
    scopeMaturity: budget.aaceClass.scopeMaturity,
    accuracyRange: budget.aaceClass.expectedAccuracyLow + '% to +' + budget.aaceClass.expectedAccuracyHigh + '%',
    contingencyApplied: budget.contingency.percentOfBase,
  };

  // --- Methodology ---
  const methLines: string[] = [];
  methLines.push('Measurement Method: Quantities derived from BIM model geometry and ' +
    'construction document analysis using AI-assisted extraction. All quantities ' +
    'are measured per CIQS elemental measurement rules.');
  methLines.push('');
  methLines.push('Pricing Structure: Labor, Material, and Equipment (L/M/E) breakdown ' +
    'per line item. Base rates sourced from CIQS Elemental Cost Analysis and ' +
    'RSMeans Canadian Edition. Regional adjustment factor of ' +
    estimate.regionalFactor.toFixed(2) + ' applied for ' + estimate.region + '.');
  methLines.push('');
  methLines.push('Waste Factors: Material-specific waste percentages applied per CIQS ' +
    'standard practice. Waste cost tracked separately for transparency. ' +
    'Total waste allowance: ' + f(budget.directCost.waste) + '.');
  methLines.push('');
  methLines.push('Classification: CSI MasterFormat 2018 for trade-based pricing (34 active ' +
    'divisions). UNIFORMAT II (ASTM E1557) for elemental cost management. ' +
    'Dual classification enables both contractor pricing and management reporting.');
  methLines.push('');
  methLines.push('Budget Structure: 8-tier layered budget per CIQS/AACE methodology. ' +
    'Escalation calculated using compound interest with blended material (' +
    (budget.escalation.config.materialEscalation * 100).toFixed(1) + '%) and labor (' +
    (budget.escalation.config.laborEscalation * 100).toFixed(1) + '%) rates.');
  methLines.push('');
  methLines.push('Contingency: AACE RP 18R-97 class-based contingency. Design contingency, ' +
    'construction contingency, and management reserve tracked separately.');
  const methodology = methLines.join('\n');

  // --- Cost Summary by Division ---
  const costSummaryByDivision = dualSummary.byCSIDivision.map(d => ({
    division: d.division,
    name: d.divisionName,
    amount: d.subtotal,
    percent: d.percentOfTotal,
  }));

  // --- Cost Summary by Element ---
  const costSummaryByElement = dualSummary.byUniformat.map(l1 => ({
    code: l1.code,
    name: l1.name,
    amount: l1.subtotal,
    percent: l1.percentOfTotal,
  }));

  // --- Budget Layer Summary ---
  const directPct = budget.GRAND_TOTAL > 0 ? budget.directCost.subtotal / budget.GRAND_TOTAL : 0;
  const budgetLayerSummary = [
    { layer: '1. Direct Costs (L+M+E)', amount: budget.directCost.subtotal, percent: directPct },
    { layer: '2. General Conditions', amount: budget.generalConditions.subtotal, percent: budget.GRAND_TOTAL > 0 ? budget.generalConditions.subtotal / budget.GRAND_TOTAL : 0 },
    { layer: '3. Design Fees', amount: budget.designFees.subtotal, percent: budget.GRAND_TOTAL > 0 ? budget.designFees.subtotal / budget.GRAND_TOTAL : 0 },
    { layer: '4. Allowances', amount: budget.allowances.subtotal, percent: budget.GRAND_TOTAL > 0 ? budget.allowances.subtotal / budget.GRAND_TOTAL : 0 },
    { layer: '5. Contingency', amount: budget.contingency.totalContingency, percent: budget.GRAND_TOTAL > 0 ? budget.contingency.totalContingency / budget.GRAND_TOTAL : 0 },
    { layer: '6. Escalation', amount: budget.escalation.amount, percent: budget.GRAND_TOTAL > 0 ? budget.escalation.amount / budget.GRAND_TOTAL : 0 },
    { layer: '7. Permits & Fees', amount: budget.permitsFees.subtotal, percent: budget.GRAND_TOTAL > 0 ? budget.permitsFees.subtotal / budget.GRAND_TOTAL : 0 },
    { layer: '8. OH&P + Taxes', amount: budget.overheadProfit.subtotal + budget.taxes.subtotal, percent: budget.GRAND_TOTAL > 0 ? (budget.overheadProfit.subtotal + budget.taxes.subtotal) / budget.GRAND_TOTAL : 0 },
  ];

  // --- Risk Summary ---
  const riskSummary = {
    totalContingency: budget.contingency.totalContingency,
    managementReserve: budget.contingency.managementReserve,
    riskItems: budget.contingency.riskRegister,
  };

  // --- Rate Basis ---
  const rateLines: string[] = [];
  rateLines.push('All unit rates are in Canadian Dollars (CAD), priced at Ontario 2025 ' +
    'base date. Rates represent all-in installed costs including labor burden, ' +
    'small tools, and consumables.');
  rateLines.push('');
  rateLines.push('Rate Sources:');
  rateLines.push('  Primary: CIQS Elemental Cost Analysis — latest edition');
  rateLines.push('  Secondary: RSMeans Building Construction Cost Data — Canadian Edition');
  rateLines.push('  Tertiary: Provincial trade association published rates');
  rateLines.push('  Site-specific: Vendor quotes where available');
  rateLines.push('');
  rateLines.push('Regional Factor: ' + estimate.regionalFactor.toFixed(2) +
    ' (' + estimate.region + ')');
  rateLines.push('Labor burden included in labor rates (statutory benefits, ' +
    'WSIB, vacation, union contributions where applicable).');
  rateLines.push('');
  rateLines.push('Rate Coverage: ' + estimate.lineItemCount + ' line items using ' +
    estimate.csiDivisionsUsed + ' of 34 CSI MasterFormat divisions.');
  const rateBasis = rateLines.join('\n');

  // --- Reconciliation ---
  const reconciliation = {
    csiTotal: dualSummary.csiTotal,
    uniformatTotal: dualSummary.uniformatTotal,
    delta: dualSummary.reconciliationDelta,
    passed: dualSummary.reconciliationPassed,
  };

  // --- Format Complete Document ---
  const formattedDocument = formatBoeDocument({
    reportDate,
    preparedBy: config.preparedBy,
    reviewedBy: config.reviewedBy || 'Pending',
    approvedBy: config.approvedBy || 'Pending',
    confidentiality: config.confidentiality || 'CONFIDENTIAL — FOR AUTHORIZED USE ONLY',
    project: config.project,
    executiveSummary,
    estimateClassification,
    documents: config.documents,
    methodology,
    assumptions: config.assumptions,
    exclusions: config.exclusions,
    qualifications: config.qualifications,
    costSummaryByDivision,
    costSummaryByElement,
    budgetLayerSummary,
    riskSummary,
    rateBasis,
    reconciliation,
    budget,
  });

  return {
    projectName: config.project.projectName,
    reportDate,
    preparedBy: config.preparedBy,
    reviewedBy: config.reviewedBy || 'Pending',
    approvedBy: config.approvedBy || 'Pending',
    confidentiality: config.confidentiality || 'CONFIDENTIAL — FOR AUTHORIZED USE ONLY',
    executiveSummary,
    projectDescription: config.project,
    estimateClassification,
    documentsReferenced: config.documents,
    methodology,
    assumptions: config.assumptions,
    exclusions: config.exclusions,
    qualifications: config.qualifications,
    costSummaryByDivision,
    costSummaryByElement,
    budgetLayerSummary,
    riskSummary,
    rateBasis,
    reconciliation,
    formattedDocument,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Document Formatter ──────────────────────────────────────────────────────

function formatBoeDocument(data: {
  reportDate: string;
  preparedBy: string;
  reviewedBy: string;
  approvedBy: string;
  confidentiality: string;
  project: ProjectDescription;
  executiveSummary: string;
  estimateClassification: { aaceClass: number; className: string; scopeMaturity: number; accuracyRange: string; contingencyApplied: number };
  documents: DocumentReference[];
  methodology: string;
  assumptions: Assumption[];
  exclusions: Exclusion[];
  qualifications: Qualification[];
  costSummaryByDivision: { division: string; name: string; amount: number; percent: number }[];
  costSummaryByElement: { code: string; name: string; amount: number; percent: number }[];
  budgetLayerSummary: { layer: string; amount: number; percent: number }[];
  riskSummary: { totalContingency: number; managementReserve: number; riskItems: RiskItem[] };
  rateBasis: string;
  reconciliation: { csiTotal: number; uniformatTotal: number; delta: number; passed: boolean };
  budget: BudgetStructure;
}): string {
  const f = (n: number) => '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (n: number) => (n * 100).toFixed(1) + '%';
  const sep = '═'.repeat(76);
  const thin = '─'.repeat(76);
  const out: string[] = [];

  // Cover page
  out.push(sep);
  out.push('');
  out.push('  BASIS OF ESTIMATE');
  out.push('  Per AACE RP 34R-05');
  out.push('');
  out.push('  ' + data.project.projectName);
  out.push('  ' + data.project.location);
  out.push('');
  out.push('  Report Date: ' + data.reportDate);
  out.push('  Prepared by: ' + data.preparedBy);
  out.push('  Reviewed by: ' + data.reviewedBy);
  out.push('  Approved by: ' + data.approvedBy);
  out.push('');
  out.push('  ' + data.confidentiality);
  out.push('');
  out.push(sep);

  // 1. Executive Summary
  out.push('');
  out.push('  1. EXECUTIVE SUMMARY');
  out.push(thin);
  out.push('');
  out.push(data.executiveSummary);
  out.push('');

  // 2. Project Description
  out.push('  2. PROJECT DESCRIPTION');
  out.push(thin);
  out.push('');
  out.push('  Project:          ' + data.project.projectName);
  out.push('  Location:         ' + data.project.location);
  if (data.project.client) out.push('  Client:           ' + data.project.client);
  if (data.project.architect) out.push('  Architect:        ' + data.project.architect);
  if (data.project.structuralEngineer) out.push('  Structural:       ' + data.project.structuralEngineer);
  if (data.project.mechanicalEngineer) out.push('  Mechanical:       ' + data.project.mechanicalEngineer);
  if (data.project.electricalEngineer) out.push('  Electrical:       ' + data.project.electricalEngineer);
  out.push('  Building Type:    ' + data.project.buildingType);
  if (data.project.grossFloorArea) out.push('  Gross Floor Area: ' + data.project.grossFloorArea.toLocaleString() + ' m²');
  if (data.project.numberOfStoreys) out.push('  Storeys:          ' + data.project.numberOfStoreys);
  if (data.project.constructionType) out.push('  Construction:     ' + data.project.constructionType);
  if (data.project.buildingCodeEdition) out.push('  Building Code:    ' + data.project.buildingCodeEdition);
  out.push('');

  // 3. Estimate Classification
  out.push('  3. ESTIMATE CLASSIFICATION & ACCURACY');
  out.push(thin);
  out.push('');
  out.push('  AACE Class:       ' + data.estimateClassification.className);
  out.push('  Scope Maturity:   ' + data.estimateClassification.scopeMaturity.toFixed(1) + '%');
  out.push('  Accuracy Range:   ' + data.estimateClassification.accuracyRange);
  out.push('  Contingency:      ' + pct(data.estimateClassification.contingencyApplied) + ' of base');
  out.push('');
  out.push('  Per AACE RP 18R-97, the estimate class is automatically determined');
  out.push('  from the percentage of line items with verified (as opposed to');
  out.push('  estimated) quantities, reflecting the completeness of design');
  out.push('  documentation available at time of estimate preparation.');
  out.push('');

  // 4. Documents Referenced
  out.push('  4. DOCUMENTS REFERENCED');
  out.push(thin);
  out.push('');
  if (data.documents.length === 0) {
    out.push('  No documents formally registered. Document log to be completed');
    out.push('  prior to estimate submission.');
  } else {
    for (const doc of data.documents) {
      out.push('  [' + doc.id + '] ' + doc.title);
      out.push('    Discipline: ' + doc.discipline + ' | Rev: ' + (doc.revisionNumber || 'N/A') + ' | Date: ' + doc.revisionDate);
      if (doc.drawingNumbers && doc.drawingNumbers.length > 0) {
        out.push('    Drawings: ' + doc.drawingNumbers.join(', '));
      }
      if (doc.notes) out.push('    Notes: ' + doc.notes);
      out.push('');
    }
  }
  out.push('');

  // 5. Methodology
  out.push('  5. METHODOLOGY');
  out.push(thin);
  out.push('');
  out.push(data.methodology);
  out.push('');

  // 6. Assumptions, Qualifications & Exclusions
  out.push('  6. ASSUMPTIONS, QUALIFICATIONS & EXCLUSIONS');
  out.push(thin);
  out.push('');
  if (data.assumptions.length > 0) {
    out.push('  6A. ASSUMPTIONS');
    out.push('');
    for (const a of data.assumptions) {
      out.push('  [' + a.id + '] (' + a.impact.toUpperCase() + ') ' + a.description);
      if (a.source) out.push('    Source: ' + a.source);
    }
    out.push('');
  }

  if (data.qualifications.length > 0) {
    out.push('  6B. QUALIFICATIONS');
    out.push('');
    for (const q of data.qualifications) {
      out.push('  [' + q.id + '] ' + q.description);
      if (q.costImpact) out.push('    Impact: ' + q.costImpact);
    }
    out.push('');
  }

  if (data.exclusions.length > 0) {
    out.push('  6C. EXCLUSIONS');
    out.push('');
    for (const e of data.exclusions) {
      out.push('  [' + e.id + '] ' + e.description);
      out.push('    Reason: ' + e.reason);
      if (e.suggestedAllowance) out.push('    Suggested allowance: ' + f(e.suggestedAllowance));
    }
    out.push('');
  }

  if (data.assumptions.length === 0 && data.qualifications.length === 0 && data.exclusions.length === 0) {
    out.push('  No assumptions, qualifications, or exclusions formally recorded.');
    out.push('  This section to be completed prior to estimate submission.');
    out.push('');
  }

  // 7. Cost Summary by CSI Division
  out.push('  7. COST SUMMARY — BY CSI MASTERFORMAT DIVISION');
  out.push(thin);
  out.push('');
  for (const d of data.costSummaryByDivision) {
    out.push('  Div ' + d.division.padEnd(6) + d.name.padEnd(38) + f(d.amount).padStart(16) + ('  ' + pct(d.percent)).padStart(8));
  }
  out.push('  ' + '─'.repeat(68));
  const csiT = data.costSummaryByDivision.reduce((s, d) => s + d.amount, 0);
  out.push('  DIRECT COST TOTAL:'.padEnd(44) + f(csiT).padStart(16));
  out.push('');

  // 8. Cost Summary by UNIFORMAT Element
  out.push('  8. COST SUMMARY — BY UNIFORMAT II ELEMENT');
  out.push(thin);
  out.push('');
  for (const e of data.costSummaryByElement) {
    out.push('  ' + e.code + ': ' + e.name.padEnd(42) + f(e.amount).padStart(16) + ('  ' + pct(e.percent)).padStart(8));
  }
  out.push('  ' + '─'.repeat(68));
  const ufT = data.costSummaryByElement.reduce((s, e) => s + e.amount, 0);
  out.push('  ELEMENT TOTAL:'.padEnd(44) + f(ufT).padStart(16));
  out.push('');

  // 9. Budget Layer Summary
  out.push('  9. BUDGET LAYER SUMMARY');
  out.push(thin);
  out.push('');
  for (const l of data.budgetLayerSummary) {
    out.push('  ' + l.layer.padEnd(36) + f(l.amount).padStart(20) + ('  ' + pct(l.percent)).padStart(8));
  }
  out.push('  ' + '─'.repeat(68));
  out.push('  GRAND TOTAL:'.padEnd(36) + f(data.budget.GRAND_TOTAL).padStart(20));
  out.push('');

  // 10. Risk & Contingency
  out.push('  10. RISK & CONTINGENCY');
  out.push(thin);
  out.push('');
  out.push('  Design Contingency:       ' + f(data.budget.contingency.designContingency));
  out.push('  Construction Contingency: ' + f(data.budget.contingency.constructionContingency));
  out.push('  Management Reserve:       ' + f(data.budget.contingency.managementReserve));
  out.push('  Total Contingency:        ' + f(data.budget.contingency.totalContingency));
  out.push('  Contingency as % of base: ' + pct(data.budget.contingency.percentOfBase));
  out.push('');
  if (data.riskSummary.riskItems.length > 0) {
    out.push('  Risk Register:');
    for (const r of data.riskSummary.riskItems) {
      out.push('  [' + r.id + '] ' + r.description + ' (P=' + (r.probability * 100).toFixed(0) +
        '%, EV=' + f(r.expectedValue) + ')');
    }
    out.push('');
  }

  // 11. Rate Basis (ADV-3: full labor rate declaration)
  out.push('  11. RATE BASIS & SOURCES');
  out.push(thin);
  out.push('');
  out.push(data.rateBasis);
  out.push('');
  out.push('  LABOR RATE BASIS DECLARATION (ADV-3 — CIQS §3.2 / AACE 18R-97 §4):');
  out.push('  ─────────────────────────────────────────────────────────────────');
  out.push('  All labor rates in this estimate are FULLY-LOADED ALL-IN rates for');
  out.push('  Ontario ICI construction (Q1 2026 base date). Each rate includes:');
  out.push('');
  out.push('    • Base wage per MLITSD prevailing wage schedule');
  out.push('    • CPP employer contribution:      5.95% on insurable earnings');
  out.push('    • EI employer premium:            2.62% of insurable earnings');
  out.push('    • WSIB: trade-rated (2.0–4.0%)   by classification');
  out.push('    • Employer Health Tax (EHT):      1.95% on Ontario payroll');
  out.push('    • Vacation pay:                   4.0% on gross wages');
  out.push('    • Union fringe (H&W, pension,     training fund) per CA');
  out.push('    • Supervision allowance:          10–15% blended into crew');
  out.push('');
  out.push('  MEP labor (Div 21–28): UA Local 46/401/524/787 and IBEW 353/586/636');
  out.push('  collective agreements, current term.');
  out.push('');
  out.push('  Rates are NOT bare labor rates and must NOT be compared directly');
  out.push('  to published bare-trade wage schedules without removing burden.');
  out.push('');

  // 12. Reconciliation
  out.push('  12. RECONCILIATION & QA');
  out.push(thin);
  out.push('');
  out.push('  CSI Division Total:      ' + f(data.reconciliation.csiTotal));
  out.push('  UNIFORMAT Element Total: ' + f(data.reconciliation.uniformatTotal));
  out.push('  Reconciliation Delta:    ' + f(data.reconciliation.delta));
  out.push('  Status:                  ' + (data.reconciliation.passed ? 'PASSED' : 'FAILED'));
  out.push('');
  out.push('  Per CIQS best practice, the sum of all CSI division costs must');
  out.push('  equal the sum of all UNIFORMAT element costs. Any discrepancy');
  out.push('  indicates a mapping error requiring investigation.');
  out.push('');

  // Footer
  out.push(sep);
  out.push('  END OF BASIS OF ESTIMATE');
  out.push('  ' + data.project.projectName);
  out.push('  Generated: ' + new Date().toISOString());
  out.push(sep);

  return out.join('\n');
}


// ═══════════════════════════════════════════════════════════════════════════════
// LEGACY COMPATIBILITY LAYER — v14.x API
// ═══════════════════════════════════════════════════════════════════════════════
//
// Consumers: qs-level5-routes.ts (generateBoE/boeToText/storeBoE/getBoE/deleteBoE)
//            qs-level5-supplement.ts (getBoE)
//
// These exports maintain the original BoE API used throughout QS Level 5.
// They coexist with the new API above (different type names: BoEDocument vs
// BasisOfEstimate, BoEConfig vs BoeConfig) so both callers work unchanged.
//
// Do NOT remove — active runtime dependency.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── BOE TYPES ──────────────────────────────────────────────────────────────

export interface BoEDocument {
  // Header
  projectName: string;
  projectNumber?: string;
  preparedBy: string;
  preparedFor: string;
  dateIssued: string;
  estimateClass: string;        // AACE Class 1-5
  revision: string;             // "Rev 0", "Rev 1", etc.
  status: 'draft' | 'issued' | 'final';

  // Sections
  executiveSummary: BoEExecutiveSummary;
  projectOverview: BoEProjectOverview;
  documentsUsed: BoEDocumentReference[];
  methodology: BoEMethodology;
  assumptions: BoEAssumption[];
  qualifications: string[];
  exclusions: BoEExclusion[];
  estimateSummaryByDivision: CSIDivisionSummaryRow[];
  estimateSummaryByElement: UniformatSummaryRow[];
  budgetStructure?: BoEBudgetSummary;
  riskAndContingency?: BoERiskSummary;
  benchmarkComparison?: BoEBenchmarkSummary;
  approvalSignoff: BoEApproval[];

  // Meta
  generatedAt: string;
  methodology_standard: 'AACE RP 34R-05';
}

export interface BoEExecutiveSummary {
  purpose: string;
  estimateClass: string;
  scopeMaturityPercent: number;
  headlineTotal: number;
  currency: 'CAD';
  grossFloorArea?: number;
  costPerM2?: number;
  buildingType?: string;
  keyHighlights: string[];
}

export interface BoEProjectOverview {
  projectName: string;
  location: string;
  owner: string;
  buildingType: string;
  grossFloorArea: number;
  numberOfStoreys: number;
  constructionType: string;
  projectDuration: string;
  scopeDescription: string;
}

export interface BoEDocumentReference {
  documentId: string;
  title: string;
  discipline: string;
  revision: string;
  date: string;
  status: string;
}

export interface BoEMethodology {
  measurementStandard: string;   // "CIQS Standard Method of Measurement"
  pricingBasis: string;          // "CSI MasterFormat 2018, 212 rate entries"
  laborRateSource: string;       // "Ontario trade rates, 12 union classifications"
  materialRateSource: string;    // "RSMeans Canadian Edition 2025 baseline"
  equipmentRateSource: string;   // "RSMeans / rental survey"
  regionalAdjustment: string;    // "Ontario - Kawartha Lakes composite factor"
  escalationMethod?: string;     // "Compound escalation from price base date"
  wasteFactorMethod: string;     // "Material-specific factors per CIQS"
  contingencyMethod?: string;    // "AACE class-based + risk register"
}

export interface BoEAssumption {
  id: string;
  category: 'scope' | 'design' | 'pricing' | 'schedule' | 'site' | 'regulatory';
  description: string;
  impact: 'low' | 'medium' | 'high';
  source: string;                // where assumption originated
  linkedCSI?: string[];          // affected divisions
}

export interface BoEExclusion {
  id: string;
  description: string;
  reason: string;
  estimatedValue?: number;       // potential cost if included
  linkedCSI?: string[];
}

export interface BoEBudgetSummary {
  directCost: number;
  generalConditions: number;
  designFees: number;
  allowances: number;
  contingency: number;
  escalation: number;
  permitsFees: number;
  overheadProfit: number;
  taxes: number;
  grandTotal: number;
}

export interface BoERiskSummary {
  estimateClass: string;
  contingencyPercent: number;
  contingencyAmount: number;
  riskItemCount: number;
  monteCarloP50?: number;
  monteCarloP80?: number;
  monteCarloP90?: number;
  recommendedContingency?: number;
}

export interface BoEBenchmarkSummary {
  costPerM2: number;
  benchmarkLow: number;
  benchmarkMid: number;
  benchmarkHigh: number;
  status: string;
  completenessScore: number;
  flags: string[];
}

export interface BoEApproval {
  role: string;                  // "Estimator", "Reviewer", "Approver"
  name: string;
  date?: string;
  signature?: string;            // placeholder for future digital signature
  status: 'pending' | 'signed';
}


// ─── BOE CONFIG (input to generator) ────────────────────────────────────────

export interface BoEConfig {
  projectName: string;
  projectNumber?: string;
  preparedBy: string;
  preparedFor: string;
  revision: string;
  location: string;
  owner: string;
  buildingType: string;
  grossFloorArea: number;
  numberOfStoreys: number;
  constructionType: string;
  projectDuration: string;
  scopeDescription: string;
  // Optional enrichment data
  documentReferences?: BoEDocumentReference[];
  additionalAssumptions?: BoEAssumption[];
  additionalExclusions?: BoEExclusion[];
  approvers?: Array<{ role: string; name: string }>;
}


// ─── GENERATE BOE ───────────────────────────────────────────────────────────

export function generateBoE(
  config: BoEConfig,
  estimate: EstimateSummary,
  divisionSummary: CSIDivisionSummaryRow[],
  elementSummary: UniformatSummaryRow[],
  options?: {
    budgetStructure?: BudgetStructure;
    codeAdderResult?: CodeAdderResult;
    monteCarloResult?: MonteCarloResult;
    benchmarkComparison?: BenchmarkComparison;
    completenessCheck?: CompletenessCheck;
  },
): BoEDocument {
  const now = new Date().toISOString();

  // Derive AACE class from data quality
  const totalItems = estimate.floors.reduce((s, f) => s + f.lineItems.length, 0);
  const verifiedItems = estimate.floors.reduce((s, f) =>
    s + f.lineItems.filter(li => li.verificationStatus === 'verified').length, 0);
  const scopeMaturity = totalItems > 0 ? Math.round((verifiedItems / totalItems) * 100) : 0;
  const estimateClass = scopeMaturity >= 80 ? 'Class 1'
    : scopeMaturity >= 60 ? 'Class 2'
    : scopeMaturity >= 40 ? 'Class 3'
    : scopeMaturity >= 20 ? 'Class 4' : 'Class 5';

  // Cost/m²
  const costPerM2 = config.grossFloorArea > 0
    ? Math.round((estimate.grandTotal / config.grossFloorArea) * 100) / 100
    : undefined;

  // Auto-generate assumptions from estimate data
  const assumptions: BoEAssumption[] = [
    {
      id: 'A-001', category: 'pricing',
      description: `All rates based on Ontario 2025 baseline with regional factor ${estimate.regionalFactor.toFixed(3)}`,
      impact: 'medium', source: 'Estimate engine regional configuration',
    },
    {
      id: 'A-002', category: 'scope',
      description: `${estimate.incompleteElements} elements have incomplete dimensions — quantities estimated from available data`,
      impact: estimate.incompleteElements > 5 ? 'high' : 'low',
      source: 'Estimate engine data quality flags',
    },
    {
      id: 'A-003', category: 'pricing',
      description: 'Material waste factors applied per CIQS standard practice (3-15% by material type)',
      impact: 'low', source: 'Estimate engine waste factor configuration',
    },
    {
      id: 'A-004', category: 'design',
      description: `Estimate based on ${estimate.csiDivisionsUsed} CSI divisions with ${estimate.lineItemCount} line items`,
      impact: 'low', source: 'Estimate engine output statistics',
    },
    ...(config.additionalAssumptions ?? []),
  ];

  // Auto-generate exclusions from skipped elements
  const exclusions: BoEExclusion[] = [
    ...estimate.skippedElements.slice(0, 20).map((desc, i) => ({
      id: `X-${String(i + 1).padStart(3, '0')}`,
      description: desc,
      reason: 'Insufficient dimensional data for quantity calculation',
    })),
    ...(config.additionalExclusions ?? []),
  ];

  // Budget summary from BudgetStructure if provided
  const budgetSummary: BoEBudgetSummary | undefined = options?.budgetStructure ? {
    directCost: options.budgetStructure.directCost.subtotal,
    generalConditions: options.budgetStructure.generalConditions.subtotal,
    designFees: options.budgetStructure.designFees.subtotal,
    allowances: options.budgetStructure.allowances.subtotal,
    contingency: options.budgetStructure.contingency.totalContingency,
    escalation: options.budgetStructure.escalation.amount,
    permitsFees: options.budgetStructure.permitsFees.subtotal,
    overheadProfit: options.budgetStructure.overheadProfit.subtotal,
    taxes: options.budgetStructure.taxes.subtotal,
    grandTotal: options.budgetStructure.GRAND_TOTAL,
  } : undefined;

  // Risk summary
  const riskSummary: BoERiskSummary | undefined = options?.monteCarloResult ? {
    estimateClass,
    contingencyPercent: options.monteCarloResult.recommendedContingencyPercent,
    contingencyAmount: options.monteCarloResult.recommendedContingency,
    riskItemCount: 0,
    monteCarloP50: options.monteCarloResult.confidenceLevels.find(c => c.percentile === 50)?.value,
    monteCarloP80: options.monteCarloResult.confidenceLevels.find(c => c.percentile === 80)?.value,
    monteCarloP90: options.monteCarloResult.confidenceLevels.find(c => c.percentile === 90)?.value,
    recommendedContingency: options.monteCarloResult.recommendedContingency,
  } : undefined;

  // Benchmark summary
  const benchSummary: BoEBenchmarkSummary | undefined = options?.benchmarkComparison ? {
    costPerM2: options.benchmarkComparison.costPerM2,
    benchmarkLow: options.benchmarkComparison.benchmarkRange.lowPerM2,
    benchmarkMid: options.benchmarkComparison.benchmarkRange.midPerM2,
    benchmarkHigh: options.benchmarkComparison.benchmarkRange.highPerM2,
    status: options.benchmarkComparison.status,
    completenessScore: options.completenessCheck?.completenessScore ?? 0,
    flags: [
      ...(options.benchmarkComparison.flags ?? []),
      ...(options.completenessCheck?.flags ?? []),
    ],
  } : undefined;

  // Key highlights
  const highlights: string[] = [
    `Total estimate: $${estimate.grandTotal.toLocaleString('en-CA', { minimumFractionDigits: 2 })} CAD`,
    `${estimate.csiDivisionsUsed} CSI divisions, ${estimate.lineItemCount} line items across ${estimate.floors.length} floors`,
    `AACE ${estimateClass} (${scopeMaturity}% scope maturity)`,
    `Regional factor: ${estimate.regionalFactor.toFixed(3)} (${estimate.region})`,
  ];
  if (costPerM2) highlights.push(`Cost per m²: $${costPerM2.toLocaleString('en-CA', { minimumFractionDigits: 2 })}/m² GFA`);
  if (estimate.incompleteElements > 0) highlights.push(`${estimate.incompleteElements} elements flagged as incomplete — review required`);

  // Approvers
  const approvals: BoEApproval[] = (config.approvers ?? [
    { role: 'Estimator', name: config.preparedBy },
    { role: 'Reviewer', name: 'TBD' },
    { role: 'Approver', name: config.preparedFor },
  ]).map(a => ({ ...a, status: 'pending' as const }));

  return {
    projectName: config.projectName,
    projectNumber: config.projectNumber,
    preparedBy: config.preparedBy,
    preparedFor: config.preparedFor,
    dateIssued: now.split('T')[0],
    estimateClass,
    revision: config.revision,
    status: 'draft',

    executiveSummary: {
      purpose: `This Basis of Estimate documents the methodology, assumptions, qualifications, and exclusions for the ${config.projectName} cost estimate prepared in accordance with AACE RP 34R-05.`,
      estimateClass,
      scopeMaturityPercent: scopeMaturity,
      headlineTotal: estimate.grandTotal,
      currency: 'CAD',
      grossFloorArea: config.grossFloorArea > 0 ? config.grossFloorArea : undefined,
      costPerM2,
      buildingType: config.buildingType,
      keyHighlights: highlights,
    },

    projectOverview: {
      projectName: config.projectName,
      location: config.location,
      owner: config.owner,
      buildingType: config.buildingType,
      grossFloorArea: config.grossFloorArea,
      numberOfStoreys: config.numberOfStoreys,
      constructionType: config.constructionType,
      projectDuration: config.projectDuration,
      scopeDescription: config.scopeDescription,
    },

    documentsUsed: config.documentReferences ?? [],

    methodology: {
      measurementStandard: 'CIQS Standard Method of Measurement',
      pricingBasis: `CSI MasterFormat 2018, ${estimate.lineItemCount} priced line items across ${estimate.csiDivisionsUsed} divisions`,
      laborRateSource: 'Ontario trade rates with statutory burdens (CPP 5.95%, EI 2.28%, WSIB by trade), 12 union classifications with full fringe benefits',
      materialRateSource: 'RSMeans Canadian Edition 2025 baseline, adjusted by regional composite factor',
      equipmentRateSource: 'RSMeans equipment rental database, productivity-adjusted',
      regionalAdjustment: `${estimate.region} composite factor ${estimate.regionalFactor.toFixed(3)}`,
      escalationMethod: options?.budgetStructure ? 'Compound escalation from price base date to construction midpoint' : undefined,
      wasteFactorMethod: 'Material-specific waste factors per CIQS standard practice: Concrete 5%, Rebar 3%, Drywall 10%, Tile 15%, Flooring 10%, Paint 5%, Insulation 8%, Roofing 7%, Lumber 10%, Masonry 5%',
      contingencyMethod: options?.monteCarloResult
        ? `AACE class-based contingency refined by Monte Carlo simulation (${options.monteCarloResult.iterations} iterations, triangular distribution)`
        : 'AACE class-based percentage applied to direct cost subtotal',
    },

    assumptions,
    qualifications: [
      'This estimate is based on documents and information available at the date of preparation',
      'Quantities are derived from BIM model elements where available; estimated from partial data where dimensions are incomplete',
      'Pricing reflects Ontario 2025 market conditions',
      'No allowance for force majeure, pandemic impacts, or supply chain disruptions beyond standard escalation',
      'Subcontractor pricing based on rate table estimates — firm quotes may differ',
    ],
    exclusions,

    estimateSummaryByDivision: divisionSummary,
    estimateSummaryByElement: elementSummary,
    budgetStructure: budgetSummary,
    riskAndContingency: riskSummary,
    benchmarkComparison: benchSummary,
    approvalSignoff: approvals,

    generatedAt: now,
    methodology_standard: 'AACE RP 34R-05',
  };
}


// ─── BOE TEXT EXPORT (for document generation) ──────────────────────────────

export function boeToText(boe: BoEDocument): string {
  const lines: string[] = [];
  const hr = '═'.repeat(80);
  const sr = '─'.repeat(80);

  lines.push(hr);
  lines.push(`  BASIS OF ESTIMATE — ${boe.projectName}`);
  lines.push(`  ${boe.estimateClass} | ${boe.revision} | ${boe.dateIssued}`);
  lines.push(hr);
  lines.push('');

  // Executive Summary
  lines.push('1. EXECUTIVE SUMMARY');
  lines.push(sr);
  lines.push(boe.executiveSummary.purpose);
  lines.push('');
  for (const h of boe.executiveSummary.keyHighlights) {
    lines.push(`  • ${h}`);
  }
  lines.push('');

  // Project Overview
  lines.push('2. PROJECT OVERVIEW');
  lines.push(sr);
  lines.push(`  Project: ${boe.projectOverview.projectName}`);
  lines.push(`  Location: ${boe.projectOverview.location}`);
  lines.push(`  Owner: ${boe.projectOverview.owner}`);
  lines.push(`  Building Type: ${boe.projectOverview.buildingType}`);
  lines.push(`  GFA: ${boe.projectOverview.grossFloorArea} m²`);
  lines.push(`  Storeys: ${boe.projectOverview.numberOfStoreys}`);
  lines.push(`  Construction: ${boe.projectOverview.constructionType}`);
  lines.push(`  Duration: ${boe.projectOverview.projectDuration}`);
  lines.push('');

  // Documents
  if (boe.documentsUsed.length > 0) {
    lines.push('3. DOCUMENTS USED');
    lines.push(sr);
    for (const doc of boe.documentsUsed) {
      lines.push(`  ${doc.documentId} | ${doc.title} | Rev ${doc.revision} | ${doc.date}`);
    }
    lines.push('');
  }

  // Methodology
  lines.push('4. METHODOLOGY');
  lines.push(sr);
  lines.push(`  Measurement: ${boe.methodology.measurementStandard}`);
  lines.push(`  Pricing: ${boe.methodology.pricingBasis}`);
  lines.push(`  Labor Rates: ${boe.methodology.laborRateSource}`);
  lines.push(`  Material Rates: ${boe.methodology.materialRateSource}`);
  lines.push(`  Regional: ${boe.methodology.regionalAdjustment}`);
  lines.push(`  Waste: ${boe.methodology.wasteFactorMethod}`);
  if (boe.methodology.contingencyMethod) lines.push(`  Contingency: ${boe.methodology.contingencyMethod}`);
  lines.push('');

  // Assumptions
  lines.push('5. ASSUMPTIONS');
  lines.push(sr);
  for (const a of boe.assumptions) {
    lines.push(`  [${a.id}] (${a.category}/${a.impact}) ${a.description}`);
  }
  lines.push('');

  // Qualifications
  lines.push('6. QUALIFICATIONS');
  lines.push(sr);
  for (const q of boe.qualifications) {
    lines.push(`  • ${q}`);
  }
  lines.push('');

  // Exclusions
  if (boe.exclusions.length > 0) {
    lines.push('7. EXCLUSIONS');
    lines.push(sr);
    for (const x of boe.exclusions) {
      lines.push(`  [${x.id}] ${x.description} — ${x.reason}`);
    }
    lines.push('');
  }

  // Division Summary
  lines.push('8. ESTIMATE SUMMARY BY CSI DIVISION');
  lines.push(sr);
  lines.push(`  ${'Div'.padEnd(6)}${'Division Name'.padEnd(35)}${'Material'.padStart(14)}${'Labor'.padStart(14)}${'Equipment'.padStart(14)}${'Total'.padStart(16)}`);
  for (const row of boe.estimateSummaryByDivision) {
    lines.push(`  ${row.csiDivision.padEnd(6)}${row.csiDivisionName.padEnd(35)}${('$' + row.materialTotal.toLocaleString()).padStart(14)}${('$' + row.laborTotal.toLocaleString()).padStart(14)}${('$' + row.equipmentTotal.toLocaleString()).padStart(14)}${('$' + row.subtotal.toLocaleString()).padStart(16)}`);
  }
  lines.push('');

  // Elemental Summary
  lines.push('9. ESTIMATE SUMMARY BY UNIFORMAT ELEMENT');
  lines.push(sr);
  lines.push(`  ${'Code'.padEnd(8)}${'Element'.padEnd(30)}${'Total'.padStart(16)}${'%'.padStart(8)}`);
  for (const row of boe.estimateSummaryByElement) {
    lines.push(`  ${row.level3Code.padEnd(8)}${row.level3Name.padEnd(30)}${('$' + row.subtotal.toLocaleString()).padStart(16)}${(row.percentOfTotal + '%').padStart(8)}`);
  }
  lines.push('');

  // Budget Structure
  if (boe.budgetStructure) {
    lines.push('10. BUDGET STRUCTURE');
    lines.push(sr);
    const bs = boe.budgetStructure;
    lines.push(`  1. Direct Cost:         $${bs.directCost.toLocaleString()}`);
    lines.push(`  2. General Conditions:  $${bs.generalConditions.toLocaleString()}`);
    lines.push(`  3. Design Fees:         $${bs.designFees.toLocaleString()}`);
    lines.push(`  4. Allowances:          $${bs.allowances.toLocaleString()}`);
    lines.push(`  5. Contingency:         $${bs.contingency.toLocaleString()}`);
    lines.push(`  6. Escalation:          $${bs.escalation.toLocaleString()}`);
    lines.push(`  7. Permits & Fees:      $${bs.permitsFees.toLocaleString()}`);
    lines.push(`  8. OH&P + Tax:          $${(bs.overheadProfit + bs.taxes).toLocaleString()}`);
    lines.push(`  ${'─'.repeat(40)}`);
    lines.push(`  GRAND TOTAL:            $${bs.grandTotal.toLocaleString()}`);
    lines.push('');
  }

  // Approval
  lines.push('APPROVAL SIGN-OFF');
  lines.push(sr);
  for (const a of boe.approvalSignoff) {
    lines.push(`  ${a.role.padEnd(15)} ${a.name.padEnd(25)} ${(a.date ?? '________').padEnd(12)} ${a.status}`);
  }
  lines.push('');
  lines.push(hr);
  lines.push(`  Generated: ${boe.generatedAt} | Standard: ${boe.methodology_standard}`);
  lines.push(hr);

  return lines.join('\n');
}


// ─── IN-MEMORY STORAGE ──────────────────────────────────────────────────────

const boeStore = new Map<string, BoEDocument>();

export function storeBoE(projectId: string, boe: BoEDocument): BoEDocument {
  boeStore.set(projectId, boe);
  return boe;
}
export function getBoE(projectId: string): BoEDocument | undefined {
  return boeStore.get(projectId);
}
export function deleteBoE(projectId: string): boolean {
  return boeStore.delete(projectId);
}