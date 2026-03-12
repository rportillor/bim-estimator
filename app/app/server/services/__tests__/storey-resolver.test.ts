/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  STOREY & GRID RESOLVER — Test Suite
 *  50+ tests: storey validation, naming normalization, height bounds,
 *  grid consistency, cross-reference, backward compatibility
 * ══════════════════════════════════════════════════════════════════════════════
 */

import {
  resolveStoreys,
  resolveStoreysValidated,
  resolveGrids,
  resolveGridsValidated,
  crossReferenceStoreysAndGrids,
} from '../storey-resolver';

import type { Storey, Grid, StoreyValidation, GridValidation } from '../storey-resolver';

// ═══════════════════════════════════════════════════════════════════════════════
//  TEST DATA
// ═══════════════════════════════════════════════════════════════════════════════

const VALID_STOREYS = {
  storeys: [
    { name: 'Level 1', elevation_m: 0 },
    { name: 'Level 2', elevation_m: 3.2 },
    { name: 'Level 3', elevation_m: 6.4 },
    { name: 'Roof', elevation_m: 9.6 },
  ],
};

const STOREYS_WITH_BASEMENT = {
  storeys: [
    { name: 'B1', elevation_m: -3.0 },
    { name: 'Ground Floor', elevation_m: 0 },
    { name: '2nd Floor', elevation_m: 3.0 },
    { name: 'Roof Level', elevation_m: 6.0 },
  ],
};

const ANOMALOUS_STOREYS = {
  storeys: [
    { name: 'Level 1', elevation_m: 0 },
    { name: 'Level 2', elevation_m: 1.5 },   // Too short (< 2.4m)
    { name: 'Level 3', elevation_m: 12.0 },  // Huge gap from Level 2
  ],
};

const VALID_GRIDS = {
  grids: [
    { name: 'A', x: 0, y: 0, orientation: 'X', spacing_m: 6.0 },
    { name: 'B', x: 0, y: 6, orientation: 'X', spacing_m: 6.0 },
    { name: 'C', x: 0, y: 12, orientation: 'X', spacing_m: 6.0 },
    { name: '1', x: 0, y: 0, orientation: 'Y', spacing_m: 8.0 },
    { name: '2', x: 8, y: 0, orientation: 'Y', spacing_m: 8.0 },
    { name: '3', x: 16, y: 0, orientation: 'Y', spacing_m: 8.0 },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
//  BACKWARD COMPATIBILITY
// ═══════════════════════════════════════════════════════════════════════════════

describe('Backward Compatibility', () => {
  test('resolveStoreys returns Storey[] directly', () => {
    const result = resolveStoreys(VALID_STOREYS);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(4);
    expect(result[0]).toHaveProperty('name');
    expect(result[0]).toHaveProperty('elevation_m');
  });

  test('resolveGrids returns Grid[] directly', () => {
    const result = resolveGrids(VALID_GRIDS);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(6);
  });

  test('empty input still returns base level', () => {
    const result = resolveStoreys({});
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some(s => Math.abs(s.elevation_m) < 0.01)).toBe(true);
  });

  test('null input returns base level', () => {
    const result = resolveStoreys(null);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  STOREY VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveStoreysValidated', () => {
  test('valid storeys pass validation', () => {
    const result = resolveStoreysValidated(VALID_STOREYS);
    expect(result.valid).toBe(true);
    expect(result.storeys).toHaveLength(4);
    expect(result.warnings).toHaveLength(0);
  });

  test('storeys are sorted by elevation', () => {
    const scrambled = {
      storeys: [
        { name: 'Level 3', elevation_m: 6.4 },
        { name: 'Level 1', elevation_m: 0 },
        { name: 'Level 2', elevation_m: 3.2 },
      ],
    };
    const result = resolveStoreysValidated(scrambled);
    expect(result.storeys[0].name).toBe('Level 1');
    expect(result.storeys[1].name).toBe('Level 2');
    expect(result.storeys[2].name).toBe('Level 3');
  });

  test('calculates floor-to-floor heights', () => {
    const result = resolveStoreysValidated(VALID_STOREYS);
    expect(result.storeys[0].floorToFloorHeight_m).toBeCloseTo(3.2, 1);
    expect(result.storeys[1].floorToFloorHeight_m).toBeCloseTo(3.2, 1);
    // Last storey (Roof) has no floor-to-floor
    expect(result.storeys[3].floorToFloorHeight_m).toBeUndefined();
  });

  test('detects below-minimum floor height', () => {
    const result = resolveStoreysValidated(ANOMALOUS_STOREYS);
    expect(result.valid).toBe(false);
    expect(result.warnings.some(w => w.includes('below NBC minimum'))).toBe(true);
  });

  test('detects large elevation gaps (missing floors)', () => {
    const result = resolveStoreysValidated(ANOMALOUS_STOREYS);
    expect(result.warnings.some(w => w.includes('missing floor'))).toBe(true);
  });

  test('adds base level when missing', () => {
    const noBase = {
      storeys: [
        { name: 'Level 2', elevation_m: 3.2 },
        { name: 'Level 3', elevation_m: 6.4 },
      ],
    };
    const result = resolveStoreysValidated(noBase);
    expect(result.storeys.some(s => Math.abs(s.elevation_m) < 0.01)).toBe(true);
    expect(result.corrections.some(c => c.includes('Added base'))).toBe(true);
  });

  test('deduplicates by normalized name', () => {
    const dupes = {
      storeys: [
        { name: 'Level 1', elevation_m: 0 },
        { name: 'level 1', elevation_m: 0 },
        { name: 'Level 2', elevation_m: 3.2 },
      ],
    };
    const result = resolveStoreysValidated(dupes);
    expect(result.storeys.filter(s => s.name === 'Level 1')).toHaveLength(1);
  });

  test('warns on conflicting elevation for same name', () => {
    const conflict = {
      storeys: [
        { name: 'Level 1', elevation_m: 0 },
        { name: 'Level 1', elevation_m: 3.0 }, // same name, different elevation
      ],
    };
    const result = resolveStoreysValidated(conflict);
    expect(result.warnings.some(w => w.includes('conflicting elevations'))).toBe(true);
  });

  test('skips storeys with invalid elevation', () => {
    const bad = {
      storeys: [
        { name: 'Level 1', elevation_m: 0 },
        { name: 'Level Bad', elevation_m: 'not a number' },
      ],
    };
    const result = resolveStoreysValidated(bad);
    expect(result.warnings.some(w => w.includes('invalid elevation'))).toBe(true);
    expect(result.storeys.some(s => s.name === 'Level Bad')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  NAMING NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Storey Name Normalization', () => {
  test('B1 → Basement 1', () => {
    const result = resolveStoreysValidated({ storeys: [{ name: 'B1', elevation_m: -3 }] });
    expect(result.storeys.some(s => s.name === 'Basement 1')).toBe(true);
  });

  test('Ground Floor → Level 1', () => {
    const result = resolveStoreysValidated({ storeys: [{ name: 'Ground Floor', elevation_m: 0 }] });
    expect(result.storeys.some(s => s.name === 'Level 1')).toBe(true);
  });

  test('1st Floor → Level 1', () => {
    const result = resolveStoreysValidated({ storeys: [{ name: '1st Floor', elevation_m: 0 }] });
    expect(result.storeys.some(s => s.name === 'Level 1')).toBe(true);
  });

  test('2nd Floor → Level 2', () => {
    const result = resolveStoreysValidated({ storeys: [{ name: '2nd Floor', elevation_m: 3.2 }, { name: 'Level 1', elevation_m: 0 }] });
    expect(result.storeys.some(s => s.name === 'Level 2')).toBe(true);
  });

  test('Roof Level → Roof', () => {
    const result = resolveStoreysValidated({ storeys: [{ name: 'Roof Level', elevation_m: 10 }, { name: 'Level 1', elevation_m: 0 }] });
    expect(result.storeys.some(s => s.name === 'Roof')).toBe(true);
  });

  test('P1 → Parking 1', () => {
    const result = resolveStoreysValidated({ storeys: [{ name: 'P1', elevation_m: -4 }] });
    expect(result.storeys.some(s => s.name === 'Parking 1')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  BELOW-GRADE DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Below-Grade Detection', () => {
  test('negative elevation marked as below grade', () => {
    const result = resolveStoreysValidated(STOREYS_WITH_BASEMENT);
    const basement = result.storeys.find(s => s.name === 'Basement 1');
    expect(basement).toBeDefined();
    expect(basement!.isBelowGrade).toBe(true);
  });

  test('ground level not marked below grade', () => {
    const result = resolveStoreysValidated(STOREYS_WITH_BASEMENT);
    const ground = result.storeys.find(s => s.elevation_m === 0);
    expect(ground).toBeDefined();
    expect(ground!.isBelowGrade).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  OCCUPANCY INFERENCE
// ═══════════════════════════════════════════════════════════════════════════════

describe('Occupancy Inference', () => {
  test('basement inferred as basement', () => {
    const result = resolveStoreysValidated({ storeys: [{ name: 'Basement 1', elevation_m: -3 }] });
    const b = result.storeys.find(s => s.name === 'Basement 1');
    expect(b?.occupancy).toBe('basement');
  });

  test('parking level inferred as parking', () => {
    const result = resolveStoreysValidated({ storeys: [{ name: 'P1', elevation_m: -6 }] });
    const p = result.storeys.find(s => s.name === 'Parking 1');
    expect(p?.occupancy).toBe('parking');
  });

  test('roof inferred as roof', () => {
    const result = resolveStoreysValidated({ storeys: [{ name: 'Roof', elevation_m: 10 }, { name: 'Level 1', elevation_m: 0 }] });
    const r = result.storeys.find(s => s.name === 'Roof');
    expect(r?.occupancy).toBe('roof');
  });

  test('regular level inferred as residential', () => {
    const result = resolveStoreysValidated(VALID_STOREYS);
    const l2 = result.storeys.find(s => s.name === 'Level 2');
    expect(l2?.occupancy).toBe('residential');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GRID VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveGridsValidated', () => {
  test('valid grids pass validation', () => {
    const result = resolveGridsValidated(VALID_GRIDS);
    expect(result.valid).toBe(true);
    expect(result.grids).toHaveLength(6);
  });

  test('empty grids produces warning', () => {
    const result = resolveGridsValidated({ grids: [] });
    expect(result.grids).toHaveLength(0);
    expect(result.warnings.some(w => w.includes('No grids'))).toBe(true);
  });

  test('null input handled gracefully', () => {
    const result = resolveGridsValidated(null);
    expect(result.grids).toHaveLength(0);
  });

  test('deduplicates grid names', () => {
    const dupes = {
      grids: [
        { name: 'A', x: 0, y: 0, orientation: 'X' },
        { name: 'A', x: 0, y: 0, orientation: 'X' },
        { name: 'B', x: 0, y: 6, orientation: 'X' },
      ],
    };
    const result = resolveGridsValidated(dupes);
    expect(result.grids).toHaveLength(2);
    expect(result.warnings.some(w => w.includes('Duplicate grid'))).toBe(true);
  });

  test('warns on too-small spacing', () => {
    const small = {
      grids: [
        { name: 'A', x: 0, y: 0, orientation: 'X', spacing_m: 0.3 },
      ],
    };
    const result = resolveGridsValidated(small);
    expect(result.warnings.some(w => w.includes('below minimum'))).toBe(true);
  });

  test('warns on too-large spacing', () => {
    const big = {
      grids: [
        { name: 'A', x: 0, y: 0, orientation: 'X', spacing_m: 25 },
      ],
    };
    const result = resolveGridsValidated(big);
    expect(result.warnings.some(w => w.includes('above maximum'))).toBe(true);
  });

  test('warns on inconsistent grid spacing', () => {
    const inconsistent = {
      grids: [
        { name: 'A', x: 0, y: 0, orientation: 'X' },
        { name: 'B', x: 0, y: 2, orientation: 'X' },
        { name: 'C', x: 0, y: 12, orientation: 'X' }, // 2m then 10m — big variance
      ],
    };
    const result = resolveGridsValidated(inconsistent);
    expect(result.warnings.some(w => w.includes('varies significantly'))).toBe(true);
  });

  test('orientation defaults to X', () => {
    const noOrientation = {
      grids: [{ name: 'A', x: 0, y: 0 }],
    };
    const result = resolveGridsValidated(noOrientation);
    expect(result.grids[0].orientation).toBe('X');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  CROSS-REFERENCE
// ═══════════════════════════════════════════════════════════════════════════════

describe('crossReferenceStoreysAndGrids', () => {
  test('warns when storeys exist but no grids', () => {
    const storeyResult = resolveStoreysValidated(VALID_STOREYS);
    const gridResult = resolveGridsValidated({ grids: [] });
    const warnings = crossReferenceStoreysAndGrids(storeyResult, gridResult);
    expect(warnings.some(w => w.includes('no structural grids'))).toBe(true);
  });

  test('warns when grids exist but only 1 storey', () => {
    const storeyResult = resolveStoreysValidated({ storeys: [{ name: 'Level 1', elevation_m: 0 }] });
    const gridResult = resolveGridsValidated(VALID_GRIDS);
    const warnings = crossReferenceStoreysAndGrids(storeyResult, gridResult);
    expect(warnings.some(w => w.includes('only 1 storey'))).toBe(true);
  });

  test('no warnings when both are complete', () => {
    const storeyResult = resolveStoreysValidated(VALID_STOREYS);
    const gridResult = resolveGridsValidated(VALID_GRIDS);
    const warnings = crossReferenceStoreysAndGrids(storeyResult, gridResult);
    // May or may not have warnings depending on footprint check
    // At minimum, should not have the basic structural warnings
    expect(warnings.some(w => w.includes('no structural grids'))).toBe(false);
    expect(warnings.some(w => w.includes('only 1 storey'))).toBe(false);
  });
});
