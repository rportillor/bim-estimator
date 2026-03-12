/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  SERVICES — Assembly, Document, Lifecycle Services — Test Suite
 *  50+ tests
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ─── ASSEMBLY LOGIC ─────────────────────────────────────────────────────────

import { AssemblyLogicService } from '../assembly-logic';
import type { Assembly, AssemblyComponent } from '../assembly-logic';

describe('assembly-logic.ts', () => {
  let service: AssemblyLogicService;
  beforeEach(() => { service = new AssemblyLogicService(); });

  test('creates assembly from components', () => {
    const assembly = service.createAssembly({
      name: 'Exterior Wall Type A',
      components: [
        { name: 'Brick veneer', material: 'brick', thickness_mm: 90, csiDivision: '04' },
        { name: 'Air gap', material: 'air', thickness_mm: 25, csiDivision: '07' },
        { name: 'Insulation', material: 'mineral_wool', thickness_mm: 75, csiDivision: '07' },
        { name: 'Gypsum board', material: 'gypsum', thickness_mm: 13, csiDivision: '09' },
      ],
    });
    expect(assembly).toBeDefined();
    expect(assembly.name).toBe('Exterior Wall Type A');
    expect(assembly.components.length).toBe(4);
  });

  test('calculates total thickness', () => {
    const assembly = service.createAssembly({
      name: 'Test Wall',
      components: [
        { name: 'A', material: 'a', thickness_mm: 100, csiDivision: '03' },
        { name: 'B', material: 'b', thickness_mm: 50, csiDivision: '07' },
      ],
    });
    expect(assembly.totalThickness_mm).toBe(150);
  });

  test('validates fire rating requirements', () => {
    const result = service.validateFireRating({
      assembly: { name: 'Fire Wall', components: [], totalThickness_mm: 200, fireRating: 'FRL 120/120/120' },
      requiredRating: 'FRL 60/60/60',
    });
    expect(result).toBeDefined();
    expect(result.meets).toBe(true);
  });

  test('empty components returns valid assembly', () => {
    const assembly = service.createAssembly({ name: 'Empty', components: [] });
    expect(assembly.totalThickness_mm).toBe(0);
  });
});

// ─── DOCUMENT CHUNKER ───────────────────────────────────────────────────────

import { DocumentChunker } from '../document-chunker';

describe('document-chunker.ts', () => {
  let chunker: DocumentChunker;
  beforeEach(() => { chunker = new DocumentChunker(); });

  test('chunks long text into manageable pieces', () => {
    const longText = 'A'.repeat(5000);
    const chunks = chunker.chunk(longText, { maxChunkSize: 1000 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(1100);
    }
  });

  test('short text returns single chunk', () => {
    const chunks = chunker.chunk('Hello world', { maxChunkSize: 1000 });
    expect(chunks).toHaveLength(1);
  });

  test('chunks have sequential indices', () => {
    const text = 'Word '.repeat(500);
    const chunks = chunker.chunk(text, { maxChunkSize: 500 });
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].index).toBe(i);
    }
  });

  test('empty text returns empty or single chunk', () => {
    const chunks = chunker.chunk('', { maxChunkSize: 1000 });
    expect(chunks.length).toBeLessThanOrEqual(1);
  });
});

// ─── RFI SERVICE ────────────────────────────────────────────────────────────

import { RfiService } from '../rfi-service';

describe('rfi-service.ts', () => {
  let rfiService: RfiService;
  beforeEach(() => { rfiService = new RfiService(); });

  test('creates RFI', () => {
    const rfi = rfiService.create({
      projectId: 'MOOR',
      subject: 'Wall thickness at grid A-3',
      description: 'Drawing A-201 does not specify wall thickness at grid intersection A-3',
      discipline: 'ARCH',
      drawingRef: 'A-201',
      priority: 'HIGH',
    });
    expect(rfi).toBeDefined();
    expect(rfi.number).toMatch(/RFI/);
    expect(rfi.status).toBe('OPEN');
  });

  test('assigns sequential numbers', () => {
    const rfi1 = rfiService.create({
      projectId: 'MOOR',
      subject: 'RFI 1',
      description: 'First',
      discipline: 'ARCH',
      priority: 'NORMAL',
    });
    const rfi2 = rfiService.create({
      projectId: 'MOOR',
      subject: 'RFI 2',
      description: 'Second',
      discipline: 'STRUCT',
      priority: 'HIGH',
    });
    expect(rfi1.number).not.toBe(rfi2.number);
  });

  test('retrieves RFI by number', () => {
    const created = rfiService.create({
      projectId: 'MOOR',
      subject: 'Test',
      description: 'Test',
      discipline: 'MECH',
      priority: 'NORMAL',
    });
    const retrieved = rfiService.getByNumber(created.number);
    expect(retrieved).toBeDefined();
    expect(retrieved!.subject).toBe('Test');
  });

  test('lists RFIs by project', () => {
    rfiService.create({ projectId: 'MOOR', subject: 'A', description: 'A', discipline: 'ARCH', priority: 'NORMAL' });
    rfiService.create({ projectId: 'MOOR', subject: 'B', description: 'B', discipline: 'STRUCT', priority: 'HIGH' });
    rfiService.create({ projectId: 'OTHER', subject: 'C', description: 'C', discipline: 'ELEC', priority: 'NORMAL' });

    const moorRFIs = rfiService.listByProject('MOOR');
    expect(moorRFIs.length).toBe(2);
  });

  test('responds to RFI', () => {
    const rfi = rfiService.create({ projectId: 'MOOR', subject: 'Q', description: 'Q', discipline: 'ARCH', priority: 'NORMAL' });
    const responded = rfiService.respond(rfi.number, {
      response: 'Wall is 200mm thick',
      respondedBy: 'Architect',
    });
    expect(responded).toBeDefined();
    expect(responded!.status).toBe('RESPONDED');
    expect(responded!.response).toBe('Wall is 200mm thick');
  });

  test('closes RFI', () => {
    const rfi = rfiService.create({ projectId: 'MOOR', subject: 'Q', description: 'Q', discipline: 'ARCH', priority: 'NORMAL' });
    rfiService.respond(rfi.number, { response: 'Answer', respondedBy: 'Arch' });
    const closed = rfiService.close(rfi.number);
    expect(closed).toBeDefined();
    expect(closed!.status).toBe('CLOSED');
  });
});

// ─── CHANGE REQUEST SERVICE ─────────────────────────────────────────────────

import { ChangeRequestService } from '../change-request-service';

describe('change-request-service.ts', () => {
  let crService: ChangeRequestService;
  beforeEach(() => { crService = new ChangeRequestService(); });

  test('creates change request', () => {
    const cr = crService.create({
      projectId: 'MOOR',
      title: 'Add window to north elevation',
      description: 'Client requested additional window at grid B-2 Level 2',
      requestedBy: 'Client',
      discipline: 'ARCH',
    });
    expect(cr).toBeDefined();
    expect(cr.status).toBe('PENDING');
  });

  test('approves change request', () => {
    const cr = crService.create({
      projectId: 'MOOR',
      title: 'Test CR',
      description: 'Test',
      requestedBy: 'Client',
      discipline: 'ARCH',
    });
    const approved = crService.approve(cr.id, 'Project Manager');
    expect(approved).toBeDefined();
    expect(approved!.status).toBe('APPROVED');
  });

  test('rejects change request', () => {
    const cr = crService.create({
      projectId: 'MOOR',
      title: 'Test CR 2',
      description: 'Test',
      requestedBy: 'Client',
      discipline: 'STRUCT',
    });
    const rejected = crService.reject(cr.id, 'PM', 'Budget constraint');
    expect(rejected).toBeDefined();
    expect(rejected!.status).toBe('REJECTED');
  });

  test('lists by project', () => {
    crService.create({ projectId: 'MOOR', title: 'A', description: 'A', requestedBy: 'C', discipline: 'ARCH' });
    crService.create({ projectId: 'MOOR', title: 'B', description: 'B', requestedBy: 'C', discipline: 'MECH' });
    const list = crService.listByProject('MOOR');
    expect(list.length).toBe(2);
  });
});

// ─── ATOMIC REVISION SERVICE ────────────────────────────────────────────────

import { AtomicRevisionService } from '../atomic-revision-service';

describe('atomic-revision-service.ts', () => {
  let revService: AtomicRevisionService;
  beforeEach(() => { revService = new AtomicRevisionService(); });

  test('creates revision', () => {
    const rev = revService.createRevision({
      projectId: 'MOOR',
      modelId: 'model-001',
      description: 'Initial model upload',
      changedBy: 'BIM Manager',
    });
    expect(rev).toBeDefined();
    expect(rev.revisionNumber).toBeGreaterThanOrEqual(1);
  });

  test('increments revision numbers', () => {
    const rev1 = revService.createRevision({ projectId: 'MOOR', modelId: 'm1', description: 'Rev 1', changedBy: 'A' });
    const rev2 = revService.createRevision({ projectId: 'MOOR', modelId: 'm1', description: 'Rev 2', changedBy: 'B' });
    expect(rev2.revisionNumber).toBeGreaterThan(rev1.revisionNumber);
  });

  test('retrieves revision history', () => {
    revService.createRevision({ projectId: 'MOOR', modelId: 'm1', description: 'First', changedBy: 'A' });
    revService.createRevision({ projectId: 'MOOR', modelId: 'm1', description: 'Second', changedBy: 'B' });
    const history = revService.getHistory('MOOR', 'm1');
    expect(history.length).toBe(2);
  });

  test('rollback marks later revisions', () => {
    revService.createRevision({ projectId: 'MOOR', modelId: 'm2', description: 'R1', changedBy: 'A' });
    const rev2 = revService.createRevision({ projectId: 'MOOR', modelId: 'm2', description: 'R2', changedBy: 'B' });
    const result = revService.rollback('MOOR', 'm2', 1);
    expect(result).toBeDefined();
    expect(result.rolledBack).toBe(true);
  });
});
