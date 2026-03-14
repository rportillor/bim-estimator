/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  GAP POLICY ENGINE — Test Suite (SOP Appendix)
 *  Tests: gap detection, tolerance gaps, batch processing, register, lifecycle
 * ══════════════════════════════════════════════════════════════════════════════
 */

import {
  detectElementGaps,
  detectBatchGaps,
  createToleranceGap,
  buildGapRegister,
  resolveGap,
} from '../gap-policy-engine';

import type { GapDetectionInput } from '../gap-policy-engine';

// ═══════════════════════════════════════════════════════════════════════════════
//  TEST DATA
// ═══════════════════════════════════════════════════════════════════════════════

/** A well-formed ARC wall with material, fire rating, spec section, and level present. */
const completeInput: GapDetectionInput = {
  elementId: 'wall-001',
  elementName: 'Interior Wall W-12',
  discipline: 'ARC',
  level: 'Level 1',
  zone: 'Zone A',
  properties: {
    Material: 'concrete',
    Fire_Rating: 'FRL 120/120/120',
    Specification_Section: '04 22 00',
    Level: 'Level 1',
  },
};

/** A MECH duct missing material, system type, spec section, and level in properties. */
const incompleteInput: GapDetectionInput = {
  elementId: 'duct-001',
  elementName: 'Supply Duct SD-01',
  discipline: 'MECH',
  level: 'Level 1',
  zone: 'Zone B',
  properties: {
    // Material: missing
    // SystemType: missing
    // Specification_Section: missing
    // Level: missing
  },
};

/** A PLBG pipe with material and system type present but missing spec section and level. */
const partialInput: GapDetectionInput = {
  elementId: 'pipe-001',
  elementName: 'HW Pipe P-01',
  discipline: 'PLBG',
  level: 'Level 2',
  zone: 'Zone C',
  properties: {
    Material: 'copper',        // present — should NOT trigger material gap
    SystemType: 'domestic_hot', // present — should NOT trigger system gap
    diameter: 25,
    // Specification_Section: missing
    // Level: missing
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
//  SINGLE ELEMENT GAP DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

describe('detectElementGaps', () => {
  test('complete element produces no gaps', () => {
    const gaps = detectElementGaps(completeInput);
    expect(gaps).toHaveLength(0);
  });

  test('incomplete MECH element produces multiple gaps', () => {
    const gaps = detectElementGaps(incompleteInput);
    expect(gaps.length).toBeGreaterThan(0);

    // Should flag missing SystemType for MECH discipline
    const systemGap = gaps.find(g => g.source === 'system_type');
    expect(systemGap).toBeDefined();

    // Should flag missing Specification_Section (applies to ALL disciplines)
    const specGap = gaps.find(g => g.source === 'specification_reference');
    expect(specGap).toBeDefined();
  });

  test('gaps include element ID and discipline', () => {
    const gaps = detectElementGaps(incompleteInput);
    for (const gap of gaps) {
      expect(gap.elementId).toBe('duct-001');
      expect(gap.discipline).toBe('MECH');
    }
  });

  test('gaps have DETECTED lifecycle state', () => {
    const gaps = detectElementGaps(incompleteInput);
    for (const gap of gaps) {
      expect(gap.lifecycle).toBe('DETECTED');
    }
  });

  test('gap records have requiredAction and actionDescription', () => {
    const gaps = detectElementGaps(incompleteInput);
    for (const gap of gaps) {
      expect(gap.requiredAction).toBeDefined();
      expect(gap.actionDescription).toBeDefined();
      expect(gap.actionDescription.length).toBeGreaterThan(0);
    }
  });

  test('gap records have LOW confidence', () => {
    const gaps = detectElementGaps(incompleteInput);
    for (const gap of gaps) {
      expect(gap.confidenceWithGap).toBe('LOW');
    }
  });

  test('partial input flags missing properties but not present ones', () => {
    const gaps = detectElementGaps(partialInput);
    // Material is 'copper' — should NOT be flagged
    const materialGap = gaps.find(g => g.source === 'material_property');
    expect(materialGap).toBeUndefined();

    // SystemType is 'domestic_hot' — should NOT be flagged
    const systemGap = gaps.find(g => g.source === 'system_type');
    expect(systemGap).toBeUndefined();
  });

  test('gap IDs are unique', () => {
    const gaps = detectElementGaps(incompleteInput);
    const ids = gaps.map(g => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('actionDescription interpolates element name', () => {
    const gaps = detectElementGaps(incompleteInput);
    for (const gap of gaps) {
      expect(gap.actionDescription).toContain('Supply Duct SD-01');
    }
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

  test('batch results contain gaps from the expected elements', () => {
    const gaps = detectBatchGaps([incompleteInput, partialInput]);
    const elementIds = new Set(gaps.map(g => g.elementId));
    expect(elementIds.has('duct-001')).toBe(true);
  });

  test('empty input produces no gaps', () => {
    const gaps = detectBatchGaps([]);
    expect(gaps).toHaveLength(0);
  });

  test('batch returns aggregate of individual detections', () => {
    const single1 = detectElementGaps(incompleteInput);
    const single2 = detectElementGaps(partialInput);
    const batch = detectBatchGaps([incompleteInput, partialInput]);
    // Batch should have same total count as individual runs combined
    // (IDs will differ because of the counter, but counts should match)
    expect(batch.length).toBe(single1.length + single2.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  TOLERANCE GAPS
// ═══════════════════════════════════════════════════════════════════════════════

describe('createToleranceGap', () => {
  test('creates a gap for missing tolerance', () => {
    const gap = createToleranceGap('CT-001', 'Duct vs Beam clearance', 'tolerance_mm');
    expect(gap).toBeDefined();
    expect(gap.source).toBe('clearance_tolerance');
    expect(gap.lifecycle).toBe('DETECTED');
    expect(gap.confidenceWithGap).toBe('LOW');
  });

  test('tolerance gap references test ID and test name in description', () => {
    const gap = createToleranceGap('CT-002', 'Pipe vs Structure clearance', 'min_clearance_mm');
    expect(gap.description).toContain('CT-002');
    expect(gap.description).toContain('Pipe vs Structure clearance');
  });

  test('tolerance gap has correct parameter', () => {
    const gap = createToleranceGap('CT-003', 'Cable tray clearance', 'vertical_clearance');
    expect(gap.parameter).toBe('vertical_clearance');
  });

  test('tolerance gap has RFI as required action', () => {
    const gap = createToleranceGap('CT-004', 'Sprinkler head clearance', 'head_clearance_mm');
    expect(gap.requiredAction).toBe('RFI');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GAP REGISTER
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildGapRegister', () => {
  test('builds register from gap array', () => {
    const gaps = detectBatchGaps([incompleteInput, partialInput]);
    const register = buildGapRegister(gaps, 'MOOR-001');

    expect(register.projectName).toBe('MOOR-001');
    expect(register.gaps).toHaveLength(gaps.length);
    expect(register.summary.total).toBe(gaps.length);
  });

  test('register summary categorizes by source', () => {
    const gaps = detectBatchGaps([incompleteInput]);
    const register = buildGapRegister(gaps, 'MOOR-001');
    expect(register.summary.bySource).toBeDefined();
  });

  test('register summary categorizes by discipline', () => {
    const gaps = detectBatchGaps([incompleteInput, partialInput]);
    const register = buildGapRegister(gaps, 'MOOR-001');
    expect(register.summary.byDiscipline).toBeDefined();
    expect(register.summary.byDiscipline['MECH']).toBeGreaterThan(0);
  });

  test('empty gaps produce register with zero totals', () => {
    const register = buildGapRegister([], 'MOOR-001');
    expect(register.summary.total).toBe(0);
    expect(register.gaps).toHaveLength(0);
    expect(register.summary.openCount).toBe(0);
  });

  test('register has generatedDate', () => {
    const register = buildGapRegister([], 'MOOR-001');
    expect(register.generatedDate).toBeDefined();
    expect(typeof register.generatedDate).toBe('string');
  });

  test('closure rate is 100% when no gaps exist', () => {
    const register = buildGapRegister([], 'MOOR-001');
    expect(register.summary.closureRate).toBe(100);
  });

  test('closure rate is 0% when all gaps are open', () => {
    const gaps = detectBatchGaps([incompleteInput]);
    const register = buildGapRegister(gaps, 'MOOR-001');
    expect(register.summary.closureRate).toBe(0);
    expect(register.summary.openCount).toBe(gaps.length);
    expect(register.summary.closedCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GAP LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveGap', () => {
  test('resolves a gap with value and evidence', () => {
    const gaps = detectElementGaps(incompleteInput);
    expect(gaps.length).toBeGreaterThan(0);

    const gap = gaps[0];
    const resolved = resolveGap(gap, 'Sheet metal', 'RFI-MOOR-001-Response.pdf');

    expect(resolved.lifecycle).toBe('CLOSED');
    expect(resolved.resolvedValue).toBe('Sheet metal');
    expect(resolved.evidenceRef).toBe('RFI-MOOR-001-Response.pdf');
    expect(resolved.resolvedDate).toBeDefined();
  });

  test('resolved gap has HIGH confidence', () => {
    const gaps = detectElementGaps(incompleteInput);
    const gap = gaps[0];
    const resolved = resolveGap(gap, '25 MPa', 'Struct-Calc-001.pdf');
    expect(resolved.confidenceWithGap).toBe('HIGH');
  });

  test('preserves original gap data on resolve', () => {
    const gaps = detectElementGaps(incompleteInput);
    const gap = gaps[0];
    const originalSource = gap.source;
    const originalElement = gap.elementId;
    const originalId = gap.id;

    const resolved = resolveGap(gap, 'test-value', 'test-ref');
    expect(resolved.source).toBe(originalSource);
    expect(resolved.elementId).toBe(originalElement);
    expect(resolved.id).toBe(originalId);
  });

  test('original gap is not mutated', () => {
    const gaps = detectElementGaps(incompleteInput);
    const gap = gaps[0];
    const originalLifecycle = gap.lifecycle;

    resolveGap(gap, 'some-value', 'some-ref');
    expect(gap.lifecycle).toBe(originalLifecycle);
    expect(gap.resolvedValue).toBeNull();
  });
});
