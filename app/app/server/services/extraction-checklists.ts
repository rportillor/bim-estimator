/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  EXTRACTION CHECKLISTS — SOP Part 4.2, 4.3
 *  Phase 2 — Document Control & Structured Extraction
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Manages the structured extraction of data from project documents.
 *  Five mandatory table types per SOP Part 4.2:
 *
 *    Table 1: Dimensions (opening widths, room heights, slab thicknesses, etc.)
 *    Table 2: Levels / Grades / Elevations (datum, level names, elevations)
 *    Table 3: Materials / Construction (location, material, spec, thickness, finish)
 *    Table 4: Systems Inventory (discipline, system, tag, parameters, location)
 *    Table 5: Notes / Constraints (constraint ID, type, description, affected scope)
 *
 *  SOP Part 4.3 — Conflict identification rules:
 *    - Conflicting dimensions (same element, different values across sheets)
 *    - Datum conflicts (inconsistent elevation references)
 *    - Scope gaps (elements referenced but not detailed)
 *    - Uncoordinated details (cross-discipline mismatches)
 *    - Dimension chain not closed (plan dims don't sum to overall)
 *
 *  SOP Part 1 rule: Every row requires an evidence reference.
 *
 *  Consumes from types.ts:
 *    DimensionRow, LevelElevationRow, MaterialRow, SystemInventoryRow,
 *    ConstraintRow, EvidenceReference, Gap, GapType, Discipline
 *
 *  Consumes from prompt-library.ts:
 *    DrawingParsingParams, CrossDocQAParams,
 *    getDrawingParsingPrompt, getCrossDocQAPrompt
 *
 *  Consumes from document-control-register.ts:
 *    validateEvidenceReference (validates refs against register)
 *
 *  Consumed by:
 *    constructability-engine.ts (Phase 4 — constraints, materials)
 *    sequencing-4d.ts (Phase 4 — system inventory for sequencing)
 *    clash-engine.ts (evidence references for clash grouping)
 *    report-generator.ts (future — extraction summary)
 *
 *  @module extraction-checklists
 *  @version 1.0.0
 */

import type {
  DimensionRow,
  LevelElevationRow,
  MaterialRow,
  SystemInventoryRow,
  ConstraintRow,
  EvidenceReference,
  Gap,
  GapType,
  Discipline,
} from './types';
import { formatEvidenceRef } from './types';
import type { DrawingParsingParams, CrossDocQAParams } from './prompt-library';
import { getDrawingParsingPrompt, getCrossDocQAPrompt } from './prompt-library';
import { validateEvidenceReference } from './document-control-register';


// ═══════════════════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/** Complete extraction result for a set of documents */
export interface ExtractionResult {
  projectId: string;
  /** Discipline being extracted */
  discipline: Discipline;
  /** Sheets/specs processed in this extraction */
  processedDocuments: string[];
  /** Extraction timestamp */
  timestamp: string;

  /** SOP Part 4.2 — Five mandatory tables */
  dimensions: DimensionRow[];
  levels: LevelElevationRow[];
  materials: MaterialRow[];
  systems: SystemInventoryRow[];
  constraints: ConstraintRow[];

  /** SOP Part 4.3 — Identified conflicts */
  conflicts: ConflictRecord[];

  /** Gaps found during extraction (missing data, low confidence) */
  gaps: Gap[];

  /** AI prompt used for this extraction (for audit trail) */
  promptUsed?: string;
}

/** A single conflict identified per SOP Part 4.3 */
export interface ConflictRecord {
  id: string;
  type: ConflictType;
  description: string;
  /** Sheets/rows involved in the conflict */
  sources: Array<{
    sheetOrSpecId: string;
    value: string;
    evidenceRef: EvidenceReference;
  }>;
  /** Affected element or scope */
  affectedScope: string;
  /** Severity */
  severity: 'critical' | 'major' | 'minor';
  /** Recommended action */
  action: string;
  /** Converted to RFI? */
  rfiId?: string;
}

/** Conflict types per SOP Part 4.3 */
export type ConflictType =
  | 'CONFLICTING_DIMENSIONS'    // Same element, different values across sheets
  | 'DATUM_CONFLICT'            // Inconsistent elevation references
  | 'SCOPE_GAP'                 // Referenced but not detailed
  | 'UNCOORDINATED_DETAIL'      // Cross-discipline mismatch
  | 'CHAIN_NOT_CLOSED';         // Dimension chain doesn't sum to overall

/** Per-discipline checklist definition (what to look for) */
export interface DisciplineChecklist {
  discipline: Discipline;
  /** Tables required for this discipline */
  requiredTables: Array<'dimensions' | 'levels' | 'materials' | 'systems' | 'constraints'>;
  /** Minimum expected rows per table (0 = not required) */
  minimumRows: {
    dimensions: number;
    levels: number;
    materials: number;
    systems: number;
    constraints: number;
  };
  /** Specific parameters to look for per discipline */
  keyParameters: string[];
  /** Common conflict patterns to check */
  conflictPatterns: ConflictType[];
}

/** Extraction validation result */
export interface ExtractionValidation {
  isComplete: boolean;
  tablesPresent: string[];
  tablesMissing: string[];
  rowCounts: Record<string, number>;
  evidenceIssues: Array<{ table: string; rowIndex: number; issue: string }>;
  gaps: Gap[];
}


// ═══════════════════════════════════════════════════════════════════════════════
//  DISCIPLINE CHECKLISTS — SOP Part 4.2
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Per-discipline extraction checklist definitions.
 * Each discipline has different emphasis on what tables matter most.
 */
export const DISCIPLINE_CHECKLISTS: Record<string, DisciplineChecklist> = {
  ARC: {
    discipline: 'ARC',
    requiredTables: ['dimensions', 'levels', 'materials', 'constraints'],
    minimumRows: { dimensions: 5, levels: 3, materials: 3, systems: 0, constraints: 1 },
    keyParameters: [
      'room dimensions', 'door/window openings', 'ceiling heights',
      'finish materials', 'fire ratings', 'acoustic ratings',
      'floor-to-floor heights', 'slab thicknesses', 'wall types',
    ],
    conflictPatterns: ['CONFLICTING_DIMENSIONS', 'SCOPE_GAP', 'CHAIN_NOT_CLOSED'],
  },

  STR: {
    discipline: 'STR',
    requiredTables: ['dimensions', 'levels', 'materials', 'constraints'],
    minimumRows: { dimensions: 5, levels: 3, materials: 2, systems: 0, constraints: 2 },
    keyParameters: [
      'member sizes', 'span lengths', 'concrete strengths',
      'rebar grades/sizes', 'bearing dimensions', 'foundation depths',
      'slab thicknesses', 'beam/column schedules', 'load paths',
    ],
    conflictPatterns: ['CONFLICTING_DIMENSIONS', 'DATUM_CONFLICT', 'CHAIN_NOT_CLOSED'],
  },

  MECH: {
    discipline: 'MECH',
    requiredTables: ['dimensions', 'levels', 'systems', 'constraints'],
    minimumRows: { dimensions: 3, levels: 2, materials: 0, systems: 5, constraints: 2 },
    keyParameters: [
      'duct sizes', 'pipe sizes', 'equipment CFM/BTU',
      'system pressures', 'clearance requirements', 'service access zones',
      'insulation thickness', 'fire damper locations', 'control zones',
    ],
    conflictPatterns: ['CONFLICTING_DIMENSIONS', 'UNCOORDINATED_DETAIL', 'SCOPE_GAP'],
  },

  PLMB: {  // PLBG_FP merged into PLMB
    discipline: 'PLMB',
    requiredTables: ['dimensions', 'systems', 'materials', 'constraints'],
    minimumRows: { dimensions: 2, levels: 1, materials: 2, systems: 4, constraints: 2 },
    keyParameters: [
      'pipe sizes', 'fixture counts', 'sprinkler coverage',
      'water supply pressure', 'drain slopes', 'riser locations',
      'fire pump capacity', 'standpipe locations', 'backflow preventers',
    ],
    conflictPatterns: ['UNCOORDINATED_DETAIL', 'SCOPE_GAP', 'CONFLICTING_DIMENSIONS'],
  },

  ELEC: {
    discipline: 'ELEC',
    requiredTables: ['dimensions', 'systems', 'constraints'],
    minimumRows: { dimensions: 2, levels: 1, materials: 0, systems: 5, constraints: 2 },
    keyParameters: [
      'panel schedules', 'conduit sizes', 'cable tray sizes',
      'transformer ratings', 'generator capacity', 'lighting levels',
      'receptacle counts', 'grounding requirements', 'emergency circuits',
    ],
    conflictPatterns: ['UNCOORDINATED_DETAIL', 'SCOPE_GAP', 'CONFLICTING_DIMENSIONS'],
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
//  EXTRACTION STORE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * In-memory extraction results store.
 * Key = `${projectId}::${discipline}` (one extraction per discipline per project).
 */
const extractions = new Map<string, ExtractionResult>();

function storeKey(projectId: string, discipline: Discipline): string {
  return `${projectId}::${discipline}`;
}


// ═══════════════════════════════════════════════════════════════════════════════
//  EXTRACTION CRUD
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Store a complete extraction result for a discipline.
 * Replaces any previous extraction for the same project + discipline.
 */
export function storeExtraction(result: ExtractionResult): ExtractionResult {
  const key = storeKey(result.projectId, result.discipline);
  extractions.set(key, result);
  return result;
}

/**
 * Get the extraction result for a discipline.
 */
export function getExtraction(
  projectId: string,
  discipline: Discipline,
): ExtractionResult | undefined {
  return extractions.get(storeKey(projectId, discipline));
}

/**
 * Get all extractions for a project.
 */
export function getAllExtractions(projectId: string): ExtractionResult[] {
  const results: ExtractionResult[] = [];
  for (const [key, result] of extractions) {
    if (key.startsWith(projectId + '::')) {
      results.push(result);
    }
  }
  return results;
}

/**
 * Delete extraction for a discipline.
 */
export function deleteExtraction(projectId: string, discipline: Discipline): boolean {
  return extractions.delete(storeKey(projectId, discipline));
}


// ═══════════════════════════════════════════════════════════════════════════════
//  TABLE BUILDERS — Add rows to extraction tables
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a new empty extraction result for a discipline.
 */
export function createEmptyExtraction(
  projectId: string,
  discipline: Discipline,
  processedDocuments: string[],
): ExtractionResult {
  return {
    projectId,
    discipline,
    processedDocuments,
    timestamp: new Date().toISOString(),
    dimensions: [],
    levels: [],
    materials: [],
    systems: [],
    constraints: [],
    conflicts: [],
    gaps: [],
  };
}

/**
 * Add a dimension row to an extraction.
 * Validates evidence reference is present.
 */
export function addDimensionRow(
  extraction: ExtractionResult,
  row: DimensionRow,
): { added: boolean; gap?: Gap } {
  const evidenceCheck = checkEvidence(row.evidenceRef ? { documentId: row.evidenceRef } : undefined, 'dimensions', extraction.dimensions.length);
  if (evidenceCheck) {
    extraction.gaps.push(evidenceCheck);
    return { added: false, gap: evidenceCheck };
  }
  extraction.dimensions.push(row);
  return { added: true };
}

/**
 * Add a level/elevation row to an extraction.
 */
export function addLevelRow(
  extraction: ExtractionResult,
  row: LevelElevationRow,
): { added: boolean; gap?: Gap } {
  const evidenceCheck = checkEvidence(row.evidenceRef ? { documentId: row.evidenceRef } : undefined, 'levels', extraction.levels.length);
  if (evidenceCheck) {
    extraction.gaps.push(evidenceCheck);
    return { added: false, gap: evidenceCheck };
  }
  extraction.levels.push(row);
  return { added: true };
}

/**
 * Add a material row to an extraction.
 */
export function addMaterialRow(
  extraction: ExtractionResult,
  row: MaterialRow,
): { added: boolean; gap?: Gap } {
  const evidenceCheck = checkEvidence(row.evidenceRef ? { documentId: row.evidenceRef } : undefined, 'materials', extraction.materials.length);
  if (evidenceCheck) {
    extraction.gaps.push(evidenceCheck);
    return { added: false, gap: evidenceCheck };
  }
  extraction.materials.push(row);
  return { added: true };
}

/**
 * Add a system inventory row to an extraction.
 */
export function addSystemRow(
  extraction: ExtractionResult,
  row: SystemInventoryRow,
): { added: boolean; gap?: Gap } {
  const evidenceCheck = checkEvidence(row.evidenceRef ? { documentId: row.evidenceRef } : undefined, 'systems', extraction.systems.length);
  if (evidenceCheck) {
    extraction.gaps.push(evidenceCheck);
    return { added: false, gap: evidenceCheck };
  }
  extraction.systems.push(row);
  return { added: true };
}

/**
 * Add a constraint row to an extraction.
 */
export function addConstraintRow(
  extraction: ExtractionResult,
  row: ConstraintRow,
): { added: boolean; gap?: Gap } {
  const evidenceCheck = checkEvidence(row.evidenceRef ? { documentId: row.evidenceRef } : undefined, 'constraints', extraction.constraints.length);
  if (evidenceCheck) {
    extraction.gaps.push(evidenceCheck);
    return { added: false, gap: evidenceCheck };
  }
  extraction.constraints.push(row);
  return { added: true };
}


// ═══════════════════════════════════════════════════════════════════════════════
//  CONFLICT DETECTION — SOP Part 4.3
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run all conflict detection rules on an extraction.
 * Populates the extraction.conflicts array.
 *
 * SOP Part 4.3 — Five conflict types:
 *   1. CONFLICTING_DIMENSIONS
 *   2. DATUM_CONFLICT
 *   3. DATUM_CONFLICT (elevation mismatches)
 *   4. SCOPE_GAP
 *   5. CHAIN_NOT_CLOSED
 */
export function detectConflicts(extraction: ExtractionResult): ConflictRecord[] {
  const conflicts: ConflictRecord[] = [];
  let conflictCounter = 0;

  const nextId = (): string => {
    conflictCounter++;
    return `CONF-${extraction.discipline}-${String(conflictCounter).padStart(3, '0')}`;
  };

  // ─── Rule 1: Conflicting dimensions ───────────────────────────────
  // Same appliesTo + same dimType but different values across sheets
  const dimGroups = groupBy(extraction.dimensions, d => `${d.appliesTo}::${d.dimType}`);
  for (const [key, rows] of Object.entries(dimGroups)) {
    if (rows.length < 2) continue;
    const values = new Set(rows.map(r => (r as any).width ?? (r as any).height ?? (r as any).depth ?? (r as any).value));
    if (values.size > 1) {
      conflicts.push({
        id: nextId(),
        type: 'CONFLICTING_DIMENSIONS',
        description: `Conflicting ${rows[0].dimType} for "${rows[0].appliesTo}": values ${[...values].join(', ')} ${rows[0].units}`,
        sources: rows.map(r => ({
          sheetOrSpecId: r.source ?? '',
          value: `${(r as any).width ?? (r as any).height ?? (r as any).depth ?? ''} ${r.unit}`,
          evidenceRef: (typeof r.evidenceRef === "string" ? { documentId: r.evidenceRef } : r.evidenceRef || {}) as any,
        })),
        affectedScope: (rows[0] as any).appliesTo ?? '',
        severity: 'critical',
        action: 'Issue RFI to resolve conflicting dimension. Do not proceed with either value.',
      });
    }
  }

  // ─── Rule 2: Datum conflicts ──────────────────────────────────────
  // Same levelName but different elevations
  const levelGroups = groupBy(extraction.levels, l => l.levelName);
  for (const [levelName, rows] of Object.entries(levelGroups)) {
    if (rows.length < 2) continue;
    const elevations = new Set(rows.map(r => r.elevation_m));
    if (elevations.size > 1) {
      conflicts.push({
        id: nextId(),
        type: 'DATUM_CONFLICT',
        description: `Level "${levelName}" has conflicting elevations: ${[...elevations].join(', ')} across sheets`,
        sources: rows.map(r => ({
          sheetOrSpecId: r.sheet,
          value: `${r.elevation} ${r.units}`,
          evidenceRef: (typeof r.evidenceRef === "string" ? { documentId: r.evidenceRef } : r.evidenceRef || {}) as any,
        })),
        affectedScope: levelName,
        severity: 'critical',
        action: 'Verify datum reference and resolve elevation conflict. Issue RFI.',
      });
    }
  }

  // ─── Rule 3: Datum reference inconsistency ────────────────────────
  // Multiple different datum references in the same extraction
  const datumRefs = new Set(extraction.levels.map(l => l.datum).filter(d => d && d !== ''));
  if (datumRefs.size > 1) {
    conflicts.push({
      id: nextId(),
      type: 'DATUM_CONFLICT',
      description: `Multiple datum references found: ${[...datumRefs].join(', ')}. Project should use a single datum.`,
      sources: extraction.levels
        .filter((l, i, arr) => arr.findIndex(x => x.datum === l.datum) === i)
        .map(l => ({
          sheetOrSpecId: l.sheet,
          value: l.datum,
          evidenceRef: (typeof l.evidenceRef === "string" ? { documentId: l.evidenceRef } : l.evidenceRef || {}) as any,
        })),
      affectedScope: 'All elevations',
      severity: 'major',
      action: 'Confirm primary datum reference. All elevations must reference same benchmark.',
    });
  }

  // ─── Rule 4: Scope gaps ───────────────────────────────────────────
  // Systems referenced in constraints but not in systems table
  const systemTags = new Set(extraction.systems.map(s => s.tag));
  for (const constraint of extraction.constraints) {
    if (constraint.type === 'design' || constraint.type === 'access') {
      // Look for system references in constraint description
      const systemRefs = extraction.systems.filter(s =>
        constraint.description.includes(s.system) ||
        constraint.description.includes(s.tag)
      );
      // If constraint mentions a system not in inventory, that's a scope gap
      if (constraint.affectedScope && !systemTags.has(constraint.affectedScope)) {
        const mentioned = extraction.systems.some(s =>
          constraint.affectedScope.includes(s.system)
        );
        if (!mentioned && constraint.affectedScope.length > 3) {
          conflicts.push({
            id: nextId(),
            type: 'SCOPE_GAP',
            description: `Constraint ${constraint.constraintId} references "${constraint.affectedScope}" — not found in systems inventory.`,
            sources: [{
              sheetOrSpecId: 'Constraint register',
              value: constraint.description,
              evidenceRef: (typeof constraint.evidenceRef === "string" ? { documentId: constraint.evidenceRef } : constraint.evidenceRef || {}) as any,
            }],
            affectedScope: constraint.affectedScope,
            severity: 'minor',
            action: 'Verify scope reference exists. If missing from design, flag as scope gap.',
          });
        }
      }
    }
  }

  // ─── Rule 5: Uncoordinated details (cross-discipline) ────────────
  // Materials referenced in dimensions but spec section missing or mismatched
  for (const dim of extraction.dimensions) {
    if (dim.conflicts && dim.conflicts.length > 0) {
      // Already flagged by the caller (from AI extraction)
      for (const conflictRef of dim.conflicts) {
        conflicts.push({
          id: nextId(),
          type: 'UNCOORDINATED_DETAIL',
          description: `Dimension for "${dim.appliesTo}" (${dim.dimType}) flagged with conflict reference: ${conflictRef}`,
          sources: [{
            sheetOrSpecId: (dim as any).source ?? '',
            value: `${(dim as any).width ?? (dim as any).height ?? (dim as any).depth ?? ''} ${dim.unit ?? ''}`,
            evidenceRef: (typeof dim.evidenceRef === "string" ? { documentId: dim.evidenceRef } : dim.evidenceRef || {}) as any,
          }],
          affectedScope: (dim as any).appliesTo ?? '',
          severity: 'major',
          action: 'Cross-reference with related discipline drawings. Issue RFI if unresolvable.',
        });
      }
    }
  }

  extraction.conflicts = conflicts;
  return conflicts;
}


// ═══════════════════════════════════════════════════════════════════════════════
//  EXTRACTION VALIDATION — SOP Part 4.2 completeness check
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate an extraction against the discipline checklist.
 *
 * Checks:
 *   1. All required tables have data
 *   2. Minimum row counts met
 *   3. Every row has an evidence reference
 *   4. Key parameters represented in extraction
 *
 * @returns Validation result with gaps for any shortfalls
 */
export function validateExtraction(extraction: ExtractionResult): ExtractionValidation {
  const checklist = DISCIPLINE_CHECKLISTS[extraction.discipline];
  const gaps: Gap[] = [];
  const evidenceIssues: ExtractionValidation['evidenceIssues'] = [];

  const rowCounts: Record<string, number> = {
    dimensions: extraction.dimensions.length,
    levels: extraction.levels.length,
    materials: extraction.materials.length,
    systems: extraction.systems.length,
    constraints: extraction.constraints.length,
  };

  const tablesPresent: string[] = [];
  const tablesMissing: string[] = [];

  // Check required tables
  for (const table of checklist.requiredTables) {
    const count = rowCounts[table];
    const minimum = checklist.minimumRows[table];

    if (count > 0) {
      tablesPresent.push(table);
    } else if (minimum > 0) {
      tablesMissing.push(table);
      gaps.push(makeGap(
        `EXT-TABLE-${extraction.discipline}-${table}`,
        'PARAMETER_MISSING',
        table,
        `${extraction.discipline} extraction missing required table: ${table}. Expected ≥${minimum} rows.`,
        'high',
        extraction.discipline,
        `SOP Part 4.2 — ${table} table`,
      ));
    }

    if (count > 0 && count < minimum) {
      gaps.push(makeGap(
        `EXT-ROWS-${extraction.discipline}-${table}`,
        'ambiguous_detail',
        table,
        `${extraction.discipline} ${table} table has ${count} rows, expected ≥${minimum}. Extraction may be incomplete.`,
        'medium',
        extraction.discipline,
        `SOP Part 4.2 — ${table} minimum rows`,
      ));
    }
  }

  // Check evidence references for all rows
  const allRows: Array<{ table: string; rows: Array<any> }> = [
    { table: 'dimensions', rows: extraction.dimensions },
    { table: 'levels', rows: extraction.levels },
    { table: 'materials', rows: extraction.materials },
    { table: 'systems', rows: extraction.systems },
    { table: 'constraints', rows: extraction.constraints },
  ];

  for (const { table, rows } of allRows) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.evidenceRef) {
        evidenceIssues.push({
          table,
          rowIndex: i,
          issue: `Row ${i} missing evidence reference (SOP Part 1 violation).`,
        });
      }
    }
  }

  if (evidenceIssues.length > 0) {
    gaps.push(makeGap(
      `EXT-EVIDENCE-${extraction.discipline}`,
      'PARAMETER_MISSING',
      'evidenceRef',
      `${evidenceIssues.length} rows across tables missing evidence reference. SOP Part 1 requires every fact to be traceable.`,
      'high',
      extraction.discipline,
      'SOP Part 1 — Traceability',
    ));
  }

  return {
    isComplete: tablesMissing.length === 0 && evidenceIssues.length === 0,
    tablesPresent,
    tablesMissing,
    rowCounts,
    evidenceIssues,
    gaps,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
//  PROMPT GENERATION — SOP Part 3 integration
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate the AI prompt for drawing extraction.
 * Wraps prompt-library.ts getDrawingParsingPrompt with discipline checklist context.
 */
export function generateExtractionPrompt(
  params: DrawingParsingParams,
): string {
  const checklist = DISCIPLINE_CHECKLISTS[params.discipline];
  const enrichedParams: DrawingParsingParams = {
    ...params,
    additionalContext: [
      params.additionalContext ?? '',
      `Required tables for ${params.discipline}: ${checklist.requiredTables.join(', ')}`,
      `Key parameters: ${checklist.keyParameters.join(', ')}`,
      `Minimum rows expected: ${JSON.stringify(checklist.minimumRows)}`,
      `Common conflict patterns: ${checklist.conflictPatterns.join(', ')}`,
    ].filter(Boolean).join('\n'),
  };
  return getDrawingParsingPrompt(enrichedParams);
}

/**
 * Generate the AI prompt for cross-document QA.
 * Wraps prompt-library.ts getCrossDocQAPrompt with extraction context.
 */
export function generateCrossDocQAPrompt(
  params: CrossDocQAParams,
  existingExtractions: ExtractionResult[],
): string {
  // Build context from existing extractions
  const contextParts: string[] = [];
  for (const ext of existingExtractions) {
    contextParts.push(
      `${ext.discipline}: ${ext.dimensions.length} dims, ${ext.levels.length} levels, ` +
      `${ext.materials.length} materials, ${ext.systems.length} systems, ` +
      `${ext.constraints.length} constraints, ${ext.conflicts.length} conflicts found`
    );
  }

  const enrichedParams: CrossDocQAParams = {
    ...params,
    additionalContext: [
      params.additionalContext ?? '',
      'Existing extraction summary:',
      ...contextParts,
    ].filter(Boolean).join('\n'),
  };
  return getCrossDocQAPrompt(enrichedParams);
}


// ═══════════════════════════════════════════════════════════════════════════════
//  CROSS-EXTRACTION QUERIES — Aggregate data across disciplines
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get all dimensions across all discipline extractions for a project.
 */
export function getAllDimensions(projectId: string): DimensionRow[] {
  return getAllExtractions(projectId).flatMap(e => e.dimensions);
}

/**
 * Get all levels across all discipline extractions for a project.
 */
export function getAllLevels(projectId: string): LevelElevationRow[] {
  return getAllExtractions(projectId).flatMap(e => e.levels);
}

/**
 * Get all materials across all discipline extractions for a project.
 */
export function getAllMaterials(projectId: string): MaterialRow[] {
  return getAllExtractions(projectId).flatMap(e => e.materials);
}

/**
 * Get all systems across all discipline extractions for a project.
 */
export function getAllSystems(projectId: string): SystemInventoryRow[] {
  return getAllExtractions(projectId).flatMap(e => e.systems);
}

/**
 * Get all constraints across all discipline extractions for a project.
 */
export function getAllConstraints(projectId: string): ConstraintRow[] {
  return getAllExtractions(projectId).flatMap(e => e.constraints);
}

/**
 * Get all conflicts across all discipline extractions for a project.
 */
export function getAllConflicts(projectId: string): ConflictRecord[] {
  return getAllExtractions(projectId).flatMap(e => e.conflicts);
}

/**
 * Get all gaps across all discipline extractions for a project.
 */
export function getAllExtractionGaps(projectId: string): Gap[] {
  return getAllExtractions(projectId).flatMap(e => e.gaps);
}


// ═══════════════════════════════════════════════════════════════════════════════
//  CROSS-DISCIPLINE CONFLICT DETECTION — SOP Part 4.3
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Run cross-discipline conflict detection.
 * Compares data across ALL discipline extractions for a project.
 *
 * Checks:
 *   - Same element dimensions across ARC, STR, MEP
 *   - Level elevations consistent across disciplines
 *   - Material specs match between disciplines
 */
export function detectCrossDisciplineConflicts(
  projectId: string,
): ConflictRecord[] {
  const allExtractions = getAllExtractions(projectId);
  if (allExtractions.length < 2) return [];

  const conflicts: ConflictRecord[] = [];
  let counter = 0;
  const nextId = (): string => {
    counter++;
    return `XDISC-${String(counter).padStart(3, '0')}`;
  };

  // ─── Cross-discipline dimension conflicts ─────────────────────────
  const allDims = allExtractions.flatMap(e =>
    e.dimensions.map(d => ({ ...d, discipline: e.discipline }))
  );
  const dimGroups = groupBy(allDims, d => `${d.appliesTo}::${d.dimType}`);

  for (const [key, rows] of Object.entries(dimGroups)) {
    if (rows.length < 2) continue;
    const disciplines = new Set(rows.map((r: any) => r.discipline));
    if (disciplines.size < 2) continue; // Same discipline — already caught within-discipline

    const values = new Set(rows.map(r => (r as any).width ?? (r as any).height ?? (r as any).depth ?? (r as any).value));
    if (values.size > 1) {
      conflicts.push({
        id: nextId(),
        type: 'CONFLICTING_DIMENSIONS',
        description: `Cross-discipline conflict: ${(rows[0] as any).dimType} for "${(rows[0] as any).appliesTo}" differs between disciplines ${[...disciplines].join(', ')}: values ${[...values].join(', ')} ${rows[0].unit}`,
        sources: rows.map(r => ({
          sheetOrSpecId: r.source ?? '',
          value: `${(r as any).width ?? (r as any).height ?? (r as any).depth ?? ''} ${r.unit} (${(r as any).discipline})`,
          evidenceRef: (typeof r.evidenceRef === "string" ? { documentId: r.evidenceRef } : r.evidenceRef || {}) as any,
        })),
        affectedScope: (rows[0] as any).appliesTo ?? '',
        severity: 'critical',
        action: 'Issue RFI for cross-discipline dimensional coordination. Both disciplines must agree.',
      });
    }
  }

  // ─── Cross-discipline level/elevation conflicts ───────────────────
  const allLevels = allExtractions.flatMap(e =>
    e.levels.map(l => ({ ...l, discipline: e.discipline }))
  );
  const levelGroups = groupBy(allLevels, l => l.levelName);

  for (const [levelName, rows] of Object.entries(levelGroups)) {
    if (rows.length < 2) continue;
    const disciplines = new Set(rows.map((r: any) => r.discipline));
    if (disciplines.size < 2) continue;

    const elevations = new Set(rows.map(r => r.elevation_m));
    if (elevations.size > 1) {
      conflicts.push({
        id: nextId(),
        type: 'DATUM_CONFLICT',
        description: `Cross-discipline elevation conflict: "${levelName}" shows ${[...elevations].join(', ')} across disciplines ${[...disciplines].join(', ')}`,
        sources: rows.map(r => ({
          sheetOrSpecId: r.source,
          value: `${r.elevation_m} m (${(r as any).discipline})`,
          evidenceRef: (typeof r.evidenceRef === "string" ? { documentId: r.evidenceRef } : r.evidenceRef || {}) as any,
        })),
        affectedScope: levelName,
        severity: 'critical',
        action: 'Verify datum reference. All disciplines must use same project datum.',
      });
    }
  }

  return conflicts;
}


// ═══════════════════════════════════════════════════════════════════════════════
//  SUMMARY / REPORT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a text summary of all extractions for a project.
 */
export function formatExtractionSummary(projectId: string): string {
  const allExtractions = getAllExtractions(projectId);
  if (allExtractions.length === 0) {
    return `No extractions found for project ${projectId}.`;
  }

  const lines: string[] = [
    `EXTRACTION SUMMARY — Project ${projectId}`,
    `Disciplines extracted: ${allExtractions.map(e => e.discipline).join(', ')}`,
    '',
  ];

  for (const ext of allExtractions) {
    const validation = validateExtraction(ext);
    lines.push(`── ${ext.discipline} (${ext.processedDocuments.length} documents) ──`);
    lines.push(`  Dimensions:  ${ext.dimensions.length} rows`);
    lines.push(`  Levels:      ${ext.levels.length} rows`);
    lines.push(`  Materials:   ${ext.materials.length} rows`);
    lines.push(`  Systems:     ${ext.systems.length} rows`);
    lines.push(`  Constraints: ${ext.constraints.length} rows`);
    lines.push(`  Conflicts:   ${ext.conflicts.length}`);
    lines.push(`  Gaps:        ${ext.gaps.length}`);
    lines.push(`  Complete:    ${validation.isComplete ? 'YES' : 'NO'}`);
    if (validation.tablesMissing.length > 0) {
      lines.push(`  Missing:     ${validation.tablesMissing.join(', ')}`);
    }
    lines.push('');
  }

  // Cross-discipline conflicts
  const xConflicts = detectCrossDisciplineConflicts(projectId);
  if (xConflicts.length > 0) {
    lines.push(`CROSS-DISCIPLINE CONFLICTS: ${xConflicts.length}`);
    for (const c of xConflicts) {
      lines.push(`  [${c.id}] ${c.type} — ${c.description}`);
    }
  }

  return lines.join('\n');
}


// ═══════════════════════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Helper: check evidence reference is present.
 * Returns a Gap if evidence is missing, null if OK.
 */
function checkEvidence(
  ref: EvidenceReference | undefined,
  table: string,
  rowIndex: number,
): Gap | null {
  if (!ref) {
    return makeGap(
      `EXT-NOEVIDENCE-${table}-${rowIndex}`,
      'PARAMETER_MISSING',
      'evidenceRef',
      `Row ${rowIndex} in ${table} table has no evidence reference. SOP Part 1 violation.`,
      'high',
      'ARC', // Default discipline — actual discipline set at extraction level
      'SOP Part 1 — Traceability',
    );
  }
  return null;
}

/**
 * Helper: create a typed Gap object.
 */
function makeGap(
  id: string,
  type: GapType,
  parameterName: string,
  description: string,
  impact: Gap['impact'],
  discipline: Discipline,
  sopReference: string,
): Gap {
  return {
    id,
    type,
    parameterName,
    affectedCount: 0,
    discipline,
    description,
    impact,
    sopReference,
  };
}

/**
 * Helper: group array items by a key function.
 */
function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}
