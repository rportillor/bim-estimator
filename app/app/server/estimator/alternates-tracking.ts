// server/estimator/alternates-tracking.ts
// =============================================================================
// ALTERNATES TRACKING
// =============================================================================
//
// Master Priority Item #26
//
// Purpose:
//   1. Track bid alternates (add/deduct) per CCDC 3 tender documents
//   2. Compare base bid vs alternate scenarios
//   3. Calculate cumulative impact of alternate combinations
//   4. Support value engineering (VE) alternates
//   5. Track alternate status through decision lifecycle
//   6. Generate alternate summary for tender/bid documents
//   7. Map alternates to affected CSI divisions and WBS elements
//
// Standards: CCDC 3 (Stipulated Price Tender), CCDC 10 (Tender Call),
//            CIQS estimating practices
// =============================================================================

import type { EstimateSummary } from './estimate-engine';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export type AlternateType = 'add' | 'deduct' | 'substitution';
export type AlternateStatus = 'proposed' | 'included-in-tender' | 'accepted' | 'rejected' | 'deferred' | 'withdrawn';
export type AlternateOrigin = 'owner-requested' | 'architect-recommended' | 'contractor-proposed' | 'value-engineering' | 'budget-driven';

export interface AlternateItem {
  alternateId: string;             // e.g., "ALT-001", "ALT-002"
  alternateNumber: number;         // Sequential number
  name: string;                    // Short name
  description: string;             // Full description of the alternate
  type: AlternateType;
  origin: AlternateOrigin;
  status: AlternateStatus;

  // Scope
  affectedCSIDivisions: string[];  // Which divisions are impacted
  affectedFloors?: string[];       // Which floors
  wbsCodes?: string[];             // WBS elements affected
  drawingRefs?: string[];          // Drawing references
  specRefs?: string[];             // Spec section references

  // Cost
  baseBidCost: number;             // Cost of base bid scope being replaced
  alternateCost: number;           // Cost of alternate scope
  netImpact: number;               // Alternate - base (positive = add, negative = deduct)

  // L/M/E breakdown of net impact
  laborImpact: number;
  materialImpact: number;
  equipmentImpact: number;

  // Schedule
  scheduleImpactDays?: number;     // Positive = adds time, negative = saves time
  leadTimeWeeks?: number;          // Procurement lead time for alternate materials

  // Quality/Performance
  qualityImpact?: string;          // Description of quality difference
  performanceNotes?: string;
  lifeCycleImpact?: string;        // 20-year cost difference if applicable

  // Decision tracking
  proposedDate: string;
  decisionDate?: string;
  decidedBy?: string;
  decisionRationale?: string;
}

export interface AlternateScenario {
  scenarioId: string;
  scenarioName: string;            // e.g., "Budget Option", "Premium Option"
  description: string;
  includedAlternates: string[];    // Alternate IDs included in this scenario
  baseBidTotal: number;
  totalAdditions: number;
  totalDeductions: number;
  netAdjustment: number;
  scenarioTotal: number;
  scheduleImpactDays: number;
}

export interface AlternateSummary {
  projectName: string;
  baseBidTotal: number;
  totalAlternates: number;
  alternatesByType: Record<AlternateType, number>;
  alternatesByStatus: Record<string, number>;
  totalAdds: number;
  totalDeducts: number;
  netAlternatesValue: number;      // If all accepted
  alternates: AlternateItem[];
  scenarios: AlternateScenario[];
  generatedAt: string;
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Create an alternate with auto-calculated net impact.
 */
export function createAlternate(
  input: Omit<AlternateItem, 'netImpact'>
): AlternateItem {
  return {
    ...input,
    netImpact: input.alternateCost - input.baseBidCost,
  };
}

/**
 * Build an alternate scenario from a selection of alternates.
 */
export function buildScenario(
  scenarioId: string,
  scenarioName: string,
  description: string,
  alternateIds: string[],
  allAlternates: AlternateItem[],
  baseBidTotal: number
): AlternateScenario {
  const included = allAlternates.filter(a => alternateIds.includes(a.alternateId));

  let totalAdds = 0;
  let totalDeducts = 0;
  let scheduleDays = 0;

  for (const alt of included) {
    if (alt.netImpact > 0) totalAdds += alt.netImpact;
    else totalDeducts += alt.netImpact;
    scheduleDays += alt.scheduleImpactDays || 0;
  }

  return {
    scenarioId,
    scenarioName,
    description,
    includedAlternates: alternateIds,
    baseBidTotal,
    totalAdditions: Math.round(totalAdds * 100) / 100,
    totalDeductions: Math.round(totalDeducts * 100) / 100,
    netAdjustment: Math.round((totalAdds + totalDeducts) * 100) / 100,
    scenarioTotal: Math.round((baseBidTotal + totalAdds + totalDeducts) * 100) / 100,
    scheduleImpactDays: scheduleDays,
  };
}

/**
 * Generate common VE alternates for a building project.
 * These are typical alternates that appear on most ICI projects.
 */
export function generateCommonVEAlternates(
  baseBidTotal: number,
  projectType: string
): AlternateItem[] {
  const now = new Date().toISOString();
  const alternates: AlternateItem[] = [];
  let num = 1;

  const alt = (name: string, desc: string, type: AlternateType, divisions: string[],
    baseCost: number, altCost: number, schedule?: number): AlternateItem => {
    const id = 'ALT-' + String(num).padStart(3, '0');
    num++;
    const net = altCost - baseCost;
    return {
      alternateId: id, alternateNumber: num - 1, name, description: desc,
      type, origin: 'value-engineering', status: 'proposed',
      affectedCSIDivisions: divisions,
      baseBidCost: baseCost, alternateCost: altCost, netImpact: net,
      laborImpact: Math.round(net * 0.40 * 100) / 100,
      materialImpact: Math.round(net * 0.50 * 100) / 100,
      equipmentImpact: Math.round(net * 0.10 * 100) / 100,
      scheduleImpactDays: schedule,
      proposedDate: now,
    };
  };

  // Envelope alternates
  alternates.push(alt(
    'Exterior cladding substitution',
    'Substitute specified architectural precast with insulated metal panel system',
    'deduct', ['07'], baseBidTotal * 0.08, baseBidTotal * 0.06, -10));

  alternates.push(alt(
    'Glazing system downgrade',
    'Replace triple-glazed curtain wall with high-performance double-glazed system',
    'deduct', ['08'], baseBidTotal * 0.06, baseBidTotal * 0.045));

  // Mechanical alternates
  alternates.push(alt(
    'VRF system substitution',
    'Replace conventional VAV HVAC with variable refrigerant flow (VRF) system',
    'substitution', ['23'], baseBidTotal * 0.12, baseBidTotal * 0.105, -15));

  alternates.push(alt(
    'Geothermal heating',
    'Add ground-source heat pump system for heating/cooling',
    'add', ['23','31'], 0, baseBidTotal * 0.04, 20));

  // Finishes alternates
  alternates.push(alt(
    'Flooring downgrade',
    'Substitute porcelain tile with polished concrete in common areas',
    'deduct', ['09'], baseBidTotal * 0.03, baseBidTotal * 0.015, -5));

  alternates.push(alt(
    'Ceiling system simplification',
    'Replace custom acoustic ceiling with standard suspended T-bar',
    'deduct', ['09'], baseBidTotal * 0.02, baseBidTotal * 0.012));

  // Structural alternates
  alternates.push(alt(
    'Post-tensioned slabs',
    'Replace conventional reinforced slabs with post-tensioned system',
    'substitution', ['03'], baseBidTotal * 0.10, baseBidTotal * 0.09, -20));

  // Sitework alternates
  alternates.push(alt(
    'Permeable paving',
    'Replace conventional asphalt parking with permeable pavers (stormwater credit)',
    'add', ['32'], baseBidTotal * 0.015, baseBidTotal * 0.022, 5));

  return alternates;
}

/**
 * Generate complete alternates summary with scenarios.
 */
export function generateAlternateSummary(
  alternates: AlternateItem[],
  baseBidTotal: number,
  projectName: string
): AlternateSummary {
  const byType: Record<AlternateType, number> = { add: 0, deduct: 0, substitution: 0 };
  const byStatus: Record<string, number> = {};
  let totalAdds = 0;
  let totalDeducts = 0;

  for (const alt of alternates) {
    byType[alt.type]++;
    byStatus[alt.status] = (byStatus[alt.status] || 0) + 1;
    if (alt.netImpact > 0) totalAdds += alt.netImpact;
    else totalDeducts += alt.netImpact;
  }

  // Auto-generate three standard scenarios
  const addIds = alternates.filter(a => a.type === 'add').map(a => a.alternateId);
  const deductIds = alternates.filter(a => a.type === 'deduct' || (a.type === 'substitution' && a.netImpact < 0)).map(a => a.alternateId);
  const allIds = alternates.map(a => a.alternateId);

  const scenarios: AlternateScenario[] = [
    buildScenario('SCN-BUDGET', 'Budget Option', 'Accept all deducts and value-saving substitutions', deductIds, alternates, baseBidTotal),
    buildScenario('SCN-BASE', 'Base Bid', 'No alternates accepted', [], alternates, baseBidTotal),
    buildScenario('SCN-PREMIUM', 'Premium Option', 'Accept all add alternates', addIds, alternates, baseBidTotal),
  ];

  return {
    projectName,
    baseBidTotal,
    totalAlternates: alternates.length,
    alternatesByType: byType,
    alternatesByStatus: byStatus,
    totalAdds: Math.round(totalAdds * 100) / 100,
    totalDeducts: Math.round(totalDeducts * 100) / 100,
    netAlternatesValue: Math.round((totalAdds + totalDeducts) * 100) / 100,
    alternates,
    scenarios,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Format alternates summary as report.
 */
export function formatAlternatesReport(summary: AlternateSummary): string {
  const f = (n: number) => '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const out: string[] = [];

  out.push('====================================================================');
  out.push('  ALTERNATES & VALUE ENGINEERING REGISTER');
  out.push('  Project: ' + summary.projectName);
  out.push('====================================================================');
  out.push('');
  out.push('  Base bid: ' + f(summary.baseBidTotal));
  out.push('  Alternates: ' + summary.totalAlternates + ' (Add: ' + summary.alternatesByType.add +
    ', Deduct: ' + summary.alternatesByType.deduct + ', Substitution: ' + summary.alternatesByType.substitution + ')');
  out.push('  Total adds: ' + f(summary.totalAdds) + ' | Total deducts: ' + f(summary.totalDeducts));
  out.push('  Net if all accepted: ' + f(summary.netAlternatesValue));
  out.push('');

  out.push('  ── Alternates ──');
  for (const alt of summary.alternates) {
    const sign = alt.netImpact >= 0 ? '+' : '';
    out.push('  ' + alt.alternateId + ' [' + alt.type.toUpperCase() + '] ' + alt.name);
    out.push('    ' + alt.description);
    out.push('    Base: ' + f(alt.baseBidCost) + ' → Alt: ' + f(alt.alternateCost) +
      ' = ' + sign + f(alt.netImpact));
    if (alt.scheduleImpactDays) {
      const sDays = alt.scheduleImpactDays > 0 ? '+' + alt.scheduleImpactDays : String(alt.scheduleImpactDays);
      out.push('    Schedule: ' + sDays + ' days');
    }
    out.push('    Status: ' + alt.status + ' | Divisions: ' + alt.affectedCSIDivisions.join(', '));
  }
  out.push('');

  out.push('  ── Scenarios ──');
  for (const scn of summary.scenarios) {
    out.push('  ' + scn.scenarioName + ': ' + f(scn.scenarioTotal) +
      ' (net ' + (scn.netAdjustment >= 0 ? '+' : '') + f(scn.netAdjustment) + ')');
    if (scn.scheduleImpactDays !== 0) {
      out.push('    Schedule impact: ' + (scn.scheduleImpactDays > 0 ? '+' : '') + scn.scheduleImpactDays + ' days');
    }
  }

  out.push('');
  out.push('====================================================================');
  return out.join('\n');
}
