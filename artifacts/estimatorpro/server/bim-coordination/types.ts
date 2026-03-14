// server/bim-coordination/types.ts
// =============================================================================
// BIM COORDINATION FOUNDATION TYPES & ENUMS
// =============================================================================
//
// Phase 1 — Foundation (everything else imports from here)
//
// SOP Coverage:
//   Appendix B — Status enums and definitions (Table 9)
//   Appendix C — Priority scoring rubric 1-5 (Table 10)
//   Appendix D — Gap policy
//   Part 7.3   — Clash test types and tolerances (Table 3)
//   Part 7.6   — Priority scoring (construction risk calibrated)
//   Part 8.1   — Naming convention
//   Part 8.2   — Issue log columns (20-column, Table 7)
//   Part 9     — Viewpoint types
//   Part 10.1  — Delta classification
//   Part 11.2  — Risk-to-path classification
//   Part 12.3  — Penetration status
//
// Principle: Every enum and interface maps 1:1 to a specific SOP table or
//            bullet point. No invented fields. No assumed values.
// =============================================================================

// ─── Discipline Enums (SOP Part 2) ──────────────────────────────────────────

/** Discipline codes per SOP Part 2 discipline-specific SOPs */
export type Discipline =
  | 'ARC'      // Architectural
  | 'STR'      // Structural
  | 'MECH'     // Mechanical
  | 'PLBG_FP'  // Plumbing / Fire Protection
  | 'ELEC'     // Electrical
  | 'BIM_VDC'  // BIM/VDC Management
  | 'P6';      // Project Controls / Scheduler

/** Discipline display labels */
export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  ARC: 'Architectural',
  STR: 'Structural',
  MECH: 'Mechanical',
  PLBG_FP: 'Plumbing / Fire Protection',
  ELEC: 'Electrical',
  BIM_VDC: 'BIM/VDC Management',
  P6: 'Project Controls / Scheduler',
};

// ─── Issue Status (SOP Appendix B, Table 9) ─────────────────────────────────

/**
 * Status workflow per Appendix B.
 *
 * Valid transitions:
 *   OPEN → IN_REVIEW → DECISION_REQUIRED → IN_PROGRESS → READY_FOR_VERIFY → RESOLVED
 *   Any stage → DEFERRED (with milestone tie + mitigation plan)
 *   Any stage → WONT_FIX (with justification + risk acceptance)
 *   Any stage → DUPLICATE (merged under parent/root-cause group)
 */
export type IssueStatus =
  | 'OPEN'                // Identified and logged; not yet reviewed by owner
  | 'IN_REVIEW'           // Owner reviewing; proposal being developed
  | 'DECISION_REQUIRED'   // Blocked pending design/owner decision or RFI response
  | 'IN_PROGRESS'         // Fix being implemented in discipline model
  | 'READY_FOR_VERIFY'    // Fix claimed complete; pending re-test in next federation
  | 'RESOLVED'            // Verified resolved by delta report and re-test
  | 'DEFERRED'            // Approved deferral with milestone tie and mitigation plan
  | 'WONT_FIX'            // Approved as-is; justification documented; risk accepted
  | 'DUPLICATE';          // Merged under parent/root-cause group

export const ISSUE_STATUS_DEFINITIONS: Record<IssueStatus, string> = {
  OPEN: 'Identified and logged; not yet reviewed by owner.',
  IN_REVIEW: 'Owner reviewing; proposal being developed.',
  DECISION_REQUIRED: 'Blocked pending design/owner decision or RFI response.',
  IN_PROGRESS: 'Fix being implemented in discipline model.',
  READY_FOR_VERIFY: 'Fix claimed complete; pending re-test in next federation.',
  RESOLVED: 'Verified resolved by delta report and re-test.',
  DEFERRED: 'Approved deferral with milestone tie and mitigation plan.',
  WONT_FIX: 'Approved as-is; justification documented; risk accepted.',
  DUPLICATE: 'Merged under parent/root-cause group.',
};

/** Valid status transitions — enforced by issue-log module */
export const VALID_STATUS_TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  OPEN: ['IN_REVIEW', 'DEFERRED', 'WONT_FIX', 'DUPLICATE'],
  IN_REVIEW: ['DECISION_REQUIRED', 'IN_PROGRESS', 'DEFERRED', 'WONT_FIX', 'DUPLICATE'],
  DECISION_REQUIRED: ['IN_PROGRESS', 'DEFERRED', 'WONT_FIX', 'DUPLICATE'],
  IN_PROGRESS: ['READY_FOR_VERIFY', 'DEFERRED', 'WONT_FIX', 'DUPLICATE'],
  READY_FOR_VERIFY: ['RESOLVED', 'IN_PROGRESS', 'DEFERRED'],
  RESOLVED: [],   // Terminal — can only regress via delta tracker
  DEFERRED: ['OPEN', 'IN_PROGRESS'],   // Can be reopened
  WONT_FIX: [],   // Terminal
  DUPLICATE: [],  // Terminal
};

// ─── Clash Test Types (SOP Part 7.3, Table 3) ──────────────────────────────

/** Clash test classification per SOP Table 3 */
export type ClashTestType =
  | 'Hard'           // Physical interference, 0-5mm tolerance
  | 'Clearance'      // Soft/clearance, project-standard tolerance
  | 'Code_Access';   // Code/access, 0mm against clearance zone

/** Standard clash test definitions per SOP Table 3 */
export interface ClashTestDefinition {
  testId: string;
  testName: string;
  setA: string;                     // Selection set name
  setB: string;                     // Selection set name
  type: ClashTestType;
  toleranceMm: number;              // 0 = hard clash, >0 = clearance
  purpose: string;
  sopReference: string;             // e.g., "Table 3, CD-001"
}

/** Pre-defined clash tests from SOP Table 3 */
export const STANDARD_CLASH_TESTS: ClashTestDefinition[] = [
  {
    testId: 'CD-001',
    testName: 'Struct vs MEP (Hard)',
    setA: 'Structure',
    setB: 'MEP_All',
    type: 'Hard',
    toleranceMm: 5,
    purpose: 'Prevent physical interferences',
    sopReference: 'Part 7.3, Table 3',
  },
  {
    testId: 'SC-01',
    testName: 'Duct vs Duct (Soft)',
    setA: 'Ducts',
    setB: 'Ducts',
    type: 'Clearance',
    toleranceMm: 25,
    purpose: 'Maintain install tolerance',
    sopReference: 'Part 7.3, Table 3',
  },
  {
    testId: 'SC-02',
    testName: 'Duct vs Pipe (Soft)',
    setA: 'Ducts',
    setB: 'Pipes',
    type: 'Clearance',
    toleranceMm: 25,
    purpose: 'Avoid routing congestion',
    sopReference: 'Part 7.3, Table 3',
  },
  {
    testId: 'SC-03',
    testName: 'Pipe vs Tray (Soft)',
    setA: 'Pipes',
    setB: 'CableTrays',
    type: 'Clearance',
    toleranceMm: 13,
    purpose: 'Avoid tray/pipe conflicts',
    sopReference: 'Part 7.3, Table 3',
  },
  {
    testId: 'AC-001',
    testName: 'Access panel keep-out',
    setA: 'AccessPanel_ClearanceBoxes',
    setB: 'Obstructions',
    type: 'Code_Access',
    toleranceMm: 0,
    purpose: 'Maintain access panel clearance',
    sopReference: 'Part 7.3, Table 3',
  },
  {
    testId: 'AC-002',
    testName: 'Equipment service zone',
    setA: 'Equipment_ClearanceZones',
    setB: 'Obstructions',
    type: 'Code_Access',
    toleranceMm: 0,
    purpose: 'Maintain service clearances',
    sopReference: 'Part 7.3, Table 3',
  },
];

// ─── Priority Scoring (SOP Appendix C, Table 10) ────────────────────────────

/**
 * Priority scoring dimensions per Appendix C.
 * Each dimension scored 1-5.
 *
 * Table 10 rubric:
 *   1 = No code implication / Not near execution / Minor adjustment / Local
 *   3 = Likely code risk / Near-term, limited float / Significant rework / Blocks close-in
 *   5 = Critical code violation / CP, blocks milestone / Embedded/long-lead / Stops turnover
 *
 * Final Priority = max(lifeSafetyCode, round(weightedSum))
 * Code/Access issues always listed first and treated as high priority until proven otherwise.
 */
export interface PriorityScores {
  lifeSafetyCode: number;       // 1-5: Life-safety / Code compliance
  scheduleCriticality: number;  // 1-5: Schedule criticality
  reworkCost: number;           // 1-5: Rework cost potential
  downstreamBlocking: number;   // 1-5: Downstream blocking
}

/** Priority scoring weights (calibrated for construction risk) */
export const PRIORITY_WEIGHTS = {
  lifeSafetyCode: 1.0,       // Always dominates via max() rule
  scheduleCriticality: 0.35,
  reworkCost: 0.35,
  downstreamBlocking: 0.30,
} as const;

/**
 * Calculate final priority per SOP Appendix C.
 * Final = max(lifeSafetyCode, round(weighted sum of others))
 */
export function calculatePriority(scores: PriorityScores): number {
  const weightedSum =
    scores.scheduleCriticality * PRIORITY_WEIGHTS.scheduleCriticality +
    scores.reworkCost * PRIORITY_WEIGHTS.reworkCost +
    scores.downstreamBlocking * PRIORITY_WEIGHTS.downstreamBlocking;

  const roundedWeighted = Math.round(weightedSum);
  const finalPriority = Math.max(scores.lifeSafetyCode, roundedWeighted);

  return Math.min(5, Math.max(1, finalPriority));
}

/** Priority rubric descriptions per Table 10 */
export const PRIORITY_RUBRIC: Record<string, Record<number, string>> = {
  lifeSafetyCode: {
    1: 'No code implication',
    3: 'Likely code risk but workaround plausible',
    5: 'Critical code/life-safety violation',
  },
  scheduleCriticality: {
    1: 'Not near execution; float available',
    3: 'Near-term work; limited float',
    5: 'Critical path; blocks milestone',
  },
  reworkCost: {
    1: 'Minor adjustment',
    3: 'Significant rework potential',
    5: 'Embedded/long-lead/high demolition risk',
  },
  downstreamBlocking: {
    1: 'Local; does not gate work',
    3: 'Blocks close-in in area',
    5: 'Stops turnover/commissioning path',
  },
};

// ─── Evidence Reference (SOP Part 1, traceability rule) ─────────────────────

/**
 * Every table row must include an Evidence Reference.
 * Per SOP:
 *   Drawings: Sheet number + view/detail callout + note number
 *   Specs: section + paragraph/table reference
 *   RFIs: RFI ID + date
 *   Models: model version label + element ID (IFC GUID / Revit UniqueId)
 */
export interface EvidenceReference {
  type: 'drawing' | 'specification' | 'rfi' | 'model' | 'verbal' | 'other';

  // Drawing references
  sheetNumber?: string;
  viewDetailCallout?: string;
  noteNumber?: string;

  // Specification references
  specSection?: string;
  specParagraph?: string;
  specTable?: string;

  // RFI references
  rfiId?: string;
  rfiDate?: string;

  // Model references
  modelVersionLabel?: string;
  elementId?: string;        // IFC GUID or Revit UniqueId
  elementIdType?: 'IFC_GUID' | 'Revit_UniqueId' | 'unknown';

  // Other
  description?: string;
  date?: string;
}

/** Format evidence reference as citation string */
export function formatEvidenceRef(ref: EvidenceReference): string {
  switch (ref.type) {
    case 'drawing': {
      const parts = [ref.sheetNumber];
      if (ref.viewDetailCallout) parts.push(ref.viewDetailCallout);
      if (ref.noteNumber) parts.push('Note ' + ref.noteNumber);
      return parts.filter(Boolean).join(', ');
    }
    case 'specification':
      return [ref.specSection, ref.specParagraph, ref.specTable].filter(Boolean).join(' / ');
    case 'rfi':
      return [ref.rfiId, ref.rfiDate].filter(Boolean).join(' dated ');
    case 'model': {
      const idStr = ref.elementId
        ? (ref.elementIdType === 'IFC_GUID' ? 'IFC:' : 'RVT:') + ref.elementId
        : '';
      return [ref.modelVersionLabel, idStr].filter(Boolean).join(' / ');
    }
    default:
      return ref.description || 'No evidence reference';
  }
}

// ─── Gap Policy (SOP Appendix D) ────────────────────────────────────────────

/**
 * Gap types per Appendix D.
 * If a required parameter is missing, log as GAP and treat outputs as low confidence.
 * Do NOT invent code thresholds, lead times, or clearances unless project-defined.
 * Every GAP → corrected at source OR converted to RFI/Action Item with owner + due date.
 */
export type GapType =
  | 'PARAMETER_MISSING'     // Required parameter absent (SystemType, FireRating, Level, ServiceClearance_mm)
  | 'LOW_CONFIDENCE'        // Fallback used, reduced confidence
  | 'RFI_REQUIRED'          // Gap requires formal RFI with decision date
  | 'ACTION_ITEM'           // Gap requires non-RFI action (model update, metadata correction)
  | 'THRESHOLD_UNDEFINED';  // Code/clearance threshold not project-defined

export interface Gap {
  id: string;
  type: GapType;
  parameterName: string;         // e.g., 'SystemType', 'FireRating', 'ServiceClearance_mm'
  affectedElementIds: string[];
  affectedCount: number;
  discipline: Discipline;
  description: string;
  impact: 'high' | 'medium' | 'low';
  owner?: string;
  dueDate?: string;
  rfiId?: string;                // If converted to RFI
  evidenceRef?: EvidenceReference;
  sopReference: string;          // SOP section that requires this parameter
}

// ─── Conflict Types (SOP Part 4.3) ──────────────────────────────────────────

/** Conflict identification types per SOP Part 4.3 */
export type ConflictType =
  | 'CONFLICTING_DIMENSIONS'   // Same element dimensioned differently across plan/section/detail
  | 'DATUM_CONFLICT'           // Elevations referenced to different datums without crosswalk
  | 'SCOPE_GAP'               // 'by others' not assigned; referenced details missing; schedules missing
  | 'UNCOORDINATED_DETAIL'    // Callouts to wrong sheet/detail; revision mismatches
  | 'CHAIN_NOT_CLOSED';       // Dimension chain does not close

// ─── Delta Classification (SOP Part 10.1) ───────────────────────────────────

/** Version-to-version delta classification per Part 10.1 */
export type DeltaClassification =
  | 'RESOLVED'      // Present in Vn, not in Vm
  | 'PERSISTENT'    // Present in both
  | 'NEW'           // Present only in Vm (latest)
  | 'REGRESSION';   // Previously resolved but reappears as near-match

/** Matching strategy for delta comparison */
export type MatchStrategy =
  | 'strict'   // test + root ID + type + level/grid
  | 'fuzzy';   // discipline pair + level/zone + location cluster (with confidence)

// ─── Risk-to-Path (SOP Part 11.2) ───────────────────────────────────────────

/** Risk-to-path classification per Part 11.2 */
export type RiskToPath =
  | 'CP_RISK'     // On or very near critical path
  | 'NEAR_CP'     // Near critical path, limited float
  | 'BUFFERED'    // Sufficient float available
  | 'UNKNOWN';    // Logic/float data missing

// ─── Penetration Status (SOP Part 12.3) ─────────────────────────────────────

/** Penetration matrix statuses per Part 12.3 */
export type PenetrationStatus =
  | 'OK'                    // Sleeve exists, firestop defined, rating known, size known
  | 'SLEEVE_MISSING'        // Penetration exists with no sleeve/opening evidence
  | 'FIRESTOP_UNDEFINED'    // Sleeve exists but no firestop system reference
  | 'RATING_UNKNOWN'        // Assembly rating not defined
  | 'SIZE_UNKNOWN';         // Sleeve size not calculable (OD/insulation data missing)

// ─── Viewpoint Types (SOP Part 9) ───────────────────────────────────────────

/** Viewpoint types per Part 9 — three per clash group */
export type ViewpointType =
  | 'ISO'    // 3D overview and routing context
  | 'SEC'    // Section box buildability view
  | 'PLAN';  // Plan locator view for grids/rooms

/** Color override standard per Part 9 */
export const VIEWPOINT_COLOR_OVERRIDES = {
  offender: '#FF0000',     // Red — root-cause element
  impacted: '#FFAA00',     // Amber — victim elements
  context: '#808080',      // Gray — context elements
  hidden: 'transparent',   // Hidden — everything else (preferred)
  transparent: '#00000020', // Transparent fallback
} as const;

/** Viewpoint naming suffix convention per Part 9 */
export const VIEWPOINT_SUFFIXES: Record<ViewpointType, string> = {
  ISO: '__ISO',
  SEC: '__SEC',
  PLAN: '__PLAN',
};

// ─── Selection Set (SOP Part 7.2, Table 2) ──────────────────────────────────

/** Selection set definition per SOP Table 2 */
export interface SelectionSetDefinition {
  name: string;
  description: string;
  primaryRule: SelectionRule;                // Revit/NWC typical
  fallbackRule: SelectionRule;              // When primary property missing
  ifcMapping: string[];                     // IFC entity types
  confidenceWhenFallback: 'high' | 'medium' | 'low';
  gapWhenFallback: string;                  // GAP description logged
  sopReference: string;
}

export interface SelectionRule {
  categories: string[];                     // Revit categories
  systemTypeFilter?: string[];              // SystemType values to include
  systemTypeExclude?: string[];             // SystemType values to exclude
  worksetExclude?: string[];                // Worksets to exclude
  nameTokens?: string[];                    // Name-based fallback tokens
  additionalFilters?: Record<string, any>;
}

// ─── BIM Element (Extended for coordination) ────────────────────────────────

/** BIM element with coordination-required metadata */
export interface CoordinationElement {
  id: string;                               // Stable ID (IFC GUID or Revit UniqueId)
  idType: 'IFC_GUID' | 'Revit_UniqueId' | 'internal';
  category: string;                         // Revit category or IFC class
  familyType: string;                       // Family:Type string
  tag?: string;                             // Element tag if available
  discipline: Discipline;
  level?: string;                           // Level/storey assignment
  zone?: string;                            // Zone assignment
  workset?: string;                         // Workset name
  systemType?: string;                      // MEP SystemType/Service
  systemName?: string;                      // System name
  hostId?: string;                          // Host element ID (for hosted elements)
  material?: string;                        // Primary material
  fireRating?: string;                      // Fire rating if applicable
  serviceClearanceMm?: number;              // ServiceClearance_mm parameter

  // Geometry (AABB — axis-aligned bounding box)
  bbox: BoundingBox;

  // Connectivity (MEP)
  connectors?: ConnectorInfo[];

  // Metadata completeness flags (for QA)
  hasLevel: boolean;
  hasSystemType: boolean;
  hasMaterial: boolean;
  hasHostId: boolean;                       // Only relevant for hosted elements
  isHosted: boolean;

  // Model version tracking
  modelVersion: string;
  modelDropDate?: string;

  // Raw properties (preserved per SOP "preserve raw values")
  rawProperties: Record<string, any>;
}

export interface BoundingBox {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

export interface ConnectorInfo {
  connectorId: string;
  systemType: string;
  isConnected: boolean;
  connectedToId?: string;
  position: { x: number; y: number; z: number };
}

// ─── Clash Result ────────────────────────────────────────────────────────────

/** Individual clash detection result */
export interface ClashResult {
  clashId: string;
  testId: string;                           // Reference to ClashTestDefinition.testId
  testName: string;
  type: ClashTestType;

  elementA: ClashElementRef;
  elementB: ClashElementRef;

  // Geometric data
  distanceMm: number;                       // Negative = penetration depth, positive = clearance
  overlapVolumeMm3?: number;                // For hard clashes
  clashPoint: { x: number; y: number; z: number };

  // Location
  level?: string;
  zone?: string;
  gridRef?: string;

  // Classification
  isFalsePositive: boolean;
  falsePositiveReason?: string;
  isDuplicate: boolean;
  duplicateOfId?: string;

  // Grouping
  rootCauseElementId?: string;
  groupId?: string;

  // Naming convention
  slug: string;                             // Per Part 8.1

  // Evidence
  modelVersionA: string;
  modelVersionB: string;
}

export interface ClashElementRef {
  elementId: string;
  idType: 'IFC_GUID' | 'Revit_UniqueId' | 'internal';
  category: string;
  familyType: string;
  discipline: Discipline;
  systemType?: string;
  level?: string;
}

// ─── Clash Group (de-duplicated root-cause group) ───────────────────────────

/** Root-cause group of related clashes */
export interface ClashGroup {
  groupId: string;
  rootElementId: string;
  rootElementDiscipline: Discipline;
  rootElementSystem?: string;

  clashIds: string[];
  clashCount: number;

  testId: string;
  type: ClashTestType;

  level?: string;
  zone?: string;
  gridRef?: string;

  // Priority (SOP Appendix C)
  priorityScores: PriorityScores;
  finalPriority: number;

  // Naming
  slug: string;

  // Owner (based on root element discipline/system)
  owner: Discipline;
  ownerBasis: 'system_metadata' | 'category_fallback' | 'manual';

  // Gaps
  gaps: Gap[];
}

// ─── Issue Log Entry (SOP Part 8.2, Table 7 — 20 columns) ──────────────────

/** Full 20-column issue log record per SOP Table 7 */
export interface IssueLogEntry {
  // Required columns (Part 8.2)
  id: string;
  title: string;                            // Naming convention string
  test: string;                             // Test ID (CD-001, SC-01, etc.)
  type: ClashTestType;
  level: string;
  zone: string;
  grid: string;
  priority: number;                         // 1-5
  owner: Discipline;
  status: IssueStatus;
  targetDate: string;                       // ISO date

  // Recommended additional columns
  slug: string;                             // Naming convention slug
  viewpointId?: string;
  rootElementId: string;
  systemA: string;
  systemB: string;
  wbs?: string;                             // P6 WBS code
  activityId?: string;                      // P6 Activity ID
  milestoneAtRisk?: string;
  evidenceRefs: EvidenceReference[];
  gaps: string[];                           // Gap flags

  // Tracking
  createdDate: string;
  updatedDate: string;
  resolvedDate?: string;
  clashGroupId: string;
  priorityScores: PriorityScores;

  // RFI linkage
  rfiId?: string;
  rfiStatus?: string;

  // Resolution
  resolutionDescription?: string;
  verifiedInDrop?: string;                  // Model version that verified resolution

  // Deferral (if DEFERRED)
  deferralMilestone?: string;
  deferralMitigationPlan?: string;
}

// ─── Document Control Register (SOP Part 4.1) ──────────────────────────────

export type DocumentStatus = 'IFR' | 'IFC' | 'DRAFT' | 'SUPERSEDED' | 'VOID';

export interface DocumentControlEntry {
  id: string;
  sheetOrSpecId: string;
  title: string;
  discipline: Discipline | string;
  revision: string;
  revisionDate: string;
  status: DocumentStatus;
  scopeNotes: string;
  evidenceRef: EvidenceReference;
}

// ─── Extraction Checklist Row (SOP Part 4.2) ────────────────────────────────

export interface DimensionRow {
  sheet: string;
  viewDetail: string;
  dimType: string;            // Opening width, room height, slab thickness, etc.
  value: number;
  units: string;              // mm, m, in, ft
  appliesTo: string;          // e.g., 'Door D-12 opening'
  refPoint?: string;
  evidenceRef: EvidenceReference;
  conflicts?: string[];       // Cross-reference IDs if conflicting
}

export interface LevelElevationRow {
  sheet: string;
  datum: string;              // e.g., 'Project 0.000'
  levelName: string;
  elevation: number;
  units: string;
  appliesTo: string;
  notes?: string;
  evidenceRef: EvidenceReference;
}

export interface MaterialRow {
  location: string;
  material: string;
  specRef: string;
  thicknessOrRating?: string;
  finish?: string;
  notes?: string;
  evidenceRef: EvidenceReference;
}

export interface SystemInventoryRow {
  discipline: Discipline | string;
  system: string;
  tag: string;
  keyParameters: string;
  location: string;
  evidenceRef: EvidenceReference;
}

export interface ConstraintRow {
  constraintId: string;
  type: 'design' | 'access' | 'procurement' | 'safety' | 'testing' | 'code' | 'other';
  description: string;
  affectedScope: string;
  evidenceRef: EvidenceReference;
}

// ─── QTO QA Result (SOP Part 5) ─────────────────────────────────────────────

export interface QTOQAResult {
  modelId: string;
  modelVersion: string;
  runDate: string;

  // Element index summary
  totalElements: number;
  categorySummary: { category: string; count: number; discipline: Discipline }[];
  typeSummary: { familyType: string; count: number; category: string }[];

  // QA rule results
  idStabilityCheck: QARuleResult;
  levelAssignmentCheck: QARuleResult;
  systemMetadataCheck: QARuleResult;
  materialCheck: QARuleResult;
  orphanCheck: QARuleResult;
  connectivityCheck: QARuleResult;

  // Maturity scoring
  maturityScore: {
    overall: number;                       // 0-100%
    byCategory: { category: string; completeness: number; missingFields: string[] }[];
    quantityReliability: 'full' | 'counts_only';  // counts_only if critical params missing
  };

  // Gaps
  gaps: Gap[];
}

export interface QARuleResult {
  ruleName: string;
  passed: boolean;
  flaggedCount: number;
  totalChecked: number;
  flaggedElementIds: string[];
  description: string;
  sopReference: string;
}

// ─── Schedule Linkage (SOP Part 11) ─────────────────────────────────────────

export interface ScheduleLinkage {
  clashGroupId: string;
  activityIds: string[];
  milestoneAtRisk: string;
  milestoneDate: string;
  riskToPath: RiskToPath;
  mitigationActions: string[];
  decisionDate: string;
  delayExposureDays: { min: number; mostLikely: number; max: number };
  mappingConfidence: 'high' | 'medium' | 'low';
  gaps: string[];                          // e.g., 'SCHEDULE_LINK_MISSING'
  notes: string;
}

// ─── Weekly Governance (SOP Part 13) ─────────────────────────────────────────

export interface GovernanceStatus {
  projectId: string;
  currentWeek: string;
  modelVersionLabel: string;
  clashRunId: string;

  // Cutoff compliance
  disciplineModelsDue: string;             // T-48h
  federationClashDue: string;              // T-36h
  meetingPackDue: string;                  // T-24h

  // SLA tracking
  openIssuesCount: number;
  issuesPastSLA: number;                   // Beyond 3 working days without response
  issuesPastResolutionSLA: number;         // P1-2 beyond 10 working days

  // Delta summary
  newThisDrop: number;
  resolvedThisDrop: number;
  persistentCount: number;
  regressionCount: number;

  // By priority
  openByPriority: Record<number, number>;  // { 1: count, 2: count, ... }

  // Meeting readiness
  meetingPackReady: boolean;
  topRisksIdentified: number;
}

// ─── Constructability (SOP Part 6) ──────────────────────────────────────────

export interface WorkArea {
  id: string;
  name: string;
  level: string;
  zone: string;
  gridBounds: { startGrid: string; endGrid: string };
  accessRoutes: string[];
  materialHandling: string[];
  constraints: string[];
  evidenceRef: EvidenceReference;
}

export interface TempWorksItem {
  id: string;
  type: 'scaffold' | 'shoring' | 'temporary_power' | 'temporary_ventilation' | 'protection' | 'other';
  description: string;
  location: string;
  duration: string;
  prerequisite: string;
  evidenceRef: EvidenceReference;
}

export interface TradeDependency {
  predecessorTrade: string;
  successorTrade: string;
  dependencyType: 'finish_to_start' | 'start_to_start' | 'finish_to_finish';
  holdPoint: boolean;
  inspectionRequired: boolean;
  description: string;
  evidenceRef: EvidenceReference;
}

// ─── 4D Sequencing (SOP Part 6.2) ──────────────────────────────────────────

export interface BuildPhase {
  phaseNumber: number;
  phaseName: string;
  level?: string;
  zone?: string;
  activities: BuildActivity[];
  prerequisites: string[];
  constraints: string[];
}

export interface BuildActivity {
  activityId: string;
  description: string;
  trade: string;
  wbs?: string;
  modelElementIds: string[];               // Activity-to-model mapping
  predecessors: string[];
  successors: string[];
  duration?: string;
  holdPoints: string[];
}

export interface LongLeadItem {
  item: string;
  submittalGate: string;
  leadTimeSource: string;                  // Spec/vendor/assumption — NOT invented
  leadTimeDays?: number;                   // null if unknown → GAP
  installDependency: string;
  isGap: boolean;                          // true if lead time unknown
  evidenceRef: EvidenceReference;
}

// ─── Penetrations Matrix (SOP Part 12.3) ────────────────────────────────────

export interface PenetrationRecord {
  id: string;
  level: string;
  gridRef: string;
  mepElementId: string;
  mepSystem: string;
  mepDiscipline: Discipline;
  assemblyId: string;                      // Wall/floor being penetrated
  assemblyType: string;
  assemblyFireRating?: string;
  sleeveExists: boolean;
  sleeveId?: string;
  sleeveSizeMm?: number;
  firestopDefined: boolean;
  firestopSystem?: string;
  status: PenetrationStatus;
  evidenceRef: EvidenceReference;
}
