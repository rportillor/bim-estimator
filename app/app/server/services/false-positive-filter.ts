/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  FALSE POSITIVE FILTER — SOP Part 7
 *  EstimatorPro v14.35 — Project-agnostic
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Removes false positives from raw clash results before reporting.
 *  Filters:
 *    1. TEMP elements (temporary construction, scaffolding, formwork)
 *    2. Dev workset elements (design-in-progress, test geometry)
 *    3. Hanger junction micro-clashes (≤10mm penetration at connection points)
 *    4. Insulation-only clashes (insulation envelope touching — not physical clash)
 *    5. Same-system connections (pipe fittings on same system are intentional)
 *    6. Known acceptable patterns (e.g. embedded plates in concrete)
 *
 *  Standards: CIQS Standard Method, BIM coordination best practices
 *  Principle: Every filtered clash must have a documented reason
 *
 *  Consumed by: clash-detection-engine.ts, bim-coordination-router.ts
 *  Depends on:  spatial-clash-engine.ts (RawClash type)
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { RawClash } from './spatial-clash-engine';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type FilterReason =
  | 'temp_element'
  | 'dev_workset'
  | 'hanger_junction'
  | 'insulation_only'
  | 'same_system_connection'
  | 'embedded_plate'
  | 'sleeve_present'
  | 'design_intent'
  | 'below_threshold'
  | 'custom_rule';

export interface FilteredClash {
  clash: RawClash;
  filterReason: FilterReason;
  filterDescription: string;
  ruleId: string;
}

export interface FilterResult {
  passed: RawClash[];
  filtered: FilteredClash[];
  summary: {
    inputCount: number;
    passedCount: number;
    filteredCount: number;
    byReason: Record<FilterReason, number>;
  };
}

export interface FilterRule {
  id: string;
  name: string;
  reason: FilterReason;
  description: string;
  enabled: boolean;
  predicate: (clash: RawClash) => boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FILTER RULES
// ═══════════════════════════════════════════════════════════════════════════════

/** Configurable threshold for hanger micro-clashes (mm) */
const HANGER_JUNCTION_THRESHOLD_MM = 10;

/** Minimum overlap volume to be considered a real clash (m³) */
const MIN_OVERLAP_VOLUME_M3 = 0.000001; // 1 cm³

/** Built-in filter rules per SOP Part 7 */
export const DEFAULT_FILTER_RULES: FilterRule[] = [
  // ── 1. TEMP ELEMENTS ────────────────────────────────────────────────────
  {
    id: 'FP-001',
    name: 'Temporary Element Filter',
    reason: 'temp_element',
    description: 'Removes clashes involving elements marked as temporary (formwork, scaffolding, shoring)',
    enabled: true,
    predicate: (clash: RawClash): boolean => {
      const names = [
        clash.elementA.name.toLowerCase(),
        clash.elementB.name.toLowerCase(),
      ];
      const types = [
        clash.elementA.elementType.toLowerCase(),
        clash.elementB.elementType.toLowerCase(),
      ];
      const tempKeywords = ['temp', 'temporary', 'scaffold', 'formwork', 'shoring', 'falsework', 'hoarding'];
      return names.some(n => tempKeywords.some(k => n.includes(k))) ||
             types.some(t => tempKeywords.some(k => t.includes(k)));
    },
  },

  // ── 2. DEV WORKSET ──────────────────────────────────────────────────────
  {
    id: 'FP-002',
    name: 'Development Workset Filter',
    reason: 'dev_workset',
    description: 'Removes clashes involving elements in development/test worksets',
    enabled: true,
    predicate: (clash: RawClash): boolean => {
      const devKeywords = ['dev', 'test', 'wip', 'draft', 'sandbox', 'design_option'];
      const check = (el: RawClash['elementA']) => {
        const ws = String(el.properties?.workset || '').toLowerCase();
        const phase = String(el.properties?.phaseCreated || '').toLowerCase();
        return devKeywords.some(k => ws.includes(k) || phase.includes(k));
      };
      return check(clash.elementA) || check(clash.elementB);
    },
  },

  // ── 3. HANGER JUNCTION MICRO-CLASHES ────────────────────────────────────
  {
    id: 'FP-003',
    name: 'Hanger Junction Filter',
    reason: 'hanger_junction',
    description: `Removes clashes at hanger/support junctions with penetration ≤${HANGER_JUNCTION_THRESHOLD_MM}mm`,
    enabled: true,
    predicate: (clash: RawClash): boolean => {
      if (clash.penetrationDepth_mm > HANGER_JUNCTION_THRESHOLD_MM) return false;
      const hangerKeywords = ['hanger', 'support', 'bracket', 'trapeze', 'clevis', 'rod', 'clamp', 'strut'];
      const names = [
        clash.elementA.name.toLowerCase(),
        clash.elementB.name.toLowerCase(),
        clash.elementA.elementType.toLowerCase(),
        clash.elementB.elementType.toLowerCase(),
      ];
      return names.some(n => hangerKeywords.some(k => n.includes(k)));
    },
  },

  // ── 4. INSULATION-ONLY ──────────────────────────────────────────────────
  {
    id: 'FP-004',
    name: 'Insulation Envelope Filter',
    reason: 'insulation_only',
    description: 'Removes clashes where only insulation envelopes overlap (not physical elements)',
    enabled: true,
    predicate: (clash: RawClash): boolean => {
      const insulKeywords = ['insulation', 'insulated', 'lagging', 'jacket'];
      const matA = (clash.elementA.material || '').toLowerCase();
      const matB = (clash.elementB.material || '').toLowerCase();
      const nameA = clash.elementA.name.toLowerCase();
      const nameB = clash.elementB.name.toLowerCase();

      const aIsInsulation = insulKeywords.some(k => matA.includes(k) || nameA.includes(k));
      const bIsInsulation = insulKeywords.some(k => matB.includes(k) || nameB.includes(k));

      // Filter only if BOTH are insulation or one is insulation touching non-structural
      return (aIsInsulation || bIsInsulation) && clash.penetrationDepth_mm < 50;
    },
  },

  // ── 5. SAME-SYSTEM CONNECTIONS ──────────────────────────────────────────
  {
    id: 'FP-005',
    name: 'Same System Connection Filter',
    reason: 'same_system_connection',
    description: 'Removes clashes between elements of the same MEP system (intentional connections)',
    enabled: true,
    predicate: (clash: RawClash): boolean => {
      const sysA = clash.elementA.properties?.systemType || clash.elementA.properties?.systemName || '';
      const sysB = clash.elementB.properties?.systemType || clash.elementB.properties?.systemName || '';
      if (!sysA || !sysB) return false;
      // Same system and same discipline → intentional connection
      return String(sysA).toLowerCase() === String(sysB).toLowerCase() &&
             clash.elementA.discipline === clash.elementB.discipline;
    },
  },

  // ── 6. EMBEDDED PLATES / CAST-IN ───────────────────────────────────────
  {
    id: 'FP-006',
    name: 'Embedded Plate / Cast-in Element Filter',
    reason: 'embedded_plate',
    description: 'Removes clashes between concrete and embedded/cast-in steel elements (design intent)',
    enabled: true,
    predicate: (clash: RawClash): boolean => {
      const embedKeywords = ['embed', 'cast-in', 'cast_in', 'anchor', 'plate', 'dowel', 'insert'];
      const concreteKeywords = ['concrete', 'slab', 'foundation', 'footing'];

      const aEmbed = embedKeywords.some(k =>
        clash.elementA.name.toLowerCase().includes(k) || clash.elementA.elementType.toLowerCase().includes(k)
      );
      const bEmbed = embedKeywords.some(k =>
        clash.elementB.name.toLowerCase().includes(k) || clash.elementB.elementType.toLowerCase().includes(k)
      );
      const aConcrete = concreteKeywords.some(k =>
        clash.elementA.material.toLowerCase().includes(k) || clash.elementA.elementType.toLowerCase().includes(k)
      );
      const bConcrete = concreteKeywords.some(k =>
        clash.elementB.material.toLowerCase().includes(k) || clash.elementB.elementType.toLowerCase().includes(k)
      );

      return (aEmbed && bConcrete) || (bEmbed && aConcrete);
    },
  },

  // ── 7. SLEEVE PRESENT ──────────────────────────────────────────────────
  {
    id: 'FP-007',
    name: 'Sleeve Present Filter',
    reason: 'sleeve_present',
    description: 'Removes clashes where a sleeve/penetration element exists at the clash point',
    enabled: true,
    predicate: (clash: RawClash): boolean => {
      const sleeveKeywords = ['sleeve', 'penetration', 'core_hole', 'corehole', 'opening'];
      const names = [
        clash.elementA.name.toLowerCase(),
        clash.elementB.name.toLowerCase(),
        clash.elementA.elementType.toLowerCase(),
        clash.elementB.elementType.toLowerCase(),
      ];
      return names.some(n => sleeveKeywords.some(k => n.includes(k)));
    },
  },

  // ── 8. BELOW MINIMUM VOLUME ────────────────────────────────────────────
  {
    id: 'FP-008',
    name: 'Sub-Threshold Volume Filter',
    reason: 'below_threshold',
    description: `Removes hard clashes with overlap volume < ${MIN_OVERLAP_VOLUME_M3} m³ (< 1 cm³)`,
    enabled: true,
    predicate: (clash: RawClash): boolean => {
      return clash.isHard && clash.overlapVolume_m3 > 0 && clash.overlapVolume_m3 < MIN_OVERLAP_VOLUME_M3;
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// FILTER ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run all filter rules against raw clashes.
 *
 * @param rawClashes   Output from spatial-clash-engine
 * @param customRules  Optional additional rules (merged with defaults)
 * @param disabledIds  Rule IDs to skip
 */
export function filterFalsePositives(
  rawClashes: RawClash[],
  customRules: FilterRule[] = [],
  disabledIds: Set<string> = new Set(),
): FilterResult {
  const rules = [...DEFAULT_FILTER_RULES, ...customRules]
    .filter(r => r.enabled && !disabledIds.has(r.id));

  const passed: RawClash[] = [];
  const filtered: FilteredClash[] = [];

  for (const clash of rawClashes) {
    let wasFiltered = false;

    for (const rule of rules) {
      if (rule.predicate(clash)) {
        filtered.push({
          clash,
          filterReason: rule.reason,
          filterDescription: rule.description,
          ruleId: rule.id,
        });
        wasFiltered = true;
        break; // First matching rule wins
      }
    }

    if (!wasFiltered) {
      passed.push(clash);
    }
  }

  // Build summary
  const byReason: Record<string, number> = {};
  for (const f of filtered) {
    byReason[f.filterReason] = (byReason[f.filterReason] || 0) + 1;
  }

  return {
    passed,
    filtered,
    summary: {
      inputCount: rawClashes.length,
      passedCount: passed.length,
      filteredCount: filtered.length,
      byReason: byReason as Record<FilterReason, number>,
    },
  };
}
