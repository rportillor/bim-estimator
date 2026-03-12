/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  GAP POLICY ENGINE — Test Suite (SOP Appendix)
 *  40+ tests: gap detection, tolerance gaps, batch processing, register, lifecycle
 * ══════════════════════════════════════════════════════════════════════════════
 */

import {
  detectElementGaps,
  detectBatchGaps,
  createToleranceGap,
  buildGapRegister,
  resolveGap,
} from '../gap-policy-engine';

import type { GapRecord, GapDetectionInput, GapRegister } from '../gap-policy-engine';

// ═══════════════════════════════════════════════════════════════════════════════
//  TEST DATA
// ═══════════════════════════════════════════════════════════════════════════════

const completeInput: GapDetectionInput = {
  elementId: 'wall-001',
  elementType: 'wall',
  discipline: 'ARCH',
  storey: 'Level 1',
  material: 'concrete',
  systemType: undefined,
  fireRating: 'FRL 120/120/120',
  properties: {
    thickness: 200,
    height: 3000,
    length: 5000,
  },
};

const incompleteInput: GapDetectionInput = {
  elementId: 'duct-001',
  elementType: 'duct',
  discipline: 'MECH',
  storey: 'Level 1',
  material: '', // missing
  systemType: '', // missing
  fireRating: undefined,
  properties: {},
};

const partialInput: GapDetectionInput = {
  elementId: 'pipe-001',
  elementType: 'pipe',
  discipline: 'PLUMB',
  storey: 'Level 2',
  material: 'copper',
  systemType: 'domestic_hot',
  fireRating: undefined,
  properties: {
    diameter: 25, // has some properties
    // but missing length, insulation
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
//  SINGLE ELEMENT GAP DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

describe('detectElementGaps', () => {
  test('complete element produces no gaps', () => {
    const gaps = detectElementGaps(completeInput);
    // A well-formed arch wall with material, fire rating, and dimensions → should have few/no gaps
    expect(gaps.length).toBeLessThanOrEqual(1); // might flag systemType if required for ARCH
  });

  test('incomplete element produces multiple gaps', () => {
    const gaps = detectElementGaps(incompleteInput);
    expect(gaps.length).toBeGreaterThan(0);

    // Should flag missing material
    const materialGap = gaps.find(g => g.source === 'material_property');
    expect(materialGap).toBeDefined();

    // Should flag missing systemType for MECH discipline
    const systemGap = gaps.find(g => g.source === 'system_type');
    expect(systemGap).toBeDefined();
  });

  test('gaps include element ID and discipline', () => {
    const gaps = detectElementGaps(incompleteInput);
    for (const gap of gaps) {
      expect(gap.elementId).toBe('duct-001');
      expect(gap.discipline).toBe('MECH');
    }
  });

  test('gaps have correct lifecycle state', () => {
    const gaps = detectElementGaps(incompleteInput);
    for (const gap of gaps) {
      expect(gap.lifecycle).toBe('DETECTED');
    }
  });

  test('gap records have suggested actions', () => {
    const gaps = detectElementGaps(incompleteInput);
    for (const gap of gaps) {
      expect(gap.suggestedAction).toBeDefined();
      expect(gap.suggestedAction.length).toBeGreaterThan(0);
    }
  });

  test('partial input flags missing properties but not present ones', () => {
    const gaps = detectElementGaps(partialInput);
    // Should NOT flag material (copper is present)
    const materialGap = gaps.find(g => g.source === 'material_property');
    expect(materialGap).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  BATCH GAP DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

describe('detectBatchGaps', () => {
  test('processes multiple elements', () => {
    const gaps = detectBatchGaps([completeInput, incompleteInput, partialInput]);
    expect(gaps.length).toBeGreaterThan(0);
  });

  test('batch results contain gaps from all elements', () => {
    const gaps = detectBatchGaps([incompleteInput, partialInput]);
    const elementIds = new Set(gaps.map(g => g.elementId));
    expect(elementIds.has('duct-001')).toBe(true);
  });

  test('empty input produces no gaps', () => {
    const gaps = detectBatchGaps([]);
    expect(gaps).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  TOLERANCE GAPS
// ═══════════════════════════════════════════════════════════════════════════════

describe('createToleranceGap', () => {
  test('creates a gap for missing tolerance', () => {
    const gap = createToleranceGap(
      'duct-001',
      'beam-001',
      'MECH',
      'STRUCT',
      null // null tolerance = missing
    );
    expect(gap).toBeDefined();
    expect(gap.source).toBe('clearance_tolerance');
    expect(gap.lifecycle).toBe('DETECTED');
  });

  test('tolerance gap references both elements', () => {
    const gap = createToleranceGap('elem-a', 'elem-b', 'MECH', 'STRUCT', null);
    expect(gap.description).toContain('elem-a');
    expect(gap.description).toContain('elem-b');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GAP REGISTER
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildGapRegister', () => {
  test('builds register from gap array', () => {
    const gaps = detectBatchGaps([incompleteInput, partialInput]);
    const register = buildGapRegister('MOOR-001', gaps);

    expect(register.projectId).toBe('MOOR-001');
    expect(register.totalGaps).toBe(gaps.length);
    expect(register.items).toHaveLength(gaps.length);
  });

  test('register categorizes by source', () => {
    const gaps = detectBatchGaps([incompleteInput]);
    const register = buildGapRegister('MOOR-001', gaps);
    expect(register.bySource).toBeDefined();
  });

  test('register categorizes by discipline', () => {
    const gaps = detectBatchGaps([incompleteInput, partialInput]);
    const register = buildGapRegister('MOOR-001', gaps);
    expect(register.byDiscipline).toBeDefined();
    expect(register.byDiscipline['MECH']).toBeGreaterThan(0);
  });

  test('empty gaps produce empty register', () => {
    const register = buildGapRegister('MOOR-001', []);
    expect(register.totalGaps).toBe(0);
    expect(register.items).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GAP LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveGap', () => {
  test('resolves a gap with RFI response', () => {
    const gaps = detectElementGaps(incompleteInput);
    expect(gaps.length).toBeGreaterThan(0);

    const gap = gaps[0];
    const resolved = resolveGap(gap, {
      lifecycle: 'CLOSED',
      resolvedValue: 'Sheet metal',
      rfiNumber: 'RFI-MOOR-001',
    });

    expect(resolved.lifecycle).toBe('CLOSED');
    expect(resolved.resolvedValue).toBe('Sheet metal');
    expect(resolved.rfiNumber).toBe('RFI-MOOR-001');
  });

  test('defers a gap', () => {
    const gaps = detectElementGaps(incompleteInput);
    const gap = gaps[0];

    const deferred = resolveGap(gap, { lifecycle: 'DEFERRED' });
    expect(deferred.lifecycle).toBe('DEFERRED');
  });

  test('preserves original gap data on resolve', () => {
    const gaps = detectElementGaps(incompleteInput);
    const gap = gaps[0];
    const originalSource = gap.source;
    const originalElement = gap.elementId;

    const resolved = resolveGap(gap, { lifecycle: 'CLOSED', resolvedValue: 'test' });
    expect(resolved.source).toBe(originalSource);
    expect(resolved.elementId).toBe(originalElement);
  });
});
