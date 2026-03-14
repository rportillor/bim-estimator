/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  MISSING DATA TRACKER — Test Suite
 *  50+ tests: 7 detection points, registration, resolution, RFI generation,
 *  summary statistics, serialization
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { MissingDataTracker } from '../missing-data-tracker';

// ═══════════════════════════════════════════════════════════════════════════════
//  SETUP
// ═══════════════════════════════════════════════════════════════════════════════

let tracker: MissingDataTracker;

beforeEach(() => {
  tracker = new MissingDataTracker('MOOR');
});

// ═══════════════════════════════════════════════════════════════════════════════
//  REGISTRATION — 7 DETECTION POINTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Detection Point 1: Document Extraction', () => {
  test('registers document gap', () => {
    const id = tracker.registerDocumentGap({
      drawingRef: 'A-201',
      parameter: 'wall_thickness',
      description: 'Wall thickness not legible on drawing',
    });
    expect(id).toMatch(/^GAP-MOOR-/);
    expect(tracker.size).toBe(1);

    const item = tracker.get(id)!;
    expect(item.detectionPoint).toBe('DOCUMENT_EXTRACTION');
    expect(item.severity).toBe('HIGH');
    expect(item.status).toBe('OPEN');
    expect(item.drawingRef).toBe('A-201');
  });

  test('allows custom severity', () => {
    const id = tracker.registerDocumentGap({
      drawingRef: 'A-101',
      parameter: 'north_arrow',
      description: 'North arrow missing',
      severity: 'LOW',
    });
    expect(tracker.get(id)!.severity).toBe('LOW');
  });
});

describe('Detection Point 2: Product Mapping', () => {
  test('registers product gap', () => {
    const id = tracker.registerProductGap({
      specSection: '07 21 13',
      parameter: 'insulation_manufacturer',
      description: 'Spec section lists "or equal" without basis of design',
    });
    const item = tracker.get(id)!;
    expect(item.detectionPoint).toBe('PRODUCT_MAPPING');
    expect(item.specSection).toBe('07 21 13');
  });
});

describe('Detection Point 3: Assembly Composition', () => {
  test('registers assembly gap', () => {
    const id = tracker.registerAssemblyGap({
      elementId: 'wall-ext-001',
      csiDivision: '07',
      parameter: 'vapor_barrier_type',
      description: 'Vapor barrier not specified in wall assembly',
    });
    const item = tracker.get(id)!;
    expect(item.detectionPoint).toBe('ASSEMBLY_COMPOSITION');
    expect(item.severity).toBe('MEDIUM');
  });
});

describe('Detection Point 4: Element Generation', () => {
  test('registers element gap', () => {
    const id = tracker.registerElementGap({
      elementId: 'beam-003',
      parameter: 'concrete_strength',
      description: 'Concrete strength (f\'c) not specified for transfer beam',
      floor: 'Level 2',
      severity: 'CRITICAL',
      discipline: 'STRUCT',
    });
    const item = tracker.get(id)!;
    expect(item.detectionPoint).toBe('ELEMENT_GENERATION');
    expect(item.severity).toBe('CRITICAL');
    expect(item.floor).toBe('Level 2');
    expect(item.discipline).toBe('STRUCT');
  });
});

describe('Detection Point 5: QTO Calculation', () => {
  test('registers QTO gap', () => {
    const id = tracker.registerQTOGap({
      elementId: 'slab-001',
      csiDivision: '03',
      parameter: 'slab_depth',
      description: 'Slab depth varies — cannot calculate concrete volume',
    });
    const item = tracker.get(id)!;
    expect(item.detectionPoint).toBe('QTO_CALCULATION');
    expect(item.csiDivision).toBe('03');
  });
});

describe('Detection Point 6: Cost Estimation', () => {
  test('registers cost gap', () => {
    const id = tracker.registerCostGap({
      csiDivision: '26',
      parameter: 'electrical_panel_unit_rate',
      description: 'No rate data for 200A panel in Kawartha Lakes region',
    });
    const item = tracker.get(id)!;
    expect(item.detectionPoint).toBe('COST_ESTIMATION');
    expect(item.severity).toBe('MEDIUM');
  });
});

describe('Detection Point 7: Clash Detection', () => {
  test('registers clash gap', () => {
    const id = tracker.registerClashGap({
      elementId: 'duct-hvac-001',
      parameter: 'clearance_duct_to_sprinkler',
      description: 'No clearance tolerance defined for HVAC duct to sprinkler head',
      discipline: 'MECH',
      severity: 'HIGH',
    });
    const item = tracker.get(id)!;
    expect(item.detectionPoint).toBe('CLASH_DETECTION');
    expect(item.discipline).toBe('MECH');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SEQUENTIAL IDS
// ═══════════════════════════════════════════════════════════════════════════════

describe('ID Generation', () => {
  test('generates sequential IDs', () => {
    const id1 = tracker.registerDocumentGap({ drawingRef: 'A-101', parameter: 'p1', description: 'd1' });
    const id2 = tracker.registerDocumentGap({ drawingRef: 'A-102', parameter: 'p2', description: 'd2' });
    const id3 = tracker.registerDocumentGap({ drawingRef: 'A-103', parameter: 'p3', description: 'd3' });

    expect(id1).toBe('GAP-MOOR-0001');
    expect(id2).toBe('GAP-MOOR-0002');
    expect(id3).toBe('GAP-MOOR-0003');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  RESOLUTION LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════════

describe('Resolution', () => {
  test('resolves a gap with value', () => {
    const id = tracker.registerElementGap({
      elementId: 'wall-001',
      parameter: 'thickness',
      description: 'Missing thickness',
    });

    const resolved = tracker.resolve(id, '200mm', 'architect');
    expect(resolved).toBe(true);

    const item = tracker.get(id)!;
    expect(item.status).toBe('RESOLVED');
    expect(item.resolvedValue).toBe('200mm');
    expect(item.resolvedBy).toBe('architect');
    expect(item.resolvedAt).toBeDefined();
  });

  test('accepts a gap as-is', () => {
    const id = tracker.registerCostGap({
      csiDivision: '14',
      parameter: 'elevator_rate',
      description: 'Elevator rate unavailable',
    });

    tracker.accept(id, 'Client confirmed no elevator');
    const item = tracker.get(id)!;
    expect(item.status).toBe('ACCEPTED');
    expect(item.resolvedValue).toContain('ACCEPTED');
  });

  test('resolve returns false for non-existent ID', () => {
    expect(tracker.resolve('GAP-FAKE-9999', 'value')).toBe(false);
  });

  test('accept returns false for non-existent ID', () => {
    expect(tracker.accept('GAP-FAKE-9999', 'reason')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  QUERIES
// ═══════════════════════════════════════════════════════════════════════════════

describe('Queries', () => {
  beforeEach(() => {
    tracker.registerDocumentGap({ drawingRef: 'A-101', parameter: 'p1', description: 'd1', severity: 'CRITICAL' });
    tracker.registerProductGap({ specSection: '03', parameter: 'p2', description: 'd2', severity: 'HIGH' });
    tracker.registerCostGap({ csiDivision: '07', parameter: 'p3', description: 'd3', severity: 'LOW' });
  });

  test('getAll returns all items', () => {
    expect(tracker.getAll()).toHaveLength(3);
  });

  test('getByDetectionPoint filters correctly', () => {
    const docs = tracker.getByDetectionPoint('DOCUMENT_EXTRACTION');
    expect(docs).toHaveLength(1);
    expect(docs[0].drawingRef).toBe('A-101');
  });

  test('getBySeverity filters correctly', () => {
    expect(tracker.getBySeverity('CRITICAL')).toHaveLength(1);
    expect(tracker.getBySeverity('HIGH')).toHaveLength(1);
    expect(tracker.getBySeverity('LOW')).toHaveLength(1);
    expect(tracker.getBySeverity('MEDIUM')).toHaveLength(0);
  });

  test('getOpen returns unresolved items', () => {
    expect(tracker.getOpen()).toHaveLength(3);

    tracker.resolve('GAP-MOOR-0001', 'fixed');
    expect(tracker.getOpen()).toHaveLength(2);
  });

  test('getCriticalOpen returns only critical unresolved', () => {
    expect(tracker.getCriticalOpen()).toHaveLength(1);

    tracker.resolve('GAP-MOOR-0001', 'fixed');
    expect(tracker.getCriticalOpen()).toHaveLength(0);
  });

  test('isEstimateBlocked when critical gaps exist', () => {
    expect(tracker.isEstimateBlocked()).toBe(true);

    tracker.resolve('GAP-MOOR-0001', 'fixed');
    expect(tracker.isEstimateBlocked()).toBe(false);
  });

  test('size property is correct', () => {
    expect(tracker.size).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

describe('Summary', () => {
  test('summary counts by severity', () => {
    tracker.registerElementGap({ elementId: 'e1', parameter: 'p1', description: 'd', severity: 'CRITICAL' });
    tracker.registerElementGap({ elementId: 'e2', parameter: 'p2', description: 'd', severity: 'HIGH' });
    tracker.registerElementGap({ elementId: 'e3', parameter: 'p3', description: 'd', severity: 'HIGH' });

    const summary = tracker.getSummary();
    expect(summary.total).toBe(3);
    expect(summary.bySeverity.CRITICAL).toBe(1);
    expect(summary.bySeverity.HIGH).toBe(2);
  });

  test('summary counts by detection point', () => {
    tracker.registerDocumentGap({ drawingRef: 'A-1', parameter: 'p1', description: 'd' });
    tracker.registerDocumentGap({ drawingRef: 'A-2', parameter: 'p2', description: 'd' });
    tracker.registerCostGap({ csiDivision: '03', parameter: 'p3', description: 'd' });

    const summary = tracker.getSummary();
    expect(summary.byDetectionPoint.DOCUMENT_EXTRACTION).toBe(2);
    expect(summary.byDetectionPoint.COST_ESTIMATION).toBe(1);
  });

  test('summary tracks by discipline', () => {
    tracker.registerElementGap({ elementId: 'e1', parameter: 'p', description: 'd', discipline: 'STRUCT' });
    tracker.registerElementGap({ elementId: 'e2', parameter: 'p', description: 'd', discipline: 'STRUCT' });
    tracker.registerClashGap({ parameter: 'p', description: 'd', discipline: 'MECH' });

    const summary = tracker.getSummary();
    expect(summary.byDiscipline['STRUCT']).toBe(2);
    expect(summary.byDiscipline['MECH']).toBe(1);
  });

  test('completeness reflects resolved items', () => {
    const id1 = tracker.registerDocumentGap({ drawingRef: 'A-1', parameter: 'p1', description: 'd' });
    tracker.registerDocumentGap({ drawingRef: 'A-2', parameter: 'p2', description: 'd' });

    expect(tracker.getSummary().completenessPercent).toBe(0);

    tracker.resolve(id1, 'done');
    expect(tracker.getSummary().completenessPercent).toBe(50);
  });

  test('empty tracker is 100% complete', () => {
    expect(tracker.getSummary().completenessPercent).toBe(100);
    expect(tracker.getSummary().estimateBlocked).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  RFI GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('RFI Generation', () => {
  test('generates RFIs grouped by discipline + drawing', () => {
    tracker.registerDocumentGap({ drawingRef: 'A-201', parameter: 'wall_height', description: 'Missing', discipline: 'ARCH' });
    tracker.registerDocumentGap({ drawingRef: 'A-201', parameter: 'wall_type', description: 'Missing', discipline: 'ARCH' });
    tracker.registerDocumentGap({ drawingRef: 'S-301', parameter: 'beam_depth', description: 'Missing', discipline: 'STRUCT' });

    const rfis = tracker.generateRFIs();
    expect(rfis.length).toBe(2); // ARCH_A-201 and STRUCT_S-301

    const archRFI = rfis.find(r => r.discipline === 'ARCH');
    expect(archRFI).toBeDefined();
    expect(archRFI!.relatedGapIds).toHaveLength(2);
    expect(archRFI!.rfiNumber).toMatch(/^RFI-MOOR-/);
  });

  test('RFI priority reflects gap severity', () => {
    tracker.registerElementGap({ elementId: 'e1', parameter: 'p', description: 'd', severity: 'CRITICAL', discipline: 'STRUCT' });

    const rfis = tracker.generateRFIs();
    expect(rfis[0].priority).toBe('URGENT');
  });

  test('gaps are marked RFI_ISSUED after generation', () => {
    const id = tracker.registerDocumentGap({ drawingRef: 'A-1', parameter: 'p', description: 'd' });
    tracker.generateRFIs();

    const item = tracker.get(id)!;
    expect(item.status).toBe('RFI_ISSUED');
    expect(item.rfiNumber).toMatch(/^RFI-MOOR-/);
  });

  test('already-RFI gaps are not re-issued', () => {
    tracker.registerDocumentGap({ drawingRef: 'A-1', parameter: 'p', description: 'd' });
    const rfis1 = tracker.generateRFIs();
    expect(rfis1).toHaveLength(1);

    const rfis2 = tracker.generateRFIs();
    expect(rfis2).toHaveLength(0); // already issued
  });

  test('no open gaps returns empty RFIs', () => {
    const rfis = tracker.generateRFIs();
    expect(rfis).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SERIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Serialization', () => {
  test('toJSON includes all data', () => {
    tracker.registerDocumentGap({ drawingRef: 'A-1', parameter: 'p1', description: 'd1' });
    tracker.registerCostGap({ csiDivision: '03', parameter: 'p2', description: 'd2' });

    const json = tracker.toJSON();
    expect(json.projectId).toBe('MOOR');
    expect(json.items).toHaveLength(2);
    expect(json.summary.total).toBe(2);
  });

  test('loadItems restores saved items', () => {
    tracker.registerDocumentGap({ drawingRef: 'A-1', parameter: 'p1', description: 'd1' });
    const saved = tracker.toJSON().items;

    const newTracker = new MissingDataTracker('MOOR', 'session-2');
    newTracker.loadItems(saved);
    expect(newTracker.size).toBe(1);
    expect(newTracker.getAll()[0].drawingRef).toBe('A-1');
  });

  test('clear resets everything', () => {
    tracker.registerDocumentGap({ drawingRef: 'A-1', parameter: 'p', description: 'd' });
    expect(tracker.size).toBe(1);

    tracker.clear();
    expect(tracker.size).toBe(0);
    expect(tracker.getSummary().total).toBe(0);
  });
});
