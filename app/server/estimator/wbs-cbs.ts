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

import type { EstimateSummary, EstimateLineItem } from './estimate-engine';

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
export function generateStandardWBS(projectName: string, projectCode: string): WBSElement[] {
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
  const cbsCodes: CBSCode[] = [];

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
