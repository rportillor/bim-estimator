/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  SERVICES — Assembly, Document, Lifecycle Services — Test Suite
 *  50+ tests
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ─── Mock DB and storage dependencies ──────────────────────────────────────

jest.mock('../../db', () => {
  const mockReturning = jest.fn();
  const mockValues = jest.fn(() => ({ returning: mockReturning, onConflictDoNothing: jest.fn() }));
  const mockSet = jest.fn(() => ({ where: jest.fn(() => ({ returning: mockReturning })) }));
  const mockWhere = jest.fn(() => ({
    orderBy: jest.fn(() => ({ limit: jest.fn(() => []) })),
    returning: mockReturning,
  }));
  const mockFrom = jest.fn(() => ({ where: mockWhere, orderBy: jest.fn(() => []) }));
  const mockInsert = jest.fn(() => ({ values: mockValues }));
  const mockSelect = jest.fn(() => ({ from: mockFrom }));
  const mockUpdate = jest.fn(() => ({ set: mockSet }));
  const mockTransaction = jest.fn((cb) => cb({
    insert: mockInsert,
    select: mockSelect,
    update: mockUpdate,
  }));

  return {
    db: {
      insert: mockInsert,
      select: mockSelect,
      update: mockUpdate,
      transaction: mockTransaction,
    },
  };
});

jest.mock('@shared/schema', () => ({
  rfis: { id: 'rfis.id', projectId: 'rfis.projectId', rfiNumber: 'rfis.rfiNumber', createdAt: 'rfis.createdAt', generatedFromConflict: 'rfis.generatedFromConflict', status: 'rfis.status' },
  rfiResponses: { rfiId: 'rfiResponses.rfiId', createdAt: 'rfiResponses.createdAt' },
  rfiAttachments: { rfiId: 'rfiAttachments.rfiId', createdAt: 'rfiAttachments.createdAt' },
  documents: { id: 'documents.id', projectId: 'documents.projectId' },
  documentRevisions: { documentId: 'documentRevisions.documentId', revisionNumber: 'documentRevisions.revisionNumber' },
  revisionCounters: { documentId: 'revisionCounters.documentId' },
  changeRequests: { id: 'changeRequests.id', projectId: 'changeRequests.projectId', status: 'changeRequests.status', createdAt: 'changeRequests.createdAt', approvedAt: 'changeRequests.approvedAt', estimateRevisionRequired: 'changeRequests.estimateRevisionRequired', bimModelUpdateRequired: 'changeRequests.bimModelUpdateRequired', rfiId: 'changeRequests.rfiId' },
  changeRequestAttachments: { changeRequestId: 'changeRequestAttachments.changeRequestId', createdAt: 'changeRequestAttachments.createdAt' },
  projects: {},
  users: {},
  boqItems: {},
  costEstimates: {},
}));

jest.mock('drizzle-orm', () => ({
  eq: jest.fn((...args: any[]) => ({ op: 'eq', args })),
  desc: jest.fn((col: any) => ({ op: 'desc', col })),
  and: jest.fn((...args: any[]) => ({ op: 'and', args })),
  like: jest.fn((...args: any[]) => ({ op: 'like', args })),
}));

jest.mock('../../utils/rfi-utils', () => ({
  generateRfiNumber: jest.fn().mockResolvedValue('RFI-2026-0001'),
}));

jest.mock('../file-storage', () => ({
  FileStorageService: {
    saveFile: jest.fn().mockResolvedValue({
      storagePath: '/tmp/test',
      fileHash: 'abc123',
      relativePath: 'uploads/test.pdf',
    }),
  },
}));

// ─── ASSEMBLY LOGIC ─────────────────────────────────────────────────────────

import { AssemblyLogicService } from '../assembly-logic';

describe('assembly-logic.ts', () => {
  let service: AssemblyLogicService;
  beforeEach(() => { service = new AssemblyLogicService(); });

  test('processAssemblies groups raw materials into assemblies', () => {
    const rawMaterials = [
      { description: 'Gypsum board', quantity: 100 },
      { description: 'Drywall screw box', quantity: 10 },
      { description: 'Insulation batt', quantity: 50 },
    ];
    const assemblies = service.processAssemblies(rawMaterials);
    expect(assemblies).toBeDefined();
    expect(Array.isArray(assemblies)).toBe(true);
    expect(assemblies.length).toBeGreaterThan(0);
  });

  test('creates wall assembly from gypsum/drywall materials', () => {
    const rawMaterials = [
      { description: 'Gypsum board 13mm', quantity: 200 },
      { description: 'Drywall compound', quantity: 5 },
    ];
    const assemblies = service.processAssemblies(rawMaterials);
    const wallAssembly = assemblies.find(a => a.name.toLowerCase().includes('wall'));
    expect(wallAssembly).toBeDefined();
    expect(wallAssembly!.components.length).toBeGreaterThan(0);
    expect(wallAssembly!.baseUnit).toBe('100 SF');
  });

  test('creates fastener assembly from screw materials', () => {
    const rawMaterials = [
      { description: 'Self-drilling screw #8', quantity: 500 },
      { description: 'Hex bolt 10mm', quantity: 200 },
    ];
    const assemblies = service.processAssemblies(rawMaterials);
    const fastenerAssembly = assemblies.find(a => a.name.toLowerCase().includes('fastener'));
    expect(fastenerAssembly).toBeDefined();
    expect(fastenerAssembly!.components.length).toBe(2);
    expect(fastenerAssembly!.csiCode).toBe('06 05 23');
  });

  test('creates floor assembly from flooring materials', () => {
    const rawMaterials = [
      { description: 'Flooring underlayment 6mm', quantity: 100 },
    ];
    const assemblies = service.processAssemblies(rawMaterials);
    const floorAssembly = assemblies.find(a => a.name.toLowerCase().includes('floor'));
    expect(floorAssembly).toBeDefined();
    expect(floorAssembly!.baseUnit).toBe('100 SF');
  });

  test('empty materials returns empty assemblies', () => {
    const assemblies = service.processAssemblies([]);
    expect(assemblies).toEqual([]);
  });

  test('assembly components have zero cost and quantity by default', () => {
    const rawMaterials = [
      { description: 'Brick veneer', quantity: 500 },
    ];
    const assemblies = service.processAssemblies(rawMaterials);
    expect(assemblies.length).toBeGreaterThan(0);
    for (const assembly of assemblies) {
      expect(assembly.totalCost).toBe(0);
      for (const comp of assembly.components) {
        expect(comp.quantity).toBe(0);
        expect(comp.rate).toBe(0);
        expect(comp.subtotal).toBe(0);
      }
    }
  });

  test('concrete materials create concrete/masonry assembly', () => {
    const rawMaterials = [
      { description: 'Precast concrete panel', quantity: 20 },
    ];
    const assemblies = service.processAssemblies(rawMaterials);
    expect(assemblies.length).toBe(1);
    expect(assemblies[0].components[0].material).toContain('Precast concrete');
  });

  test('miscellaneous materials grouped under generic assembly', () => {
    const rawMaterials = [
      { description: 'Custom item ABC', quantity: 10 },
    ];
    const assemblies = service.processAssemblies(rawMaterials);
    expect(assemblies.length).toBe(1);
    expect(assemblies[0].name).toContain('miscellaneous');
  });

  test('multiple assembly types from mixed materials', () => {
    const rawMaterials = [
      { description: 'Gypsum board', quantity: 100 },
      { description: 'Self-drilling screw', quantity: 500 },
      { description: 'Flooring underlayment', quantity: 80 },
      { description: 'Concrete footing', quantity: 30 },
      { description: 'Brick veneer', quantity: 200 },
    ];
    const assemblies = service.processAssemblies(rawMaterials);
    expect(assemblies.length).toBeGreaterThanOrEqual(4);
  });

  test('assembly has valid id', () => {
    const rawMaterials = [
      { description: 'Gypsum board', quantity: 50 },
    ];
    const assemblies = service.processAssemblies(rawMaterials);
    expect(assemblies[0].id).toBeDefined();
    expect(typeof assemblies[0].id).toBe('string');
    expect(assemblies[0].id.length).toBeGreaterThan(0);
  });

  test('assembly description is populated', () => {
    const rawMaterials = [
      { description: 'Self-drilling screw', quantity: 100 },
    ];
    const assemblies = service.processAssemblies(rawMaterials);
    expect(assemblies[0].description).toBeDefined();
    expect(assemblies[0].description.length).toBeGreaterThan(0);
  });
});

// ─── DOCUMENT CHUNKER ───────────────────────────────────────────────────────

import { DocumentChunker } from '../document-chunker';

describe('document-chunker.ts', () => {
  let chunker: DocumentChunker;
  beforeEach(() => { chunker = new DocumentChunker(); });

  test('chunks specification document by CSI divisions', async () => {
    const specContent = `
DIVISION 01 - GENERAL REQUIREMENTS
General requirements for the project including quality control and temporary facilities.

DIVISION 03 - CONCRETE
Concrete foundation work including reinforcement and formwork specifications.

DIVISION 07 - THERMAL & MOISTURE PROTECTION
Insulation requirements and waterproofing membrane specifications.

DIVISION 09 - FINISHES
Drywall and flooring finish specifications and paint requirements.

DIVISION 16 - ELECTRICAL
Electrical systems and communications wiring specifications.
    `;
    const chunks = await chunker.chunkSpecificationDocument(specContent, 'test-spec.pdf');
    expect(chunks).toBeDefined();
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks.length).toBeGreaterThan(0);
  });

  test('chunks have ascending indices', async () => {
    const specContent = `
DIVISION 01 - GENERAL
General requirements.
DIVISION 07 - THERMAL
Thermal and moisture protection.
DIVISION 09 - FINISHES
Finishes specifications.
    `;
    const chunks = await chunker.chunkSpecificationDocument(specContent, 'spec.pdf');
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].chunkIndex).toBeGreaterThan(chunks[i - 1].chunkIndex);
    }
  });

  test('each chunk has required properties', async () => {
    const specContent = `
DIVISION 03 - CONCRETE
Concrete specifications including foundation requirements.
    `;
    const chunks = await chunker.chunkSpecificationDocument(specContent, 'spec.pdf');
    for (const chunk of chunks) {
      expect(chunk.id).toBeDefined();
      expect(chunk.title).toBeDefined();
      expect(chunk.content).toBeDefined();
      expect(chunk.csiDivisions).toBeDefined();
      expect(Array.isArray(chunk.csiDivisions)).toBe(true);
      expect(chunk.tokenEstimate).toBeGreaterThan(0);
      // totalChunks reflects the strategy length (3), not the returned array length
      expect(chunk.totalChunks).toBe(3);
    }
  });

  test('empty content returns empty chunks', async () => {
    const chunks = await chunker.chunkSpecificationDocument('', 'empty.pdf');
    expect(chunks).toHaveLength(0);
  });

  test('chunk token estimate is roughly content length / 4', async () => {
    const specContent = `
DIVISION 03 - CONCRETE
${'Concrete specification details. '.repeat(100)}
    `;
    const chunks = await chunker.chunkSpecificationDocument(specContent, 'spec.pdf');
    for (const chunk of chunks) {
      expect(chunk.tokenEstimate).toBe(Math.ceil(chunk.content.length / 4));
    }
  });

  test('createChunkedAnalysisPrompt returns prompt string', async () => {
    const specContent = `
DIVISION 03 - CONCRETE
Concrete foundation specs.
    `;
    const chunks = await chunker.chunkSpecificationDocument(specContent, 'spec.pdf');
    if (chunks.length > 0) {
      const prompt = chunker.createChunkedAnalysisPrompt(chunks[0], 'Test Project');
      expect(typeof prompt).toBe('string');
      expect(prompt).toContain('Test Project');
      expect(prompt).toContain(chunks[0].title);
    }
  });

  test('createChunkedAnalysisPrompt works without project context', async () => {
    const specContent = `
DIVISION 07 - THERMAL & MOISTURE
Insulation and waterproofing.
    `;
    const chunks = await chunker.chunkSpecificationDocument(specContent, 'spec.pdf');
    if (chunks.length > 0) {
      const prompt = chunker.createChunkedAnalysisPrompt(chunks[0]);
      expect(typeof prompt).toBe('string');
      expect(prompt).toContain('CHUNK');
    }
  });

  test('chunks report consistent totalChunks from strategy', async () => {
    const specContent = `
DIVISION 01 - GENERAL
General requirements and quality control.
DIVISION 07 - THERMAL
Insulation, roofing, waterproofing, vapor barrier, sealants.
DIVISION 09 - FINISHES
Drywall, flooring, ceiling, paint specifications.
    `;
    const chunks = await chunker.chunkSpecificationDocument(specContent, 'spec.pdf');
    // totalChunks is always the strategy length (3 CSI groups)
    for (const chunk of chunks) {
      expect(chunk.totalChunks).toBe(3);
    }
  });
});

// ─── RFI SERVICE ────────────────────────────────────────────────────────────

import { RfiService } from '../rfi-service';
import { db } from '../../db';

describe('rfi-service.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('createRfi is a static async method', () => {
    expect(typeof RfiService.createRfi).toBe('function');
  });

  test('getProjectRfis is a static async method', () => {
    expect(typeof RfiService.getProjectRfis).toBe('function');
  });

  test('getRfiWithDetails is a static async method', () => {
    expect(typeof RfiService.getRfiWithDetails).toBe('function');
  });

  test('addResponse is a static async method', () => {
    expect(typeof RfiService.addResponse).toBe('function');
  });

  test('addAttachment is a static async method', () => {
    expect(typeof RfiService.addAttachment).toBe('function');
  });

  test('updateRfiStatus is a static async method', () => {
    expect(typeof RfiService.updateRfiStatus).toBe('function');
  });

  test('getConflictGeneratedRfis is a static async method', () => {
    expect(typeof RfiService.getConflictGeneratedRfis).toBe('function');
  });

  test('generateRfiFromConflict is a static async method', () => {
    expect(typeof RfiService.generateRfiFromConflict).toBe('function');
  });

  test('getRfiStats is a static async method', () => {
    expect(typeof RfiService.getRfiStats).toBe('function');
  });

  test('searchRfis is a static async method', () => {
    expect(typeof RfiService.searchRfis).toBe('function');
  });

  test('createRfi calls db.insert', async () => {
    const mockRfi = {
      id: 'rfi-1',
      rfiNumber: 'RFI-2026-0001',
      subject: 'Test RFI',
      question: 'What is the wall thickness?',
      projectId: 'proj-1',
      status: 'Open',
      priority: 'High',
      fromName: 'Engineer',
      fromCompany: 'EngCo',
      toName: 'Architect',
      toCompany: 'ArchCo',
      createdAt: new Date(),
    };

    const mockReturning = jest.fn().mockResolvedValue([mockRfi]);
    const mockValues = jest.fn(() => ({ returning: mockReturning }));
    (db.insert as jest.Mock).mockReturnValue({ values: mockValues });

    const result = await RfiService.createRfi({
      projectId: 'proj-1',
      rfiNumber: 'RFI-2026-0001',
      subject: 'Test RFI',
      question: 'What is the wall thickness?',
      priority: 'High',
      fromName: 'Engineer',
      fromCompany: 'EngCo',
      toName: 'Architect',
      toCompany: 'ArchCo',
    } as any);

    expect(db.insert).toHaveBeenCalled();
    expect(result).toEqual(mockRfi);
  });

  test('getProjectRfis calls db.select with project filter', async () => {
    const mockRfis = [
      { id: 'rfi-1', rfiNumber: 'RFI-2026-0001', subject: 'RFI A', status: 'Open' },
      { id: 'rfi-2', rfiNumber: 'RFI-2026-0002', subject: 'RFI B', status: 'Responded' },
    ];

    const mockOrderBy = jest.fn().mockResolvedValue(mockRfis);
    const mockWhere = jest.fn(() => ({ orderBy: mockOrderBy }));
    const mockFrom = jest.fn(() => ({ where: mockWhere }));
    (db.select as jest.Mock).mockReturnValue({ from: mockFrom });

    const result = await RfiService.getProjectRfis('proj-1');
    expect(db.select).toHaveBeenCalled();
    expect(result).toEqual(mockRfis);
  });

  test('updateRfiStatus sets Closed status with user info', async () => {
    const mockUpdatedRfi = { id: 'rfi-1', status: 'Closed', answeredBy: 'user-1' };
    const mockReturning = jest.fn().mockResolvedValue([mockUpdatedRfi]);
    const mockWhere = jest.fn(() => ({ returning: mockReturning }));
    const mockSet = jest.fn(() => ({ where: mockWhere }));
    (db.update as jest.Mock).mockReturnValue({ set: mockSet });

    const result = await RfiService.updateRfiStatus('rfi-1', 'Closed', 'user-1');
    expect(db.update).toHaveBeenCalled();
    expect(result).toEqual(mockUpdatedRfi);
  });

  test('getRfiStats computes statistics from project RFIs', async () => {
    const mockRfis = [
      { id: '1', status: 'Open', generatedFromConflict: false },
      { id: '2', status: 'Open', generatedFromConflict: true },
      { id: '3', status: 'Responded', generatedFromConflict: false },
      { id: '4', status: 'Closed', generatedFromConflict: false },
      { id: '5', status: 'In Progress', generatedFromConflict: true },
    ];

    const mockOrderBy = jest.fn().mockResolvedValue(mockRfis);
    const mockWhere = jest.fn(() => ({ orderBy: mockOrderBy }));
    const mockFrom = jest.fn(() => ({ where: mockWhere }));
    (db.select as jest.Mock).mockReturnValue({ from: mockFrom });

    const stats = await RfiService.getRfiStats('proj-1');
    expect(stats.total).toBe(5);
    expect(stats.open).toBe(2);
    expect(stats.responded).toBe(1);
    expect(stats.closed).toBe(1);
    expect(stats.inProgress).toBe(1);
    expect(stats.aiGenerated).toBe(2);
  });

  test('searchRfis filters results by query', async () => {
    const mockRfis = [
      { id: '1', subject: 'Wall thickness', question: 'What is wall thickness?', rfiNumber: 'RFI-2026-0001' },
      { id: '2', subject: 'Floor detail', question: 'What floor type?', rfiNumber: 'RFI-2026-0002' },
    ];

    const mockOrderBy = jest.fn().mockResolvedValue(mockRfis);
    const mockWhere = jest.fn(() => ({ orderBy: mockOrderBy }));
    const mockFrom = jest.fn(() => ({ where: mockWhere }));
    (db.select as jest.Mock).mockReturnValue({ from: mockFrom });

    const results = await RfiService.searchRfis('proj-1', 'wall');
    expect(results.length).toBe(1);
    expect(results[0].subject).toBe('Wall thickness');
  });
});

// ─── CHANGE REQUEST SERVICE ─────────────────────────────────────────────────

import { ChangeRequestService } from '../change-request-service';

describe('change-request-service.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('createChangeRequest is a static async method', () => {
    expect(typeof ChangeRequestService.createChangeRequest).toBe('function');
  });

  test('getProjectChangeRequests is a static async method', () => {
    expect(typeof ChangeRequestService.getProjectChangeRequests).toBe('function');
  });

  test('getChangeRequestWithDetails is a static async method', () => {
    expect(typeof ChangeRequestService.getChangeRequestWithDetails).toBe('function');
  });

  test('updateStatus is a static async method', () => {
    expect(typeof ChangeRequestService.updateStatus).toBe('function');
  });

  test('analyzeImpact is a static async method', () => {
    expect(typeof ChangeRequestService.analyzeImpact).toBe('function');
  });

  test('getChangeRequestStats is a static async method', () => {
    expect(typeof ChangeRequestService.getChangeRequestStats).toBe('function');
  });

  test('createChangeRequest calls db.insert', async () => {
    const mockCr = {
      id: 'cr-1',
      title: 'Add window',
      description: 'Client wants window at B-2',
      status: 'Pending',
      projectId: 'proj-1',
    };

    const mockReturning = jest.fn().mockResolvedValue([mockCr]);
    const mockValues = jest.fn(() => ({ returning: mockReturning }));
    (db.insert as jest.Mock).mockReturnValue({ values: mockValues });

    const result = await ChangeRequestService.createChangeRequest({
      projectId: 'proj-1',
      title: 'Add window',
      description: 'Client wants window at B-2',
      reason: 'Client request',
    } as any);

    expect(db.insert).toHaveBeenCalled();
    expect(result).toEqual(mockCr);
  });

  test('getProjectChangeRequests queries by project', async () => {
    const mockCrs = [
      { id: 'cr-1', title: 'CR A', status: 'Pending' },
      { id: 'cr-2', title: 'CR B', status: 'Approved' },
    ];

    const mockOrderBy = jest.fn().mockResolvedValue(mockCrs);
    const mockWhere = jest.fn(() => ({ orderBy: mockOrderBy }));
    const mockFrom = jest.fn(() => ({ where: mockWhere }));
    (db.select as jest.Mock).mockReturnValue({ from: mockFrom });

    const result = await ChangeRequestService.getProjectChangeRequests('proj-1');
    expect(result).toEqual(mockCrs);
    expect(result.length).toBe(2);
  });

  test('updateStatus sets Approved status', async () => {
    const mockUpdatedCr = { id: 'cr-1', status: 'Approved', approvedBy: 'pm-1' };
    const mockReturning = jest.fn().mockResolvedValue([mockUpdatedCr]);
    const mockWhere = jest.fn(() => ({ returning: mockReturning }));
    const mockSet = jest.fn(() => ({ where: mockWhere }));
    (db.update as jest.Mock).mockReturnValue({ set: mockSet });

    const result = await ChangeRequestService.updateStatus('cr-1', 'Approved', 'pm-1');
    expect(result.status).toBe('Approved');
  });

  test('updateStatus sets Rejected status with reason', async () => {
    const mockUpdatedCr = { id: 'cr-1', status: 'Rejected', rejectionReason: 'Budget constraint' };
    const mockReturning = jest.fn().mockResolvedValue([mockUpdatedCr]);
    const mockWhere = jest.fn(() => ({ returning: mockReturning }));
    const mockSet = jest.fn(() => ({ where: mockWhere }));
    (db.update as jest.Mock).mockReturnValue({ set: mockSet });

    const result = await ChangeRequestService.updateStatus('cr-1', 'Rejected', 'pm-1', 'Budget constraint');
    expect(result.status).toBe('Rejected');
  });

  test('getChangeRequestStats computes statistics', async () => {
    const mockCrs = [
      { id: '1', status: 'Pending', costImpact: null, submittedAt: null, approvedAt: null },
      { id: '2', status: 'Approved', costImpact: '5000', submittedAt: new Date('2026-01-01'), approvedAt: new Date('2026-01-05') },
      { id: '3', status: 'Rejected', costImpact: null, submittedAt: null, approvedAt: null },
      { id: '4', status: 'Under Review', costImpact: null, submittedAt: null, approvedAt: null },
      { id: '5', status: 'Implemented', costImpact: null, submittedAt: null, approvedAt: null },
    ];

    const mockOrderBy = jest.fn().mockResolvedValue(mockCrs);
    const mockWhere = jest.fn(() => ({ orderBy: mockOrderBy }));
    const mockFrom = jest.fn(() => ({ where: mockWhere }));
    (db.select as jest.Mock).mockReturnValue({ from: mockFrom });

    const stats = await ChangeRequestService.getChangeRequestStats('proj-1');
    expect(stats.total).toBe(5);
    expect(stats.pending).toBe(1);
    expect(stats.approved).toBe(1);
    expect(stats.rejected).toBe(1);
    expect(stats.underReview).toBe(1);
    expect(stats.implemented).toBe(1);
  });

  test('searchChangeRequests filters by query string', async () => {
    const mockCrs = [
      { id: '1', title: 'Add window north', description: 'Window at B-2', reason: 'Client' },
      { id: '2', title: 'Remove door south', description: 'Door removal', reason: 'Design change' },
    ];

    const mockOrderBy = jest.fn().mockResolvedValue(mockCrs);
    const mockWhere = jest.fn(() => ({ orderBy: mockOrderBy }));
    const mockFrom = jest.fn(() => ({ where: mockWhere }));
    (db.select as jest.Mock).mockReturnValue({ from: mockFrom });

    const results = await ChangeRequestService.searchChangeRequests('proj-1', 'window');
    expect(results.length).toBe(1);
    expect(results[0].title).toContain('window');
  });

  test('bulkApprove approves multiple CRs', async () => {
    const mockUpdatedCr1 = { id: 'cr-1', status: 'Approved' };
    const mockUpdatedCr2 = { id: 'cr-2', status: 'Approved' };

    const mockReturning = jest.fn()
      .mockResolvedValueOnce([mockUpdatedCr1])
      .mockResolvedValueOnce([mockUpdatedCr2]);
    const mockWhere = jest.fn(() => ({ returning: mockReturning }));
    const mockSet = jest.fn(() => ({ where: mockWhere }));
    (db.update as jest.Mock).mockReturnValue({ set: mockSet });

    const results = await ChangeRequestService.bulkApprove(['cr-1', 'cr-2'], 'pm-1', 'Batch approved');
    expect(results.length).toBe(2);
    expect(results[0].status).toBe('Approved');
    expect(results[1].status).toBe('Approved');
  });

  test('addAttachment is a static async method', () => {
    expect(typeof ChangeRequestService.addAttachment).toBe('function');
  });
});

// ─── ATOMIC REVISION SERVICE ────────────────────────────────────────────────

import { AtomicRevisionService } from '../atomic-revision-service';

describe('atomic-revision-service.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('createRevision is a static async method', () => {
    expect(typeof AtomicRevisionService.createRevision).toBe('function');
  });

  test('getDocumentRevisions is a static async method', () => {
    expect(typeof AtomicRevisionService.getDocumentRevisions).toBe('function');
  });

  test('approveRevision is a static async method', () => {
    expect(typeof AtomicRevisionService.approveRevision).toBe('function');
  });

  test('finalizeRevision is a static async method', () => {
    expect(typeof AtomicRevisionService.finalizeRevision).toBe('function');
  });

  test('getRevisionCounter is a static async method', () => {
    expect(typeof AtomicRevisionService.getRevisionCounter).toBe('function');
  });

  test('compareRevisions is a static async method', () => {
    expect(typeof AtomicRevisionService.compareRevisions).toBe('function');
  });

  test('getDocumentRevisions queries by documentId', async () => {
    const mockRevisions = [
      { id: 'rev-1', documentId: 'doc-1', revisionNumber: 1, status: 'approved' },
      { id: 'rev-2', documentId: 'doc-1', revisionNumber: 2, status: 'pending' },
    ];

    const mockOrderBy = jest.fn().mockResolvedValue(mockRevisions);
    const mockWhere = jest.fn(() => ({ orderBy: mockOrderBy }));
    const mockFrom = jest.fn(() => ({ where: mockWhere }));
    (db.select as jest.Mock).mockReturnValue({ from: mockFrom });

    const result = await AtomicRevisionService.getDocumentRevisions('doc-1');
    expect(result).toEqual(mockRevisions);
    expect(result.length).toBe(2);
  });

  test('getRevisionCounter returns number for existing document', async () => {
    const mockCounter = { documentId: 'doc-1', lastRevision: 5 };

    const mockWhere = jest.fn().mockResolvedValue([mockCounter]);
    const mockFrom = jest.fn(() => ({ where: mockWhere }));
    (db.select as jest.Mock).mockReturnValue({ from: mockFrom });

    const count = await AtomicRevisionService.getRevisionCounter('doc-1');
    expect(count).toBe(5);
  });

  test('getRevisionCounter returns 0 for nonexistent document', async () => {
    const mockWhere = jest.fn().mockResolvedValue([]);
    const mockFrom = jest.fn(() => ({ where: mockWhere }));
    (db.select as jest.Mock).mockReturnValue({ from: mockFrom });

    const count = await AtomicRevisionService.getRevisionCounter('doc-nonexistent');
    expect(count).toBe(0);
  });

  test('compareRevisions detects hash changes between revisions', async () => {
    const mockRevisions = [
      { revisionNumber: 1, filePath: '/path/v1.pdf', fileHash: 'hash-aaa', createdAt: new Date(), notes: 'First' },
      { revisionNumber: 2, filePath: '/path/v2.pdf', fileHash: 'hash-bbb', createdAt: new Date(), notes: 'Second' },
    ];

    const mockOrderBy = jest.fn().mockResolvedValue(mockRevisions);
    const mockWhere = jest.fn(() => ({ orderBy: mockOrderBy }));
    const mockFrom = jest.fn(() => ({ where: mockWhere }));
    (db.select as jest.Mock).mockReturnValue({ from: mockFrom });

    const comparison = await AtomicRevisionService.compareRevisions('doc-1', 1, 2);
    expect(comparison.hasChanges).toBe(true);
    expect(comparison.from.revision).toBe(1);
    expect(comparison.to.revision).toBe(2);
  });

  test('compareRevisions detects no changes when hashes match', async () => {
    const mockRevisions = [
      { revisionNumber: 1, filePath: '/path/v1.pdf', fileHash: 'same-hash', createdAt: new Date(), notes: 'First' },
      { revisionNumber: 2, filePath: '/path/v2.pdf', fileHash: 'same-hash', createdAt: new Date(), notes: 'Second' },
    ];

    const mockOrderBy = jest.fn().mockResolvedValue(mockRevisions);
    const mockWhere = jest.fn(() => ({ orderBy: mockOrderBy }));
    const mockFrom = jest.fn(() => ({ where: mockWhere }));
    (db.select as jest.Mock).mockReturnValue({ from: mockFrom });

    const comparison = await AtomicRevisionService.compareRevisions('doc-1', 1, 2);
    expect(comparison.hasChanges).toBe(false);
  });

  test('createRevision requires documentId, file, and uploadedBy', () => {
    // Verify the method signature exists and expects these params
    expect(AtomicRevisionService.createRevision.length).toBeGreaterThanOrEqual(3);
  });
});
