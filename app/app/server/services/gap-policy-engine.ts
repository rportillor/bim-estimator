/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  GAP POLICY ENGINE — SOP Appendix
 *  EstimatorPro v14.35 — Project-agnostic; projectName must be passed by caller
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Enforces the fundamental QS principle: NO DEFAULT VALUES.
 *  When data is missing, this engine:
 *    1. Detects missing parameters against discipline requirements
 *    2. Flags as LOW confidence (never fills in a default)
 *    3. Generates formal RFI or Action Item
 *    4. Maintains a gap register with traceability
 *    5. Tracks gap closure lifecycle
 *
 *  The gap policy applies to:
 *    - Clearance tolerances (null tolerance_mm in clash templates)
 *    - Material properties (placeholder/empty material assignments)
 *    - Fire ratings (required but missing on fire-rated assemblies)
 *    - SystemType (required for all MEP elements)
 *    - Any parameter defined as required in discipline-sop.ts
 *
 *  Standards: CIQS Standard Method, ISO 19650 (information requirements)
 *  Consumed by: All SOP modules, bim-coordination-router.ts
 *  Depends on:  discipline-sop.ts, bep-rules-engine.ts, issue-log.ts
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { DisciplineCode } from './discipline-sop';
import type { ConfidenceLevel } from './types';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type GapSource =
  | 'clearance_tolerance'
  | 'material_property'
  | 'fire_rating'
  | 'system_type'
  | 'metadata_parameter'
  | 'specification_reference'
  | 'code_requirement'
  | 'drawing_dimension'
  | 'product_data'
  | 'schedule_data';

export type GapAction = 'RFI' | 'ACTION_ITEM' | 'DESIGNER_QUERY' | 'SITE_VERIFY' | 'ASSUME_AND_FLAG';

export type GapLifecycle = 'DETECTED' | 'RFI_ISSUED' | 'RESPONSE_RECEIVED' | 'CLOSED' | 'DEFERRED';

export interface GapRecord {
  id: string;
  source: GapSource;
  discipline: DisciplineCode | 'ALL';
  parameter: string;               // Which parameter is missing
  elementId: string | null;        // Specific element or null for global gap
  elementName: string | null;
  level: string | null;
  zone: string | null;
  description: string;
  impact: string;                  // What happens because of this gap
  confidenceWithGap: ConfidenceLevel;
  requiredAction: GapAction;
  actionDescription: string;
  rfiNumber: string | null;        // If RFI was generated
  lifecycle: GapLifecycle;
  detectedDate: string;
  resolvedDate: string | null;
  resolvedValue: string | null;    // The actual value once the gap is filled
  evidenceRef: string | null;      // Document/drawing reference for the resolution
}

export interface GapRegister {
  projectName: string;
  generatedDate: string;
  gaps: GapRecord[];
  summary: {
    total: number;
    bySource: Record<GapSource, number>;
    byLifecycle: Record<GapLifecycle, number>;
    byDiscipline: Record<string, number>;
    rfisGenerated: number;
    closedCount: number;
    openCount: number;
    closureRate: number;
  };
}

export interface GapDetectionInput {
  elementId: string;
  elementName: string;
  discipline: DisciplineCode;
  level: string;
  zone: string;
  properties: Record<string, any>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GAP DETECTION RULES
// ═══════════════════════════════════════════════════════════════════════════════

interface GapDetectionRule {
  id: string;
  parameter: string;
  source: GapSource;
  appliesTo: DisciplineCode[] | 'ALL';
  check: (props: Record<string, any>) => boolean;  // Returns TRUE if gap exists
  impact: string;
  requiredAction: GapAction;
  actionTemplate: string;
}

const PLACEHOLDER_PATTERNS = [
  /^by category$/i, /^default$/i, /^<by category>$/i, /^<default>$/i,
  /^none$/i, /^n\/a$/i, /^tbd$/i, /^placeholder$/i, /^unknown$/i, /^$/,
];

function isPlaceholder(value: any): boolean {
  if (value === null || value === undefined) return true;
  const str = String(value).trim();
  if (str.length === 0) return true;
  return PLACEHOLDER_PATTERNS.some(p => p.test(str));
}

const GAP_RULES: GapDetectionRule[] = [
  {
    id: 'GAP-MAT-01',
    parameter: 'Material',
    source: 'material_property',
    appliesTo: ['STR', 'ARC'],
    check: (p) => isPlaceholder(p.Material || p.material),
    impact: 'Cannot determine material takeoff quantities or cost — BOQ line items will have LOW confidence',
    requiredAction: 'RFI',
    actionTemplate: 'Provide material specification for {elementName} at {level}. Current value: "{currentValue}"',
  },
  {
    id: 'GAP-FR-01',
    parameter: 'Fire_Rating',
    source: 'fire_rating',
    appliesTo: ['ARC'],
    check: (p) => {
      const val = p.Fire_Rating || p.fireRating || p.fire_rating;
      return isPlaceholder(val);
    },
    impact: 'Cannot verify fire compartment integrity — life-safety compliance unknown',
    requiredAction: 'RFI',
    actionTemplate: 'Provide fire rating for {elementName} at {level}. Required per NBC 3.1.8 / OBC 3.2.6',
  },
  {
    id: 'GAP-SYS-01',
    parameter: 'SystemType',
    source: 'system_type',
    appliesTo: ['MECH', 'PLBG', 'FP', 'ELEC'],
    check: (p) => isPlaceholder(p.SystemType || p.systemType),
    impact: 'Cannot assign element to correct system for clash testing and BOQ grouping',
    requiredAction: 'ACTION_ITEM',
    actionTemplate: 'Assign SystemType for {elementName} at {level}. Element currently has no system assignment.',
  },
  {
    id: 'GAP-LVL-01',
    parameter: 'Level',
    source: 'metadata_parameter',
    appliesTo: 'ALL',
    check: (p) => isPlaceholder(p.Level || p.level || p.storey),
    impact: 'Cannot assign element to correct level for quantity takeoff and coordination',
    requiredAction: 'ACTION_ITEM',
    actionTemplate: 'Assign correct level for {elementName}. Element has no level assignment.',
  },
  {
    id: 'GAP-SPEC-01',
    parameter: 'Specification_Section',
    source: 'specification_reference',
    appliesTo: 'ALL',
    check: (p) => isPlaceholder(p.Specification_Section || p.specSection),
    impact: 'Cannot link element to specification for product verification and cost data',
    requiredAction: 'DESIGNER_QUERY',
    actionTemplate: 'Provide specification section reference for {elementName}.',
  },
  {
    id: 'GAP-CONC-01',
    parameter: 'Concrete_Strength',
    source: 'material_property',
    appliesTo: ['STR'],
    check: (p) => {
      const val = p.Concrete_Strength || p.concreteStrength || p.concrete_strength;
      return isPlaceholder(val) || (val !== undefined && isNaN(Number(val)));
    },
    impact: 'Cannot verify structural capacity or determine concrete mix cost',
    requiredAction: 'RFI',
    actionTemplate: 'Provide concrete compressive strength (MPa) for {elementName} per CSA A23.3',
  },
  {
    id: 'GAP-REBAR-01',
    parameter: 'Rebar_Grade',
    source: 'material_property',
    appliesTo: ['STR'],
    check: (p) => isPlaceholder(p.Rebar_Grade || p.rebarGrade || p.rebar_grade),
    impact: 'Cannot determine rebar unit cost or verify CSA G30.18 compliance',
    requiredAction: 'RFI',
    actionTemplate: 'Provide reinforcement grade for {elementName} per CSA G30.18',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// GAP DETECTION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

let gapCounter = 0;

/**
 * Detect all gaps in a single element against discipline rules.
 */
export function detectElementGaps(input: GapDetectionInput): GapRecord[] {
  const gaps: GapRecord[] = [];

  for (const rule of GAP_RULES) {
    if (rule.appliesTo !== 'ALL' && !rule.appliesTo.includes(input.discipline)) continue;

    if (rule.check(input.properties)) {
      gapCounter++;
      const currentValue = input.properties[rule.parameter] || '(empty)';

      gaps.push({
        id: `GAP-${String(gapCounter).padStart(5, '0')}`,
        source: rule.source,
        discipline: input.discipline,
        parameter: rule.parameter,
        elementId: input.elementId,
        elementName: input.elementName,
        level: input.level,
        zone: input.zone,
        description: `Missing ${rule.parameter} for ${input.elementName}`,
        impact: rule.impact,
        confidenceWithGap: 'LOW',
        requiredAction: rule.requiredAction,
        actionDescription: rule.actionTemplate
          .replace('{elementName}', input.elementName)
          .replace('{level}', input.level || 'unknown')
          .replace('{currentValue}', String(currentValue)),
        rfiNumber: null,
        lifecycle: 'DETECTED',
        detectedDate: new Date().toISOString(),
        resolvedDate: null,
        resolvedValue: null,
        evidenceRef: null,
      });
    }
  }

  return gaps;
}

/**
 * Detect gaps across a batch of elements.
 */
export function detectBatchGaps(inputs: GapDetectionInput[]): GapRecord[] {
  const allGaps: GapRecord[] = [];
  for (const input of inputs) {
    allGaps.push(...detectElementGaps(input));
  }
  return allGaps;
}

/**
 * Create a gap for a missing clearance tolerance (from clash test templates).
 */
export function createToleranceGap(
  testId: string,
  testName: string,
  parameterName: string,
): GapRecord {
  gapCounter++;
  return {
    id: `GAP-${String(gapCounter).padStart(5, '0')}`,
    source: 'clearance_tolerance',
    discipline: 'ALL',
    parameter: parameterName,
    elementId: null,
    elementName: null,
    level: null,
    zone: null,
    description: `Missing clearance tolerance for test ${testId}: ${testName}`,
    impact: 'Clash test will use 0mm tolerance (overly conservative) — results may include false positives',
    confidenceWithGap: 'LOW',
    requiredAction: 'RFI',
    actionDescription: `Provide ${parameterName} clearance requirement per project specifications for ${testName}`,
    rfiNumber: null,
    lifecycle: 'DETECTED',
    detectedDate: new Date().toISOString(),
    resolvedDate: null,
    resolvedValue: null,
    evidenceRef: null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GAP REGISTER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a full gap register from detected gaps.
 */
export function buildGapRegister(
  gaps: GapRecord[],
  projectName: string = '',
): GapRegister {
  const bySource: Record<string, number> = {};
  const byLifecycle: Record<string, number> = {};
  const byDiscipline: Record<string, number> = {};

  for (const g of gaps) {
    bySource[g.source] = (bySource[g.source] || 0) + 1;
    byLifecycle[g.lifecycle] = (byLifecycle[g.lifecycle] || 0) + 1;
    byDiscipline[g.discipline] = (byDiscipline[g.discipline] || 0) + 1;
  }

  const closedCount = gaps.filter(g => g.lifecycle === 'CLOSED').length;
  const openCount = gaps.filter(g => g.lifecycle !== 'CLOSED' && g.lifecycle !== 'DEFERRED').length;

  return {
    projectName,
    generatedDate: new Date().toISOString(),
    gaps,
    summary: {
      total: gaps.length,
      bySource: bySource as Record<GapSource, number>,
      byLifecycle: byLifecycle as Record<GapLifecycle, number>,
      byDiscipline,
      rfisGenerated: gaps.filter(g => g.rfiNumber !== null).length,
      closedCount,
      openCount,
      closureRate: gaps.length > 0 ? Math.round((closedCount / gaps.length) * 100) : 100,
    },
  };
}

/**
 * Resolve a gap with an actual value and evidence.
 */
export function resolveGap(
  gap: GapRecord,
  resolvedValue: string,
  evidenceRef: string,
): GapRecord {
  return {
    ...gap,
    lifecycle: 'CLOSED',
    resolvedDate: new Date().toISOString(),
    resolvedValue,
    evidenceRef,
    confidenceWithGap: 'HIGH',
  };
}
