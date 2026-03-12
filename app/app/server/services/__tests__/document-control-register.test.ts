/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  DOCUMENT CONTROL REGISTER — Test Suite (SOP Part 1)
 *  55+ tests: suitability codes, revision history, evidence validation,
 *  document set completeness audit, supersession, discipline queries
 * ══════════════════════════════════════════════════════════════════════════════
 */

import {
  loadDocumentRegister,
  getDocumentRegister,
  getDocument,
  getDocumentsByDiscipline,
  registerSize,
  registerDocument,
  supersede,
  validateEvidenceReference,
  validateEvidenceBatch,
  getExpectedDocumentMatrix,
  auditDocumentSet,
  getRevisionHistory,
  getRevisedSince,
  getSupersededDocuments,
  buildEvidenceTraceChain,
  inferDiscipline,
  getSuitabilityLabel,
  isSuitableForQTO,
} from '../document-control-register';

import type {
  RegisteredDocument,
  SuitabilityCode,
  Discipline,
  RevisionEntry,
} from '../document-control-register';

// ═══════════════════════════════════════════════════════════════════════════════
//  TEST DATA
// ═══════════════════════════════════════════════════════════════════════════════

const REV_A: RevisionEntry = {
  revision: 'A',
  dateIssued: '2025-01-15',
  suitability: 'S3',
  issuedBy: 'ArchCorp',
  description: 'Issued for review',
};

const REV_B: RevisionEntry = {
  revision: 'B',
  dateIssued: '2025-03-01',
  suitability: 'S5',
  issuedBy: 'ArchCorp',
  description: 'Issued for construction',
  supersedes: 'A',
};

const DOC_A101: RegisteredDocument = {
  drawingNumber: 'A-101',
  title: 'Ground Floor Plan',
  discipline: 'ARCH',
  currentRevision: 'B',
  currentSuitability: 'S5',
  dateReceived: '2025-03-01',
  revisionHistory: [REV_A, REV_B],
  status: 'current',
  originatingFirm: 'ArchCorp',
  fileReference: '/docs/A-101-RevB.pdf',
};

const DOC_S201: RegisteredDocument = {
  drawingNumber: 'S-201',
  title: 'Structural Sections',
  discipline: 'STRUCT',
  currentRevision: 'A',
  currentSuitability: 'S3',
  dateReceived: '2025-01-20',
  revisionHistory: [{ revision: 'A', dateIssued: '2025-01-20', suitability: 'S3', issuedBy: 'StructEng', description: 'IFR' }],
  status: 'current',
  originatingFirm: 'StructEng',
};

const DOC_M101: RegisteredDocument = {
  drawingNumber: 'M-101',
  title: 'Mechanical Ground Floor',
  discipline: 'MECH',
  currentRevision: 'A',
  currentSuitability: 'S2', // Below IFR threshold
  dateReceived: '2025-02-10',
  revisionHistory: [{ revision: 'A', dateIssued: '2025-02-10', suitability: 'S2', issuedBy: 'MechCo', description: 'For info only' }],
  status: 'current',
  originatingFirm: 'MechCo',
};

const DOC_OLD: RegisteredDocument = {
  drawingNumber: 'A-100',
  title: 'Site Plan (old)',
  discipline: 'ARCH',
  currentRevision: 'A',
  currentSuitability: 'S5',
  dateReceived: '2024-11-01',
  revisionHistory: [{ revision: 'A', dateIssued: '2024-11-01', suitability: 'S5', issuedBy: 'ArchCorp', description: 'Original issue' }],
  status: 'superseded',
  supersededBy: 'A-100-R',
  originatingFirm: 'ArchCorp',
};

function loadTestDocuments(): void {
  loadDocumentRegister([DOC_A101, DOC_S201, DOC_M101, DOC_OLD]);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  REGISTER LOADING & QUERIES
// ═══════════════════════════════════════════════════════════════════════════════

describe('Document Register Loading', () => {
  beforeEach(() => loadTestDocuments());

  test('loads documents into register', () => {
    expect(registerSize()).toBe(4);
  });

  test('retrieves document by drawing number', () => {
    const doc = getDocument('A-101');
    expect(doc).toBeDefined();
    expect(doc!.title).toBe('Ground Floor Plan');
  });

  test('case-insensitive lookup', () => {
    expect(getDocument('a-101')).toBeDefined();
    expect(getDocument('A-101')).toBeDefined();
    expect(getDocument('  A-101  ')).toBeDefined();
  });

  test('returns undefined for non-existent document', () => {
    expect(getDocument('X-999')).toBeUndefined();
  });

  test('getDocumentsByDiscipline filters correctly', () => {
    const archDocs = getDocumentsByDiscipline('ARCH');
    expect(archDocs.length).toBe(2); // A-101 and A-100
    expect(archDocs.every(d => d.discipline === 'ARCH')).toBe(true);
  });

  test('getDocumentsByDiscipline returns sorted by drawing number', () => {
    const archDocs = getDocumentsByDiscipline('ARCH');
    expect(archDocs[0].drawingNumber).toBe('A-100');
    expect(archDocs[1].drawingNumber).toBe('A-101');
  });

  test('getDocumentRegister returns readonly map', () => {
    const reg = getDocumentRegister();
    expect(reg.size).toBe(4);
  });

  test('reload replaces previous data', () => {
    loadDocumentRegister([DOC_A101]);
    expect(registerSize()).toBe(1);
    loadTestDocuments();
    expect(registerSize()).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  DOCUMENT REGISTRATION & UPDATE
// ═══════════════════════════════════════════════════════════════════════════════

describe('registerDocument', () => {
  beforeEach(() => loadDocumentRegister([]));

  test('creates new document', () => {
    const result = registerDocument(DOC_A101);
    expect(result.action).toBe('created');
    expect(registerSize()).toBe(1);
  });

  test('updates existing document with new revision', () => {
    registerDocument(DOC_A101);
    const updated: RegisteredDocument = {
      ...DOC_A101,
      currentRevision: 'C',
      currentSuitability: 'S5',
      dateReceived: '2025-06-01',
      revisionHistory: [
        ...DOC_A101.revisionHistory,
        { revision: 'C', dateIssued: '2025-06-01', suitability: 'S5', issuedBy: 'ArchCorp', description: 'Rev C' },
      ],
    };

    const result = registerDocument(updated);
    expect(result.action).toBe('updated');
    expect(getDocument('A-101')!.currentRevision).toBe('C');
  });

  test('warns on suitability downgrade', () => {
    registerDocument(DOC_A101); // S5
    const downgraded: RegisteredDocument = {
      ...DOC_A101,
      currentSuitability: 'S2',
      revisionHistory: DOC_A101.revisionHistory,
    };
    const result = registerDocument(downgraded);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('downgraded');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SUPERSESSION
// ═══════════════════════════════════════════════════════════════════════════════

describe('supersede', () => {
  beforeEach(() => loadTestDocuments());

  test('marks document as superseded', () => {
    const warnings = supersede('A-101', 'A-101-R2');
    const doc = getDocument('A-101');
    expect(doc!.status).toBe('superseded');
    expect(doc!.supersededBy).toBe('A-101-R2');
  });

  test('warns when old document not found', () => {
    const warnings = supersede('X-999', 'A-101');
    expect(warnings.some(w => w.includes('not found'))).toBe(true);
  });

  test('warns when new document not in register', () => {
    const warnings = supersede('A-101', 'A-101-R99');
    expect(warnings.some(w => w.includes('not found'))).toBe(true);
  });

  test('getSupersededDocuments returns superseded docs', () => {
    const superseded = getSupersededDocuments();
    expect(superseded.length).toBeGreaterThanOrEqual(1);
    expect(superseded.some(d => d.drawingNumber === 'A-100')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  EVIDENCE VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('validateEvidenceReference', () => {
  beforeEach(() => loadTestDocuments());

  test('null reference is invalid', () => {
    const result = validateEvidenceReference(null);
    expect(result.valid).toBe(false);
    expect(result.warnings[0]).toContain('RFI');
  });

  test('undefined reference is invalid', () => {
    const result = validateEvidenceReference(undefined);
    expect(result.valid).toBe(false);
  });

  test('valid IFC document passes', () => {
    const result = validateEvidenceReference({ documentId: 'A-101', page: 1 });
    expect(result.valid).toBe(true);
    expect(result.documentFound).toBe(true);
    expect(result.revisionCurrent).toBe(true);
    expect(result.suitabilityOk).toBe(true);
    expect(result.suitabilityCode).toBe('S5');
  });

  test('document below IFR suitability fails', () => {
    const result = validateEvidenceReference({ documentId: 'M-101', page: 1 });
    expect(result.valid).toBe(false);
    expect(result.suitabilityOk).toBe(false);
    expect(result.warnings.some(w => w.includes('below minimum'))).toBe(true);
  });

  test('superseded document is flagged', () => {
    const result = validateEvidenceReference({ documentId: 'A-100' });
    expect(result.valid).toBe(false);
    expect(result.revisionCurrent).toBe(false);
    expect(result.warnings.some(w => w.includes('superseded'))).toBe(true);
  });

  test('non-existent document is invalid', () => {
    const result = validateEvidenceReference({ documentId: 'X-999' });
    expect(result.valid).toBe(false);
    expect(result.documentFound).toBe(false);
  });

  test('custom min suitability works', () => {
    // M-101 is S2, which passes if min is S1
    const result = validateEvidenceReference({ documentId: 'M-101' }, 'S1');
    expect(result.suitabilityOk).toBe(true);
  });

  test('empty register returns valid with warning', () => {
    loadDocumentRegister([]);
    const result = validateEvidenceReference({ documentId: 'A-101' });
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('not loaded'))).toBe(true);
  });
});

describe('validateEvidenceBatch', () => {
  beforeEach(() => loadTestDocuments());

  test('batch validates multiple references', () => {
    const result = validateEvidenceBatch([
      { id: 'ref-1', ref: { documentId: 'A-101' } },
      { id: 'ref-2', ref: { documentId: 'M-101' } },
      { id: 'ref-3', ref: null },
    ]);
    expect(result.valid).toBe(1);   // A-101
    expect(result.invalid).toBe(2); // M-101 (below suitability) + null
    expect(result.results.size).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  REVISION HISTORY
// ═══════════════════════════════════════════════════════════════════════════════

describe('Revision History', () => {
  beforeEach(() => loadTestDocuments());

  test('getRevisionHistory returns chronological order', () => {
    const history = getRevisionHistory('A-101');
    expect(history).toHaveLength(2);
    expect(history[0].revision).toBe('A');
    expect(history[1].revision).toBe('B');
    expect(history[0].dateIssued < history[1].dateIssued).toBe(true);
  });

  test('returns empty for non-existent document', () => {
    expect(getRevisionHistory('X-999')).toHaveLength(0);
  });

  test('getRevisedSince finds documents revised after date', () => {
    const revised = getRevisedSince('2025-02-01');
    expect(revised.length).toBeGreaterThanOrEqual(1);
    // A-101 Rev B was issued 2025-03-01 and M-101 Rev A was 2025-02-10
    const drawingNums = revised.map(r => r.document.drawingNumber);
    expect(drawingNums).toContain('A-101');
  });

  test('getRevisedSince with future date returns empty', () => {
    const revised = getRevisedSince('2099-01-01');
    expect(revised).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  DOCUMENT SET AUDIT
// ═══════════════════════════════════════════════════════════════════════════════

describe('Document Set Audit', () => {
  beforeEach(() => loadTestDocuments());

  test('getExpectedDocumentMatrix generates expected drawings', () => {
    const matrix = getExpectedDocumentMatrix(3, true, true);
    expect(matrix.has('ARCH')).toBe(true);
    expect(matrix.has('STRUCT')).toBe(true);
    expect(matrix.has('MECH')).toBe(true);
    expect(matrix.has('ELEC')).toBe(true);

    const archDrawings = matrix.get('ARCH')!;
    expect(archDrawings).toContain('A-101');
    expect(archDrawings).toContain('A-200');
  });

  test('matrix scales with floor count', () => {
    const twoFloor = getExpectedDocumentMatrix(2);
    const fiveFloor = getExpectedDocumentMatrix(5);
    const archTwo = twoFloor.get('ARCH')!;
    const archFive = fiveFloor.get('ARCH')!;
    expect(archFive.length).toBeGreaterThan(archTwo.length);
  });

  test('matrix without mechanical omits MECH', () => {
    const matrix = getExpectedDocumentMatrix(2, false, true);
    expect(matrix.has('MECH')).toBe(false);
    expect(matrix.has('ELEC')).toBe(true);
  });

  test('auditDocumentSet identifies missing documents', () => {
    const matrix = getExpectedDocumentMatrix(3);
    const audit = auditDocumentSet('MOOR-001', matrix);

    expect(audit.projectId).toBe('MOOR-001');
    expect(audit.totalMissing).toBeGreaterThan(0);
    expect(audit.overallCompleteness).toBeLessThan(100);
    expect(audit.warnings.length).toBeGreaterThan(0);
  });

  test('audit flags below-suitability documents', () => {
    const matrix = new Map<Discipline, string[]>();
    matrix.set('MECH', ['M-101']);
    const audit = auditDocumentSet('MOOR-001', matrix);

    expect(audit.totalBelowSuitability).toBe(1);
    expect(audit.warnings.some(w => w.includes('below IFR'))).toBe(true);
  });

  test('audit with empty register shows all missing', () => {
    loadDocumentRegister([]);
    const matrix = getExpectedDocumentMatrix(2);
    const audit = auditDocumentSet('MOOR-001', matrix);
    expect(audit.totalReceived).toBe(0);
    expect(audit.overallCompleteness).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  EVIDENCE TRACE CHAIN
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildEvidenceTraceChain', () => {
  beforeEach(() => loadTestDocuments());

  test('builds trace for valid reference', () => {
    const trace = buildEvidenceTraceChain({ documentId: 'A-101', sheet: 'A1', detailRef: '3/A-301' });
    expect(trace).not.toBeNull();
    expect(trace!.documentId).toBe('A-101');
    expect(trace!.discipline).toBe('ARCH');
    expect(trace!.suitability).toBe('S5');
    expect(trace!.originatingFirm).toBe('ArchCorp');
    expect(trace!.sheet).toBe('A1');
    expect(trace!.detailRef).toBe('3/A-301');
    expect(trace!.traceValid).toBe(true);
    expect(trace!.revisionCount).toBe(2);
  });

  test('returns null for missing reference', () => {
    expect(buildEvidenceTraceChain(null)).toBeNull();
    expect(buildEvidenceTraceChain(undefined)).toBeNull();
    expect(buildEvidenceTraceChain({})).toBeNull();
  });

  test('flags superseded document in trace', () => {
    const trace = buildEvidenceTraceChain({ documentId: 'A-100' });
    expect(trace).not.toBeNull();
    expect(trace!.traceValid).toBe(false);
    expect(trace!.warnings.some(w => w.includes('superseded'))).toBe(true);
  });

  test('flags below-suitability in trace', () => {
    const trace = buildEvidenceTraceChain({ documentId: 'M-101' });
    expect(trace).not.toBeNull();
    expect(trace!.traceValid).toBe(false);
    expect(trace!.warnings.some(w => w.includes('below IFR'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

describe('inferDiscipline', () => {
  test('A- prefix → ARCH', () => expect(inferDiscipline('A-201')).toBe('ARCH'));
  test('S- prefix → STRUCT', () => expect(inferDiscipline('S-301')).toBe('STRUCT'));
  test('M- prefix → MECH', () => expect(inferDiscipline('M-101')).toBe('MECH'));
  test('E- prefix → ELEC', () => expect(inferDiscipline('E-101')).toBe('ELEC'));
  test('P- prefix → PLUMB', () => expect(inferDiscipline('P-101')).toBe('PLUMB'));
  test('FP- prefix → FIRE', () => expect(inferDiscipline('FP-101')).toBe('FIRE'));
  test('C- prefix → CIVIL', () => expect(inferDiscipline('C-101')).toBe('CIVIL'));
  test('L- prefix → LANDSCAPE', () => expect(inferDiscipline('L-101')).toBe('LANDSCAPE'));
  test('SPEC prefix → SPEC', () => expect(inferDiscipline('SPEC-03')).toBe('SPEC'));
  test('unknown prefix → OTHER', () => expect(inferDiscipline('Z-101')).toBe('OTHER'));
  test('case insensitive', () => expect(inferDiscipline('a-101')).toBe('ARCH'));
});

describe('getSuitabilityLabel', () => {
  test('S0 → Work in Progress', () => expect(getSuitabilityLabel('S0')).toContain('Work in Progress'));
  test('S3 → Review', () => expect(getSuitabilityLabel('S3')).toContain('Review'));
  test('S5 → Construction', () => expect(getSuitabilityLabel('S5')).toContain('Construction'));
});

describe('isSuitableForQTO', () => {
  test('S0 is not suitable', () => expect(isSuitableForQTO('S0')).toBe(false));
  test('S1 is not suitable', () => expect(isSuitableForQTO('S1')).toBe(false));
  test('S2 is not suitable', () => expect(isSuitableForQTO('S2')).toBe(false));
  test('S3 (IFR) is suitable', () => expect(isSuitableForQTO('S3')).toBe(true));
  test('S4 is suitable', () => expect(isSuitableForQTO('S4')).toBe(true));
  test('S5 (IFC) is suitable', () => expect(isSuitableForQTO('S5')).toBe(true));
  test('S6 is suitable', () => expect(isSuitableForQTO('S6')).toBe(true));
});
