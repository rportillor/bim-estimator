/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOCUMENT CONTROL REGISTER — SOP Parts 1, 4.1
 *  Phase 2 — Document Control & Structured Extraction
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Manages the project document register: every drawing, specification,
 *  addendum, bulletin, and RFI response that feeds the coordination workflow.
 *
 *  SOP Part 1 rule: "Every fact must trace to a numbered drawing sheet,
 *  a specification section, or a model element ID."
 *
 *  SOP Part 4.1 requirements:
 *    - Document control register (sheet/spec ID, discipline, revision, date, status, scope)
 *    - Revision tracking (addenda, bulletins, RFI log)
 *    - Unit/datum convention check (GAP if project 0.000 not stated)
 *    - Transmittal numbering
 *
 *  Consumes from types.ts:
 *    DocumentControlEntry, DocumentStatus, EvidenceReference, Gap,
 *    GapType, Discipline
 *
 *  Consumed by:
 *    extraction-checklists.ts (needs register to validate evidence references)
 *    qto-qa-engine.ts (model version tracking)
 *    clash-engine.ts (evidence for clash grouping)
 *    issue-log.ts (future — document references in issues)
 *    report-generator.ts (future — document register summary)
 *
 *  @module document-control-register
 *  @version 1.0.0
 */

import type {
  DocumentControlEntry,
  DocumentStatus,
  EvidenceReference,
  Gap,
  GapType,
  Discipline,
} from './types';


// ═══════════════════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/** A single revision event (addendum, bulletin, RFI response, re-issue) */
export interface RevisionEvent {
  documentId: string;
  previousRevision: string;
  newRevision: string;
  date: string;                       // ISO date
  type: 'ADDENDUM' | 'BULLETIN' | 'RFI_RESPONSE' | 'RE_ISSUE' | 'INITIAL';
  referenceNumber?: string;           // e.g., "Addendum 03", "RFI-042"
  description: string;
  affectedSheets: string[];
  supersedes?: string;                // Previous document ID if superseded
}

/** Transmittal record (per SOP Part 4.1 — formal document issue) */
export interface TransmittalRecord {
  transmittalNumber: string;          // e.g., "TX-2026-001"
  date: string;
  from: string;                       // Issuer
  to: string;                         // Recipient
  purpose: 'IFR' | 'IFC' | 'ADDENDUM' | 'BULLETIN' | 'RFI_RESPONSE' | 'RECORD';
  documentIds: string[];
  notes?: string;
}

/** Project unit and datum convention (SOP Part 4.1 — mandatory check) */
export interface UnitDatumConvention {
  unitSystem: 'metric' | 'imperial' | 'mixed' | 'NOT_STATED';
  primaryLengthUnit: string;          // 'mm', 'm', 'in', 'ft', 'NOT_STATED'
  datumReference: string;             // e.g., 'Project 0.000 = 265.50m geodetic'
  datumSource?: EvidenceReference;
  benchmarks: Array<{
    name: string;
    elevation: number;
    units: string;
    source: EvidenceReference;
  }>;
  verified: boolean;
  gaps: Gap[];                        // GAPs if datum not stated, units inconsistent, etc.
}

/** Complete document register with all tracking data */
export interface DocumentRegister {
  projectId: string;
  projectName: string;
  documents: DocumentControlEntry[];
  revisionHistory: RevisionEvent[];
  transmittals: TransmittalRecord[];
  unitDatumConvention: UnitDatumConvention;
  lastUpdated: string;
}

/** Result of a register validation check */
export interface RegisterValidation {
  isValid: boolean;
  documentCount: number;
  byStatus: Record<DocumentStatus, number>;
  byDiscipline: Record<string, number>;
  gaps: Gap[];
  warnings: string[];
}


// ═══════════════════════════════════════════════════════════════════════════════
//  DOCUMENT REGISTER — IN-MEMORY STORE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * In-memory document register store.
 * Key = projectId. Production: backed by Drizzle ORM.
 */
const registers = new Map<string, DocumentRegister>();

/** Transmittal counter per project (for sequential numbering) */
const transmittalCounters = new Map<string, number>();


// ═══════════════════════════════════════════════════════════════════════════════
//  REGISTER CRUD
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Initialize a new document register for a project.
 *
 * @param projectId     Unique project identifier
 * @param projectName   Human-readable project name
 * @returns The initialized (empty) register
 */
export function initializeRegister(
  projectId: string,
  projectName: string,
): DocumentRegister {
  const register: DocumentRegister = {
    projectId,
    projectName,
    documents: [],
    revisionHistory: [],
    transmittals: [],
    unitDatumConvention: {
      unitSystem: 'NOT_STATED',
      primaryLengthUnit: 'NOT_STATED',
      datumReference: 'NOT_STATED',
      benchmarks: [],
      verified: false,
      gaps: [],
    },
    lastUpdated: new Date().toISOString(),
  };

  registers.set(projectId, register);
  transmittalCounters.set(projectId, 0);
  return register;
}

/**
 * Get the document register for a project.
 */
export function getRegister(projectId: string): DocumentRegister | undefined {
  return registers.get(projectId);
}

/**
 * Add a document to the register.
 * Creates a REVISION_EVENT of type INITIAL.
 *
 * @param projectId  Project identifier
 * @param doc        Document entry (id, sheetOrSpecId, title, discipline, etc.)
 * @returns The added document, or null if register doesn't exist
 */
export function addDocument(
  projectId: string,
  doc: DocumentControlEntry,
): DocumentControlEntry | null {
  const reg = registers.get(projectId);
  if (!reg) return null;

  // Check for duplicate ID
  const existing = reg.documents.find(d => d.id === doc.id);
  if (existing) {
    return null; // Caller should use reviseDocument instead
  }

  reg.documents.push(doc);

  // Record initial revision event
  reg.revisionHistory.push({
    documentId: doc.id,
    previousRevision: '',
    newRevision: doc.revision,
    date: doc.revisionDate,
    type: 'INITIAL',
    description: `Initial issue: ${doc.title}`,
    affectedSheets: [doc.sheetOrSpecId],
  });

  reg.lastUpdated = new Date().toISOString();
  return doc;
}

/**
 * Add multiple documents to the register at once.
 * Returns count of successfully added documents.
 */
export function addDocuments(
  projectId: string,
  docs: DocumentControlEntry[],
): { added: number; skipped: number; errors: string[] } {
  const errors: string[] = [];
  let added = 0;
  let skipped = 0;

  for (const doc of docs) {
    const result = addDocument(projectId, doc);
    if (result) {
      added++;
    } else {
      skipped++;
      errors.push(`Document ${doc.id} (${doc.sheetOrSpecId}) — duplicate or register not found`);
    }
  }

  return { added, skipped, errors };
}

/**
 * Revise an existing document (new revision, addendum, bulletin, RFI response).
 *
 * SOP Part 4.1: Revision tracking must capture what changed, what it supersedes,
 * and what sheets are affected.
 */
export function reviseDocument(
  projectId: string,
  documentId: string,
  update: {
    newRevision: string;
    newStatus?: DocumentStatus;
    newScopeNotes?: string;
    revisionType: RevisionEvent['type'];
    referenceNumber?: string;
    description: string;
    affectedSheets?: string[];
  },
): DocumentControlEntry | null {
  const reg = registers.get(projectId);
  if (!reg) return null;

  const docIndex = reg.documents.findIndex(d => d.id === documentId);
  if (docIndex === -1) return null;

  const doc = reg.documents[docIndex];
  const previousRevision = doc.revision;

  // Record revision event
  reg.revisionHistory.push({
    documentId,
    previousRevision,
    newRevision: update.newRevision,
    date: new Date().toISOString(),
    type: update.revisionType,
    referenceNumber: update.referenceNumber,
    description: update.description,
    affectedSheets: update.affectedSheets ?? [doc.sheetOrSpecId],
    supersedes: previousRevision !== update.newRevision ? documentId : undefined,
  });

  // Update the document
  doc.revision = update.newRevision;
  doc.revisionDate = new Date().toISOString().split('T')[0];
  if (update.newStatus) doc.status = update.newStatus;
  if (update.newScopeNotes) doc.scopeNotes = update.newScopeNotes;

  reg.documents[docIndex] = doc;
  reg.lastUpdated = new Date().toISOString();
  return doc;
}

/**
 * Change a document's status (e.g., IFR → IFC, or IFC → SUPERSEDED).
 */
export function updateDocumentStatus(
  projectId: string,
  documentId: string,
  newStatus: DocumentStatus,
): DocumentControlEntry | null {
  const reg = registers.get(projectId);
  if (!reg) return null;

  const doc = reg.documents.find(d => d.id === documentId);
  if (!doc) return null;

  doc.status = newStatus;
  reg.lastUpdated = new Date().toISOString();
  return doc;
}

/**
 * Get a specific document by ID.
 */
export function getDocument(
  projectId: string,
  documentId: string,
): DocumentControlEntry | undefined {
  const reg = registers.get(projectId);
  return reg?.documents.find(d => d.id === documentId);
}

/**
 * Get all documents for a discipline.
 */
export function getDocumentsByDiscipline(
  projectId: string,
  discipline: Discipline | string,
): DocumentControlEntry[] {
  const reg = registers.get(projectId);
  if (!reg) return [];
  return reg.documents.filter(d => d.discipline === discipline);
}

/**
 * Get all documents with a given status.
 */
export function getDocumentsByStatus(
  projectId: string,
  status: DocumentStatus,
): DocumentControlEntry[] {
  const reg = registers.get(projectId);
  if (!reg) return [];
  return reg.documents.filter(d => d.status === status);
}

/**
 * Get the full revision history for a specific document.
 */
export function getRevisionHistory(
  projectId: string,
  documentId: string,
): RevisionEvent[] {
  const reg = registers.get(projectId);
  if (!reg) return [];
  return reg.revisionHistory.filter(r => r.documentId === documentId);
}

/**
 * Get all revision events (across all documents) since a given date.
 */
export function getRecentRevisions(
  projectId: string,
  sinceDate: string,
): RevisionEvent[] {
  const reg = registers.get(projectId);
  if (!reg) return [];
  const since = new Date(sinceDate).getTime();
  return reg.revisionHistory.filter(r => new Date(r.date).getTime() >= since);
}


// ═══════════════════════════════════════════════════════════════════════════════
//  TRANSMITTAL NUMBERING — SOP Part 4.1
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate the next sequential transmittal number.
 * Format: TX-{YYYY}-{NNN} (e.g., TX-2026-001, TX-2026-002, ...)
 */
export function generateTransmittalNumber(projectId: string): string {
  const current = transmittalCounters.get(projectId) ?? 0;
  const next = current + 1;
  transmittalCounters.set(projectId, next);
  const year = new Date().getFullYear();
  return `TX-${year}-${String(next).padStart(3, '0')}`;
}

/**
 * Record a transmittal (formal document issue).
 */
export function recordTransmittal(
  projectId: string,
  params: {
    from: string;
    to: string;
    purpose: TransmittalRecord['purpose'];
    documentIds: string[];
    notes?: string;
  },
): TransmittalRecord | null {
  const reg = registers.get(projectId);
  if (!reg) return null;

  // Validate all document IDs exist in register
  const missing = params.documentIds.filter(
    id => !reg.documents.some(d => d.id === id)
  );
  if (missing.length > 0) {
    return null; // All documents must be in register before transmittal
  }

  const transmittal: TransmittalRecord = {
    transmittalNumber: generateTransmittalNumber(projectId),
    date: new Date().toISOString(),
    from: params.from,
    to: params.to,
    purpose: params.purpose,
    documentIds: params.documentIds,
    notes: params.notes,
  };

  reg.transmittals.push(transmittal);
  reg.lastUpdated = new Date().toISOString();
  return transmittal;
}

/**
 * Get all transmittals for a project.
 */
export function getTransmittals(projectId: string): TransmittalRecord[] {
  const reg = registers.get(projectId);
  return reg?.transmittals ?? [];
}


// ═══════════════════════════════════════════════════════════════════════════════
//  UNIT / DATUM CONVENTION CHECK — SOP Part 4.1
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Set the project unit and datum convention.
 *
 * SOP Part 4.1 rule: If the project 0.000 datum or unit system
 * is not explicitly stated in the documents, flag a GAP.
 */
export function setUnitDatumConvention(
  projectId: string,
  convention: Omit<UnitDatumConvention, 'gaps' | 'verified'>,
): UnitDatumConvention | null {
  const reg = registers.get(projectId);
  if (!reg) return null;

  const gaps: Gap[] = [];

  // Check unit system stated
  if (convention.unitSystem === 'NOT_STATED') {
    gaps.push(makeGap(
      `DATUM-001`,
      'PARAMETER_MISSING',
      'unitSystem',
      'Unit system (metric/imperial) not stated in project documents. Cannot verify dimensional consistency.',
      'high',
      'SOP Part 4.1 — Unit Convention',
    ));
  }

  // Check datum reference stated
  if (convention.datumReference === 'NOT_STATED' || !convention.datumReference) {
    gaps.push(makeGap(
      `DATUM-002`,
      'PARAMETER_MISSING',
      'datumReference',
      'Project 0.000 datum not defined. All elevations lack a common reference. Requires RFI.',
      'high',
      'SOP Part 4.1 — Datum Convention',
    ));
  }

  // Check at least one benchmark exists
  if (convention.benchmarks.length === 0) {
    gaps.push(makeGap(
      `DATUM-003`,
      'PARAMETER_MISSING',
      'benchmarks',
      'No survey benchmarks documented. Site elevations cannot be verified.',
      'medium',
      'SOP Part 4.1 — Datum Convention',
    ));
  }

  // Check mixed units (warning, not blocking)
  if (convention.unitSystem === 'mixed') {
    gaps.push(makeGap(
      `DATUM-004`,
      'ambiguous_detail',
      'unitSystem',
      'Mixed unit system detected (metric + imperial). Dimensional conversion errors possible. Verify all cross-discipline dimensions.',
      'medium',
      'SOP Part 4.1 — Unit Convention',
    ));
  }

  const result: UnitDatumConvention = {
    ...convention,
    verified: gaps.length === 0,
    gaps,
  };

  reg.unitDatumConvention = result;
  reg.lastUpdated = new Date().toISOString();
  return result;
}

/**
 * Get the current unit/datum convention for a project.
 */
export function getUnitDatumConvention(projectId: string): UnitDatumConvention | undefined {
  const reg = registers.get(projectId);
  return reg?.unitDatumConvention;
}


// ═══════════════════════════════════════════════════════════════════════════════
//  REGISTER VALIDATION — SOP Part 1 (Traceability)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate the entire document register.
 *
 * Checks:
 *   1. Every document has a non-empty evidence reference
 *   2. No orphan revisions (revision events for documents not in register)
 *   3. Datum convention is verified
 *   4. All IFC documents have at least one transmittal
 *   5. No duplicate sheet/spec IDs within same discipline + status
 *
 * @returns Validation result with gaps and warnings
 */
export function validateRegister(projectId: string): RegisterValidation {
  const reg = registers.get(projectId);
  if (!reg) {
    return {
      isValid: false,
      documentCount: 0,
      byStatus: { ISSUED: 0, FOR_REVIEW: 0, DRAFT: 0, SUPERSEDED: 0, VOIDED: 0 },
      byDiscipline: {},
      gaps: [],
      warnings: ['Register not found for project ' + projectId],
    };
  }

  const gaps: Gap[] = [];
  const warnings: string[] = [];

  // ─── Check 1: Evidence references ──────────────────────────────────
  for (const doc of reg.documents) {
    if (!doc.evidenceRef || !doc.evidenceRef.type) {
      gaps.push(makeGap(
        `REG-EVIDENCE-${doc.id}`,
        'PARAMETER_MISSING',
        'evidenceRef',
        `Document ${doc.sheetOrSpecId} (${doc.title}) missing evidence reference.`,
        'medium',
        'SOP Part 1 — Traceability',
      ));
    }
  }

  // ─── Check 2: Orphan revision events ──────────────────────────────
  const docIds = new Set(reg.documents.map(d => d.id));
  for (const rev of reg.revisionHistory) {
    if (!docIds.has(rev.documentId)) {
      warnings.push(
        `Orphan revision: event for document ${rev.documentId} — document not in register.`
      );
    }
  }

  // ─── Check 3: Datum convention ────────────────────────────────────
  if (!reg.unitDatumConvention.verified) {
    gaps.push(...reg.unitDatumConvention.gaps);
  }

  // ─── Check 4: IFC documents without transmittals ──────────────────
  const ifcDocs = reg.documents.filter(d => d.status === 'ISSUED');
  const transmittedDocIds = new Set(
    reg.transmittals.flatMap(t => t.documentIds)
  );
  for (const doc of ifcDocs) {
    if (!transmittedDocIds.has(doc.id)) {
      warnings.push(
        `IFC document ${doc.sheetOrSpecId} (${doc.title}) has no transmittal record.`
      );
    }
  }

  // ─── Check 5: Duplicate sheet/spec IDs (same discipline + active status) ─────
  const activeStatuses: DocumentStatus[] = ['FOR_REVIEW', 'ISSUED', 'DRAFT'];
  const activeDocs = reg.documents.filter(d => activeStatuses.includes(d.status));
  const seen = new Map<string, string>();
  for (const doc of activeDocs) {
    const key = `${doc.discipline}::${doc.sheetOrSpecId}`;
    if (seen.has(key)) {
      warnings.push(
        `Duplicate active sheet: ${doc.sheetOrSpecId} for discipline ${doc.discipline} ` +
        `(IDs: ${seen.get(key)}, ${doc.id}). One should be SUPERSEDED or VOID.`
      );
    } else {
      seen.set(key, doc.id);
    }
  }

  // ─── Compile status and discipline counts ─────────────────────────
  const byStatus: Record<DocumentStatus, number> = {
    ISSUED: 0, FOR_REVIEW: 0, DRAFT: 0, SUPERSEDED: 0, VOIDED: 0,
  };
  const byDiscipline: Record<string, number> = {};

  for (const doc of reg.documents) {
    (byStatus as any)[doc.status] = ((byStatus as any)[doc.status] || 0) + 1;
    if (doc.discipline) { byDiscipline[doc.discipline] = (byDiscipline[doc.discipline] || 0) + 1; }
  }

  return {
    isValid: gaps.length === 0 && warnings.length === 0,
    documentCount: reg.documents.length,
    byStatus,
    byDiscipline,
    gaps,
    warnings,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
//  EVIDENCE REFERENCE VALIDATION — SOP Part 1
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate an evidence reference against the document register.
 * Ensures the referenced sheet/spec actually exists in the register.
 *
 * SOP Part 1: "If the evidence cannot be traced, flag a GAP."
 */
export function validateEvidenceReference(
  projectId: string,
  ref: EvidenceReference,
): { valid: boolean; reason?: string } {
  const reg = registers.get(projectId);
  if (!reg) return { valid: false, reason: 'Register not found' };

  if (ref.sheet || ref.documentId) {
    const found = reg.documents.some(d =>
      d.sheetOrSpecId === (ref.sheet ?? ref.documentId) &&
      d.status !== 'VOIDED' &&
      d.status !== 'SUPERSEDED'
    );
    if (!found) {
      return {
        valid: false,
        reason: `Sheet ${ref.sheet ?? ref.documentId} not found in register (or is VOIDED/SUPERSEDED).`,
      };
    }
  }

  if (ref.section) {
    const found = reg.documents.some(d =>
      d.sheetOrSpecId === ref.section &&
      d.status !== 'VOIDED' &&
      d.status !== 'SUPERSEDED'
    );
    if (!found) {
      return {
        valid: false,
        reason: `Spec section ${ref.section} not found in register (or is VOIDED/SUPERSEDED).`,
      };
    }
  }

  return { valid: true };
}


// ═══════════════════════════════════════════════════════════════════════════════
//  DOCUMENT LOOKUP — For cross-module use
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Find documents by sheet/spec ID (partial match supported).
 */
export function findDocuments(
  projectId: string,
  query: string,
): DocumentControlEntry[] {
  const reg = registers.get(projectId);
  if (!reg) return [];
  const q = query.toLowerCase();
  return reg.documents.filter(d =>
    d.sheetOrSpecId.toLowerCase().includes(q) ||
    d.title.toLowerCase().includes(q) ||
    d.id.toLowerCase().includes(q)
  );
}

/**
 * Get the current (non-SUPERSEDED, non-VOID) version of a sheet/spec.
 */
export function getCurrentVersion(
  projectId: string,
  sheetOrSpecId: string,
): DocumentControlEntry | undefined {
  const reg = registers.get(projectId);
  if (!reg) return undefined;
  return reg.documents.find(d =>
    d.sheetOrSpecId === sheetOrSpecId &&
    d.status !== 'VOIDED' &&
    d.status !== 'SUPERSEDED'
  );
}

/**
 * List all unique disciplines in the register.
 */
export function listDisciplines(projectId: string): string[] {
  const reg = registers.get(projectId);
  if (!reg) return [];
  return [...new Set(reg.documents.map(d => d.discipline).filter((d): d is string => !!d))];
}


// ═══════════════════════════════════════════════════════════════════════════════
//  SUMMARY / REPORT HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a text summary of the register for meeting packs / dashboards.
 */
export function formatRegisterSummary(projectId: string): string {
  const reg = registers.get(projectId);
  if (!reg) return `No register found for project ${projectId}.`;

  const validation = validateRegister(projectId);
  const lines: string[] = [
    `DOCUMENT REGISTER SUMMARY — ${reg.projectName}`,
    `Last updated: ${reg.lastUpdated}`,
    ``,
    `Documents: ${reg.documents.length}`,
  ];

  // Status breakdown
  for (const [status, count] of Object.entries(validation.byStatus)) {
    if (count > 0) lines.push(`  ${status}: ${count}`);
  }

  // Discipline breakdown
  lines.push('');
  for (const [disc, count] of Object.entries(validation.byDiscipline)) {
    lines.push(`  ${disc}: ${count} documents`);
  }

  // Datum convention
  lines.push('');
  const datum = reg.unitDatumConvention;
  lines.push(`Unit system: ${datum.unitSystem}`);
  lines.push(`Datum: ${datum.datumReference}`);
  lines.push(`Datum verified: ${datum.verified ? 'YES' : 'NO'}`);

  // Transmittals
  lines.push('');
  lines.push(`Transmittals: ${reg.transmittals.length}`);

  // Gaps and warnings
  if (validation.gaps.length > 0) {
    lines.push('');
    lines.push(`GAPS (${validation.gaps.length}):`);
    for (const gap of validation.gaps) {
      lines.push(`  [${gap.id}] ${gap.type} — ${gap.description}`);
    }
  }

  if (validation.warnings.length > 0) {
    lines.push('');
    lines.push(`WARNINGS (${validation.warnings.length}):`);
    for (const w of validation.warnings) {
      lines.push(`  ⚠ ${w}`);
    }
  }

  return lines.join('\n');
}


// ═══════════════════════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Helper: create a typed Gap object with consistent structure.
 */
function makeGap(
  id: string,
  type: GapType,
  parameterName: string,
  description: string,
  impact: Gap['impact'],
  sopReference: string,
): Gap {
  return {
    id,
    type,
    parameterName,
    affectedCount: 0,
    discipline: 'ARC',  // Default; caller can override if needed
    description,
    impact,
    sopReference,
  };
}

/**
 * Delete a register (for testing / project cleanup).
 */
export function deleteRegister(projectId: string): boolean {
  transmittalCounters.delete(projectId);
  return registers.delete(projectId);
}
