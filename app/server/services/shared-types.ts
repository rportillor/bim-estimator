/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  SHARED TYPES — EstimatorPro v3
 *  Common type definitions across SOP Parts 6.4, 7, 8
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Consumed by:
 *    - report-generator.ts (SOP Part 7)
 *    - clash-detection-engine.ts (SOP Part 6.4)
 *    - integration-export-engine.ts (SOP Part 8)
 *    - construction-workflow-processor.ts (MissingDataTracker)
 *
 *  @module shared-types
 *  @version 1.0.0
 */


// ══════════════════════════════════════════════════════════════════════════════
//  GAP / RFI TYPES
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Represents a data gap detected by any SOP module.
 * Gaps trigger RFIs when they impact estimate accuracy.
 */
export interface Gap {
  /** Unique gap identifier (format: GAP-XXX-NNN) */
  id: string;

  /** Gap classification */
  type: GapType;

  /** The specific parameter that is missing or ambiguous */
  parameterName: string;

  /** Human-readable description of the gap */
  description: string;

  /** Responsible discipline */
  discipline: Discipline;

  /** Severity impact on estimate accuracy */
  impact: GapImpact;

  /** Number of BIM elements affected by this gap */
  affectedCount: number;

  /** Current resolution status */
  status?: GapStatus;

  /** Assigned RFI number if one has been generated */
  rfiNumber?: string;

  /** Which SOP module detected this gap */
  sopReference: string;

  /** Reference to the document location (or null if no evidence) */
  evidenceRef?: EvidenceReference | null;
}

export type GapType =
  | 'missing_dimension'
  | 'missing_spec'
  | 'missing_rate'
  | 'missing_detail'
  | 'ambiguous_detail'
  | 'conflicting_data'
  | 'missing_clearance'
  | 'missing_material'
  | 'missing_assembly'
  | 'vendor_quote_pending'
  | 'PARAMETER_MISSING';

export type GapImpact = 'critical' | 'high' | 'medium' | 'low';

export type GapStatus = 'open' | 'pending' | 'closed' | 'deferred';


// ══════════════════════════════════════════════════════════════════════════════
//  EVIDENCE REFERENCE
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Tracks where data was extracted from in the construction documents.
 * Used for traceability (SOP Part 6.3 — No-Defaults Enforcement).
 */
export interface EvidenceReference {
  /** Document ID from the project document set (e.g., 'A-201', 'S-301') */
  documentId?: string;

  /** Page number within the document */
  page?: number;

  /** Sheet identifier (for multi-sheet drawings) */
  sheet?: string;

  /** Section reference (e.g., specification section number) */
  section?: string;

  /** Coordinate location on the drawing (x, y in drawing units) */
  location?: { x: number; y: number };

  /** Drawing detail reference (e.g., 'Detail 3/A-301') */
  detailRef?: string;
}

/**
 * Format an EvidenceReference as a human-readable string.
 */
export function formatEvidenceRef(ref: EvidenceReference | null | undefined): string {
  if (!ref) return '[none]';
  const parts: string[] = [];
  if (ref.documentId) parts.push(ref.documentId);
  if (ref.sheet) parts.push(`Sheet ${ref.sheet}`);
  if (ref.page) parts.push(`p.${ref.page}`);
  if (ref.section) parts.push(`§${ref.section}`);
  if (ref.detailRef) parts.push(ref.detailRef);
  if (ref.location) parts.push(`@ (${ref.location.x},${ref.location.y})`);
  return parts.length > 0 ? parts.join(', ') : '[none]';
}


// ══════════════════════════════════════════════════════════════════════════════
//  DISCIPLINE TYPES
// ══════════════════════════════════════════════════════════════════════════════

export type Discipline =
  | 'Architectural'
  | 'Structural'
  | 'Mechanical'
  | 'Electrical'
  | 'Plumbing'
  | 'Fire Protection'
  | 'Civil'
  | 'Landscape'
  | 'General'
  | 'ARC'
  | 'STR'
  | 'MEP'
  | 'MECH'
  | 'ELEC'
  | 'PLMB'
  | 'FP';

/**
 * Map a CSI division number to a discipline.
 */
export function divisionToDiscipline(division: string): Discipline {
  const num = parseInt(division, 10);
  if (num >= 1 && num <= 14) return 'Architectural';
  if (num >= 3 && num <= 5) return 'Structural';
  if (num === 21) return 'Fire Protection';
  if (num === 22) return 'Plumbing';
  if (num >= 23 && num <= 25) return 'Mechanical';
  if (num >= 26 && num <= 28) return 'Electrical';
  if (num >= 31 && num <= 35) return 'Civil';
  if (num === 32) return 'Landscape';
  return 'General';
}


// ══════════════════════════════════════════════════════════════════════════════
//  CONFIDENCE TYPES
// ══════════════════════════════════════════════════════════════════════════════

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'GAP';

/**
 * Determine confidence level for a BOQ line item.
 * HIGH: 2+ evidence refs, qty > 0, rate > 0
 * MEDIUM: 1 evidence ref, qty > 0, rate > 0
 * LOW: zero qty or rate (but has some evidence)
 * GAP: no document evidence at all
 */
export function assessConfidence(
  evidenceRefCount: number,
  quantity: number,
  rate: number,
): ConfidenceLevel {
  if (evidenceRefCount === 0) return 'GAP';
  if (quantity <= 0 || rate <= 0) return 'LOW';
  if (evidenceRefCount >= 2) return 'HIGH';
  return 'MEDIUM';
}

/** Numeric score per confidence level (for weighted averages) */
export const CONFIDENCE_SCORE: Record<ConfidenceLevel, number> = {
  HIGH: 100,
  MEDIUM: 70,
  LOW: 40,
  GAP: 0,
};


// ══════════════════════════════════════════════════════════════════════════════
//  CSI MASTERFORMAT 2018 DIVISION MAP
// ══════════════════════════════════════════════════════════════════════════════

export const CSI_DIVISION_MAP: Record<string, string> = {
  '01': 'General Requirements',
  '02': 'Existing Conditions',
  '03': 'Concrete',
  '04': 'Masonry',
  '05': 'Metals',
  '06': 'Wood, Plastics, Composites',
  '07': 'Thermal & Moisture Protection',
  '08': 'Openings',
  '09': 'Finishes',
  '10': 'Specialties',
  '11': 'Equipment',
  '12': 'Furnishings',
  '13': 'Special Construction',
  '14': 'Conveying Equipment',
  '21': 'Fire Suppression',
  '22': 'Plumbing',
  '23': 'HVAC',
  '25': 'Integrated Automation',
  '26': 'Electrical',
  '27': 'Communications',
  '28': 'Electronic Safety & Security',
  '31': 'Earthwork',
  '32': 'Exterior Improvements',
  '33': 'Utilities',
  '34': 'Transportation',
  '35': 'Waterway & Marine',
};


// ══════════════════════════════════════════════════════════════════════════════
//  AACE ESTIMATE CLASSIFICATION
// ══════════════════════════════════════════════════════════════════════════════

export type AACEEstimateClass = 'Class1' | 'Class2' | 'Class3' | 'Class4' | 'Class5';

export interface AccuracyRange {
  low: number;   // e.g., -3 for Class 1
  high: number;  // e.g., +10 for Class 1
}

export const AACE_ACCURACY: Record<AACEEstimateClass, AccuracyRange> = {
  Class1: { low: -3, high: 10 },
  Class2: { low: -5, high: 15 },
  Class3: { low: -10, high: 20 },
  Class4: { low: -15, high: 30 },
  Class5: { low: -20, high: 50 },
};

export const AACE_DESCRIPTION: Record<AACEEstimateClass, string> = {
  Class1: 'Definitive Estimate (Check Estimate)',
  Class2: 'Detailed Estimate (Control Estimate)',
  Class3: 'Budget Authorization (Semi-Detailed)',
  Class4: 'Feasibility Estimate (Preliminary)',
  Class5: 'Order of Magnitude (Screening)',
};


// ══════════════════════════════════════════════════════════════════════════════
//  REPORT TYPES
// ══════════════════════════════════════════════════════════════════════════════

export type ReportType =
  | 'BOQ_FULL'
  | 'BOQ_SUMMARY'
  | 'BID_LEVELING'
  | 'CLASH_REPORT'
  | 'CONSTRUCTABILITY'
  | 'EXECUTIVE_SUMMARY'
  | 'GAP_REGISTER'
  | 'SCHEDULE_OF_VALUES';


// ══════════════════════════════════════════════════════════════════════════════
//  STORAGE INTERFACE EXTENSIONS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Optional storage methods consumed by report-routes.ts and export-routes.ts.
 * All have try/catch fallbacks — the app runs without them.
 * Implement as modules are integrated.
 */
export interface IStorageReportExtensions {
  getEstimateByProject?(projectId: string): Promise<{ lines: any[] } | null>;
  getClashResults?(projectId: string): Promise<any | null>;
  getConstructabilityAnalysis?(projectId: string): Promise<any | null>;
  getMonteCarloResult?(projectId: string): Promise<any | null>;
  getSequencingModel?(projectId: string): Promise<any | null>;
  getProjectGaps?(projectId: string): Promise<any[] | null>;
}

// ── Phase 2 type stubs — previously in bim-coordination/types.ts ──────────
// These types are referenced by document-control-register, extraction-checklists,
// and constructability-engine. Open index signatures allow fields used in callers.

export type DocumentStatus = 'ISSUED' | 'SUPERSEDED' | 'DRAFT' | 'VOIDED' | 'FOR_REVIEW';

export interface DocumentControlEntry {
  id: string;
  documentNumber: string;
  title: string;
  revision: string;
  status: DocumentStatus;
  issueDate: string;
  discipline?: string;
  fileRef?: string;
  [key: string]: any;
}

export interface DimensionRow {
  elementId: string;
  elementType: string;
  width?: number;
  height?: number;
  depth?: number;
  unit: string;
  source: string;
  evidenceRef?: string;
  appliesTo?: string;
  dimType?: string;
  [key: string]: any;
}

export interface LevelElevationRow {
  levelName: string;
  elevation_m: number;
  finishedFloorLevel?: number;
  source: string;
  evidenceRef?: string;
  [key: string]: any;
}

export interface MaterialRow {
  csiCode: string;
  description: string;
  quantity: number;
  unit: string;
  specification?: string;
  evidenceRef?: string;
  [key: string]: any;
}

export interface SystemInventoryRow {
  systemType: string;
  description: string;
  csiDivision: string;
  quantity?: number;
  unit?: string;
  [key: string]: any;
}

export interface ConstraintRow {
  constraintType: string;
  description: string;
  affectedElement?: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  [key: string]: any;
}

export interface WorkArea {
  id: string;
  name: string;
  level: string;
  area_m2: number;
  constraints?: string[];
  [key: string]: any;
}

export interface TempWorksItem {
  id: string;
  description: string;
  type: 'SHORING' | 'FORMWORK' | 'SCAFFOLDING' | 'HOARDING' | 'OTHER';
  duration_days: number;
  area?: string;
  [key: string]: any;
}

export interface TradeDependency {
  predecessorTrade: string;
  successorTrade: string;
  lagDays: number;
  constraint: 'FS' | 'FF' | 'SS' | 'SF';
  notes?: string;
  [key: string]: any;
}
