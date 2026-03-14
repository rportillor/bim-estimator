// server/estimator/rfi-generator.ts
// =============================================================================
// RFI WIRE — MISSING DATA → RFI GENERATION
// =============================================================================
//
// Master Priority Item #23
//
// Purpose:
//   1. Track missing data discovered during estimation
//   2. Categorize gaps by type (dimension, spec, material, detail, code)
//   3. Assess impact on estimate accuracy (high/medium/low)
//   4. Auto-generate RFIs (Requests for Information) from missing data
//   5. Track RFI status through lifecycle
//   6. Link RFIs to affected estimate line items
//   7. Calculate total cost uncertainty from missing data
//
// Core principle: NEVER use default values for missing data. Gaps must generate
// an RFI or user prompt — this is the fundamental QS standard.
//
// Standards: CCDC 2 GC 2.2.8 (communications), CIQS documentation practices
// =============================================================================



// ─── Interfaces ──────────────────────────────────────────────────────────────

export type MissingDataCategory =
  | 'dimension'      // Missing length, width, height, area, volume
  | 'specification'  // Missing material spec, product, or standard
  | 'detail'         // Missing construction detail or assembly
  | 'material'       // Missing material grade, type, or finish
  | 'quantity'       // Missing count or quantity information
  | 'code'           // Code compliance question requiring clarification
  | 'coordination'   // Trade coordination or interface issue
  | 'geotechnical'   // Missing soil/subsurface data
  | 'environmental'  // Environmental condition or requirement unclear
  | 'schedule';      // Missing scheduling constraint or phasing info

export type ImpactLevel = 'critical' | 'high' | 'medium' | 'low';
export type RFIStatus = 'draft' | 'submitted' | 'acknowledged' | 'answered' | 'closed' | 'void';
export type RFIPriority = 'urgent' | 'high' | 'normal' | 'low';

export interface MissingDataItem {
  id: string;                       // Unique identifier
  category: MissingDataCategory;
  description: string;              // What is missing
  drawingRef?: string;              // Drawing sheet reference
  specSection?: string;             // Specification section reference
  csiDivision: string;              // Affected CSI division
  csiSubdivision?: string;
  floorLabel?: string;              // Which floor(s) affected
  impact: ImpactLevel;
  costImpactLow: number;            // Low estimate of cost impact
  costImpactHigh: number;           // High estimate of cost impact
  assumptionUsed?: string;          // If an assumption was made (flagged for verification)
  discoveredAt: string;             // ISO date discovered
  discoveredBy: string;             // Who found it
  rfiId?: string;                   // Generated RFI ID once created
}

export interface RFI {
  rfiId: string;                    // Sequential: RFI-001, RFI-002, etc.
  projectName: string;
  subject: string;
  category: MissingDataCategory;
  priority: RFIPriority;
  status: RFIStatus;

  // Content
  question: string;                 // Formal question to architect/engineer
  background: string;               // Context for the question
  suggestedResolution?: string;     // Estimator's suggested approach
  drawingRefs: string[];            // Drawing references
  specRefs: string[];               // Specification references

  // Impact
  affectedCSIDivisions: string[];
  affectedFloors: string[];
  costImpactLow: number;
  costImpactHigh: number;
  scheduleImpactDays?: number;

  // Tracking
  createdDate: string;
  createdBy: string;
  submittedDate?: string;
  requiredByDate?: string;          // When answer is needed
  answeredDate?: string;
  answer?: string;
  answeredBy?: string;

  // Linked missing data items
  missingDataIds: string[];
}

export interface RFISummary {
  projectName: string;
  totalMissingItems: number;
  totalRFIs: number;
  rfisByStatus: Record<RFIStatus, number>;
  rfisByCategory: Record<string, number>;
  rfisByPriority: Record<string, number>;
  totalCostUncertaintyLow: number;
  totalCostUncertaintyHigh: number;
  criticalItems: MissingDataItem[];
  rfis: RFI[];
  missingData: MissingDataItem[];
  generatedAt: string;
}

// ─── Missing Data Detection ──────────────────────────────────────────────────

/**
 * Register a missing data item discovered during estimation.
 */
export function registerMissingData(
  item: Omit<MissingDataItem, 'id' | 'discoveredAt'>
): MissingDataItem {
  return {
    ...item,
    id: 'MD-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6),
    discoveredAt: new Date().toISOString(),
  };
}

/**
 * Assess priority based on impact and category.
 */
export function assessPriority(item: MissingDataItem): RFIPriority {
  if (item.impact === 'critical') return 'urgent';
  if (item.impact === 'high') return 'high';
  if (item.category === 'geotechnical' || item.category === 'code') return 'high';
  if (item.impact === 'medium') return 'normal';
  return 'low';
}

// ─── RFI Generation ──────────────────────────────────────────────────────────

/**
 * Auto-generate an RFI from one or more missing data items.
 */
export function generateRFI(
  items: MissingDataItem[],
  projectName: string,
  createdBy: string,
  rfiNumber: number
): RFI {
  if (items.length === 0) {
    throw new Error('Cannot generate RFI with no missing data items');
  }

  const primary = items[0];
  const allDivisions = [...new Set(items.map(i => i.csiDivision))];
  const allFloors = [...new Set(items.filter(i => i.floorLabel).map(i => i.floorLabel!))];
  const allDrawings = [...new Set(items.filter(i => i.drawingRef).map(i => i.drawingRef!))];
  const allSpecs = [...new Set(items.filter(i => i.specSection).map(i => i.specSection!))];

  const costLow = items.reduce((s, i) => s + i.costImpactLow, 0);
  const costHigh = items.reduce((s, i) => s + i.costImpactHigh, 0);

  // Build question from items
  const questionParts = items.map(i => i.description);
  const question = items.length === 1
    ? 'Please clarify: ' + primary.description
    : 'Please clarify the following related items:\n' + questionParts.map((q, i) => (i + 1) + '. ' + q).join('\n');

  // Build background
  const background = 'During quantity surveying and cost estimation, the following information was found to be ' +
    'missing or ambiguous in the project documentation. This information is required to produce an accurate ' +
    'estimate for CSI Division(s) ' + allDivisions.join(', ') + '.' +
    (allDrawings.length > 0 ? ' Relevant drawings: ' + allDrawings.join(', ') + '.' : '') +
    (allSpecs.length > 0 ? ' Relevant spec sections: ' + allSpecs.join(', ') + '.' : '') +
    ' Estimated cost impact: $' + costLow.toLocaleString() + ' to $' + costHigh.toLocaleString() + '.';

  const rfiId = 'RFI-' + String(rfiNumber).padStart(3, '0');
  const priority = assessPriority(primary);

  // Link back to missing data items
  for (const item of items) {
    item.rfiId = rfiId;
  }

  return {
    rfiId,
    projectName,
    subject: primary.category.charAt(0).toUpperCase() + primary.category.slice(1) + ': ' + primary.description.substring(0, 80),
    category: primary.category,
    priority,
    status: 'draft',
    question,
    background,
    drawingRefs: allDrawings,
    specRefs: allSpecs,
    affectedCSIDivisions: allDivisions,
    affectedFloors: allFloors,
    costImpactLow: costLow,
    costImpactHigh: costHigh,
    createdDate: new Date().toISOString(),
    createdBy,
    missingDataIds: items.map(i => i.id),
  };
}

/**
 * Auto-generate RFIs from all missing data, grouping related items.
 */
export function generateAllRFIs(
  missingData: MissingDataItem[],
  projectName: string,
  createdBy: string
): RFI[] {
  // Group by category + CSI division (related items become one RFI)
  const groups = new Map<string, MissingDataItem[]>();
  for (const item of missingData) {
    const key = item.category + '|' + item.csiDivision;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  const rfis: RFI[] = [];
  let rfiNumber = 1;
  for (const [, items] of groups) {
    rfis.push(generateRFI(items, projectName, createdBy, rfiNumber));
    rfiNumber++;
  }

  return rfis.sort((a, b) => {
    const priorityOrder: Record<RFIPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

// ─── Summary & Reporting ─────────────────────────────────────────────────────

/**
 * Generate complete RFI summary with cost uncertainty analysis.
 */
export function generateRFISummary(
  missingData: MissingDataItem[],
  rfis: RFI[],
  projectName: string
): RFISummary {
  const rfisByStatus = { draft: 0, submitted: 0, acknowledged: 0, answered: 0, closed: 0, void: 0 };
  const rfisByCategory: Record<string, number> = {};
  const rfisByPriority: Record<string, number> = {};

  for (const rfi of rfis) {
    rfisByStatus[rfi.status]++;
    rfisByCategory[rfi.category] = (rfisByCategory[rfi.category] || 0) + 1;
    rfisByPriority[rfi.priority] = (rfisByPriority[rfi.priority] || 0) + 1;
  }

  return {
    projectName,
    totalMissingItems: missingData.length,
    totalRFIs: rfis.length,
    rfisByStatus,
    rfisByCategory,
    rfisByPriority,
    totalCostUncertaintyLow: missingData.reduce((s, i) => s + i.costImpactLow, 0),
    totalCostUncertaintyHigh: missingData.reduce((s, i) => s + i.costImpactHigh, 0),
    criticalItems: missingData.filter(i => i.impact === 'critical'),
    rfis,
    missingData,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Format RFI summary as human-readable report.
 */
export function formatRFIReport(summary: RFISummary): string {
  const f = (n: number) => '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const out: string[] = [];

  out.push('====================================================================');
  out.push('  RFI REGISTER & MISSING DATA REPORT');
  out.push('  Project: ' + summary.projectName);
  out.push('====================================================================');
  out.push('');
  out.push('  Missing data items: ' + summary.totalMissingItems);
  out.push('  RFIs generated: ' + summary.totalRFIs);
  out.push('  Cost uncertainty: ' + f(summary.totalCostUncertaintyLow) + ' to ' + f(summary.totalCostUncertaintyHigh));
  out.push('');

  if (summary.criticalItems.length > 0) {
    out.push('  ── CRITICAL ITEMS (require immediate attention) ──');
    for (const item of summary.criticalItems) {
      out.push('    [' + item.id + '] Div ' + item.csiDivision + ' | ' + item.description);
      out.push('      Impact: ' + f(item.costImpactLow) + ' to ' + f(item.costImpactHigh));
      if (item.assumptionUsed) out.push('      ⚠️ Assumption: ' + item.assumptionUsed);
    }
    out.push('');
  }

  out.push('  ── RFI Log ──');
  for (const rfi of summary.rfis) {
    out.push('  ' + rfi.rfiId + ' [' + rfi.priority.toUpperCase() + '] ' + rfi.status);
    out.push('    ' + rfi.subject);
    out.push('    Divisions: ' + rfi.affectedCSIDivisions.join(', ') +
      ' | Impact: ' + f(rfi.costImpactLow) + '-' + f(rfi.costImpactHigh));
  }

  out.push('');
  out.push('====================================================================');
  return out.join('\n');
}
