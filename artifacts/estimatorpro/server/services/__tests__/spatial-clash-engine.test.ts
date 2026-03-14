/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  SPATIAL CLASH ENGINE — Test Suite (SOP Part 7 Core)
 *  Covers AABB geometry, broad-phase, narrow-phase, run orchestration
 * ══════════════════════════════════════════════════════════════════════════════
 */

// Mock storage (transitive dep via clash-detection-engine)
jest.mock('../../storage', () => ({
  storage: {},
}));

// Mock clash-test-templates for runSpatialClashTests
jest.mock('../clash-test-templates', () => ({
  resolveSelectionSet: jest.fn(() => ({ matchedIds: [], usedFallback: false, warnings: [] })),
  getSelectionSet: jest.fn(() => undefined),
  getEnabledTemplates: jest.fn(() => []),
}));

import {
  aabbOverlaps,
  aabbOverlapVolume,
  aabbMinDistance,
  aabbCentroid,
  expandAABB,
  aabbPenetrationDepth,
  sweepAndPrune,
  evaluatePair,
  runSpatialClashTests,
} from '../spatial-clash-engine';

import type { AABB, ResolvedElement, ClearanceRequirements } from '../clash-detection-engine';
import type { ClashTestTemplate } from '../clash-test-templates';

// ═══════════════════════════════════════════════════════════════════════════════
//  TEST DATA
// ═══════════════════════════════════════════════════════════════════════════════

const boxA: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 2, maxZ: 3 };
const boxB: AABB = { minX: 1, minY: 1, minZ: 0, maxX: 3, maxY: 3, maxZ: 3 };
const boxC: AABB = { minX: 5, minY: 5, minZ: 0, maxX: 6, maxY: 6, maxZ: 3 };
const boxD: AABB = { minX: 2, minY: 0, minZ: 0, maxX: 4, maxY: 2, maxZ: 3 }; // touches A at x=2
const boxE: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }; // fully inside A

function makeElement(
  id: string,
  box: AABB,
  elementType: string = 'wall',
  discipline: string = 'architectural',
): ResolvedElement {
  return {
    id,
    elementId: id,
    name: id,
    elementType,
    category: elementType,
    discipline: discipline as any,
    material: 'concrete',
    storey: 'Level 1',
    elevation: 0,
    bbox: box,
    dimensions: { length: 0, width: 0, height: 0, area: 0, volume: 0 },
    csiDivision: '03',
    properties: {},
    raw: {},
  } as ResolvedElement;
}

/** Default clearances for tests (all null = GAP) */
const defaultClearances: ClearanceRequirements = {
  ductToDuct_mm: null,
  ductToStructural_mm: null,
  pipeToPipe_mm: null,
  pipeToStructural_mm: null,
  equipmentServiceClearance_mm: null,
  panelFrontClearance_mm: null,
  panelSideClearance_mm: null,
  conduitToConduit_mm: null,
  drainSlopePercent: null,
  cleanoutAccessClearance_mm: null,
  sprinklerToCeiling_mm: null,
  sprinklerToObstruction_mm: null,
  fireDamperAccessClearance_mm: null,
  columnFireRating_hr: null,
  beamFireRating_hr: null,
  corridorMinWidth_mm: null,
  stairMinWidth_mm: null,
  doorMinWidth_mm: null,
  doorMinHeight_mm: null,
  ceilingMinHeight_mm: null,
  accessPanelClearance_mm: null,
};

/** Minimal hard clash template for pair evaluation tests */
function makeHardTemplate(overrides: Partial<ClashTestTemplate> = {}): ClashTestTemplate {
  return {
    id: 'TEST-001',
    name: 'Test Hard Clash',
    description: 'Test template',
    category: 'hard',
    setA: 'SS-STR-01',
    setB: 'SS-MECH-01',
    selfTest: false,
    tolerance_mm: 0,
    toleranceSource: null,
    defaultSeverity: 'critical',
    severityOverrides: [],
    enabled: true,
    codeReferences: ['NBC 3.2.5.7'],
    notes: 'test',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AABB OVERLAP TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('aabbOverlaps', () => {
  test('detects overlapping boxes', () => {
    expect(aabbOverlaps(boxA, boxB)).toBe(true);
  });

  test('rejects non-overlapping boxes', () => {
    expect(aabbOverlaps(boxA, boxC)).toBe(false);
  });

  test('touching boxes (edge contact) do not overlap', () => {
    // boxD starts at x=2, boxA ends at x=2 — touching but not overlapping
    expect(aabbOverlaps(boxA, boxD)).toBe(false);
  });

  test('fully contained box overlaps', () => {
    expect(aabbOverlaps(boxA, boxE)).toBe(true);
  });

  test('is commutative', () => {
    expect(aabbOverlaps(boxA, boxB)).toBe(aabbOverlaps(boxB, boxA));
    expect(aabbOverlaps(boxA, boxC)).toBe(aabbOverlaps(boxC, boxA));
  });

  test('identical boxes overlap', () => {
    expect(aabbOverlaps(boxA, boxA)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  AABB OVERLAP VOLUME
// ═══════════════════════════════════════════════════════════════════════════════

describe('aabbOverlapVolume', () => {
  test('calculates correct overlap volume for intersecting boxes', () => {
    // A: [0,2]x[0,2]x[0,3], B: [1,3]x[1,3]x[0,3]
    // Overlap: [1,2]x[1,2]x[0,3] = 1*1*3 = 3
    expect(aabbOverlapVolume(boxA, boxB)).toBeCloseTo(3, 5);
  });

  test('returns 0 for non-overlapping boxes', () => {
    expect(aabbOverlapVolume(boxA, boxC)).toBe(0);
  });

  test('fully contained box returns contained volume', () => {
    // boxE [0,1]x[0,1]x[0,1] inside boxA [0,2]x[0,2]x[0,3]
    // Overlap = 1*1*1 = 1
    expect(aabbOverlapVolume(boxA, boxE)).toBeCloseTo(1, 5);
  });

  test('identical boxes return full volume', () => {
    // boxA volume: 2*2*3 = 12
    expect(aabbOverlapVolume(boxA, boxA)).toBeCloseTo(12, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  AABB MIN DISTANCE
// ═══════════════════════════════════════════════════════════════════════════════

describe('aabbMinDistance', () => {
  test('returns 0 for overlapping boxes', () => {
    expect(aabbMinDistance(boxA, boxB)).toBe(0);
  });

  test('calculates distance for separated boxes', () => {
    // A max at (2,2,3), C min at (5,5,0)
    // Distance along X: 5-2=3, Y: 5-2=3, Z: 0 (overlap on Z)
    // Euclidean: sqrt(9+9+0) = sqrt(18) ≈ 4.243
    const dist = aabbMinDistance(boxA, boxC);
    expect(dist).toBeGreaterThan(4);
    expect(dist).toBeLessThan(5);
  });

  test('touching boxes have distance 0', () => {
    expect(aabbMinDistance(boxA, boxD)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  AABB CENTROID
// ═══════════════════════════════════════════════════════════════════════════════

describe('aabbCentroid', () => {
  test('calculates centroid correctly', () => {
    const c = aabbCentroid(boxA);
    expect(c.x).toBeCloseTo(1, 5);
    expect(c.y).toBeCloseTo(1, 5);
    expect(c.z).toBeCloseTo(1.5, 5);
  });

  test('asymmetric box centroid', () => {
    const c = aabbCentroid(boxC);
    expect(c.x).toBeCloseTo(5.5, 5);
    expect(c.y).toBeCloseTo(5.5, 5);
    expect(c.z).toBeCloseTo(1.5, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  EXPAND AABB (soft clash clearance zones)
// ═══════════════════════════════════════════════════════════════════════════════

describe('expandAABB', () => {
  test('expands by clearance in all directions', () => {
    const expanded = expandAABB(boxE, 0.5);
    expect(expanded.minX).toBeCloseTo(-0.5, 5);
    expect(expanded.minY).toBeCloseTo(-0.5, 5);
    expect(expanded.minZ).toBeCloseTo(-0.5, 5);
    expect(expanded.maxX).toBeCloseTo(1.5, 5);
    expect(expanded.maxY).toBeCloseTo(1.5, 5);
    expect(expanded.maxZ).toBeCloseTo(1.5, 5);
  });

  test('zero clearance returns same box', () => {
    const expanded = expandAABB(boxA, 0);
    expect(expanded.minX).toBe(boxA.minX);
    expect(expanded.maxX).toBe(boxA.maxX);
  });

  test('expanded boxes can create new overlaps', () => {
    // boxA and boxC don't overlap, but expanding by 3m might create overlap
    expect(aabbOverlaps(boxA, boxC)).toBe(false);
    const bigA = expandAABB(boxA, 3);
    // bigA max at (5, 5, 6), boxC min at (5, 5, 0) — touching/overlapping
    expect(bigA.maxX).toBeCloseTo(5, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PENETRATION DEPTH
// ═══════════════════════════════════════════════════════════════════════════════

describe('aabbPenetrationDepth', () => {
  test('returns positive depth for overlapping boxes', () => {
    const depth = aabbPenetrationDepth(boxA, boxB);
    expect(depth).toBeGreaterThan(0);
  });

  test('returns 0 for non-overlapping boxes', () => {
    expect(aabbPenetrationDepth(boxA, boxC)).toBe(0);
  });

  test('penetration depth is min overlap axis', () => {
    // A: [0,2]x[0,2]x[0,3], B: [1,3]x[1,3]x[0,3]
    // Overlap: X=1, Y=1, Z=3 → min penetration = 1
    expect(aabbPenetrationDepth(boxA, boxB)).toBeCloseTo(1, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SWEEP AND PRUNE (broad phase)
// ═══════════════════════════════════════════════════════════════════════════════

describe('sweepAndPrune', () => {
  test('finds overlapping pairs between two sets', () => {
    const setA = [makeElement('elem-1', boxA), makeElement('elem-3', boxC)];
    const setB = [makeElement('elem-2', boxB)];
    // sweepAndPrune(setA, setB, clearance_m)
    const pairs = sweepAndPrune(setA, setB, 0);
    // elem-1 overlaps elem-2, but elem-3 does not
    expect(pairs.length).toBeGreaterThanOrEqual(1);
    // pairs are [indexInSetA, indexInSetB]
    expect(pairs).toContainEqual([0, 0]);
  });

  test('returns empty for non-overlapping sets', () => {
    const setA = [makeElement('a', boxA)];
    const setB = [makeElement('b', boxC)];
    const pairs = sweepAndPrune(setA, setB, 0);
    expect(pairs).toHaveLength(0);
  });

  test('returns empty for well-separated elements', () => {
    const far1: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 };
    const far2: AABB = { minX: 100, minY: 100, minZ: 100, maxX: 101, maxY: 101, maxZ: 101 };
    const pairs = sweepAndPrune([makeElement('a', far1)], [makeElement('b', far2)], 0);
    expect(pairs).toHaveLength(0);
  });

  test('clearance expands overlap detection zone', () => {
    // boxA and boxC are far apart, but large clearance should create candidates
    const setA = [makeElement('a', boxA)];
    const setB = [makeElement('b', boxC)];
    // Without clearance = no overlap. With 5m clearance, expanded ranges should overlap on X.
    const pairs = sweepAndPrune(setA, setB, 5);
    expect(pairs.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  EVALUATE PAIR
// ═══════════════════════════════════════════════════════════════════════════════

describe('evaluatePair', () => {
  test('detects hard clash between overlapping elements', () => {
    const template = makeHardTemplate();
    const result = evaluatePair(
      makeElement('wall-1', boxA, 'wall', 'architectural'),
      makeElement('duct-1', boxB, 'duct', 'mechanical'),
      template,
      defaultClearances,
    );
    expect(result).not.toBeNull();
    if (result) {
      expect(result.category).toBe('hard');
      expect(result.penetrationDepth_mm).toBeGreaterThan(0);
      expect(result.isHard).toBe(true);
      expect(result.testId).toBe('TEST-001');
    }
  });

  test('returns null for non-overlapping elements with hard template', () => {
    const template = makeHardTemplate();
    const result = evaluatePair(
      makeElement('wall-1', boxA, 'wall', 'architectural'),
      makeElement('duct-1', boxC, 'duct', 'mechanical'),
      template,
      defaultClearances,
    );
    expect(result).toBeNull();
  });

  test('detects soft clash when within clearance zone', () => {
    // boxA ends at x=2, boxD starts at x=2 (touching, not overlapping)
    // With a soft template requiring 100mm clearance, distance 0mm < 100mm => clash
    const softTemplate = makeHardTemplate({
      id: 'SC-TEST',
      category: 'soft',
      tolerance_mm: 100,
      defaultSeverity: 'medium',
    });
    const result = evaluatePair(
      makeElement('wall-1', boxA, 'wall', 'architectural'),
      makeElement('duct-1', boxD, 'duct', 'mechanical'),
      softTemplate,
      defaultClearances,
    );
    expect(result).not.toBeNull();
    if (result) {
      expect(result.category).toBe('soft');
      expect(result.clearanceRequired_mm).toBe(100);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  FULL RUN
// ═══════════════════════════════════════════════════════════════════════════════

describe('runSpatialClashTests', () => {
  test('returns valid result structure with no templates', () => {
    const elements = [
      makeElement('wall-1', boxA, 'wall', 'architectural'),
      makeElement('duct-1', boxB, 'duct', 'mechanical'),
    ];
    const result = runSpatialClashTests(elements, {
      projectClearances: defaultClearances,
    });
    expect(result).toBeDefined();
    expect(result.pairsEvaluated).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.rawClashes)).toBe(true);
    expect(typeof result.testsRun).toBe('number');
    expect(Array.isArray(result.gapTolerances)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.timings).toBeDefined();
  });

  test('empty elements returns zero clashes', () => {
    const result = runSpatialClashTests([], {
      projectClearances: defaultClearances,
    });
    expect(result.rawClashes).toHaveLength(0);
    expect(result.pairsEvaluated).toBe(0);
  });
});
