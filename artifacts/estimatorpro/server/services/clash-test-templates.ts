/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  CLASH TEST TEMPLATES — SOP Part 7, Tables 2 & 3
 *  EstimatorPro v14.35 — Project-agnostic
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Defines:
 *    1. Selection sets (Table 2) — which element categories to include/exclude
 *       per discipline, with primary rules and fallback filters
 *    2. Clash test templates (Table 3) — CD-001 Hard, SC-01/02/03 Soft,
 *       AC-001/002 Code/Access — with tolerances
 *    3. Template registry for runtime lookup
 *
 *  Standards: CIQS Standard Method, CSI MasterFormat 2018, NBC 2020, OBC 2024
 *  Principle: Tolerances from project specs or user input — never hardcoded defaults.
 *             If a tolerance is null the engine must flag a GAP / RFI.
 *
 *  Consumed by:  spatial-clash-engine.ts, clash-detection-engine.ts
 *  Author:       EstimatorPro AI QS Engine
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { Discipline, ClashCategory, ClashSeverity } from './clash-detection-engine';
import type { EvidenceReference } from './types';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. SELECTION SET DEFINITIONS (Table 2)
// ═══════════════════════════════════════════════════════════════════════════════

/** Filter rule for building a selection set */
export interface SelectionRule {
  field: string;                 // Element property to match, e.g. 'category', 'csiDivision', 'discipline'
  operator: 'eq' | 'neq' | 'in' | 'not_in' | 'startsWith' | 'contains' | 'regex';
  value: string | string[];
  description: string;
}

/** A named selection set that resolves to a filtered list of BIM elements */
export interface SelectionSet {
  id: string;                    // e.g. 'SS-STR-01'
  name: string;                  // e.g. 'Structural — All Load-Bearing'
  discipline: Discipline;
  description: string;
  primaryRules: SelectionRule[];  // AND-combined
  fallbackRules: SelectionRule[]; // Used if primary yields < minElements
  excludeRules: SelectionRule[];  // Always excluded (TEMP, dev worksets, etc.)
  minElements: number;           // Minimum expected; below → warning
}

/** Pre-defined selection sets per Table 2 of the SOP */
export const SELECTION_SETS: SelectionSet[] = [
  // ── STRUCTURAL ───────────────────────────────────────────────────────────
  {
    id: 'SS-STR-01',
    name: 'Structural — All Load-Bearing',
    discipline: 'structural',
    description: 'Columns, beams, slabs, walls, foundations, bracing — CSI Div 03-05',
    primaryRules: [
      { field: 'discipline', operator: 'eq', value: 'structural', description: 'Discipline = structural' },
    ],
    fallbackRules: [
      { field: 'csiDivision', operator: 'in', value: ['03', '04', '05'], description: 'CSI Div 03-05' },
      { field: 'category', operator: 'in', value: ['Column', 'Beam', 'Slab', 'Wall', 'Foundation', 'Brace'], description: 'Category fallback' },
    ],
    excludeRules: [
      { field: 'name', operator: 'contains', value: 'TEMP', description: 'Exclude temporary elements' },
      { field: 'properties.workset', operator: 'contains', value: 'DEV', description: 'Exclude dev worksets' },
    ],
    minElements: 5,
  },

  // ── ARCHITECTURAL ────────────────────────────────────────────────────────
  {
    id: 'SS-ARC-01',
    name: 'Architectural — Envelope & Partitions',
    discipline: 'architectural',
    description: 'Ext/int walls, doors, windows, ceilings, floors, roofs — CSI Div 06-09',
    primaryRules: [
      { field: 'discipline', operator: 'eq', value: 'architectural', description: 'Discipline = architectural' },
    ],
    fallbackRules: [
      { field: 'csiDivision', operator: 'in', value: ['06', '07', '08', '09'], description: 'CSI Div 06-09' },
      { field: 'category', operator: 'in', value: ['Wall', 'Door', 'Window', 'Ceiling', 'Floor', 'Roof', 'Curtain Wall'], description: 'Category fallback' },
    ],
    excludeRules: [
      { field: 'name', operator: 'contains', value: 'TEMP', description: 'Exclude temporary' },
    ],
    minElements: 3,
  },

  // ── MECHANICAL (HVAC) ───────────────────────────────────────────────────
  {
    id: 'SS-MECH-01',
    name: 'Mechanical — HVAC Ductwork & Equipment',
    discipline: 'mechanical',
    description: 'Ducts, diffusers, AHUs, VAVs, dampers — CSI Div 23',
    primaryRules: [
      { field: 'discipline', operator: 'eq', value: 'mechanical', description: 'Discipline = mechanical' },
    ],
    fallbackRules: [
      { field: 'csiDivision', operator: 'eq', value: '23', description: 'CSI Div 23' },
      { field: 'category', operator: 'in', value: ['Duct', 'Duct Fitting', 'Mechanical Equipment', 'Air Terminal', 'Flex Duct'], description: 'Category fallback' },
    ],
    excludeRules: [
      { field: 'name', operator: 'contains', value: 'TEMP', description: 'Exclude temporary' },
    ],
    minElements: 1,
  },

  // ── PLUMBING ─────────────────────────────────────────────────────────────
  {
    id: 'SS-PLBG-01',
    name: 'Plumbing — Piping & Fixtures',
    discipline: 'plumbing',
    description: 'Pipes, fittings, fixtures, drains, vents — CSI Div 22',
    primaryRules: [
      { field: 'discipline', operator: 'eq', value: 'plumbing', description: 'Discipline = plumbing' },
    ],
    fallbackRules: [
      { field: 'csiDivision', operator: 'eq', value: '22', description: 'CSI Div 22' },
      { field: 'category', operator: 'in', value: ['Pipe', 'Pipe Fitting', 'Plumbing Fixture', 'Pipe Accessory'], description: 'Category fallback' },
    ],
    excludeRules: [],
    minElements: 1,
  },

  // ── FIRE PROTECTION ─────────────────────────────────────────────────────
  {
    id: 'SS-FP-01',
    name: 'Fire Protection — Sprinklers & Standpipes',
    discipline: 'fire_protection',
    description: 'Sprinkler pipes, heads, standpipes, FHCs — CSI Div 21',
    primaryRules: [
      { field: 'discipline', operator: 'eq', value: 'fire_protection', description: 'Discipline = fire_protection' },
    ],
    fallbackRules: [
      { field: 'csiDivision', operator: 'eq', value: '21', description: 'CSI Div 21' },
      { field: 'category', operator: 'in', value: ['Sprinkler', 'Pipe', 'Pipe Fitting'], description: 'Category fallback for FP' },
    ],
    excludeRules: [],
    minElements: 1,
  },

  // ── ELECTRICAL ──────────────────────────────────────────────────────────
  {
    id: 'SS-ELEC-01',
    name: 'Electrical — Conduit, Cable Tray, Equipment',
    discipline: 'electrical',
    description: 'Conduit, cable trays, panels, switchgear, transformers — CSI Div 26',
    primaryRules: [
      { field: 'discipline', operator: 'eq', value: 'electrical', description: 'Discipline = electrical' },
    ],
    fallbackRules: [
      { field: 'csiDivision', operator: 'in', value: ['26', '27', '28'], description: 'CSI Div 26-28' },
      { field: 'category', operator: 'in', value: ['Conduit', 'Cable Tray', 'Electrical Equipment', 'Electrical Fixture', 'Lighting Fixture'], description: 'Category fallback' },
    ],
    excludeRules: [],
    minElements: 1,
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// 2. CLASH TEST TEMPLATE DEFINITIONS (Table 3)
// ═══════════════════════════════════════════════════════════════════════════════

/** A single clash test that pairs two selection sets with rules */
export interface ClashTestTemplate {
  id: string;                      // e.g. 'CD-001', 'SC-01', 'AC-001'
  name: string;
  description: string;
  category: ClashCategory;
  setA: string;                    // SelectionSet ID
  setB: string;                    // SelectionSet ID
  selfTest: boolean;               // true = test within same set
  tolerance_mm: number | null;     // null → must come from spec/user → GAP if missing
  toleranceSource: EvidenceReference | null;
  defaultSeverity: ClashSeverity;
  severityOverrides: SeverityOverrideRule[];
  enabled: boolean;
  codeReferences: string[];        // e.g. ['NBC 3.2.5.7', 'OBC 9.10.15.5']
  notes: string;
}

/** Override severity based on element properties */
export interface SeverityOverrideRule {
  condition: string;               // Human-readable description
  field: string;                   // Property path on clashing element
  operator: 'eq' | 'in' | 'gt' | 'lt' | 'contains';
  value: string | number | string[];
  overrideSeverity: ClashSeverity;
}

/** Pre-defined test templates per Table 3 */
export const CLASH_TEST_TEMPLATES: ClashTestTemplate[] = [
  // ── HARD CLASHES (CD-xxx) ───────────────────────────────────────────────
  {
    id: 'CD-001',
    name: 'Structure vs HVAC Ductwork',
    description: 'Detects physical intersection between structural elements and HVAC ducts',
    category: 'hard',
    setA: 'SS-STR-01',
    setB: 'SS-MECH-01',
    selfTest: false,
    tolerance_mm: 0,              // Hard clash = zero tolerance (physical overlap)
    toleranceSource: null,
    defaultSeverity: 'critical',
    severityOverrides: [
      {
        condition: 'Small duct (≤200mm) intersecting non-primary beam',
        field: 'dimensions.width',
        operator: 'lt',
        value: 0.2,
        overrideSeverity: 'high',
      },
    ],
    enabled: true,
    codeReferences: ['NBC 3.2.5.7', 'CSA S16-19'],
    notes: 'Structural integrity check — any penetration requires engineering approval',
  },
  {
    id: 'CD-002',
    name: 'Structure vs Plumbing Piping',
    description: 'Detects physical intersection between structural elements and plumbing pipes',
    category: 'hard',
    setA: 'SS-STR-01',
    setB: 'SS-PLBG-01',
    selfTest: false,
    tolerance_mm: 0,
    toleranceSource: null,
    defaultSeverity: 'critical',
    severityOverrides: [],
    enabled: true,
    codeReferences: ['NBC 3.2.5.7', 'CSA A23.3-19'],
    notes: 'Pipe penetrations through structural members require sleeve + fire rating',
  },
  {
    id: 'CD-003',
    name: 'Structure vs Electrical Conduit/Tray',
    description: 'Physical intersection between structural elements and electrical runs',
    category: 'hard',
    setA: 'SS-STR-01',
    setB: 'SS-ELEC-01',
    selfTest: false,
    tolerance_mm: 0,
    toleranceSource: null,
    defaultSeverity: 'high',
    severityOverrides: [],
    enabled: true,
    codeReferences: ['CEC 12-100', 'NBC 3.2.5.7'],
    notes: 'Conduit routing must avoid structural members or use approved sleeves',
  },
  {
    id: 'CD-004',
    name: 'Structure vs Fire Protection',
    description: 'Physical intersection between structural elements and FP piping',
    category: 'hard',
    setA: 'SS-STR-01',
    setB: 'SS-FP-01',
    selfTest: false,
    tolerance_mm: 0,
    toleranceSource: null,
    defaultSeverity: 'critical',
    severityOverrides: [],
    enabled: true,
    codeReferences: ['NBC 3.2.5', 'NFPA 13'],
    notes: 'FP penetrations require structural engineer sign-off and ULC-listed firestop',
  },
  {
    id: 'CD-005',
    name: 'HVAC vs Plumbing',
    description: 'Physical intersection between ductwork and piping',
    category: 'hard',
    setA: 'SS-MECH-01',
    setB: 'SS-PLBG-01',
    selfTest: false,
    tolerance_mm: 0,
    toleranceSource: null,
    defaultSeverity: 'high',
    severityOverrides: [],
    enabled: true,
    codeReferences: [],
    notes: 'Coordination priority: structure first, then large ducts, then pipes',
  },
  {
    id: 'CD-006',
    name: 'HVAC vs Electrical',
    description: 'Physical intersection between ductwork and cable trays/conduit',
    category: 'hard',
    setA: 'SS-MECH-01',
    setB: 'SS-ELEC-01',
    selfTest: false,
    tolerance_mm: 0,
    toleranceSource: null,
    defaultSeverity: 'high',
    severityOverrides: [],
    enabled: true,
    codeReferences: [],
    notes: 'Vertical separation: electrical above HVAC preferred per coordination rules',
  },
  {
    id: 'CD-007',
    name: 'Architectural vs Structure',
    description: 'Architectural elements (walls, ceilings) clashing with structure',
    category: 'hard',
    setA: 'SS-ARC-01',
    setB: 'SS-STR-01',
    selfTest: false,
    tolerance_mm: 0,
    toleranceSource: null,
    defaultSeverity: 'medium',
    severityOverrides: [
      {
        condition: 'Exterior wall / curtain wall intersecting beam',
        field: 'elementType',
        operator: 'contains',
        value: 'Curtain',
        overrideSeverity: 'high',
      },
    ],
    enabled: true,
    codeReferences: [],
    notes: 'Usually indicates model alignment issue between ARC and STR models',
  },

  // ── SOFT CLASHES (SC-xxx) ──────────────────────────────────────────────
  {
    id: 'SC-001',
    name: 'Duct Clearance to Structure',
    description: 'Checks minimum clearance between ducts and structural elements for maintenance access',
    category: 'soft',
    setA: 'SS-MECH-01',
    setB: 'SS-STR-01',
    selfTest: false,
    tolerance_mm: null,           // MUST come from project specs → GAP if missing
    toleranceSource: null,
    defaultSeverity: 'medium',
    severityOverrides: [
      {
        condition: 'Main trunk duct (>600mm) with insufficient clearance',
        field: 'dimensions.width',
        operator: 'gt',
        value: 0.6,
        overrideSeverity: 'high',
      },
    ],
    enabled: true,
    codeReferences: ['SMACNA Installation Standards'],
    notes: 'Typical clearance 50-150mm but MUST be verified from project specs',
  },
  {
    id: 'SC-002',
    name: 'Pipe Clearance to Structure',
    description: 'Checks minimum clearance between pipes and structural for insulation + maintenance',
    category: 'soft',
    setA: 'SS-PLBG-01',
    setB: 'SS-STR-01',
    selfTest: false,
    tolerance_mm: null,
    toleranceSource: null,
    defaultSeverity: 'medium',
    severityOverrides: [],
    enabled: true,
    codeReferences: ['CSA B214'],
    notes: 'Must include insulation thickness — insulated pipe effective OD = nominal + 2×insulation',
  },
  {
    id: 'SC-003',
    name: 'Ceiling Clearance to MEP',
    description: 'Checks that MEP elements do not protrude below finished ceiling height',
    category: 'soft',
    setA: 'SS-ARC-01',
    setB: 'SS-MECH-01',
    selfTest: false,
    tolerance_mm: null,
    toleranceSource: null,
    defaultSeverity: 'high',
    severityOverrides: [],
    enabled: true,
    codeReferences: ['OBC 3.3.1.1'],
    notes: 'Ceiling minimum height from OBC — mechanical must fit within plenum',
  },

  // ── CODE / ACCESS CLASHES (AC-xxx) ─────────────────────────────────────
  {
    id: 'AC-001',
    name: 'Electrical Panel Front Clearance',
    description: 'CEC/OBC-required working clearance in front of electrical panels',
    category: 'code_compliance',
    setA: 'SS-ELEC-01',
    setB: 'SS-STR-01',            // Check against all elements near panels
    selfTest: false,
    tolerance_mm: null,           // CEC Rule 26-402: 1000mm typical, must verify from spec
    toleranceSource: null,
    defaultSeverity: 'critical',
    severityOverrides: [],
    enabled: true,
    codeReferences: ['CEC 26-402', 'OBC 3.6.3'],
    notes: 'Life-safety item — code-mandated clearance, non-negotiable',
  },
  {
    id: 'AC-002',
    name: 'Fire Damper Access',
    description: 'Access clearance for fire damper inspection and maintenance',
    category: 'code_compliance',
    setA: 'SS-MECH-01',
    setB: 'SS-ARC-01',
    selfTest: false,
    tolerance_mm: null,
    toleranceSource: null,
    defaultSeverity: 'high',
    severityOverrides: [],
    enabled: true,
    codeReferences: ['NBC 3.1.8', 'ULC S112'],
    notes: 'Fire dampers must have maintenance access per NBC — typically 450×450mm',
  },
  {
    id: 'AC-003',
    name: 'Sprinkler to Ceiling Clearance',
    description: 'NFPA 13 sprinkler deflector-to-ceiling distance check',
    category: 'code_compliance',
    setA: 'SS-FP-01',
    setB: 'SS-ARC-01',
    selfTest: false,
    tolerance_mm: null,           // NFPA 13: 25-305mm depending on type, must verify
    toleranceSource: null,
    defaultSeverity: 'critical',
    severityOverrides: [],
    enabled: true,
    codeReferences: ['NFPA 13 8.6.5', 'NBC 3.2.5.12'],
    notes: 'Life-safety — incorrect clearance = non-compliant fire suppression',
  },
  {
    id: 'AC-004',
    name: 'Corridor Minimum Width',
    description: 'OBC/NBC minimum egress corridor width compliance',
    category: 'code_compliance',
    setA: 'SS-ARC-01',
    setB: 'SS-MECH-01',
    selfTest: false,
    tolerance_mm: null,           // OBC: 1100mm typical, verify from drawings
    toleranceSource: null,
    defaultSeverity: 'critical',
    severityOverrides: [],
    enabled: true,
    codeReferences: ['OBC 3.3.1.9', 'NBC 3.3.1.9'],
    notes: 'Life-safety — MEP elements must not reduce egress width below code minimum',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// 3. SELECTION SET MATCHER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Evaluate a single SelectionRule against an element's properties.
 */
export function evaluateRule(rule: SelectionRule, element: Record<string, any>): boolean {
  const fieldValue = resolveNestedField(element, rule.field);
  if (fieldValue === undefined || fieldValue === null) return false;

  const strVal = String(fieldValue).toLowerCase();

  switch (rule.operator) {
    case 'eq':
      return strVal === String(rule.value).toLowerCase();
    case 'neq':
      return strVal !== String(rule.value).toLowerCase();
    case 'in':
      return Array.isArray(rule.value) && rule.value.some(v => strVal === v.toLowerCase());
    case 'not_in':
      return Array.isArray(rule.value) && !rule.value.some(v => strVal === v.toLowerCase());
    case 'startsWith':
      return strVal.startsWith(String(rule.value).toLowerCase());
    case 'contains':
      return strVal.includes(String(rule.value).toLowerCase());
    case 'regex':
      try { return new RegExp(String(rule.value), 'i').test(strVal); }
      catch { return false; }
    default:
      return false;
  }
}

/** Resolve nested property paths like 'properties.workset' */
function resolveNestedField(obj: Record<string, any>, path: string): any {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

/**
 * Resolve a SelectionSet against an array of BIM elements.
 * Returns matching element IDs. Uses primary rules first;
 * falls back to fallbackRules if primary yields < minElements.
 */
export function resolveSelectionSet(
  set: SelectionSet,
  elements: Record<string, any>[],
): { matchedIds: string[]; usedFallback: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // Apply exclude rules first
  const eligible = elements.filter(el =>
    !set.excludeRules.some(rule => evaluateRule(rule, el))
  );

  // Primary rules (AND)
  let matched = eligible.filter(el =>
    set.primaryRules.every(rule => evaluateRule(rule, el))
  );

  let usedFallback = false;

  if (matched.length < set.minElements && set.fallbackRules.length > 0) {
    // Fallback: element matches ANY fallback rule
    matched = eligible.filter(el =>
      set.fallbackRules.some(rule => evaluateRule(rule, el))
    );
    usedFallback = true;
    warnings.push(
      `Selection set ${set.id} used fallback rules — primary yielded ${matched.length} elements (min: ${set.minElements})`
    );
  }

  if (matched.length === 0) {
    warnings.push(
      `Selection set ${set.id} (${set.name}) resolved to 0 elements — test will be skipped`
    );
  }

  return {
    matchedIds: matched.map(el => el.id || el.elementId),
    usedFallback,
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. TEMPLATE REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

const templateMap = new Map<string, ClashTestTemplate>();
for (const t of CLASH_TEST_TEMPLATES) {
  templateMap.set(t.id, t);
}

/** Get a test template by ID */
export function getTestTemplate(id: string): ClashTestTemplate | undefined {
  return templateMap.get(id);
}

/** Get all enabled test templates */
export function getEnabledTemplates(): ClashTestTemplate[] {
  return CLASH_TEST_TEMPLATES.filter(t => t.enabled);
}

/** Get templates by category */
export function getTemplatesByCategory(category: ClashCategory): ClashTestTemplate[] {
  return CLASH_TEST_TEMPLATES.filter(t => t.enabled && t.category === category);
}

/** Get selection set by ID */
export function getSelectionSet(id: string): SelectionSet | undefined {
  return SELECTION_SETS.find(s => s.id === id);
}

/**
 * Validate that all templates reference valid selection sets.
 * Returns list of errors (empty = all valid).
 */
export function validateTemplateIntegrity(): string[] {
  const errors: string[] = [];
  const setIds = new Set(SELECTION_SETS.map(s => s.id));

  for (const t of CLASH_TEST_TEMPLATES) {
    if (!setIds.has(t.setA)) {
      errors.push(`Template ${t.id}: setA '${t.setA}' not found in SELECTION_SETS`);
    }
    if (!setIds.has(t.setB)) {
      errors.push(`Template ${t.id}: setB '${t.setB}' not found in SELECTION_SETS`);
    }
    if (t.tolerance_mm === null && t.category !== 'hard') {
      // Expected — soft/code clashes need user-supplied tolerance
    }
  }

  return errors;
}
