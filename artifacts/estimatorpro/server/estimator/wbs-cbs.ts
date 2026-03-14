// server/estimator/wbs-cbs.ts
// =============================================================================
// WBS / CBS INTEGRATION (Work Breakdown Structure / Cost Breakdown Structure)
// =============================================================================
//
// Master Priority Item #22
//
// Purpose:
//   1. Define project WBS hierarchy (phases → packages → activities)
//   2. Map CSI divisions to WBS elements
//   3. Generate CBS (Cost Breakdown Structure) from WBS + estimate
//   4. Support earned value tracking (BCWS, BCWP, ACWP)
//   5. Enable cost reporting by WBS level or CBS code
//   6. Integrate with schedule for progress tracking
//
// Standards: PMI Practice Standard for WBS, AACE RP 17R-97,
//            CIQS cost reporting practices
// =============================================================================

import type { EstimateSummary } from './estimate-engine';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export type WBSLevel = 'project' | 'phase' | 'package' | 'activity' | 'task';

export interface WBSElement {
  wbsCode: string;                 // e.g., "1.0", "1.2", "1.2.3"
  level: WBSLevel;
  name: string;
  description?: string;
  parentCode: string | null;       // null = root
  csiDivisions?: string[];         // CSI divisions mapped to this WBS element
  responsibleParty?: string;       // Who owns this WBS element
  scheduledStart?: string;         // ISO date
  scheduledFinish?: string;
  budgetedCost: number;            // Budgeted cost (from estimate)
}

export interface CBSCode {
  cbsCode: string;                 // Unique cost code
  wbsCode: string;                 // Maps to WBS element
  csiDivision: string;             // CSI division
  csiSubdivision: string;
  description: string;
  budgetedLabor: number;
  budgetedMaterial: number;
  budgetedEquipment: number;
  budgetedTotal: number;
  committedCost: number;           // POs, subcontracts issued
  actualCost: number;              // Invoiced/paid to date
  estimateToComplete: number;      // Forecast remaining
  estimateAtCompletion: number;    // Actual + ETC
  variance: number;                // Budget - EAC
}

export interface EarnedValueMetrics {
  wbsCode: string;
  bcws: number;                    // Budgeted Cost of Work Scheduled (planned value)
  bcwp: number;                    // Budgeted Cost of Work Performed (earned value)
  acwp: number;                    // Actual Cost of Work Performed
  sv: number;                      // Schedule Variance (BCWP - BCWS)
  cv: number;                      // Cost Variance (BCWP - ACWP)
  spi: number;                     // Schedule Performance Index (BCWP / BCWS)
  cpi: number;                     // Cost Performance Index (BCWP / ACWP)
  eac: number;                     // Estimate at Completion
  etc: number;                     // Estimate to Complete
  vac: number;                     // Variance at Completion
  percentComplete: number;
}

export interface WBSStructure {
  projectName: string;
  projectCode: string;
  elements: WBSElement[];
  cbsCodes: CBSCode[];
  earnedValue: EarnedValueMetrics[];
  totalBudget: number;
  totalCommitted: number;
  totalActual: number;
  totalEAC: number;
  generatedAt: string;
}

// ─── Standard WBS Template ───────────────────────────────────────────────────

/**
 * Generate a standard building project WBS template.
 * Based on typical ICI (Industrial, Commercial, Institutional) project structure.
 */
export function generateStandardWBS(projectName: string, _projectCode: string): WBSElement[] {
  const elements: WBSElement[] = [
    // Level 1: Project
    { wbsCode: '1.0', level: 'project', name: projectName, parentCode: null, budgetedCost: 0 },

    // Level 2: Phases
    { wbsCode: '1.1', level: 'phase', name: 'Pre-Construction', parentCode: '1.0', budgetedCost: 0 },
    { wbsCode: '1.2', level: 'phase', name: 'Site Preparation', parentCode: '1.0', csiDivisions: ['02','31'], budgetedCost: 0 },
    { wbsCode: '1.3', level: 'phase', name: 'Foundations & Substructure', parentCode: '1.0', csiDivisions: ['03','31'], budgetedCost: 0 },
    { wbsCode: '1.4', level: 'phase', name: 'Superstructure', parentCode: '1.0', csiDivisions: ['03','05'], budgetedCost: 0 },
    { wbsCode: '1.5', level: 'phase', name: 'Building Envelope', parentCode: '1.0', csiDivisions: ['04','07','08'], budgetedCost: 0 },
    { wbsCode: '1.6', level: 'phase', name: 'Interior Construction', parentCode: '1.0', csiDivisions: ['06','09','10','11','12'], budgetedCost: 0 },
    { wbsCode: '1.7', level: 'phase', name: 'Mechanical Systems', parentCode: '1.0', csiDivisions: ['22','23'], budgetedCost: 0 },
    { wbsCode: '1.8', level: 'phase', name: 'Electrical Systems', parentCode: '1.0', csiDivisions: ['26','27','28'], budgetedCost: 0 },
    { wbsCode: '1.9', level: 'phase', name: 'Conveying Systems', parentCode: '1.0', csiDivisions: ['14'], budgetedCost: 0 },
    { wbsCode: '1.10', level: 'phase', name: 'Site Work & Landscaping', parentCode: '1.0', csiDivisions: ['32','33'], budgetedCost: 0 },
    { wbsCode: '1.11', level: 'phase', name: 'Commissioning & Closeout', parentCode: '1.0', budgetedCost: 0 },

    // Level 3: Work Packages (under Foundations)
    { wbsCode: '1.3.1', level: 'package', name: 'Excavation & Shoring', parentCode: '1.3', csiDivisions: ['31'], budgetedCost: 0 },
    { wbsCode: '1.3.2', level: 'package', name: 'Footings', parentCode: '1.3', csiDivisions: ['03'], budgetedCost: 0 },
    { wbsCode: '1.3.3', level: 'package', name: 'Foundation Walls', parentCode: '1.3', csiDivisions: ['03'], budgetedCost: 0 },
    { wbsCode: '1.3.4', level: 'package', name: 'Slab on Grade', parentCode: '1.3', csiDivisions: ['03'], budgetedCost: 0 },
    { wbsCode: '1.3.5', level: 'package', name: 'Waterproofing', parentCode: '1.3', csiDivisions: ['07'], budgetedCost: 0 },

    // Level 3: Work Packages (under Superstructure)
    { wbsCode: '1.4.1', level: 'package', name: 'Structural Concrete', parentCode: '1.4', csiDivisions: ['03'], budgetedCost: 0 },
    { wbsCode: '1.4.2', level: 'package', name: 'Structural Steel', parentCode: '1.4', csiDivisions: ['05'], budgetedCost: 0 },
    { wbsCode: '1.4.3', level: 'package', name: 'Metal Decking', parentCode: '1.4', csiDivisions: ['05'], budgetedCost: 0 },
    { wbsCode: '1.4.4', level: 'package', name: 'Precast Elements', parentCode: '1.4', csiDivisions: ['03'], budgetedCost: 0 },

    // Level 3: Work Packages (under Envelope)
    { wbsCode: '1.5.1', level: 'package', name: 'Masonry', parentCode: '1.5', csiDivisions: ['04'], budgetedCost: 0 },
    { wbsCode: '1.5.2', level: 'package', name: 'Roofing', parentCode: '1.5', csiDivisions: ['07'], budgetedCost: 0 },
    { wbsCode: '1.5.3', level: 'package', name: 'Curtain Wall / Glazing', parentCode: '1.5', csiDivisions: ['08'], budgetedCost: 0 },
    { wbsCode: '1.5.4', level: 'package', name: 'Insulation & Air Barrier', parentCode: '1.5', csiDivisions: ['07'], budgetedCost: 0 },
  ];

  return elements;
}

// ─── WBS ↔ Estimate Mapping ─────────────────────────────────────────────────

/**
 * Map estimate line items to WBS elements using CSI division mappings.
 * Populates budgetedCost on each WBS element.
 */
export function mapEstimateToWBS(
  wbs: WBSElement[],
  estimate: EstimateSummary
): WBSElement[] {
  // Build division → WBS mapping (use deepest WBS element that matches)
  const divisionToWBS = new Map<string, string>();
  // Sort by code length descending so deeper elements override shallower ones
  const sortedElements = [...wbs].sort((a, b) => b.wbsCode.length - a.wbsCode.length);

  for (const elem of sortedElements) {
    if (elem.csiDivisions) {
      for (const div of elem.csiDivisions) {
        if (!divisionToWBS.has(div)) {
          divisionToWBS.set(div, elem.wbsCode);
        }
      }
    }
  }

  // Reset budgets
  for (const elem of wbs) elem.budgetedCost = 0;

  // Assign estimate costs to WBS elements
  for (const floor of estimate.floors) {
    for (const item of floor.lineItems) {
      const wbsCode = divisionToWBS.get(item.csiDivision);
      if (wbsCode) {
        const elem = wbs.find(e => e.wbsCode === wbsCode);
        if (elem) elem.budgetedCost += item.totalCost;
      }
    }
  }

  // Roll up to parent levels
  rollUpBudgets(wbs);

  return wbs;
}

/**
 * Roll up child budgets to parent WBS elements.
 */
function rollUpBudgets(wbs: WBSElement[]): void {
  // Sort by depth (deepest first) so children are processed before parents
  const byDepth = [...wbs].sort((a, b) => b.wbsCode.split('.').length - a.wbsCode.split('.').length);

  for (const elem of byDepth) {
    const children = wbs.filter(e => e.parentCode === elem.wbsCode);
    if (children.length > 0) {
      const childTotal = children.reduce((s, c) => s + c.budgetedCost, 0);
      // Parent = max(own direct costs, sum of children)
      if (childTotal > elem.budgetedCost) {
        elem.budgetedCost = childTotal;
      }
    }
  }
}

// ─── CBS Generation ──────────────────────────────────────────────────────────

/**
 * Generate CBS codes from WBS + estimate data.
 * Each CBS code is a unique combination of WBS element + CSI division.
 */
export function generateCBS(
  wbs: WBSElement[],
  estimate: EstimateSummary
): CBSCode[] {
  const _cbsCodes: CBSCode[] = [];

  // Build WBS code → CSI divisions mapping
  const wbsMap = new Map<string, WBSElement>();
  for (const elem of wbs) wbsMap.set(elem.wbsCode, elem);

  const divToWbs = new Map<string, string>();
  const sorted = [...wbs].sort((a, b) => b.wbsCode.length - a.wbsCode.length);
  for (const elem of sorted) {
    if (elem.csiDivisions) {
      for (const div of elem.csiDivisions) {
        if (!divToWbs.has(div)) divToWbs.set(div, elem.wbsCode);
      }
    }
  }

  // Aggregate by WBS + CSI division + subdivision
  const cbsMap = new Map<string, CBSCode>();
  for (const floor of estimate.floors) {
    for (const item of floor.lineItems) {
      const wbsCode = divToWbs.get(item.csiDivision) || '1.0';
      const cbsKey = wbsCode + '|' + item.csiDivision + '|' + item.csiSubdivision;

      if (!cbsMap.has(cbsKey)) {
        cbsMap.set(cbsKey, {
          cbsCode: wbsCode + '-' + item.csiDivision + item.csiSubdivision,
          wbsCode,
          csiDivision: item.csiDivision,
          csiSubdivision: item.csiSubdivision,
          description: item.description,
          budgetedLabor: 0,
          budgetedMaterial: 0,
          budgetedEquipment: 0,
          budgetedTotal: 0,
          committedCost: 0,
          actualCost: 0,
          estimateToComplete: 0,
          estimateAtCompletion: 0,
          variance: 0,
        });
      }

      const cbs = cbsMap.get(cbsKey)!;
      cbs.budgetedLabor += item.laborCost;
      cbs.budgetedMaterial += item.materialCost;
      cbs.budgetedEquipment += item.equipmentCost;
      cbs.budgetedTotal += item.totalCost;
      cbs.estimateToComplete = cbs.budgetedTotal;
      cbs.estimateAtCompletion = cbs.budgetedTotal;
    }
  }

  return Array.from(cbsMap.values())
    .sort((a, b) => a.cbsCode.localeCompare(b.cbsCode));
}

// ─── Earned Value ────────────────────────────────────────────────────────────

/**
 * Calculate earned value metrics for a WBS element.
 */
export function calculateEarnedValue(
  wbsCode: string,
  budgetedTotal: number,
  percentComplete: number,
  actualCost: number
): EarnedValueMetrics {
  const bcws = budgetedTotal;                       // Planned value
  const bcwp = budgetedTotal * (percentComplete / 100); // Earned value
  const acwp = actualCost;

  const sv = bcwp - bcws;
  const cv = bcwp - acwp;
  const spi = bcws !== 0 ? bcwp / bcws : 0;
  const cpi = acwp !== 0 ? bcwp / acwp : 0;
  const eac = cpi !== 0 ? budgetedTotal / cpi : budgetedTotal;
  const etc = eac - acwp;
  const vac = budgetedTotal - eac;

  return {
    wbsCode,
    bcws: Math.round(bcws * 100) / 100,
    bcwp: Math.round(bcwp * 100) / 100,
    acwp: Math.round(acwp * 100) / 100,
    sv: Math.round(sv * 100) / 100,
    cv: Math.round(cv * 100) / 100,
    spi: Math.round(spi * 1000) / 1000,
    cpi: Math.round(cpi * 1000) / 1000,
    eac: Math.round(eac * 100) / 100,
    etc: Math.round(etc * 100) / 100,
    vac: Math.round(vac * 100) / 100,
    percentComplete,
  };
}

/**
 * Build complete WBS structure with CBS and earned value.
 */
export function buildWBSStructure(
  projectName: string,
  projectCode: string,
  estimate: EstimateSummary
): WBSStructure {
  const wbs = generateStandardWBS(projectName, projectCode);
  mapEstimateToWBS(wbs, estimate);
  const cbsCodes = generateCBS(wbs, estimate);

  const totalBudget = cbsCodes.reduce((s, c) => s + c.budgetedTotal, 0);
  const totalCommitted = cbsCodes.reduce((s, c) => s + c.committedCost, 0);
  const totalActual = cbsCodes.reduce((s, c) => s + c.actualCost, 0);

  return {
    projectName,
    projectCode,
    elements: wbs,
    cbsCodes,
    earnedValue: [],
    totalBudget: Math.round(totalBudget * 100) / 100,
    totalCommitted: Math.round(totalCommitted * 100) / 100,
    totalActual: Math.round(totalActual * 100) / 100,
    totalEAC: Math.round(totalBudget * 100) / 100,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Format WBS as human-readable report.
 */
export function formatWBSReport(structure: WBSStructure): string {
  const f = (n: number) => '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const out: string[] = [];

  out.push('====================================================================');
  out.push('  WORK BREAKDOWN STRUCTURE / COST BREAKDOWN');
  out.push('  Project: ' + structure.projectName + ' (' + structure.projectCode + ')');
  out.push('====================================================================');
  out.push('');
  out.push('  Total Budget: ' + f(structure.totalBudget));
  out.push('  CBS Codes: ' + structure.cbsCodes.length);
  out.push('  WBS Elements: ' + structure.elements.length);
  out.push('');

  out.push('  ── WBS Hierarchy ──');
  for (const elem of structure.elements) {
    const depth = elem.wbsCode.split('.').length - 1;
    const indent = '  '.repeat(depth);
    const cost = elem.budgetedCost > 0 ? ' — ' + f(elem.budgetedCost) : '';
    out.push('  ' + indent + elem.wbsCode + ' ' + elem.name + cost);
  }
  out.push('');

  out.push('  ── CBS Summary (top 15) ──');
  const topCBS = structure.cbsCodes.sort((a, b) => b.budgetedTotal - a.budgetedTotal).slice(0, 15);
  for (const cbs of topCBS) {
    out.push('  ' + cbs.cbsCode + ' | ' + cbs.description.substring(0, 35) +
      ' | L:' + f(cbs.budgetedLabor) + ' M:' + f(cbs.budgetedMaterial) +
      ' E:' + f(cbs.budgetedEquipment) + ' = ' + f(cbs.budgetedTotal));
  }

  out.push('');
  out.push('====================================================================');
  return out.join('\n');
}

// ─── EAC/ETC Forecasting (Variance-at-Completion) ───────────────────────────

export type EACMethod = 'cpi' | 'cpi-spi' | 'manager-override' | 'remaining-budget';

export interface EACForecast {
  wbsCode: string;
  wbsName: string;
  budget: number;         // BAC
  actualToDate: number;
  percentComplete: number;
  earnedValue: number;    // BCWP
  cpi: number;
  spi: number;
  eacByCPI: number;       // BAC / CPI
  eacByCPIxSPI: number;   // ACWP + (BAC - BCWP) / (CPI * SPI)
  eacByRemaining: number; // ACWP + (BAC - BCWP)
  eacSelected: number;    // Based on chosen method
  etc: number;            // EAC - ACWP
  vac: number;            // BAC - EAC
  tcpi: number;           // (BAC - BCWP) / (BAC - ACWP) — To-Complete Performance Index
}

export interface ProjectForecastSummary {
  projectName: string;
  reportDate: string;
  method: EACMethod;
  totalBudget: number;
  totalActual: number;
  totalEarnedValue: number;
  overallCPI: number;
  overallSPI: number;
  totalEAC: number;
  totalETC: number;
  totalVAC: number;
  forecastByWBS: EACForecast[];
  atRiskElements: EACForecast[];   // WBS elements with CPI < 0.9
  generatedAt: string;
}

/**
 * Calculate EAC/ETC forecasts for each WBS element and roll up to project level.
 * Integrates the estimate with actual cost/progress data during construction.
 *
 * @param structure - WBS structure with budgets
 * @param actuals - Map of wbsCode -> { actualCost, percentComplete }
 * @param method - Forecasting method (default: 'cpi')
 */
export function generateEACForecast(
  structure: WBSStructure,
  actuals: Map<string, { actualCost: number; percentComplete: number }>,
  method: EACMethod = 'cpi'
): ProjectForecastSummary {
  const forecasts: EACForecast[] = [];

  // Process leaf-level WBS elements (those with budget > 0 and no children with budget)
  const elementsWithBudget = structure.elements.filter(e => e.budgetedCost > 0);
  const parentCodes = new Set(structure.elements.map(e => e.parentCode).filter(Boolean));
  const leafElements = elementsWithBudget.filter(e => {
    // Is a leaf if no other element lists this as parent, OR has direct budget
    const hasChildren = structure.elements.some(
      other => other.parentCode === e.wbsCode && other.budgetedCost > 0
    );
    return !hasChildren;
  });

  let totalBudget = 0;
  let totalActual = 0;
  let totalEV = 0;

  for (const elem of leafElements) {
    const actual = actuals.get(elem.wbsCode) ?? { actualCost: 0, percentComplete: 0 };
    const bac = elem.budgetedCost;
    const acwp = actual.actualCost;
    const pctComplete = actual.percentComplete;
    const bcwp = bac * (pctComplete / 100);
    const cpi = acwp > 0 ? bcwp / acwp : (pctComplete > 0 ? 1.0 : 0);
    const spi = bac > 0 ? bcwp / bac : 0;

    const eacByCPI = cpi > 0 ? bac / cpi : bac;
    const eacByCPIxSPI = (cpi * spi) > 0
      ? acwp + (bac - bcwp) / (cpi * spi)
      : bac;
    const eacByRemaining = acwp + (bac - bcwp);

    let eacSelected: number;
    switch (method) {
      case 'cpi':
        eacSelected = eacByCPI;
        break;
      case 'cpi-spi':
        eacSelected = eacByCPIxSPI;
        break;
      case 'remaining-budget':
        eacSelected = eacByRemaining;
        break;
      default:
        eacSelected = eacByCPI;
    }

    const etc = Math.max(0, eacSelected - acwp);
    const vac = bac - eacSelected;
    const tcpiBudget = bac - acwp;
    const tcpi = tcpiBudget > 0 ? (bac - bcwp) / tcpiBudget : 1.0;

    forecasts.push({
      wbsCode: elem.wbsCode,
      wbsName: elem.name,
      budget: bac,
      actualToDate: acwp,
      percentComplete: pctComplete,
      earnedValue: Math.round(bcwp * 100) / 100,
      cpi: Math.round(cpi * 1000) / 1000,
      spi: Math.round(spi * 1000) / 1000,
      eacByCPI: Math.round(eacByCPI * 100) / 100,
      eacByCPIxSPI: Math.round(eacByCPIxSPI * 100) / 100,
      eacByRemaining: Math.round(eacByRemaining * 100) / 100,
      eacSelected: Math.round(eacSelected * 100) / 100,
      etc: Math.round(etc * 100) / 100,
      vac: Math.round(vac * 100) / 100,
      tcpi: Math.round(tcpi * 1000) / 1000,
    });

    totalBudget += bac;
    totalActual += acwp;
    totalEV += bcwp;
  }

  const overallCPI = totalActual > 0 ? totalEV / totalActual : 0;
  const overallSPI = totalBudget > 0 ? totalEV / totalBudget : 0;
  const totalEAC = forecasts.reduce((s, f) => s + f.eacSelected, 0);
  const totalETC = forecasts.reduce((s, f) => s + f.etc, 0);
  const totalVAC = totalBudget - totalEAC;

  const atRiskElements = forecasts.filter(f => f.cpi > 0 && f.cpi < 0.9 && f.percentComplete > 5);

  return {
    projectName: structure.projectName,
    reportDate: new Date().toISOString().split('T')[0],
    method,
    totalBudget: Math.round(totalBudget * 100) / 100,
    totalActual: Math.round(totalActual * 100) / 100,
    totalEarnedValue: Math.round(totalEV * 100) / 100,
    overallCPI: Math.round(overallCPI * 1000) / 1000,
    overallSPI: Math.round(overallSPI * 1000) / 1000,
    totalEAC: Math.round(totalEAC * 100) / 100,
    totalETC: Math.round(totalETC * 100) / 100,
    totalVAC: Math.round(totalVAC * 100) / 100,
    forecastByWBS: forecasts,
    atRiskElements,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Format EAC forecast as human-readable report.
 */
export function formatEACReport(forecast: ProjectForecastSummary): string {
  const f = (n: number) => '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const out: string[] = [];

  out.push('═══════════════════════════════════════════════════════════════');
  out.push('  EARNED VALUE / EAC FORECAST REPORT');
  out.push('  Project: ' + forecast.projectName);
  out.push('  Report Date: ' + forecast.reportDate);
  out.push('  Method: ' + forecast.method.toUpperCase());
  out.push('═══════════════════════════════════════════════════════════════');
  out.push('');
  out.push('  Budget at Completion (BAC):  ' + f(forecast.totalBudget));
  out.push('  Actual Cost to Date (ACWP):  ' + f(forecast.totalActual));
  out.push('  Earned Value (BCWP):         ' + f(forecast.totalEarnedValue));
  out.push('  Overall CPI:                 ' + forecast.overallCPI.toFixed(3));
  out.push('  Overall SPI:                 ' + forecast.overallSPI.toFixed(3));
  out.push('');
  out.push('  Estimate at Completion (EAC): ' + f(forecast.totalEAC));
  out.push('  Estimate to Complete (ETC):   ' + f(forecast.totalETC));
  out.push('  Variance at Completion (VAC): ' + f(forecast.totalVAC));
  out.push('');

  if (forecast.atRiskElements.length > 0) {
    out.push('  ── AT-RISK ELEMENTS (CPI < 0.90) ──');
    for (const e of forecast.atRiskElements) {
      out.push('  ' + e.wbsCode + ' ' + e.wbsName);
      out.push('    BAC: ' + f(e.budget) + ' | ACWP: ' + f(e.actualToDate) +
        ' | CPI: ' + e.cpi.toFixed(3) + ' | EAC: ' + f(e.eacSelected) +
        ' | Overrun: ' + f(-e.vac));
    }
    out.push('');
  }

  out.push('  ── FORECAST BY WBS ──');
  out.push('  WBS     Name                          BAC          ACWP         EAC          VAC      CPI');
  out.push('  ───     ────                          ───          ────         ───          ───      ───');
  for (const e of forecast.forecastByWBS) {
    out.push('  ' + e.wbsCode.padEnd(8) + e.wbsName.substring(0, 28).padEnd(30) +
      f(e.budget).padStart(12) + f(e.actualToDate).padStart(13) +
      f(e.eacSelected).padStart(13) + f(e.vac).padStart(13) +
      ('  ' + e.cpi.toFixed(3)));
  }

  out.push('');
  out.push('═══════════════════════════════════════════════════════════════');
  return out.join('\n');
}
