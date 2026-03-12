// server/estimator/budget-structure.ts
// =============================================================================
// BUDGET LAYER STRUCTURE — 8-TIER PROFESSIONAL ESTIMATE
// =============================================================================
//
// Implements QS Level 5 Phase 6: Budget Structure, Markups & Commercials
// Per CIQS methodology and Ricardo's QS Level 5 estimation process.
//
// The estimate-engine.ts produces a "naked" direct cost (Layer 1).
// This module wraps it with 7 additional professional layers:
//
//   Layer 1: Direct Costs (L+M+E) <- from estimate-engine.ts
//   Layer 2: General Conditions / Preliminaries (8-15% of direct)
//   Layer 3: Design / Consultant Fees (8-12% of construction)
//   Layer 4: Defined Allowances (scoped, not provisional sums)
//   Layer 5: Contingency (design + construction, AACE class-based)
//   Layer 6: Escalation / Inflation (date-driven compound factor)
//   Layer 7: Permits, Fees & Inspections
//   Layer 8: Overhead & Profit + Taxes
//
// Standards: AACE RP 18R-97, CIQS, CSI MasterFormat 2018
// =============================================================================

import type { EstimateSummary } from './estimate-engine';

// --- Interfaces --------------------------------------------------------------

export interface AllowanceItem {
  id: string;
  description: string;
  scope: string;           // defined scope to avoid disputes (per CIQS)
  amount: number;
  basis: string;           // e.g., "per drawing A-201 note 7", "client directive"
  linkedCSI: string[];     // CSI divisions this allowance affects
}

export interface RiskItem {
  id: string;
  description: string;
  category: 'scope' | 'design' | 'market' | 'schedule' | 'regulatory';
  probability: number;     // 0-1
  impactLow: number;       // $ value
  impactHigh: number;
  expectedValue: number;   // probability x (low+high)/2
  mitigationNotes: string;
  affectedCSI: string[];
}

export interface EscalationConfig {
  priceBaseDate: string;         // ISO date - when rates were priced
  estimateBaseDate: string;      // ISO date - estimate submission date
  constructionMidPoint: string;  // ISO date - mid-point of construction
  annualEscalationRate: number;  // default 3% for Canadian construction
  materialEscalation: number;    // may differ from labor (e.g., 4% materials)
  laborEscalation: number;       // e.g., 2.5% labor
}

/** AACE Estimate Classification per RP 18R-97 */
export interface AACEClassification {
  estimateClass: 1 | 2 | 3 | 4 | 5;
  className: string;
  scopeMaturity: number;         // 0-100%
  expectedAccuracyLow: number;   // e.g., -5%
  expectedAccuracyHigh: number;  // e.g., +10%
  contingencyRange: { low: number; high: number; applied: number };
}

export interface BudgetStructure {
  projectName: string;
  region: string;
  currency: 'CAD';
  methodology: 'CIQS';
  generatedAt: string;

  // AACE Classification
  aaceClass: AACEClassification;

  // Layer 1: Direct Costs (from estimate-engine.ts)
  directCost: {
    material: number;
    labor: number;
    equipment: number;
    waste: number;
    subtotal: number;
    lineItemCount: number;
    csiDivisionsUsed: number;
  };

  // Layer 2: General Conditions / Preliminaries
  generalConditions: {
    siteManagement: number;
    temporaryWorks: number;
    HSE: number;
    QA_QC: number;
    logistics: number;
    subtotal: number;
    percentOfDirect: number;
  };

  // Layer 3: Design / Consultant Fees
  designFees: {
    architectural: number;
    structural: number;
    MEP: number;
    other: number;
    subtotal: number;
    percentOfConstruction: number;
  };

  // Layer 4: Defined Allowances
  allowances: {
    items: AllowanceItem[];
    subtotal: number;
  };

  // Layer 5: Contingency
  contingency: {
    designContingency: number;
    constructionContingency: number;
    managementReserve: number;
    totalContingency: number;
    percentOfBase: number;
    riskRegister: RiskItem[];
  };

  // Layer 6: Escalation
  escalation: {
    amount: number;
    config: EscalationConfig;
    compoundFactor: number;
    percentOfBase: number;
  };

  // Layer 7: Permits, Fees & Inspections
  permitsFees: {
    buildingPermit: number;
    developmentCharges: number;
    planReview: number;
    inspections: number;
    subtotal: number;
  };

  // Layer 8: Overhead, Profit & Taxes
  overheadProfit: {
    homeOfficeOverhead: number;
    profit: number;
    bondInsurance: number;
    subtotal: number;
    percentOfConstruction: number;
  };

  taxes: {
    HST: number;
    rate: number;
    subtotal: number;
  };

  // Grand totals
  constructionCost: number;      // Layers 1+2
  totalProjectCost: number;      // Layers 1-7 (before OH&P)
  totalWithOHP: number;          // Layers 1-8 (before tax)
  GRAND_TOTAL: number;           // Everything including tax
}

// --- Budget Configuration (Project-Level Inputs) -----------------------------

export interface BudgetConfig {
  projectName?: string;
  region?: string;
  generalConditionsPercent?: number;  // default 12% of direct cost
  generalConditionsOverride?: Partial<BudgetStructure['generalConditions']>;
  designFeesPercent?: number;         // default 10% of construction cost
  designFeesOverride?: Partial<BudgetStructure['designFees']>;
  allowances?: AllowanceItem[];
  contingencyOverride?: {
    designPercent?: number;
    constructionPercent?: number;
    managementReservePercent?: number;
  };
  riskRegister?: RiskItem[];
  escalation?: EscalationConfig;
  permitsFees?: Partial<BudgetStructure['permitsFees']>;
  permitPercent?: number;            // default 1.25% of construction value
  overheadPercent?: number;          // default 6%
  profitPercent?: number;            // default 8%
  bondInsurancePercent?: number;     // default 2.5%
  taxRate?: number;                  // default 0.13 (Ontario HST 13%)
  projectDurationMonths?: number;    // for duration-based general conditions
}

// --- AACE Classification System (RP 18R-97 / 17R-97) ------------------------

const AACE_CLASSES: Record<number, {
  className: string;
  scopeRange: [number, number];
  accuracyLow: number;
  accuracyHigh: number;
  contingencyLow: number;
  contingencyHigh: number;
}> = {
  5: { className: 'Class 5 - Concept Screening',   scopeRange: [0, 2],    accuracyLow: -30, accuracyHigh: 50, contingencyLow: 0.20, contingencyHigh: 0.30 },
  4: { className: 'Class 4 - Feasibility Study',    scopeRange: [1, 15],   accuracyLow: -20, accuracyHigh: 30, contingencyLow: 0.15, contingencyHigh: 0.25 },
  3: { className: 'Class 3 - Budget Authorization', scopeRange: [10, 40],  accuracyLow: -15, accuracyHigh: 20, contingencyLow: 0.10, contingencyHigh: 0.20 },
  2: { className: 'Class 2 - Control Estimate',     scopeRange: [30, 75],  accuracyLow: -10, accuracyHigh: 15, contingencyLow: 0.05, contingencyHigh: 0.15 },
  1: { className: 'Class 1 - Definitive Estimate',  scopeRange: [65, 100], accuracyLow: -5,  accuracyHigh: 10, contingencyLow: 0.03, contingencyHigh: 0.07 },
};

/**
 * Auto-detect AACE estimate class from scope maturity.
 * Scope maturity = % of line items with real dimensions (not 'estimated').
 */
function classifyEstimate(estimate: EstimateSummary): AACEClassification {
  let totalItems = 0;
  let verifiedItems = 0;

  for (const floor of estimate.floors) {
    for (const item of floor.lineItems) {
      totalItems++;
      if (item.verificationStatus === 'verified') verifiedItems++;
    }
  }

  const scopeMaturity = totalItems > 0 ? (verifiedItems / totalItems) * 100 : 0;

  let estimateClass: 1 | 2 | 3 | 4 | 5 = 5;
  if (scopeMaturity >= 65)      estimateClass = 1;
  else if (scopeMaturity >= 30) estimateClass = 2;
  else if (scopeMaturity >= 10) estimateClass = 3;
  else if (scopeMaturity >= 1)  estimateClass = 4;
  else                          estimateClass = 5;

  const cls = AACE_CLASSES[estimateClass];
  const midContingency = (cls.contingencyLow + cls.contingencyHigh) / 2;

  return {
    estimateClass,
    className: cls.className,
    scopeMaturity,
    expectedAccuracyLow: cls.accuracyLow,
    expectedAccuracyHigh: cls.accuracyHigh,
    contingencyRange: {
      low: cls.contingencyLow,
      high: cls.contingencyHigh,
      applied: midContingency,
    },
  };
}

// --- Escalation Calculator ---------------------------------------------------

/**
 * Calculate compound escalation factor between price base date and construction midpoint.
 * Uses compound interest formula: factor = (1 + blendedRate)^years
 */
function calculateEscalation(config: EscalationConfig): { factor: number; years: number } {
  const baseDate = new Date(config.priceBaseDate);
  const midPoint = new Date(config.constructionMidPoint);
  const yearsDiff = (midPoint.getTime() - baseDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

  if (yearsDiff <= 0) return { factor: 1.0, years: 0 };

  // Blended rate: weighted average — typical construction ~55% material, ~45% labor
  const blendedRate = (config.materialEscalation * 0.55) + (config.laborEscalation * 0.45);
  const factor = Math.pow(1 + blendedRate, yearsDiff);

  return { factor, years: yearsDiff };
}

// --- General Conditions Calculator -------------------------------------------

/**
 * Calculate duration-based general conditions (Div 01).
 * If project duration is provided, uses monthly rates (more accurate).
 * Otherwise, uses percentage of direct cost.
 */
function calculateGeneralConditions(
  directCostSubtotal: number,
  config: BudgetConfig
): BudgetStructure['generalConditions'] {
  const pct = config.generalConditionsPercent ?? 0.12;

  if (config.projectDurationMonths && config.projectDurationMonths > 0) {
    const months = config.projectDurationMonths;
    const siteManagement   = months * 18500;  // Site super + PM: ~$18,500/month CAD
    const temporaryWorks   = months * 4200;   // Temp facilities, power, water
    const HSE              = months * 3500;   // Health/safety/environmental
    const QA_QC            = months * 2800;   // Quality assurance
    const logistics        = months * 3000;   // Site logistics, hoarding, access
    const subtotal = siteManagement + temporaryWorks + HSE + QA_QC + logistics;

    return {
      siteManagement, temporaryWorks, HSE, QA_QC, logistics, subtotal,
      percentOfDirect: directCostSubtotal > 0 ? subtotal / directCostSubtotal : 0,
    };
  }

  // Percentage-based fallback
  const subtotal = directCostSubtotal * pct;
  return {
    siteManagement:  subtotal * 0.40,
    temporaryWorks:  subtotal * 0.20,
    HSE:             subtotal * 0.15,
    QA_QC:           subtotal * 0.12,
    logistics:       subtotal * 0.13,
    subtotal,
    percentOfDirect: pct,
  };
}

// --- Permits & Fees Calculator -----------------------------------------------

/**
 * Calculate permits, fees and inspections.
 * Ontario typical: building permit 1-1.5% of construction value,
 * plan review ~65-100% of permit fee, development charges vary by municipality.
 */
function calculatePermitsFees(
  constructionCost: number,
  config: BudgetConfig
): BudgetStructure['permitsFees'] {
  if (config.permitsFees) {
    const p = config.permitsFees;
    const subtotal = (p.buildingPermit ?? 0) + (p.developmentCharges ?? 0) +
                     (p.planReview ?? 0) + (p.inspections ?? 0);
    return {
      buildingPermit: p.buildingPermit ?? 0,
      developmentCharges: p.developmentCharges ?? 0,
      planReview: p.planReview ?? 0,
      inspections: p.inspections ?? 0,
      subtotal,
    };
  }

  // Default calculation for Ontario municipalities
  const permitPct = config.permitPercent ?? 0.0125;
  const buildingPermit = constructionCost * permitPct;
  const planReview = buildingPermit * 0.75;
  const developmentCharges = constructionCost * 0.005;
  const inspections = constructionCost * 0.003;

  return {
    buildingPermit, developmentCharges, planReview, inspections,
    subtotal: buildingPermit + planReview + developmentCharges + inspections,
  };
}

// --- Main Budget Assembly Function -------------------------------------------

/**
 * Build the complete 8-tier professional budget structure from estimate-engine output.
 *
 * Input:  EstimateSummary from generateEstimateFromElements()
 * Output: BudgetStructure with all 8 layers, AACE classification, and grand total
 *
 * This is the bridge between "naked direct cost" and "professional Level 5 estimate".
 */
export function buildBudgetStructure(
  estimate: EstimateSummary,
  config: BudgetConfig = {}
): BudgetStructure {

  // -- AACE Classification --
  const aaceClass = classifyEstimate(estimate);

  // -- Layer 1: Direct Costs (from engine) --
  const directCost = {
    material: estimate.materialGrandTotal,
    labor: estimate.laborGrandTotal,
    equipment: estimate.equipmentGrandTotal,
    waste: estimate.wasteGrandTotal,
    subtotal: estimate.grandTotal,
    lineItemCount: estimate.lineItemCount,
    csiDivisionsUsed: estimate.csiDivisionsUsed,
  };

  // -- Layer 2: General Conditions / Preliminaries --
  const generalConditions = calculateGeneralConditions(directCost.subtotal, config);
  const constructionCostBase = directCost.subtotal + generalConditions.subtotal;

  // -- Layer 3: Design / Consultant Fees --
  const designPct = config.designFeesPercent ?? 0.10;
  const designSubtotal = constructionCostBase * designPct;
  const designFees = {
    architectural: config.designFeesOverride?.architectural ?? designSubtotal * 0.45,
    structural: config.designFeesOverride?.structural ?? designSubtotal * 0.20,
    MEP: config.designFeesOverride?.MEP ?? designSubtotal * 0.25,
    other: config.designFeesOverride?.other ?? designSubtotal * 0.10,
    subtotal: designSubtotal,
    percentOfConstruction: designPct,
  };

  // -- Layer 4: Defined Allowances --
  const allowanceItems = config.allowances ?? [];
  const allowanceSubtotal = allowanceItems.reduce((sum, a) => sum + a.amount, 0);
  const allowances = { items: allowanceItems, subtotal: allowanceSubtotal };

  // -- Layer 5: Contingency (AACE class-based) --
  const contingencyBase = constructionCostBase + designFees.subtotal + allowanceSubtotal;
  const designContPct = config.contingencyOverride?.designPercent ??
    (aaceClass.contingencyRange.applied * 0.40);
  const constructionContPct = config.contingencyOverride?.constructionPercent ??
    (aaceClass.contingencyRange.applied * 0.60);
  const managementReservePct = config.contingencyOverride?.managementReservePercent ?? 0.04;

  const riskRegister = config.riskRegister ?? [];
  const riskExpectedValue = riskRegister.reduce((sum, r) => sum + r.expectedValue, 0);

  const designContingency = contingencyBase * designContPct;
  const constructionContingency = contingencyBase * constructionContPct + riskExpectedValue;
  const managementReserve = contingencyBase * managementReservePct;
  const totalContingency = designContingency + constructionContingency + managementReserve;

  const contingency = {
    designContingency, constructionContingency, managementReserve,
    totalContingency,
    percentOfBase: contingencyBase > 0 ? totalContingency / contingencyBase : 0,
    riskRegister,
  };

  // -- Layer 6: Escalation --
  const today = new Date().toISOString().split('T')[0];
  const oneYearOut = new Date(Date.now() + 365.25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const defaultEscalation: EscalationConfig = {
    priceBaseDate: today,
    estimateBaseDate: today,
    constructionMidPoint: oneYearOut,
    annualEscalationRate: 0.03,
    materialEscalation: 0.035,
    laborEscalation: 0.025,
  };
  const escalationConfig = config.escalation ?? defaultEscalation;
  const escResult = calculateEscalation(escalationConfig);
  const baseForEscalation = constructionCostBase + designFees.subtotal +
    allowanceSubtotal + totalContingency;
  const escalationAmount = baseForEscalation * (escResult.factor - 1);

  const escalation = {
    amount: escalationAmount,
    config: escalationConfig,
    compoundFactor: escResult.factor,
    percentOfBase: escResult.factor - 1,
  };

  // -- Layer 7: Permits, Fees & Inspections --
  const totalBeforePermits = constructionCostBase + designFees.subtotal +
    allowanceSubtotal + totalContingency + escalationAmount;
  const permitsFees = calculatePermitsFees(totalBeforePermits, config);

  // -- Layer 8: Overhead, Profit & Taxes --
  const totalBeforeOHP = totalBeforePermits + permitsFees.subtotal;
  const ohPct = config.overheadPercent ?? 0.06;
  const profitPct = config.profitPercent ?? 0.08;
  const bondPct = config.bondInsurancePercent ?? 0.025;

  const homeOfficeOverhead = totalBeforeOHP * ohPct;
  const profit = totalBeforeOHP * profitPct;
  const bondInsurance = totalBeforeOHP * bondPct;
  const ohpSubtotal = homeOfficeOverhead + profit + bondInsurance;

  const overheadProfit = {
    homeOfficeOverhead, profit, bondInsurance,
    subtotal: ohpSubtotal,
    percentOfConstruction: totalBeforeOHP > 0 ? ohpSubtotal / totalBeforeOHP : 0,
  };

  // Tax (Ontario HST 13% default)
  const taxRate = config.taxRate ?? 0.13;
  const totalBeforeTax = totalBeforeOHP + ohpSubtotal;
  const hstAmount = totalBeforeTax * taxRate;
  const taxes = { HST: hstAmount, rate: taxRate, subtotal: hstAmount };

  // -- Grand Totals --
  const constructionCost = directCost.subtotal + generalConditions.subtotal;
  const totalProjectCost = constructionCost + designFees.subtotal + allowanceSubtotal +
    totalContingency + escalationAmount + permitsFees.subtotal;
  const totalWithOHP = totalProjectCost + ohpSubtotal;
  const GRAND_TOTAL = totalWithOHP + hstAmount;

  return {
    projectName: config.projectName ?? 'Untitled Project',
    region: estimate.region,
    currency: 'CAD',
    methodology: 'CIQS',
    generatedAt: new Date().toISOString(),
    aaceClass,
    directCost,
    generalConditions,
    designFees,
    allowances,
    contingency,
    escalation,
    permitsFees,
    overheadProfit,
    taxes,
    constructionCost,
    totalProjectCost,
    totalWithOHP,
    GRAND_TOTAL,
  };
}

// --- Budget Summary Formatter ------------------------------------------------

/**
 * Format budget structure as a human-readable summary.
 * Useful for BoE documentation, report generation, and debug output.
 */
export function formatBudgetSummary(budget: BudgetStructure): string {
  const f = (n: number) => '$' + n.toLocaleString('en-CA', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  const pct = (n: number) => (n * 100).toFixed(1) + '%';

  const out: string[] = [];
  out.push('====================================================================');
  out.push('  PROFESSIONAL ESTIMATE SUMMARY - ' + budget.projectName);
  out.push('  ' + budget.aaceClass.className);
  out.push('  Scope Maturity: ' + budget.aaceClass.scopeMaturity.toFixed(1) + '%');
  out.push('  Expected Accuracy: ' + budget.aaceClass.expectedAccuracyLow +
    '% / +' + budget.aaceClass.expectedAccuracyHigh + '%');
  out.push('====================================================================');
  out.push('');
  out.push('  LAYER 1 - DIRECT COSTS');
  out.push('    Material:               ' + f(budget.directCost.material));
  out.push('    Labor:                  ' + f(budget.directCost.labor));
  out.push('    Equipment:              ' + f(budget.directCost.equipment));
  out.push('    (incl. waste:           ' + f(budget.directCost.waste) + ')');
  out.push('    DIRECT COST SUBTOTAL:   ' + f(budget.directCost.subtotal));
  out.push('');
  out.push('  LAYER 2 - GENERAL CONDITIONS (' +
    pct(budget.generalConditions.percentOfDirect) + ' of direct)');
  out.push('    Site Management:        ' + f(budget.generalConditions.siteManagement));
  out.push('    Temporary Works:        ' + f(budget.generalConditions.temporaryWorks));
  out.push('    HSE:                    ' + f(budget.generalConditions.HSE));
  out.push('    QA/QC:                  ' + f(budget.generalConditions.QA_QC));
  out.push('    Logistics:              ' + f(budget.generalConditions.logistics));
  out.push('    GEN COND SUBTOTAL:      ' + f(budget.generalConditions.subtotal));
  out.push('');
  out.push('  --- CONSTRUCTION COST:    ' + f(budget.constructionCost));
  out.push('');
  out.push('  LAYER 3 - DESIGN FEES (' +
    pct(budget.designFees.percentOfConstruction) + ' of construction)');
  out.push('    Architectural:          ' + f(budget.designFees.architectural));
  out.push('    Structural:             ' + f(budget.designFees.structural));
  out.push('    MEP:                    ' + f(budget.designFees.MEP));
  out.push('    Other Consultants:      ' + f(budget.designFees.other));
  out.push('    DESIGN FEES SUBTOTAL:   ' + f(budget.designFees.subtotal));
  out.push('');

  if (budget.allowances.items.length > 0) {
    out.push('  LAYER 4 - DEFINED ALLOWANCES');
    for (const a of budget.allowances.items) {
      out.push('    ' + a.description + ': ' + f(a.amount) + ' (' + a.scope + ')');
    }
    out.push('    ALLOWANCES SUBTOTAL:    ' + f(budget.allowances.subtotal));
    out.push('');
  }

  out.push('  LAYER 5 - CONTINGENCY (' + pct(budget.contingency.percentOfBase) + ' of base)');
  out.push('    Design Contingency:     ' + f(budget.contingency.designContingency));
  out.push('    Construction Cont.:     ' + f(budget.contingency.constructionContingency));
  out.push('    Management Reserve:     ' + f(budget.contingency.managementReserve));
  if (budget.contingency.riskRegister.length > 0) {
    out.push('    (' + budget.contingency.riskRegister.length + ' risk items in register)');
  }
  out.push('    CONTINGENCY SUBTOTAL:   ' + f(budget.contingency.totalContingency));
  out.push('');
  out.push('  LAYER 6 - ESCALATION');
  out.push('    Base -> Midpoint:       ' + budget.escalation.config.priceBaseDate +
    ' -> ' + budget.escalation.config.constructionMidPoint);
  out.push('    Compound Factor:        ' + budget.escalation.compoundFactor.toFixed(4));
  out.push('    ESCALATION AMOUNT:      ' + f(budget.escalation.amount));
  out.push('');
  out.push('  LAYER 7 - PERMITS, FEES & INSPECTIONS');
  out.push('    Building Permit:        ' + f(budget.permitsFees.buildingPermit));
  out.push('    Development Charges:    ' + f(budget.permitsFees.developmentCharges));
  out.push('    Plan Review:            ' + f(budget.permitsFees.planReview));
  out.push('    Inspections:            ' + f(budget.permitsFees.inspections));
  out.push('    PERMITS SUBTOTAL:       ' + f(budget.permitsFees.subtotal));
  out.push('');
  out.push('  --- TOTAL PROJECT COST:   ' + f(budget.totalProjectCost));
  out.push('');
  out.push('  LAYER 8 - OVERHEAD & PROFIT (' +
    pct(budget.overheadProfit.percentOfConstruction) + ')');
  out.push('    Home Office Overhead:   ' + f(budget.overheadProfit.homeOfficeOverhead));
  out.push('    Profit:                 ' + f(budget.overheadProfit.profit));
  out.push('    Bond & Insurance:       ' + f(budget.overheadProfit.bondInsurance));
  out.push('    OH&P SUBTOTAL:          ' + f(budget.overheadProfit.subtotal));
  out.push('');
  out.push('  TAXES - HST (' + pct(budget.taxes.rate) + ')');
  out.push('    HST:                    ' + f(budget.taxes.HST));
  out.push('');
  out.push('====================================================================');
  out.push('  GRAND TOTAL:              ' + f(budget.GRAND_TOTAL));
  out.push('====================================================================');

  return out.join('\n');
}
