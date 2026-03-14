/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  BEP RULES ENGINE — SOP Part 2
 *  EstimatorPro v14.35 — Project-agnostic
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  BIM Execution Plan (BEP) rules enforcement:
 *    1. File naming standards (ISO 19650 + project-specific)
 *    2. Level/zone conventions (level naming, zone coding)
 *    3. Metadata parameter validation
 *    4. Classification system enforcement (Uniformat, MasterFormat)
 *    5. Workset/phase validation
 *
 *  Standards: ISO 19650, AIA E203, CIQS, CSI MasterFormat 2018
 *  Consumed by: model-drop-gating.ts, discipline-sop.ts
 * ══════════════════════════════════════════════════════════════════════════════
 */

import type { DisciplineCode } from './discipline-sop';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface BEPRuleSet {
  projectCode: string;
  namingConvention: NamingConvention;
  levelConvention: LevelConvention;
  zoneConvention: ZoneConvention;
  metadataRules: MetadataRule[];
  classificationSystem: 'uniformat' | 'masterformat' | 'both';
}

export interface NamingConvention {
  /** Pattern: {ProjectCode}-{Discipline}-{Zone}-{Level}-{Type}-{Sequence}
   *  Example: MOOR-STR-EAST-L02-MODEL-001 */
  pattern: string;
  separator: string;
  fields: NamingField[];
}

export interface NamingField {
  name: string;
  position: number;
  required: boolean;
  validValues: string[] | null;  // null = any value
  maxLength: number;
  description: string;
}

export interface LevelConvention {
  prefix: string;                // 'L' or 'Level'
  zeroPad: number;               // 2 = L01, L02; 3 = L001
  belowGrade: string;            // 'B' prefix for basements
  roofLevel: string;             // 'RF' or 'ROOF'
  mezzaninePrefix: string;       // 'M' for mezzanines
  levels: LevelDefinition[];
}

export interface LevelDefinition {
  name: string;                  // e.g. 'L01'
  /** elevation_m is null when the floor-to-floor height has not been confirmed from
   *  section drawings. Consumers must check for null and register an RFI via
   *  trackMissingData() before using this value in calculations. */
  elevation_m: number | null;
  description: string;
}

export interface ZoneConvention {
  method: 'grid_based' | 'cardinal' | 'functional' | 'custom';
  zones: ZoneDefinition[];
}

export interface ZoneDefinition {
  code: string;
  name: string;
  description: string;
  gridRange?: { fromGrid: string; toGrid: string };
}

export interface MetadataRule {
  parameter: string;
  appliesTo: DisciplineCode[] | 'ALL';
  required: boolean;
  validationType: 'non_empty' | 'numeric' | 'enum' | 'regex' | 'reference';
  validationValue: string | string[];   // regex pattern, enum values, or reference table
  errorMessage: string;
}

export interface BEPValidationResult {
  valid: boolean;
  errors: BEPError[];
  warnings: BEPWarning[];
  score: number;                 // 0-100 compliance percentage
}

export interface BEPError {
  rule: string;
  element: string;
  field: string;
  value: string;
  expected: string;
  message: string;
}

export interface BEPWarning {
  rule: string;
  element: string;
  message: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SAMPLE PROJECT BEP — Moorings reference configuration (select by name at runtime)
// ═══════════════════════════════════════════════════════════════════════════════

export const MOORINGS_BEP: BEPRuleSet = {
  projectCode: 'MOOR',
  namingConvention: {
    pattern: '{ProjectCode}-{Discipline}-{Zone}-{Level}-{Type}-{Sequence}',
    separator: '-',
    fields: [
      { name: 'ProjectCode', position: 0, required: true, validValues: ['MOOR'], maxLength: 4, description: 'Project code' },
      { name: 'Discipline', position: 1, required: true, validValues: ['ARC', 'STR', 'MECH', 'PLBG', 'FP', 'ELEC', 'BIM'], maxLength: 4, description: 'Discipline code' },
      { name: 'Zone', position: 2, required: false, validValues: null, maxLength: 8, description: 'Building zone' },
      { name: 'Level', position: 3, required: true, validValues: null, maxLength: 4, description: 'Level code' },
      { name: 'Type', position: 4, required: true, validValues: ['MODEL', 'DRAW', 'SPEC', 'CALC', 'SCHED', 'RPT'], maxLength: 5, description: 'Document type' },
      { name: 'Sequence', position: 5, required: true, validValues: null, maxLength: 4, description: 'Sequence number' },
    ],
  },
  levelConvention: {
    prefix: 'L',
    zeroPad: 2,
    belowGrade: 'B',
    roofLevel: 'RF',
    mezzaninePrefix: 'M',
    // N-2 FIX: elevation_m values above ground are set to null — they assumed a
    // 3.2 m floor-to-floor height that has NOT been verified from section drawings for
    // The Moorings on Cameron Lake. Once the architectural section drawings are uploaded
    // and analysed, populate these values from the real storey data.
    // B01 (-3.0) and L01 (0.0) are conventional references (below-grade / datum).
    levels: [
      { name: 'B01', elevation_m: -3.0, description: 'Basement Level 1' },
      { name: 'L01', elevation_m: 0.0,  description: 'Ground Floor' },
      { name: 'L02', elevation_m: null,  description: 'Second Floor — elevation pending section drawing analysis' },
      { name: 'L03', elevation_m: null,  description: 'Third Floor — elevation pending section drawing analysis' },
      { name: 'RF',  elevation_m: null,  description: 'Roof Level — elevation pending section drawing analysis' },
    ],
  },
  zoneConvention: {
    method: 'cardinal',
    zones: [
      { code: 'NORTH', name: 'North Wing', description: 'North section of building' },
      { code: 'SOUTH', name: 'South Wing', description: 'South section of building' },
      { code: 'EAST', name: 'East Wing', description: 'East section of building' },
      { code: 'WEST', name: 'West Wing', description: 'West section of building' },
      { code: 'CORE', name: 'Core', description: 'Central core area' },
    ],
  },
  metadataRules: [
    { parameter: 'Level', appliesTo: 'ALL', required: true, validationType: 'non_empty', validationValue: '', errorMessage: 'Element must have Level assigned' },
    { parameter: 'Material', appliesTo: ['STR'], required: true, validationType: 'regex', validationValue: '^(?!.*(?:By Category|Default|<)).*$', errorMessage: 'Structural material must not be "By Category" or "Default"' },
    { parameter: 'SystemType', appliesTo: ['MECH', 'PLBG', 'FP', 'ELEC'], required: true, validationType: 'non_empty', validationValue: '', errorMessage: 'MEP element must have SystemType assigned' },
    { parameter: 'Fire_Rating', appliesTo: ['ARC'], required: true, validationType: 'non_empty', validationValue: '', errorMessage: 'Fire-rated assembly must have Fire_Rating' },
    { parameter: 'Mark', appliesTo: ['STR'], required: true, validationType: 'non_empty', validationValue: '', errorMessage: 'Structural member must have Mark/Tag' },
  ],
  classificationSystem: 'both',
};

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate a file name against BEP naming convention.
 */
export function validateFileName(fileName: string, bep: BEPRuleSet): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const parts = fileName.replace(/\.[^.]+$/, '').split(bep.namingConvention.separator);

  for (const field of bep.namingConvention.fields) {
    const value = parts[field.position];

    if (field.required && (!value || value.trim() === '')) {
      errors.push(`Missing required field "${field.name}" at position ${field.position}`);
      continue;
    }

    if (value && field.validValues && !field.validValues.includes(value.toUpperCase())) {
      errors.push(`Invalid "${field.name}": "${value}" — expected one of: ${field.validValues.join(', ')}`);
    }

    if (value && value.length > field.maxLength) {
      errors.push(`"${field.name}" exceeds max length ${field.maxLength}: "${value}"`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an element's metadata against BEP rules.
 */
export function validateElementMetadata(
  element: Record<string, any>,
  discipline: DisciplineCode,
  bep: BEPRuleSet,
): { errors: BEPError[]; warnings: BEPWarning[] } {
  const errors: BEPError[] = [];
  const warnings: BEPWarning[] = [];
  const elId = element.id || element.elementId || 'UNKNOWN';
  const elName = element.name || 'Unnamed';

  for (const rule of bep.metadataRules) {
    if (rule.appliesTo !== 'ALL' && !rule.appliesTo.includes(discipline)) continue;

    const value = element[rule.parameter] || element.properties?.[rule.parameter] || '';
    const strVal = String(value).trim();

    let valid = true;

    switch (rule.validationType) {
      case 'non_empty':
        valid = strVal.length > 0;
        break;
      case 'numeric':
        valid = strVal.length > 0 && !isNaN(Number(strVal));
        break;
      case 'enum':
        valid = Array.isArray(rule.validationValue)
          ? rule.validationValue.includes(strVal)
          : strVal === rule.validationValue;
        break;
      case 'regex':
        try {
          valid = new RegExp(String(rule.validationValue)).test(strVal);
        } catch { valid = false; }
        break;
      case 'reference':
        valid = strVal.length > 0;
        break;
    }

    if (!valid) {
      if (rule.required) {
        errors.push({
          rule: rule.parameter,
          element: elId,
          field: rule.parameter,
          value: strVal || '(empty)',
          expected: String(rule.validationValue),
          message: `${elName}: ${rule.errorMessage}`,
        });
      } else {
        warnings.push({
          rule: rule.parameter,
          element: elId,
          message: `${elName}: ${rule.errorMessage} (recommended)`,
        });
      }
    }
  }

  return { errors, warnings };
}

/**
 * Validate a level name against BEP level convention.
 */
export function validateLevelName(levelName: string, bep: BEPRuleSet): boolean {
  const validNames = bep.levelConvention.levels.map(l => l.name);
  return validNames.includes(levelName);
}

/**
 * Run full BEP validation on a set of elements.
 */
export function runBEPValidation(
  elements: Record<string, any>[],
  discipline: DisciplineCode,
  bep: BEPRuleSet = MOORINGS_BEP,
): BEPValidationResult {
  const allErrors: BEPError[] = [];
  const allWarnings: BEPWarning[] = [];

  for (const el of elements) {
    const { errors, warnings } = validateElementMetadata(el, discipline, bep);
    allErrors.push(...errors);
    allWarnings.push(...warnings);
  }

  const totalChecks = elements.length * bep.metadataRules.length;
  const score = totalChecks > 0
    ? Math.round(((totalChecks - allErrors.length) / totalChecks) * 100)
    : 100;

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
    score,
  };
}
