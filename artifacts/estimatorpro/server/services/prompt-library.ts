/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PROMPT LIBRARY — SOP Part 3
 *  BIM Coordination, Clash Detection, and Project Controls SOP v1.1
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Single-source-of-truth for all 6 standardized AI prompts.
 *  Consumer modules import the prompt they need rather than embedding AI
 *  instructions inline. This matches SOP Part 3's intent as a "copy/paste
 *  prompt library to drive consistent outputs."
 *
 *  SOP Reference: Part 3 — Prompt Library (Copy/Paste Prompts and Sample Outputs)
 *  SOP Quote:     "Use the prompts below to drive consistent outputs. Prompts
 *                  are written to require evidence-based extraction, structured
 *                  tables, and explicit identification of gaps/conflicts."
 *
 *  Core Principles Enforced in Every Prompt (SOP Executive Summary):
 *    1. Evidence-only — Do not assume. Every fact traceable to source.
 *    2. Explicit gaps — Missing/unclear/conflicting → GAP → RFI candidate.
 *    3. Revision control — Never mix revisions without flagging.
 *    4. Normalization — Standardize naming, preserve raw values.
 *    5. Separation of concerns — Parse first, interpret second, decide third.
 *    6. Automation-friendly — Tables + JSON-ready structure.
 *
 *  Gap Policy (Appendix D, enforced in all prompts):
 *    - Missing parameter → GAP + low confidence
 *    - Do NOT invent code thresholds, lead times, or clearances
 *    - Every GAP → corrected at source OR converted to RFI/Action Item
 *
 *  Consumed by:
 *    - extraction-checklists.ts   (Prompts 3.1, 3.5)
 *    - qto-qa-engine.ts           (Prompt 3.2)
 *    - constructability-engine.ts  (Prompt 3.3)
 *    - sequencing-4d.ts            (Prompt 3.4)
 *    - discipline-sop.ts           (Prompt 3.6)
 *
 *  @module prompt-library
 *  @version 1.0.0
 *  @sopPart 3
 */

import type { Discipline } from './types';

// ─── Shared Prompt Parameter Interfaces ─────────────────────────────────────

/** Parameters for every prompt — project context */
export interface BasePromptParams {
  /** Project name for header identification */
  projectName: string;
  /** Model version label (e.g., "Rev C", "IFC-2026-03-01") */
  modelVersion?: string;
  /** Document revision label if applicable */
  documentRevision?: string;
  /** Unit system in use */
  unitSystem?: 'metric' | 'imperial';
  /** Project datum/benchmark if known (e.g., "Project 0.000 = 100.500m geodetic") */
  datumReference?: string;
  /** Additional context the user wants injected into the prompt */
  additionalContext?: string;
}

/** Parameters specific to Prompt 3.1 — Drawing Parsing */
export interface DrawingParsingParams extends BasePromptParams {
  /** List of sheet IDs being parsed (e.g., ["A-101", "A-102", "S-201"]) */
  sheetIds: string[];
  /** Primary discipline of the drawings */
  discipline: Discipline;
  /** Drawing types (plan, section, elevation, detail, schedule) */
  drawingTypes?: string[];
  /** Known grid system reference (if previously extracted) */
  knownGrids?: string;
}

/** Parameters specific to Prompt 3.2 — Model QTO */
export interface ModelQTOParams extends BasePromptParams {
  /** BIM model identifier */
  modelId: string;
  /** Categories to filter (empty = all categories) */
  categoryFilter?: string[];
  /** Previous drop model version for delta comparison */
  previousModelVersion?: string;
  /** Whether to include MEP connectivity analysis */
  includeMEPConnectivity?: boolean;
}

/** Parameters specific to Prompt 3.3 — Constructability */
export interface ConstructabilityParams extends BasePromptParams {
  /** Project phase/stage (e.g., "DD", "CD", "Construction") */
  projectPhase?: string;
  /** Known site constraints (access, laydown, crane locations) */
  siteConstraints?: string[];
  /** Building type for context */
  buildingType?: string;
  /** Number of levels / storeys */
  storeyCount?: number;
}

/** Parameters specific to Prompt 3.4 — 4D Sequencing */
export interface SequencingParams extends BasePromptParams {
  /** Known WBS structure or activity list (if available from P6) */
  knownActivities?: string[];
  /** Known procurement constraints */
  procurementConstraints?: string[];
  /** Target milestone dates (if known) */
  milestones?: Array<{ name: string; date: string }>;
  /** Construction methodology preferences */
  methodologyNotes?: string;
}

/** Parameters specific to Prompt 3.5 — Cross-Document QA */
export interface CrossDocQAParams extends BasePromptParams {
  /** Pairs of documents being compared (e.g., [["A-101", "S-201"], ["Spec 03 30 00", "A-501"]]) */
  documentPairs?: string[][];
  /** Specific conflict types to focus on */
  conflictFocus?: Array<'CONFLICTING_DIMENSIONS' | 'DATUM_CONFLICT' | 'SCOPE_GAP' | 'UNCOORDINATED_DETAIL' | 'CHAIN_NOT_CLOSED'>;
  /** Known RFIs already issued (to avoid duplicating) */
  existingRFIs?: string[];
}

/** Parameters specific to Prompt 3.6 — Engineering Validation */
export interface EngineeringValidationParams extends BasePromptParams {
  /** Discipline(s) under validation */
  disciplines: Discipline[];
  /** Specific element IDs to validate (empty = full model) */
  elementIds?: string[];
  /** Applicable codes (e.g., "NBC 2020", "OBC 2024", "CSA A23.3") */
  applicableCodes?: string[];
  /** Known code thresholds (only use confirmed values) */
  confirmedThresholds?: Record<string, string>;
}

// ─── Core Principles Block (injected into every prompt) ─────────────────────

const CORE_PRINCIPLES = `
MANDATORY PRINCIPLES (NON-NEGOTIABLE):
1. EVIDENCE-ONLY: Do NOT assume. Every extracted fact must be traceable to a
   drawing (sheet + view/detail + note), spec (section + paragraph/table),
   RFI (ID + date), or model property (version + element ID).
2. EXPLICIT GAPS: If information is missing, unclear, or conflicting, record
   it as a GAP with type (PARAMETER_MISSING, LOW_CONFIDENCE, RFI_REQUIRED,
   ACTION_ITEM, or THRESHOLD_UNDEFINED) and convert to an RFI candidate.
3. REVISION CONTROL: Never mix revisions without flagging. Always state
   model/document version labels in outputs.
4. NORMALIZATION: Standardize level/zone/system naming for reporting, but
   preserve raw values in a "Raw Value" field.
5. SEPARATION OF CONCERNS: Parse and extract first. Interpret second.
   Recommend decisions/RFIs third.
6. AUTOMATION-FRIENDLY: Always produce concise tables PLUS a JSON-ready
   structure for integration. Tables must have column headers.
`;

const GAP_POLICY = `
GAP POLICY (Appendix D):
- If a required parameter is missing (SystemType, FireRating, Level,
  ServiceClearance_mm), log it as a GAP and treat outputs as LOW CONFIDENCE.
- Do NOT invent code thresholds, lead times, or clearances unless the project
  has explicitly defined them in BEP/specs.
- Every GAP must either be corrected at source (model metadata update) or
  converted into an RFI/Action Item with an owner and due date.
`;

const EVIDENCE_FORMAT = `
EVIDENCE REFERENCE FORMAT (per Data Traceability Rule):
- Drawings: Sheet# + View/Detail callout + Note# (e.g., "A-101, Detail 3, Note 7")
- Specs: Section + Paragraph/Table (e.g., "Spec 03 30 00, §3.2, Table 1")
- RFIs: RFI ID + Date (e.g., "RFI-047, 2026-02-15")
- Models: Version label + Element ID (e.g., "Rev C, GUID abc123...")
Every table row MUST include an Evidence Reference column.
`;

// ─── Helper: Build header block ─────────────────────────────────────────────

function buildHeader(params: BasePromptParams, promptId: string, title: string): string {
  const lines: string[] = [];
  lines.push(`═══ ${title} ═══`);
  lines.push(`Prompt ID: ${promptId}`);
  lines.push(`Project: ${params.projectName}`);
  if (params.modelVersion) {
    lines.push(`Model Version: ${params.modelVersion}`);
  }
  if (params.documentRevision) {
    lines.push(`Document Revision: ${params.documentRevision}`);
  }
  if (params.unitSystem) {
    lines.push(`Units: ${params.unitSystem}`);
  }
  if (params.datumReference) {
    lines.push(`Datum: ${params.datumReference}`);
  }
  lines.push('');
  return lines.join('\n');
}

// ─── Helper: Build footer block ─────────────────────────────────────────────

function buildFooter(params: BasePromptParams): string {
  const lines: string[] = [];
  if (params.additionalContext) {
    lines.push('');
    lines.push('ADDITIONAL CONTEXT:');
    lines.push(params.additionalContext);
  }
  lines.push('');
  lines.push(GAP_POLICY);
  lines.push(EVIDENCE_FORMAT);
  return lines.join('\n');
}


// ═══════════════════════════════════════════════════════════════════════════════
//  PROMPT 3.1 — Drawing Parsing
//  SOP Part 3.1: Scope, dimensions, levels, systems, notes
//  Consumer: extraction-checklists.ts, document-control-register.ts
// ═══════════════════════════════════════════════════════════════════════════════

export function getDrawingParsingPrompt(params: DrawingParsingParams): string {
  const header = buildHeader(params, '3.1', 'DRAWING PARSING PROMPT');

  const sheetList = params.sheetIds.length > 0
    ? `Sheets to parse: ${params.sheetIds.join(', ')}`
    : 'Parse ALL provided sheets.';

  const drawingTypeNote = params.drawingTypes && params.drawingTypes.length > 0
    ? `Drawing types included: ${params.drawingTypes.join(', ')}`
    : '';

  const gridNote = params.knownGrids
    ? `Known grid system: ${params.knownGrids}. Verify consistency.`
    : 'Extract grid system from drawings. If not found, record as GAP.';

  return `${header}
${CORE_PRINCIPLES}

TASK: Parse the following ${params.discipline} drawings and extract ALL of the
items listed below. Present results in structured tables. Identify any missing
or conflicting information. Do NOT assume — reference each extracted item to
its source sheet/detail/note.

${sheetList}
${drawingTypeNote}
${gridNote}

REQUIRED EXTRACTIONS:
1. SCOPE SUMMARY — What is being built and why (as explicitly stated).
   Include boundaries of scope (what is shown vs what is "by others").

2. DIMENSIONS TABLE — ALL explicit dimensions found.
   Columns: Element | Dimension | Value | Unit | Source Sheet | Detail/Note | Evidence Ref
   Include: overall building, room, opening, structural member, clearance dimensions.
   Flag: dimension chains that do not close, contradictory dimensions across sheets.

   STRUCTURAL MEMBER SIZES: For EVERY beam, column, girder, joist, brace, and
   structural element, extract the SECTION DESIGNATION (e.g., W10x49, W14x22,
   HSS6x6x3/8, W21x44, C10x30, L4x4x1/4) and record it in the Dimension column
   as "sectionDesignation". Also extract: depth, flange width, web thickness if
   given in details/schedules. If a member is shown but its section size is not
   specified, record as GAP with type PARAMETER_MISSING.

3. LEVELS / GRADES / ELEVATIONS TABLE —
   Columns: Level Name | Raw Value | Elevation | Datum | Reference Sheet | Evidence Ref
   Include: floor-to-floor heights, top of steel, top of slab, grade elevations.
   If datum convention is not stated, record as GAP.

4. MATERIALS AND CONSTRUCTION TYPES TABLE —
   Columns: Element | Material/Assembly | Specification Ref | Fire Rating | Source | Evidence Ref
   Include: concrete mix, steel grades, wall assemblies, insulation, finishes.
   Flag: "or equal" without approved alternatives, missing spec references.

5. STRUCTURAL SYSTEMS AND MEMBER SCHEDULE —
   Type (steel frame, concrete, masonry, wood), lateral system, foundation type,
   transfer conditions.
   Columns: System | Type | Location | Specification | Evidence Ref

   MEMBER SCHEDULE (CRITICAL): Extract a table of ALL structural members with:
   Columns: Member Mark | Element Type (Beam/Column/Brace/Joist/Girder) |
   Section Designation (e.g. W10x49, HSS6x6x3/8) | Material Grade (e.g. A992,
   A500 Gr.B) | Length/Height | Location (Grid/Level) | Evidence Ref
   This data is essential for accurate 3D modeling. If member schedules or
   structural plans show sections, extract EVERY entry. If sections are not
   shown, record each member as GAP with PARAMETER_MISSING.

6. MEP SYSTEM TYPES AND EQUIPMENT TAGS —
   Columns: System Name | System Type | Service | Equipment Tag | Location | Evidence Ref
   Include: HVAC, plumbing, fire protection, electrical, low voltage.
   Flag: equipment shown without tag, systems without clear routing.

7. GRIDLINES AND REFERENCE POINTS —
   Columns: Grid ID | Direction | Spacing | Evidence Ref
   Include: column grids, reference grids, benchmarks.

8. KEY NOTES AND GENERAL NOTES —
   Columns: Note ID | Content | Sheet | Scope | Evidence Ref
   Flag: notes that contradict other drawings, notes referencing missing details.

9. CONSTRAINTS REGISTER —
   Columns: Constraint | Type (design/access/procurement/safety/testing) | Impact | Evidence Ref

10. CONFLICTS FOUND —
    Columns: Conflict | Type (CONFLICTING_DIMENSIONS / DATUM_CONFLICT / SCOPE_GAP /
    UNCOORDINATED_DETAIL / CHAIN_NOT_CLOSED) | Sheet A | Sheet B | Recommended RFI | Evidence Ref

OUTPUT FORMAT: Provide all tables above plus a JSON-ready summary object with
keys: scopeSummary, dimensions[], levels[], materials[], systems[], grids[],
notes[], constraints[], conflicts[], gaps[].

${buildFooter(params)}`;
}


// ═══════════════════════════════════════════════════════════════════════════════
//  PROMPT 3.2 — Model QTO
//  SOP Part 3.2: Categories, families/types, quantities, materials, connectivity
//  Consumer: qto-qa-engine.ts
// ═══════════════════════════════════════════════════════════════════════════════

export function getModelQTOPrompt(params: ModelQTOParams): string {
  const header = buildHeader(params, '3.2', 'MODEL QTO PROMPT');

  const categoryNote = params.categoryFilter && params.categoryFilter.length > 0
    ? `Focus on categories: ${params.categoryFilter.join(', ')}`
    : 'Extract ALL categories found in the model.';

  const deltaNote = params.previousModelVersion
    ? `Previous model version: ${params.previousModelVersion}. Flag any ID changes or missing elements relative to prior drop.`
    : 'This is the first extraction — no prior version for comparison.';

  const mepNote = params.includeMEPConnectivity !== false
    ? 'Include full MEP connectivity analysis (unconnected connectors, orphan systems).'
    : 'Skip MEP connectivity analysis for this run.';

  return `${header}
${CORE_PRINCIPLES}

TASK: Parse the model data for model "${params.modelId}" and extract the items
listed below. Summarize findings cleanly and identify inconsistencies.

${categoryNote}
${deltaNote}
${mepNote}

REQUIRED EXTRACTIONS:

1. ELEMENT INDEX —
   Columns: Element ID | ID Type (GUID/UniqueId) | Category | Family | Type |
   Tag | Level | Workset | Host ID | System | Section Designation | Evidence Ref
   This is the master register of all model elements.
   For structural members (beams, columns, braces): the Section Designation
   column MUST contain the steel section (e.g., W10x49, HSS6x6x3/8) or
   concrete size (e.g., 400x400mm, 600mm dia). If not available, mark as GAP.

2. CATEGORY / TYPE ROLLUPS —
   Columns: Category | Type | Count | Total Length (m/ft) | Total Area (m²/ft²) |
   Total Volume (m³/ft³) | Unit | Evidence Ref
   Aggregate by category then by type within each category.

3. MATERIALS TABLE —
   Columns: Element ID | Category | Material Name | Is Placeholder | Compound Layers |
   Thickness | Evidence Ref
   Flag: "By Category", "Default", or blank materials as PLACEHOLDER_MATERIAL.
   Flag: inconsistent materials within the same family/type.

4. HOSTED DEPENDENCIES —
   Columns: Hosted Element ID | Host Element ID | Host Found | Category | Level | Evidence Ref
   Flag: ORPHAN when host ID is missing or host element does not exist.
   Orphans commonly cause false clashes and constructability issues.

5. MEP CONNECTIVITY SUMMARY —
   Columns: System Name | System Type | Service | Connected Count | Unconnected Count |
   Unconnected Element IDs | Evidence Ref
   Flag: unconnected connectors, system naming inconsistencies, elements in
   multiple systems.

6. QA RULE RESULTS — Run each of these mandatory checks:

   Rule 1 — ID STABILITY: Verify IFC GUID / Revit UniqueId is stable across drops.
   If prior version provided, compare IDs. Flag: UNSTABLE_IDS if >5% changed.

   Rule 2 — LEVEL ASSIGNMENT: Flag elements missing level/storey assignment.
   Report: count and % by category. Target: ≥90% assigned.

   Rule 3 — SYSTEM METADATA: For MEP elements, SystemType/Service must be populated.
   Report: count and % populated. Target: ≥80% for MEP categories.

   Rule 4 — PLACEHOLDER MATERIALS: Flag "By Category", "Default", or blank.
   Report: count and % by category.

   Rule 5 — ORPHAN DETECTION: Hosted elements missing host IDs.
   Report: count by category.

   Rule 6 — CONNECTIVITY: Unconnected MEP connectors.
   Report: count by system.

7. QTO MATURITY SCORING —
   Columns: Category | % with Level | % with System | % with Material |
   % with Size/Dim | Overall Maturity (%)
   If critical parameters are missing, state that quantities can only be
   reported as COUNTS (not length/area/volume).

OUTPUT FORMAT: Tables above plus JSON object with keys: elementIndex[],
categoryRollups[], materials[], hostedDeps[], mepConnectivity[],
qaResults{rule1..rule6}, maturityScores[], gaps[].

${buildFooter(params)}`;
}


// ═══════════════════════════════════════════════════════════════════════════════
//  PROMPT 3.3 — Constructability Analysis
//  SOP Part 3.3: Work areas, sequencing, temp works, safety, trade dependencies
//  Consumer: constructability-engine.ts
// ═══════════════════════════════════════════════════════════════════════════════

export function getConstructabilityPrompt(params: ConstructabilityParams): string {
  const header = buildHeader(params, '3.3', 'CONSTRUCTABILITY MODEL PROMPT');

  const phaseNote = params.projectPhase
    ? `Project phase: ${params.projectPhase}.`
    : '';

  const siteNote = params.siteConstraints && params.siteConstraints.length > 0
    ? `Known site constraints:\n${params.siteConstraints.map(c => `  - ${c}`).join('\n')}`
    : 'No site constraints provided — flag as GAP if relevant.';

  const buildingNote = [
    params.buildingType ? `Building type: ${params.buildingType}` : '',
    params.storeyCount ? `Storeys: ${params.storeyCount}` : '',
  ].filter(Boolean).join('. ');

  return `${header}
${CORE_PRINCIPLES}

TASK: Based on the parsed drawings and specifications, build a logical
constructability analysis. Present in a step-by-step structured format with
prerequisites, hold points, and evidence references. Identify gaps explicitly.

${phaseNote}
${siteNote}
${buildingNote}

REQUIRED OUTPUTS:

1. WORK AREAS / WORKFACES —
   Columns: Area ID | Level | Zone | Grid Limits | Description | Access Route |
   Laydown Space | Crane Access | Evidence Ref
   Define logical work areas by level/zone/grid.

2. ACCESS AND MATERIAL HANDLING CONSTRAINTS —
   Columns: Constraint | Type (access/material/lifting/staging) | Location |
   Impact | Mitigation | Evidence Ref
   Include: routes to work areas, laydown locations, lifting requirements,
   material staging areas, vertical transport.

3. TEMPORARY WORKS REGISTER —
   Columns: Item | Type (scaffold/shoring/temp_power/ventilation/protection/other) |
   Location | Duration | Dependency | Removal Trigger | Evidence Ref
   Do NOT assume temporary works unless drawings/specs indicate them.

4. TRADE DEPENDENCY MATRIX —
   Columns: Activity | Predecessor | Successor | Hold Point | Inspection Required |
   Discipline | Evidence Ref
   Include: design approvals, shop drawings, outages, inspections.

5. SAFETY AND CLEARANCE ISSUES —
   Columns: Issue | Type (headroom/access/electrical_clearance/fall_protection/confined_space) |
   Location | Code Basis | Mitigation | Evidence Ref
   Do NOT assume code thresholds unless the governing code is provided.
   If code basis is absent, flag as THRESHOLD_UNDEFINED.

6. CONSTRUCTABILITY RISK REGISTER —
   Columns: Risk | Probability (H/M/L) | Impact (H/M/L) | Location |
   Mitigation | Owner | Evidence Ref

OUTPUT FORMAT: Tables above plus JSON object with keys: workAreas[],
accessConstraints[], tempWorks[], tradeDependencies[], safetyIssues[],
constructabilityRisks[], gaps[].

${buildFooter(params)}`;
}


// ═══════════════════════════════════════════════════════════════════════════════
//  PROMPT 3.4 — 4D Sequencing
//  SOP Part 3.4: Baseline build order + model linkage + long-leads
//  Consumer: sequencing-4d.ts
// ═══════════════════════════════════════════════════════════════════════════════

export function getSequencing4DPrompt(params: SequencingParams): string {
  const header = buildHeader(params, '3.4', '4D SEQUENCING PROMPT');

  const activityNote = params.knownActivities && params.knownActivities.length > 0
    ? `Known P6 activities for mapping:\n${params.knownActivities.map(a => `  - ${a}`).join('\n')}`
    : 'No P6 activity list provided — generate logical activity sequence from drawings/specs.';

  const procurementNote = params.procurementConstraints && params.procurementConstraints.length > 0
    ? `Known procurement constraints:\n${params.procurementConstraints.map(c => `  - ${c}`).join('\n')}`
    : '';

  const milestoneNote = params.milestones && params.milestones.length > 0
    ? `Target milestones:\n${params.milestones.map(m => `  - ${m.name}: ${m.date}`).join('\n')}`
    : 'No milestones provided — flag as GAP for schedule linkage.';

  const methodNote = params.methodologyNotes
    ? `Methodology notes: ${params.methodologyNotes}`
    : '';

  return `${header}
${CORE_PRINCIPLES}

TASK: Using the project data, create a baseline 4D sequencing plan. Return a
schedule-ready sequence table plus an activity-to-model mapping matrix. Flag
all missing data (WBS mapping, zones, lead times).

${activityNote}
${procurementNote}
${milestoneNote}
${methodNote}

REQUIRED OUTPUTS:

1. BUILD ORDER / PHASE TABLE —
   Columns: Phase | Activity | Level | Zone | Trade | Predecessor | Duration Basis |
   Constraint Type | Evidence Ref
   Organize by construction phase: Site Prep → Substructure → Superstructure →
   Envelope → Rough-in → Close-in → Finishes → Commissioning.
   Duration basis must cite spec, typical practice, or GAP.

2. ACTIVITY-TO-MODEL MAPPING MATRIX —
   Columns: WBS Code | Activity ID | Activity Name | Model Set (discipline) |
   Element IDs | Level | Zone | Mapping Confidence | Evidence Ref
   If WBS codes not available, propose logical codes and flag for P6 confirmation.

3. CONSTRAINTS / PREREQUISITES LOG —
   Columns: Constraint | Type (design_approval/outage/inspection/procurement_gate/
   long_lead/regulatory) | Activity Impacted | Required By Date | Status | Evidence Ref

4. LONG-LEAD PROCUREMENT LOG —
   Columns: Item | Specification Ref | Submittal Gate | Lead Time | Lead Time Source |
   Install Activity | Required On Site | Evidence Ref

   CRITICAL: Do NOT invent lead times. Lead times MUST come from specs, vendor
   data, or agreed project assumptions. If lead time is absent, mark as GAP and
   produce an RFI / Procurement Action Item.

5. SEQUENCING RISKS —
   Columns: Risk | Impact | Activity | Mitigation | Owner | Evidence Ref

OUTPUT FORMAT: Tables above plus JSON object with keys: buildOrder[],
activityMapping[], constraints[], longLeadItems[], sequencingRisks[], gaps[].

${buildFooter(params)}`;
}


// ═══════════════════════════════════════════════════════════════════════════════
//  PROMPT 3.5 — Cross-Document QA
//  SOP Part 3.5: Conflicts, discrepancies, scope gaps, RFIs
//  Consumer: extraction-checklists.ts
// ═══════════════════════════════════════════════════════════════════════════════

export function getCrossDocQAPrompt(params: CrossDocQAParams): string {
  const header = buildHeader(params, '3.5', 'CROSS-DOCUMENT QA PROMPT');

  const pairsNote = params.documentPairs && params.documentPairs.length > 0
    ? `Document pairs to compare:\n${params.documentPairs.map(p => `  - ${p[0]} ↔ ${p[1]}`).join('\n')}`
    : 'Compare ALL provided documents against each other for cross-discipline conflicts.';

  const focusNote = params.conflictFocus && params.conflictFocus.length > 0
    ? `Focus on conflict types: ${params.conflictFocus.join(', ')}`
    : 'Check for all conflict types: CONFLICTING_DIMENSIONS, DATUM_CONFLICT, SCOPE_GAP, UNCOORDINATED_DETAIL, CHAIN_NOT_CLOSED.';

  const rfiNote = params.existingRFIs && params.existingRFIs.length > 0
    ? `Existing RFIs (do not duplicate):\n${params.existingRFIs.map(r => `  - ${r}`).join('\n')}`
    : '';

  return `${header}
${CORE_PRINCIPLES}

TASK: Compare the provided drawings, specifications, and RFIs. Identify ALL
conflicts, discrepancies, missing information, and scope gaps. List each issue
with precise references and recommended RFI wording.

${pairsNote}
${focusNote}
${rfiNote}

REQUIRED OUTPUTS:

1. CONFLICT REGISTER —
   Columns: Conflict ID | Type | Description | Document A (Sheet/Spec) |
   Document B (Sheet/Spec) | Severity (Critical/Major/Minor) |
   Recommended Action | Evidence Ref A | Evidence Ref B

   Conflict types per SOP Part 4.3:
   - CONFLICTING_DIMENSIONS: Same element dimensioned differently across
     plan/section/detail, or dimension chain does not close.
   - DATUM_CONFLICT: Elevations referenced to different datums without crosswalk.
   - SCOPE_GAP: "By others" not assigned elsewhere; referenced details missing;
     schedules missing.
   - UNCOORDINATED_DETAIL: Callouts to wrong sheet/detail; revision mismatches
     across disciplines.
   - CHAIN_NOT_CLOSED: Dimension strings that do not mathematically close.

2. MISSING INFORMATION LOG —
   Columns: Item | Expected Location | Impact | Recommended RFI | Evidence Ref
   Include: missing details, missing schedules, incomplete specifications,
   undefined materials, unresolved "or equal" substitutions.

3. SCOPE GAP ANALYSIS —
   Columns: Gap | Discipline A | Discipline B | Impact | Resolution |
   RFI Required | Evidence Ref
   Focus on inter-discipline handoff gaps (structural openings vs MEP
   penetrations, architectural finishes vs MEP rough-in, etc.).

4. RFI DRAFTS —
   For each critical/major conflict, provide:
   Columns: RFI ID (proposed) | Subject | Question | Reference Documents |
   Required Decision Date | Impact if Unresolved | Recommended Response | Evidence Ref

   RFI questions should be precise, referencing exact sheet/detail/spec
   paragraph, and include proposed resolution options where possible.

5. COORDINATION ITEMS —
   Columns: Item | Disciplines Involved | Status | Required Action | Evidence Ref
   Items that are not conflicts but require coordination agreement.

OUTPUT FORMAT: Tables above plus JSON object with keys: conflicts[],
missingInfo[], scopeGaps[], rfiDrafts[], coordinationItems[], gaps[].

${buildFooter(params)}`;
}


// ═══════════════════════════════════════════════════════════════════════════════
//  PROMPT 3.6 — Engineering Logic Validation
//  SOP Part 3.6: Structural feasibility, MEP coordination, code risks
//  Consumer: discipline-sop.ts
// ═══════════════════════════════════════════════════════════════════════════════

export function getEngineeringValidationPrompt(params: EngineeringValidationParams): string {
  const header = buildHeader(params, '3.6', 'ENGINEERING LOGIC VALIDATION PROMPT');

  const disciplineNote = `Disciplines under validation: ${params.disciplines.join(', ')}`;

  const elementNote = params.elementIds && params.elementIds.length > 0
    ? `Specific elements to validate: ${params.elementIds.length} elements (IDs provided in data).`
    : 'Validate ALL elements in the model.';

  const codeNote = params.applicableCodes && params.applicableCodes.length > 0
    ? `Applicable codes: ${params.applicableCodes.join(', ')}`
    : 'No specific codes provided — flag code-dependent findings as CODE_RISK with THRESHOLD_UNDEFINED.';

  const thresholdNote = params.confirmedThresholds && Object.keys(params.confirmedThresholds).length > 0
    ? `Confirmed thresholds (use these ONLY):\n${Object.entries(params.confirmedThresholds).map(([k, v]) => `  - ${k}: ${v}`).join('\n')}`
    : '';

  return `${header}
${CORE_PRINCIPLES}

TASK: Validate the engineering logic of the design. Flag structural, M/E, and
architectural interference. Provide clear reasoning and recommended corrective
actions. Do NOT assume code thresholds unless the governing code basis is
provided and confirmed.

${disciplineNote}
${elementNote}
${codeNote}
${thresholdNote}

REQUIRED OUTPUTS:

1. STRUCTURAL FEASIBILITY —
   Columns: Element | Issue | Type (load_path/transfer/lateral/connection/
   bearing/span/cantilever) | Severity | Reasoning | Corrective Action | Evidence Ref
   Check: load path continuity, transfer conditions, lateral system adequacy,
   connection logic, bearing support, span-to-depth ratios.
   Do NOT calculate loads — flag concerns for structural engineer review.

2. MEP COORDINATION CONFLICTS —
   Columns: MEP Element | Conflicting Element | Conflict Type (hard_clash/
   clearance/routing/access/capacity) | Location | Severity |
   Resolution Options | Evidence Ref
   Check: duct/pipe routing vs structure, cable tray vs pipes, equipment
   access clearances, riser congestion, ceiling plenum capacity.

3. ARCHITECTURAL CLEARANCE ISSUES —
   Columns: Element | Issue | Clearance Required | Clearance Available |
   Code Basis | Location | Evidence Ref
   Check: door clearances, corridor widths, headroom, egress paths, accessible
   route requirements, equipment service access.
   CRITICAL: If code basis is not provided for a threshold, flag as CODE_RISK
   and issue an RFI for the governing requirement. Do NOT assume thresholds.

4. CODE COMPLIANCE CONCERNS —
   Columns: Element | Code Reference | Requirement | Condition Found |
   Status (PASS/FAIL/CODE_RISK/UNKNOWN) | Evidence Ref
   Flag: fire rating gaps, egress deficiencies, accessibility issues,
   structural code concerns, life safety conflicts.
   Every CODE_RISK must include: "Code basis: [stated or THRESHOLD_UNDEFINED]"

5. INTER-DISCIPLINE INTERFERENCE —
   Columns: Element A | Discipline A | Element B | Discipline B |
   Interference Type | Location | Priority | Resolution | Evidence Ref
   Focus: structural member vs MEP routing, architectural partition vs MEP,
   ceiling control zones vs duct routing, riser space allocation.

6. VALIDATION SUMMARY —
   Total issues by severity (Critical/Major/Minor/Informational).
   Total issues by discipline.
   Total CODE_RISK items (require code basis confirmation).
   Total GAPs identified.
   Overall validation confidence (High/Medium/Low based on data completeness).

OUTPUT FORMAT: Tables above plus JSON object with keys: structuralIssues[],
mepConflicts[], clearanceIssues[], codeCompliance[], interDiscipline[],
validationSummary{}, gaps[].

${buildFooter(params)}`;
}


// ═══════════════════════════════════════════════════════════════════════════════
//  UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/** Get all prompt IDs and their SOP references */
export function listPrompts(): Array<{
  id: string;
  name: string;
  sopRef: string;
  consumer: string;
}> {
  return [
    {
      id: '3.1',
      name: 'Drawing Parsing',
      sopRef: 'Part 3.1 — Scope, dimensions, levels, systems, notes',
      consumer: 'extraction-checklists.ts',
    },
    {
      id: '3.2',
      name: 'Model QTO',
      sopRef: 'Part 3.2 — Categories, families/types, quantities, materials, connectivity',
      consumer: 'qto-qa-engine.ts',
    },
    {
      id: '3.3',
      name: 'Constructability Analysis',
      sopRef: 'Part 3.3 — Work areas, sequencing, temp works, safety, trade deps',
      consumer: 'constructability-engine.ts',
    },
    {
      id: '3.4',
      name: '4D Sequencing',
      sopRef: 'Part 3.4 — Build order, activity-to-model mapping, long-leads',
      consumer: 'sequencing-4d.ts',
    },
    {
      id: '3.5',
      name: 'Cross-Document QA',
      sopRef: 'Part 3.5 — Conflicts, discrepancies, scope gaps, RFIs',
      consumer: 'extraction-checklists.ts',
    },
    {
      id: '3.6',
      name: 'Engineering Logic Validation',
      sopRef: 'Part 3.6 — Structural feasibility, MEP coordination, code risks',
      consumer: 'discipline-sop.ts',
    },
  ];
}

/** Validate that required params are present for a given prompt */
export function validatePromptParams(
  promptId: string,
  params: BasePromptParams,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!params.projectName || params.projectName.trim() === '') {
    errors.push('projectName is required for all prompts.');
  }

  switch (promptId) {
    case '3.1': {
      const p = params as DrawingParsingParams;
      if (!p.sheetIds || p.sheetIds.length === 0) {
        errors.push('sheetIds[] is required for Drawing Parsing prompt.');
      }
      if (!p.discipline) {
        errors.push('discipline is required for Drawing Parsing prompt.');
      }
      break;
    }
    case '3.2': {
      const p = params as ModelQTOParams;
      if (!p.modelId || p.modelId.trim() === '') {
        errors.push('modelId is required for Model QTO prompt.');
      }
      break;
    }
    case '3.4': {
      // No strict required fields beyond base — but warn if no activities
      const p = params as SequencingParams;
      if ((!p.knownActivities || p.knownActivities.length === 0) && (!p.milestones || p.milestones.length === 0)) {
        // Not an error, but a warning — prompt handles this gracefully
      }
      break;
    }
    case '3.6': {
      const p = params as EngineeringValidationParams;
      if (!p.disciplines || p.disciplines.length === 0) {
        errors.push('disciplines[] is required for Engineering Validation prompt.');
      }
      break;
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Get prompt by ID — dispatcher for generic invocation */
export function getPromptById(promptId: string, params: BasePromptParams): string | null {
  switch (promptId) {
    case '3.1': return getDrawingParsingPrompt(params as DrawingParsingParams);
    case '3.2': return getModelQTOPrompt(params as ModelQTOParams);
    case '3.3': return getConstructabilityPrompt(params as ConstructabilityParams);
    case '3.4': return getSequencing4DPrompt(params as SequencingParams);
    case '3.5': return getCrossDocQAPrompt(params as CrossDocQAParams);
    case '3.6': return getEngineeringValidationPrompt(params as EngineeringValidationParams);
    default: return null;
  }
}

/**
 * Get the core principles block alone — for modules that need to prepend
 * SOP principles to a custom prompt (e.g., multi-stage analysis).
 */
export function getCorePrinciples(): string {
  return CORE_PRINCIPLES;
}

/**
 * Get the gap policy block alone — for modules that need to append
 * gap policy reminders to their own processing logic.
 */
export function getGapPolicy(): string {
  return GAP_POLICY;
}

/**
 * Get the evidence format block alone — for modules that need to remind
 * the AI of the required evidence reference format.
 */
export function getEvidenceFormat(): string {
  return EVIDENCE_FORMAT;
}
