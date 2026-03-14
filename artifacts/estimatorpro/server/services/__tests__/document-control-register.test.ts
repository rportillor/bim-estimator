/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  DOCUMENT CONTROL REGISTER — Test Suite
 *  Tests all exported functions, interfaces, and validation logic.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import {
  initializeRegister,
  getRegister,
  addDocument,
  addDocuments,
  reviseDocument,
  updateDocumentStatus,
  getDocument,
  getDocumentsByDiscipline,
  getDocumentsByStatus,
  getRevisionHistory,
  getRecentRevisions,
  generateTransmittalNumber,
  recordTransmittal,
  getTransmittals,
  setUnitDatumConvention,
  getUnitDatumConvention,
  validateRegister,
  validateEvidenceReference,
  findDocuments,
  getCurrentVersion,
  listDisciplines,
  formatRegisterSummary,
  deleteRegister,
} from '../document-control-register';


import type { DocumentControlEntry, DocumentStatus } from '../types';

// ═══════════════════════════════════════════════════════════════════════════════
//  TEST DATA HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const PROJECT_ID = 'test-project-001';
const PROJECT_NAME = 'Test Project';

function makeDoc(overrides: Partial<DocumentControlEntry> = {}): DocumentControlEntry {
  return {
    id: 'doc-001',
    documentNumber: 'A-101',
    title: 'Ground Floor Plan',
    revision: 'A',
    status: 'ISSUED' as DocumentStatus,
    issueDate: '2025-01-15',
    discipline: 'ARC',
    sheetOrSpecId: 'A-101',
    revisionDate: '2025-01-15',
    evidenceRef: { type: 'drawing', documentId: 'A-101' },
    scopeNotes: 'Ground floor architectural plan',
    ...overrides,
  };
}

function makeDoc2(): DocumentControlEntry {
  return makeDoc({
    id: 'doc-002',
    documentNumber: 'S-201',
    title: 'Structural Sections',
    discipline: 'STR',
    sheetOrSpecId: 'S-201',
    status: 'FOR_REVIEW' as DocumentStatus,
    revision: 'B',
    revisionDate: '2025-02-10',
    evidenceRef: { type: 'drawing', documentId: 'S-201' },
  });
}

function makeDoc3(): DocumentControlEntry {
  return makeDoc({
    id: 'doc-003',
    documentNumber: 'M-101',
    title: 'Mechanical Plan',
    discipline: 'MECH',
    sheetOrSpecId: 'M-101',
    status: 'DRAFT' as DocumentStatus,
    revision: 'A',
    revisionDate: '2025-03-01',
    evidenceRef: { type: 'drawing', documentId: 'M-101' },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  REGISTER INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('initializeRegister', () => {
  afterEach(() => deleteRegister(PROJECT_ID));

  test('creates a new empty register', () => {
    const reg = initializeRegister(PROJECT_ID, PROJECT_NAME);
    expect(reg.projectId).toBe(PROJECT_ID);
    expect(reg.projectName).toBe(PROJECT_NAME);
    expect(reg.documents).toHaveLength(0);
    expect(reg.revisionHistory).toHaveLength(0);
    expect(reg.transmittals).toHaveLength(0);
    expect(reg.lastUpdated).toBeDefined();
  });

  test('sets default unit/datum convention as NOT_STATED', () => {
    const reg = initializeRegister(PROJECT_ID, PROJECT_NAME);
    expect(reg.unitDatumConvention.unitSystem).toBe('NOT_STATED');
    expect(reg.unitDatumConvention.primaryLengthUnit).toBe('NOT_STATED');
    expect(reg.unitDatumConvention.datumReference).toBe('NOT_STATED');
    expect(reg.unitDatumConvention.verified).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  getRegister
// ═══════════════════════════════════════════════════════════════════════════════

describe('getRegister', () => {
  afterEach(() => deleteRegister(PROJECT_ID));

  test('returns the register after initialization', () => {
    initializeRegister(PROJECT_ID, PROJECT_NAME);
    const reg = getRegister(PROJECT_ID);
    expect(reg).toBeDefined();
    expect(reg!.projectId).toBe(PROJECT_ID);
  });

  test('returns undefined for non-existent project', () => {
    expect(getRegister('no-such-project')).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  addDocument
// ═══════════════════════════════════════════════════════════════════════════════

describe('addDocument', () => {
  beforeEach(() => initializeRegister(PROJECT_ID, PROJECT_NAME));
  afterEach(() => deleteRegister(PROJECT_ID));

  test('adds a document to the register', () => {
    const doc = makeDoc();
    const result = addDocument(PROJECT_ID, doc);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('doc-001');
  });

  test('creates an INITIAL revision event', () => {
    const doc = makeDoc();
    addDocument(PROJECT_ID, doc);
    const reg = getRegister(PROJECT_ID)!;
    expect(reg.revisionHistory).toHaveLength(1);
    expect(reg.revisionHistory[0].type).toBe('INITIAL');
    expect(reg.revisionHistory[0].documentId).toBe('doc-001');
  });

  test('rejects duplicate document ID', () => {
    const doc = makeDoc();
    addDocument(PROJECT_ID, doc);
    const dup = addDocument(PROJECT_ID, doc);
    expect(dup).toBeNull();
  });

  test('returns null if register does not exist', () => {
    const result = addDocument('nonexistent', makeDoc());
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  addDocuments (batch)
// ═══════════════════════════════════════════════════════════════════════════════

describe('addDocuments', () => {
  beforeEach(() => initializeRegister(PROJECT_ID, PROJECT_NAME));
  afterEach(() => deleteRegister(PROJECT_ID));

  test('adds multiple documents at once', () => {
    const result = addDocuments(PROJECT_ID, [makeDoc(), makeDoc2(), makeDoc3()]);
    expect(result.added).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  test('reports skipped duplicates', () => {
    addDocument(PROJECT_ID, makeDoc());
    const result = addDocuments(PROJECT_ID, [makeDoc(), makeDoc2()]);
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  reviseDocument
// ═══════════════════════════════════════════════════════════════════════════════

describe('reviseDocument', () => {
  beforeEach(() => {
    initializeRegister(PROJECT_ID, PROJECT_NAME);
    addDocument(PROJECT_ID, makeDoc());
  });
  afterEach(() => deleteRegister(PROJECT_ID));

  test('revises an existing document', () => {
    const result = reviseDocument(PROJECT_ID, 'doc-001', {
      newRevision: 'B',
      revisionType: 'ADDENDUM',
      description: 'Updated floor plan',
      referenceNumber: 'Addendum 01',
    });
    expect(result).not.toBeNull();
    expect(result!.revision).toBe('B');
  });

  test('records a revision event', () => {
    reviseDocument(PROJECT_ID, 'doc-001', {
      newRevision: 'B',
      revisionType: 'ADDENDUM',
      description: 'Updated floor plan',
    });
    const reg = getRegister(PROJECT_ID)!;
    // 1 INITIAL + 1 ADDENDUM
    expect(reg.revisionHistory).toHaveLength(2);
    expect(reg.revisionHistory[1].type).toBe('ADDENDUM');
    expect(reg.revisionHistory[1].previousRevision).toBe('A');
    expect(reg.revisionHistory[1].newRevision).toBe('B');
  });

  test('can update status during revision', () => {
    const result = reviseDocument(PROJECT_ID, 'doc-001', {
      newRevision: 'B',
      newStatus: 'FOR_REVIEW',
      revisionType: 'RE_ISSUE',
      description: 'Re-issued for review',
    });
    expect(result!.status).toBe('FOR_REVIEW');
  });

  test('returns null for non-existent project', () => {
    const result = reviseDocument('no-project', 'doc-001', {
      newRevision: 'B',
      revisionType: 'ADDENDUM',
      description: 'test',
    });
    expect(result).toBeNull();
  });

  test('returns null for non-existent document', () => {
    const result = reviseDocument(PROJECT_ID, 'no-doc', {
      newRevision: 'B',
      revisionType: 'ADDENDUM',
      description: 'test',
    });
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  updateDocumentStatus
// ═══════════════════════════════════════════════════════════════════════════════

describe('updateDocumentStatus', () => {
  beforeEach(() => {
    initializeRegister(PROJECT_ID, PROJECT_NAME);
    addDocument(PROJECT_ID, makeDoc());
  });
  afterEach(() => deleteRegister(PROJECT_ID));

  test('changes document status', () => {
    const result = updateDocumentStatus(PROJECT_ID, 'doc-001', 'SUPERSEDED');
    expect(result).not.toBeNull();
    expect(result!.status).toBe('SUPERSEDED');
  });

  test('returns null for missing document', () => {
    expect(updateDocumentStatus(PROJECT_ID, 'no-doc', 'VOIDED')).toBeNull();
  });

  test('returns null for missing project', () => {
    expect(updateDocumentStatus('no-project', 'doc-001', 'VOIDED')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  getDocument
// ═══════════════════════════════════════════════════════════════════════════════

describe('getDocument', () => {
  beforeEach(() => {
    initializeRegister(PROJECT_ID, PROJECT_NAME);
    addDocument(PROJECT_ID, makeDoc());
  });
  afterEach(() => deleteRegister(PROJECT_ID));

  test('retrieves a document by ID', () => {
    const doc = getDocument(PROJECT_ID, 'doc-001');
    expect(doc).toBeDefined();
    expect(doc!.title).toBe('Ground Floor Plan');
  });

  test('returns undefined for non-existent document', () => {
    expect(getDocument(PROJECT_ID, 'no-doc')).toBeUndefined();
  });

  test('returns undefined for non-existent project', () => {
    expect(getDocument('no-project', 'doc-001')).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  getDocumentsByDiscipline
// ═══════════════════════════════════════════════════════════════════════════════

describe('getDocumentsByDiscipline', () => {
  beforeEach(() => {
    initializeRegister(PROJECT_ID, PROJECT_NAME);
    addDocuments(PROJECT_ID, [makeDoc(), makeDoc2(), makeDoc3()]);
  });
  afterEach(() => deleteRegister(PROJECT_ID));

  test('filters documents by discipline', () => {
    const arcDocs = getDocumentsByDiscipline(PROJECT_ID, 'ARC');
    expect(arcDocs).toHaveLength(1);
    expect(arcDocs[0].discipline).toBe('ARC');
  });

  test('returns empty array for unmatched discipline', () => {
    expect(getDocumentsByDiscipline(PROJECT_ID, 'ELEC')).toHaveLength(0);
  });

  test('returns empty for non-existent project', () => {
    expect(getDocumentsByDiscipline('no-project', 'ARC')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  getDocumentsByStatus
// ═══════════════════════════════════════════════════════════════════════════════

describe('getDocumentsByStatus', () => {
  beforeEach(() => {
    initializeRegister(PROJECT_ID, PROJECT_NAME);
    addDocuments(PROJECT_ID, [makeDoc(), makeDoc2(), makeDoc3()]);
  });
  afterEach(() => deleteRegister(PROJECT_ID));

  test('filters documents by status', () => {
    const issued = getDocumentsByStatus(PROJECT_ID, 'ISSUED');
    expect(issued).toHaveLength(1);
    expect(issued[0].status).toBe('ISSUED');
  });

  test('returns empty for unmatched status', () => {
    expect(getDocumentsByStatus(PROJECT_ID, 'VOIDED')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  getRevisionHistory
// ═══════════════════════════════════════════════════════════════════════════════

describe('getRevisionHistory', () => {
  beforeEach(() => {
    initializeRegister(PROJECT_ID, PROJECT_NAME);
    addDocument(PROJECT_ID, makeDoc());
  });
  afterEach(() => deleteRegister(PROJECT_ID));

  test('returns revision history for a document', () => {
    const history = getRevisionHistory(PROJECT_ID, 'doc-001');
    expect(history).toHaveLength(1);
    expect(history[0].type).toBe('INITIAL');
  });

  test('includes subsequent revisions', () => {
    reviseDocument(PROJECT_ID, 'doc-001', {
      newRevision: 'B',
      revisionType: 'ADDENDUM',
      description: 'Update',
    });
    const history = getRevisionHistory(PROJECT_ID, 'doc-001');
    expect(history).toHaveLength(2);
  });

  test('returns empty for non-existent document', () => {
    expect(getRevisionHistory(PROJECT_ID, 'no-doc')).toHaveLength(0);
  });

  test('returns empty for non-existent project', () => {
    expect(getRevisionHistory('no-project', 'doc-001')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  getRecentRevisions
// ═══════════════════════════════════════════════════════════════════════════════

describe('getRecentRevisions', () => {
  beforeEach(() => {
    initializeRegister(PROJECT_ID, PROJECT_NAME);
    addDocument(PROJECT_ID, makeDoc());
  });
  afterEach(() => deleteRegister(PROJECT_ID));

  test('returns revisions since a given date', () => {
    const revisions = getRecentRevisions(PROJECT_ID, '2020-01-01');
    expect(revisions.length).toBeGreaterThanOrEqual(1);
  });

  test('returns empty for future date', () => {
    expect(getRecentRevisions(PROJECT_ID, '2099-01-01')).toHaveLength(0);
  });

  test('returns empty for non-existent project', () => {
    expect(getRecentRevisions('no-project', '2020-01-01')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  TRANSMITTAL NUMBERING
// ═══════════════════════════════════════════════════════════════════════════════

describe('generateTransmittalNumber', () => {
  beforeEach(() => initializeRegister(PROJECT_ID, PROJECT_NAME));
  afterEach(() => deleteRegister(PROJECT_ID));

  test('generates sequential transmittal numbers', () => {
    const first = generateTransmittalNumber(PROJECT_ID);
    const second = generateTransmittalNumber(PROJECT_ID);
    expect(first).toMatch(/^TX-\d{4}-001$/);
    expect(second).toMatch(/^TX-\d{4}-002$/);
  });
});

describe('recordTransmittal', () => {
  beforeEach(() => {
    initializeRegister(PROJECT_ID, PROJECT_NAME);
    addDocument(PROJECT_ID, makeDoc());
  });
  afterEach(() => deleteRegister(PROJECT_ID));

  test('records a transmittal for existing documents', () => {
    const result = recordTransmittal(PROJECT_ID, {
      from: 'Architect',
      to: 'Contractor',
      purpose: 'IFC',
      documentIds: ['doc-001'],
      notes: 'Issued for construction',
    });
    expect(result).not.toBeNull();
    expect(result!.transmittalNumber).toMatch(/^TX-/);
    expect(result!.from).toBe('Architect');
    expect(result!.to).toBe('Contractor');
    expect(result!.purpose).toBe('IFC');
  });

  test('returns null if any document ID is not in register', () => {
    const result = recordTransmittal(PROJECT_ID, {
      from: 'Architect',
      to: 'Contractor',
      purpose: 'IFC',
      documentIds: ['doc-001', 'non-existent-doc'],
    });
    expect(result).toBeNull();
  });

  test('returns null for non-existent project', () => {
    const result = recordTransmittal('no-project', {
      from: 'A',
      to: 'B',
      purpose: 'RECORD',
      documentIds: [],
    });
    expect(result).toBeNull();
  });
});

describe('getTransmittals', () => {
  beforeEach(() => {
    initializeRegister(PROJECT_ID, PROJECT_NAME);
    addDocument(PROJECT_ID, makeDoc());
  });
  afterEach(() => deleteRegister(PROJECT_ID));

  test('returns all transmittals', () => {
    recordTransmittal(PROJECT_ID, {
      from: 'A',
      to: 'B',
      purpose: 'IFC',
      documentIds: ['doc-001'],
    });
    const transmittals = getTransmittals(PROJECT_ID);
    expect(transmittals).toHaveLength(1);
  });

  test('returns empty for project with no transmittals', () => {
    expect(getTransmittals(PROJECT_ID)).toHaveLength(0);
  });

  test('returns empty for non-existent project', () => {
    expect(getTransmittals('no-project')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  UNIT / DATUM CONVENTION
// ═══════════════════════════════════════════════════════════════════════════════

describe('setUnitDatumConvention', () => {
  beforeEach(() => initializeRegister(PROJECT_ID, PROJECT_NAME));
  afterEach(() => deleteRegister(PROJECT_ID));

  test('sets convention and verifies when complete', () => {
    const result = setUnitDatumConvention(PROJECT_ID, {
      unitSystem: 'metric',
      primaryLengthUnit: 'mm',
      datumReference: 'Project 0.000 = 265.50m AHD',
      benchmarks: [{
        name: 'BM-1',
        elevation: 265.5,
        units: 'm',
        source: { documentId: 'S-001' },
      }],
    });
    expect(result).not.toBeNull();
    expect(result!.verified).toBe(true);
    expect(result!.gaps).toHaveLength(0);
  });

  test('flags GAP when unit system is NOT_STATED', () => {
    const result = setUnitDatumConvention(PROJECT_ID, {
      unitSystem: 'NOT_STATED',
      primaryLengthUnit: 'NOT_STATED',
      datumReference: 'Project 0.000 = 100m',
      benchmarks: [{
        name: 'BM-1',
        elevation: 100,
        units: 'm',
        source: { documentId: 'S-001' },
      }],
    });
    expect(result!.verified).toBe(false);
    expect(result!.gaps.some(g => g.parameterName === 'unitSystem')).toBe(true);
  });

  test('flags GAP when datum is NOT_STATED', () => {
    const result = setUnitDatumConvention(PROJECT_ID, {
      unitSystem: 'metric',
      primaryLengthUnit: 'mm',
      datumReference: 'NOT_STATED',
      benchmarks: [{
        name: 'BM-1',
        elevation: 100,
        units: 'm',
        source: { documentId: 'S-001' },
      }],
    });
    expect(result!.verified).toBe(false);
    expect(result!.gaps.some(g => g.parameterName === 'datumReference')).toBe(true);
  });

  test('flags GAP when no benchmarks', () => {
    const result = setUnitDatumConvention(PROJECT_ID, {
      unitSystem: 'metric',
      primaryLengthUnit: 'mm',
      datumReference: 'Project 0.000 = 100m',
      benchmarks: [],
    });
    expect(result!.gaps.some(g => g.parameterName === 'benchmarks')).toBe(true);
  });

  test('flags GAP for mixed unit system', () => {
    const result = setUnitDatumConvention(PROJECT_ID, {
      unitSystem: 'mixed',
      primaryLengthUnit: 'mm',
      datumReference: 'Project 0.000 = 100m',
      benchmarks: [{
        name: 'BM-1',
        elevation: 100,
        units: 'm',
        source: { documentId: 'S-001' },
      }],
    });
    expect(result!.gaps.some(g => g.type === 'ambiguous_detail')).toBe(true);
  });

  test('returns null for non-existent project', () => {
    const result = setUnitDatumConvention('no-project', {
      unitSystem: 'metric',
      primaryLengthUnit: 'mm',
      datumReference: 'test',
      benchmarks: [],
    });
    expect(result).toBeNull();
  });
});

describe('getUnitDatumConvention', () => {
  beforeEach(() => initializeRegister(PROJECT_ID, PROJECT_NAME));
  afterEach(() => deleteRegister(PROJECT_ID));

  test('returns the convention after setting', () => {
    setUnitDatumConvention(PROJECT_ID, {
      unitSystem: 'metric',
      primaryLengthUnit: 'mm',
      datumReference: 'Project 0.000 = 100m',
      benchmarks: [],
    });
    const conv = getUnitDatumConvention(PROJECT_ID);
    expect(conv).toBeDefined();
    expect(conv!.unitSystem).toBe('metric');
  });

  test('returns undefined for non-existent project', () => {
    expect(getUnitDatumConvention('no-project')).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  validateRegister
// ═══════════════════════════════════════════════════════════════════════════════

describe('validateRegister', () => {
  beforeEach(() => initializeRegister(PROJECT_ID, PROJECT_NAME));
  afterEach(() => deleteRegister(PROJECT_ID));

  test('returns invalid for non-existent project', () => {
    const result = validateRegister('no-project');
    expect(result.isValid).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('empty register with default convention is valid (no docs, no gaps pushed)', () => {
    const result = validateRegister(PROJECT_ID);
    // Default unitDatumConvention has verified=false but gaps=[] (empty),
    // so no gaps are pushed and with no documents there are no warnings.
    expect(result.isValid).toBe(true);
    expect(result.documentCount).toBe(0);
  });

  test('register becomes invalid after setting NOT_STATED datum', () => {
    setUnitDatumConvention(PROJECT_ID, {
      unitSystem: 'NOT_STATED',
      primaryLengthUnit: 'NOT_STATED',
      datumReference: 'NOT_STATED',
      benchmarks: [],
    });
    const result = validateRegister(PROJECT_ID);
    expect(result.isValid).toBe(false);
    expect(result.gaps.length).toBeGreaterThan(0);
  });

  test('counts documents by status', () => {
    addDocuments(PROJECT_ID, [makeDoc(), makeDoc2(), makeDoc3()]);
    const result = validateRegister(PROJECT_ID);
    expect(result.documentCount).toBe(3);
    expect(result.byStatus.ISSUED).toBe(1);
    expect(result.byStatus.FOR_REVIEW).toBe(1);
    expect(result.byStatus.DRAFT).toBe(1);
  });

  test('counts documents by discipline', () => {
    addDocuments(PROJECT_ID, [makeDoc(), makeDoc2(), makeDoc3()]);
    const result = validateRegister(PROJECT_ID);
    expect(result.byDiscipline['ARC']).toBe(1);
    expect(result.byDiscipline['STR']).toBe(1);
    expect(result.byDiscipline['MECH']).toBe(1);
  });

  test('warns on IFC documents without transmittal', () => {
    addDocument(PROJECT_ID, makeDoc()); // status = ISSUED
    const result = validateRegister(PROJECT_ID);
    expect(result.warnings.some(w => w.includes('transmittal'))).toBe(true);
  });

  test('warns on duplicate active sheet/spec IDs for same discipline', () => {
    addDocument(PROJECT_ID, makeDoc({ id: 'doc-dup-1', sheetOrSpecId: 'A-101', discipline: 'ARC', status: 'ISSUED' }));
    addDocument(PROJECT_ID, makeDoc({ id: 'doc-dup-2', sheetOrSpecId: 'A-101', discipline: 'ARC', status: 'FOR_REVIEW' }));
    const result = validateRegister(PROJECT_ID);
    expect(result.warnings.some(w => w.includes('Duplicate'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  validateEvidenceReference
// ═══════════════════════════════════════════════════════════════════════════════

describe('validateEvidenceReference', () => {
  beforeEach(() => {
    initializeRegister(PROJECT_ID, PROJECT_NAME);
    addDocument(PROJECT_ID, makeDoc());
  });
  afterEach(() => deleteRegister(PROJECT_ID));

  test('valid reference with matching sheet', () => {
    const result = validateEvidenceReference(PROJECT_ID, { sheet: 'A-101' });
    expect(result.valid).toBe(true);
  });

  test('invalid reference for non-existent sheet', () => {
    const result = validateEvidenceReference(PROJECT_ID, { sheet: 'X-999' });
    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
  });

  test('invalid reference for VOIDED document', () => {
    updateDocumentStatus(PROJECT_ID, 'doc-001', 'VOIDED');
    const result = validateEvidenceReference(PROJECT_ID, { sheet: 'A-101' });
    expect(result.valid).toBe(false);
  });

  test('invalid reference for SUPERSEDED document', () => {
    updateDocumentStatus(PROJECT_ID, 'doc-001', 'SUPERSEDED');
    const result = validateEvidenceReference(PROJECT_ID, { sheet: 'A-101' });
    expect(result.valid).toBe(false);
  });

  test('returns invalid for non-existent project', () => {
    const result = validateEvidenceReference('no-project', { sheet: 'A-101' });
    expect(result.valid).toBe(false);
  });

  test('validates section references', () => {
    addDocument(PROJECT_ID, makeDoc({ id: 'spec-01', sheetOrSpecId: 'SPEC-03', status: 'ISSUED' }));
    const result = validateEvidenceReference(PROJECT_ID, { section: 'SPEC-03' });
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  findDocuments
// ═══════════════════════════════════════════════════════════════════════════════

describe('findDocuments', () => {
  beforeEach(() => {
    initializeRegister(PROJECT_ID, PROJECT_NAME);
    addDocuments(PROJECT_ID, [makeDoc(), makeDoc2(), makeDoc3()]);
  });
  afterEach(() => deleteRegister(PROJECT_ID));

  test('finds documents by partial sheet ID', () => {
    const results = findDocuments(PROJECT_ID, 'A-101');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('doc-001');
  });

  test('finds documents by title substring', () => {
    const results = findDocuments(PROJECT_ID, 'Structural');
    expect(results).toHaveLength(1);
  });

  test('case-insensitive search', () => {
    const results = findDocuments(PROJECT_ID, 'ground');
    expect(results).toHaveLength(1);
  });

  test('returns empty for no match', () => {
    expect(findDocuments(PROJECT_ID, 'zzz-nonexistent')).toHaveLength(0);
  });

  test('returns empty for non-existent project', () => {
    expect(findDocuments('no-project', 'A-101')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  getCurrentVersion
// ═══════════════════════════════════════════════════════════════════════════════

describe('getCurrentVersion', () => {
  beforeEach(() => {
    initializeRegister(PROJECT_ID, PROJECT_NAME);
    addDocument(PROJECT_ID, makeDoc());
  });
  afterEach(() => deleteRegister(PROJECT_ID));

  test('returns current (non-VOIDED/SUPERSEDED) version', () => {
    const doc = getCurrentVersion(PROJECT_ID, 'A-101');
    expect(doc).toBeDefined();
    expect(doc!.id).toBe('doc-001');
  });

  test('excludes VOIDED documents', () => {
    updateDocumentStatus(PROJECT_ID, 'doc-001', 'VOIDED');
    const doc = getCurrentVersion(PROJECT_ID, 'A-101');
    expect(doc).toBeUndefined();
  });

  test('excludes SUPERSEDED documents', () => {
    updateDocumentStatus(PROJECT_ID, 'doc-001', 'SUPERSEDED');
    const doc = getCurrentVersion(PROJECT_ID, 'A-101');
    expect(doc).toBeUndefined();
  });

  test('returns undefined for non-existent project', () => {
    expect(getCurrentVersion('no-project', 'A-101')).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  listDisciplines
// ═══════════════════════════════════════════════════════════════════════════════

describe('listDisciplines', () => {
  beforeEach(() => {
    initializeRegister(PROJECT_ID, PROJECT_NAME);
    addDocuments(PROJECT_ID, [makeDoc(), makeDoc2(), makeDoc3()]);
  });
  afterEach(() => deleteRegister(PROJECT_ID));

  test('returns unique disciplines', () => {
    const disciplines = listDisciplines(PROJECT_ID);
    expect(disciplines).toContain('ARC');
    expect(disciplines).toContain('STR');
    expect(disciplines).toContain('MECH');
    expect(disciplines).toHaveLength(3);
  });

  test('returns empty for non-existent project', () => {
    expect(listDisciplines('no-project')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  formatRegisterSummary
// ═══════════════════════════════════════════════════════════════════════════════

describe('formatRegisterSummary', () => {
  beforeEach(() => {
    initializeRegister(PROJECT_ID, PROJECT_NAME);
    addDocuments(PROJECT_ID, [makeDoc(), makeDoc2()]);
  });
  afterEach(() => deleteRegister(PROJECT_ID));

  test('returns a formatted summary string', () => {
    const summary = formatRegisterSummary(PROJECT_ID);
    expect(summary).toContain('DOCUMENT REGISTER SUMMARY');
    expect(summary).toContain(PROJECT_NAME);
    expect(summary).toContain('Documents: 2');
  });

  test('returns not-found message for non-existent project', () => {
    const summary = formatRegisterSummary('no-project');
    expect(summary).toContain('No register found');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  deleteRegister
// ═══════════════════════════════════════════════════════════════════════════════

describe('deleteRegister', () => {
  test('deletes an existing register', () => {
    initializeRegister(PROJECT_ID, PROJECT_NAME);
    expect(deleteRegister(PROJECT_ID)).toBe(true);
    expect(getRegister(PROJECT_ID)).toBeUndefined();
  });

  test('returns false for non-existent register', () => {
    expect(deleteRegister('no-project')).toBe(false);
  });
});
