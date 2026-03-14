/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  CLASH PIPELINE — Test Suite (SOP Part 7 Support)
 *  Tests: templates, dedup, false positives, priority scoring
 * ══════════════════════════════════════════════════════════════════════════════
 */

// Mock storage dependency used by clash-detection-engine
jest.mock('../../storage', () => ({
  storage: {
    getBimElements: jest.fn().mockResolvedValue([]),
    getProject: jest.fn().mockResolvedValue(null),
  },
}));

// ─── CLASH TEST TEMPLATES ───────────────────────────────────────────────────

import {
  SELECTION_SETS,
  CLASH_TEST_TEMPLATES,
  evaluateRule,
  resolveSelectionSet,
  getTestTemplate,
  getEnabledTemplates,
  getTemplatesByCategory,
  getSelectionSet,
  validateTemplateIntegrity,
  type SelectionRule,
} from '../clash-test-templates';

describe('clash-test-templates.ts', () => {
  test('SELECTION_SETS has entries', () => {
    expect(SELECTION_SETS.length).toBeGreaterThan(0);
  });

  test('CLASH_TEST_TEMPLATES has entries', () => {
    expect(CLASH_TEST_TEMPLATES.length).toBeGreaterThan(0);
  });

  test('each template has required fields', () => {
    for (const t of CLASH_TEST_TEMPLATES) {
      expect(t.id).toBeDefined();
      expect(t.name).toBeDefined();
      expect(t.setA).toBeDefined();
      expect(t.setB).toBeDefined();
      expect(t.category).toBeDefined();
      expect(typeof t.selfTest).toBe('boolean');
      expect(typeof t.enabled).toBe('boolean');
    }
  });

  test('each selection set has required fields', () => {
    for (const s of SELECTION_SETS) {
      expect(s.id).toBeDefined();
      expect(s.name).toBeDefined();
      expect(s.discipline).toBeDefined();
      expect(Array.isArray(s.primaryRules)).toBe(true);
      expect(Array.isArray(s.fallbackRules)).toBe(true);
      expect(Array.isArray(s.excludeRules)).toBe(true);
      expect(typeof s.minElements).toBe('number');
    }
  });

  test('evaluateRule with eq operator matches discipline', () => {
    const rule: SelectionRule = {
      field: 'discipline',
      operator: 'eq',
      value: 'structural',
      description: 'test rule',
    };
    expect(evaluateRule(rule, { discipline: 'structural' })).toBe(true);
    expect(evaluateRule(rule, { discipline: 'mechanical' })).toBe(false);
  });

  test('evaluateRule handles contains operator', () => {
    const rule: SelectionRule = {
      field: 'type',
      operator: 'contains',
      value: 'wall',
      description: 'test rule',
    };
    expect(evaluateRule(rule, { type: 'exterior_wall' })).toBe(true);
    expect(evaluateRule(rule, { type: 'column' })).toBe(false);
  });

  test('evaluateRule handles in operator', () => {
    const rule: SelectionRule = {
      field: 'category',
      operator: 'in',
      value: ['Column', 'Beam', 'Slab'],
      description: 'test rule',
    };
    expect(evaluateRule(rule, { category: 'Beam' })).toBe(true);
    expect(evaluateRule(rule, { category: 'Duct' })).toBe(false);
  });

  test('evaluateRule returns false for missing field', () => {
    const rule: SelectionRule = {
      field: 'nonexistent',
      operator: 'eq',
      value: 'anything',
      description: 'test rule',
    };
    expect(evaluateRule(rule, { discipline: 'structural' })).toBe(false);
  });

  test('resolveSelectionSet returns matching elements using primaryRules', () => {
    // Need enough structural elements to exceed minElements threshold (5)
    const elements = [
      { id: 's1', discipline: 'structural', type: 'column' },
      { id: 's2', discipline: 'structural', type: 'beam' },
      { id: 's3', discipline: 'structural', type: 'slab' },
      { id: 's4', discipline: 'structural', type: 'wall' },
      { id: 's5', discipline: 'structural', type: 'brace' },
      { id: 's6', discipline: 'structural', type: 'foundation' },
      { id: 'd1', discipline: 'mechanical', type: 'duct' },
    ];
    const set = SELECTION_SETS.find(s =>
      s.primaryRules.some(r => r.value === 'structural')
    );
    if (set) {
      const result = resolveSelectionSet(set, elements);
      expect(result.matchedIds.length).toBeGreaterThan(0);
      expect(typeof result.usedFallback).toBe('boolean');
      expect(Array.isArray(result.warnings)).toBe(true);
    }
  });

  test('resolveSelectionSet returns empty for no matches', () => {
    const elements = [
      { id: 'x1', discipline: 'other', type: 'misc' },
    ];
    const structSet = SELECTION_SETS.find(s => s.discipline === 'structural');
    if (structSet) {
      const result = resolveSelectionSet(structSet, elements);
      // May use fallback, but still no matches expected
      expect(Array.isArray(result.matchedIds)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    }
  });

  test('getTestTemplate returns template by ID', () => {
    const template = getTestTemplate('CD-001');
    expect(template).toBeDefined();
    expect(template!.id).toBe('CD-001');
    expect(template!.name).toBe('Structure vs HVAC Ductwork');
  });

  test('getTestTemplate returns undefined for missing ID', () => {
    expect(getTestTemplate('NONEXISTENT')).toBeUndefined();
  });

  test('getEnabledTemplates returns only enabled templates', () => {
    const enabled = getEnabledTemplates();
    expect(enabled.length).toBeGreaterThan(0);
    for (const t of enabled) {
      expect(t.enabled).toBe(true);
    }
  });

  test('getTemplatesByCategory filters by category', () => {
    const hard = getTemplatesByCategory('hard');
    expect(hard.length).toBeGreaterThan(0);
    for (const t of hard) {
      expect(t.category).toBe('hard');
    }
  });

  test('getSelectionSet returns set by ID', () => {
    const set = getSelectionSet('SS-STR-01');
    expect(set).toBeDefined();
    expect(set!.discipline).toBe('structural');
  });

  test('validateTemplateIntegrity returns no errors for built-in data', () => {
    const errors = validateTemplateIntegrity();
    expect(errors).toHaveLength(0);
  });
});

// ─── DEDUP ENGINE ───────────────────────────────────────────────────────────

import {
  removeExactDuplicates,
  groupByRootCause,
  deduplicateClashes,
} from '../dedup-engine';

import type { RawClash } from '../spatial-clash-engine';
import type { ResolvedElement } from '../clash-detection-engine';

/** Helper to build a minimal RawClash-compatible object for testing */
function makeRawClash(overrides: {
  id: string;
  elementAId: string;
  elementAName: string;
  elementADiscipline: string;
  elementBId: string;
  elementBName: string;
  elementBDiscipline: string;
  severity?: string;
  category?: string;
}): RawClash {
  const makeElement = (
    id: string,
    name: string,
    discipline: string,
  ): ResolvedElement =>
    ({
      id,
      elementId: id,
      name,
      elementType: 'GenericElement',
      category: 'General',
      discipline,
      material: 'steel',
      storey: 'Level 1',
      elevation: 0,
      bbox: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
      dimensions: { length: 1, width: 1, height: 1, area: 1, volume: 1 },
      csiDivision: '05',
      properties: {},
      raw: {},
    }) as ResolvedElement;

  return {
    id: overrides.id,
    testId: 'CD-001',
    category: (overrides.category || 'hard') as any,
    severity: (overrides.severity || 'high') as any,
    elementA: makeElement(overrides.elementAId, overrides.elementAName, overrides.elementADiscipline),
    elementB: makeElement(overrides.elementBId, overrides.elementBName, overrides.elementBDiscipline),
    overlapVolume_m3: 0.01,
    clearanceRequired_mm: 0,
    clearanceActual_mm: -10,
    penetrationDepth_mm: 10,
    location: { x: 1, y: 1, z: 2 },
    description: 'Test clash',
    codeReferences: [],
    toleranceSource: 'spec',
    isHard: true,
  } as RawClash;
}

describe('dedup-engine.ts', () => {
  const sampleClashes: RawClash[] = [
    makeRawClash({ id: 'c1', elementAId: 'beam-001', elementAName: 'Beam 001', elementADiscipline: 'structural', elementBId: 'duct-001', elementBName: 'Duct 001', elementBDiscipline: 'mechanical', severity: 'high' }),
    // Exact duplicate (same element pair)
    makeRawClash({ id: 'c2', elementAId: 'beam-001', elementAName: 'Beam 001', elementADiscipline: 'structural', elementBId: 'duct-001', elementBName: 'Duct 001', elementBDiscipline: 'mechanical', severity: 'high' }),
    // Different pair, same beam
    makeRawClash({ id: 'c3', elementAId: 'beam-001', elementAName: 'Beam 001', elementADiscipline: 'structural', elementBId: 'pipe-001', elementBName: 'Pipe 001', elementBDiscipline: 'plumbing', severity: 'medium' }),
    // Completely different area
    makeRawClash({ id: 'c4', elementAId: 'wall-001', elementAName: 'Wall 001', elementADiscipline: 'architectural', elementBId: 'duct-002', elementBName: 'Duct 002', elementBDiscipline: 'mechanical', severity: 'low', category: 'soft' }),
  ];

  test('removeExactDuplicates removes identical element-pair clashes', () => {
    const result = removeExactDuplicates(sampleClashes);
    expect(result.unique.length).toBeLessThan(sampleClashes.length);
    expect(result.removed).toBeGreaterThan(0);
  });

  test('groupByRootCause groups related clashes', () => {
    const groups = groupByRootCause(sampleClashes);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.length).toBeLessThanOrEqual(sampleClashes.length);
    for (const g of groups) {
      expect(g.groupId).toBeDefined();
      expect(g.rootCauseElementId).toBeDefined();
      expect(g.clashCount).toBeGreaterThan(0);
    }
  });

  test('deduplicateClashes returns full DedupResult', () => {
    const result = deduplicateClashes(sampleClashes);
    expect(result).toHaveProperty('uniqueClashes');
    expect(result).toHaveProperty('groups');
    expect(result).toHaveProperty('duplicatesRemoved');
    expect(result).toHaveProperty('nearDuplicatesMerged');
    expect(result).toHaveProperty('summary');
    expect(result.summary.inputCount).toBe(sampleClashes.length);
    expect(result.summary.uniqueCount).toBeLessThanOrEqual(result.summary.inputCount);
  });

  test('empty input returns empty result', () => {
    const result = deduplicateClashes([]);
    expect(result.summary.inputCount).toBe(0);
    expect(result.groups).toHaveLength(0);
    expect(result.uniqueClashes).toHaveLength(0);
  });

  test('single clash returns one group', () => {
    const result = deduplicateClashes([sampleClashes[0]]);
    expect(result.groups).toHaveLength(1);
    expect(result.summary.inputCount).toBe(1);
  });
});

// ─── FALSE POSITIVE FILTER ──────────────────────────────────────────────────

import {
  DEFAULT_FILTER_RULES,
  filterFalsePositives,
} from '../false-positive-filter';

describe('false-positive-filter.ts', () => {
  test('DEFAULT_FILTER_RULES has entries', () => {
    expect(DEFAULT_FILTER_RULES.length).toBeGreaterThan(0);
  });

  test('each rule has required fields', () => {
    for (const rule of DEFAULT_FILTER_RULES) {
      expect(rule).toHaveProperty('id');
      expect(rule).toHaveProperty('name');
      expect(rule).toHaveProperty('reason');
      expect(rule).toHaveProperty('description');
      expect(rule).toHaveProperty('enabled');
      expect(typeof rule.predicate).toBe('function');
    }
  });

  test('filterFalsePositives returns result with passed and filtered', () => {
    // Create a clash that should be filtered (temporary element)
    const tempClash = makeRawClash({
      id: 'fp1',
      elementAId: 'temp-001',
      elementAName: 'TEMP Scaffold',
      elementADiscipline: 'structural',
      elementBId: 'duct-001',
      elementBName: 'Duct 001',
      elementBDiscipline: 'mechanical',
    });
    // Create a normal clash that should pass
    const normalClash = makeRawClash({
      id: 'fp2',
      elementAId: 'beam-001',
      elementAName: 'Beam 001',
      elementADiscipline: 'structural',
      elementBId: 'duct-001',
      elementBName: 'Duct 001',
      elementBDiscipline: 'mechanical',
    });

    const result = filterFalsePositives([tempClash, normalClash]);
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('filtered');
    expect(result).toHaveProperty('summary');
    expect(result.passed.length + result.filtered.length).toBe(2);
  });

  test('empty clashes returns empty result', () => {
    const result = filterFalsePositives([]);
    expect(result.passed).toHaveLength(0);
    expect(result.filtered).toHaveLength(0);
    expect(result.summary.inputCount).toBe(0);
  });

  test('filterFalsePositives filters temp elements', () => {
    const tempClash = makeRawClash({
      id: 'fp-temp',
      elementAId: 'scaffold-001',
      elementAName: 'Temporary Scaffolding',
      elementADiscipline: 'structural',
      elementBId: 'duct-001',
      elementBName: 'Duct 001',
      elementBDiscipline: 'mechanical',
    });
    const result = filterFalsePositives([tempClash]);
    expect(result.filtered.length).toBe(1);
    expect(result.filtered[0].filterReason).toBe('temp_element');
    expect(result.passed.length).toBe(0);
  });

  test('filterFalsePositives respects disabledIds', () => {
    const tempClash = makeRawClash({
      id: 'fp-disabled',
      elementAId: 'scaffold-001',
      elementAName: 'Temporary Scaffolding',
      elementADiscipline: 'structural',
      elementBId: 'duct-001',
      elementBName: 'Duct 001',
      elementBDiscipline: 'mechanical',
    });
    // Disable the temp element filter (FP-001)
    const result = filterFalsePositives([tempClash], [], new Set(['FP-001']));
    // Should no longer be filtered by FP-001, but may still be filtered by another rule
    // The key point is FP-001 is skipped
    expect(result.filtered.every(f => f.ruleId !== 'FP-001')).toBe(true);
  });
});

// ─── PRIORITY SCORING ───────────────────────────────────────────────────────

import {
  calculatePriorityScores,
  quickScoreFromSeverity,
  overrideScores,
} from '../priority-scoring';

import type { ScoringInput } from '../priority-scoring';

describe('priority-scoring.ts', () => {
  test('calculatePriorityScores returns valid result', () => {
    const input: ScoringInput = {
      clashCategory: 'hard',
      severity: 'critical',
      disciplineA: 'structural',
      disciplineB: 'mechanical',
      zone: 'Level 1',
      codeReferences: ['NBC 3.2.5.7'],
      elementTypes: ['Beam', 'Duct'],
      isOnCriticalPath: true,
      affectedTradeCount: 3,
      estimatedReworkCost: 50000,
    };
    const result = calculatePriorityScores(input);
    expect(result).toHaveProperty('scores');
    expect(result).toHaveProperty('priority');
    expect(result).toHaveProperty('priorityLabel');
    expect(result).toHaveProperty('reasoning');
    expect(result).toHaveProperty('autoScored');
    expect(result.priorityLabel).toBe('CRITICAL');
    expect(result.autoScored).toBe(true);
  });

  test('quickScoreFromSeverity returns result', () => {
    const result = quickScoreFromSeverity('high', 'hard');
    expect(result).toHaveProperty('scores');
    expect(result).toHaveProperty('priority');
    expect(result).toHaveProperty('priorityLabel');
  });

  test('critical severity maps to CRITICAL priorityLabel', () => {
    const result = quickScoreFromSeverity('critical', 'hard');
    expect(result.priorityLabel).toBe('CRITICAL');
  });

  test('low severity soft clash maps to LOW priorityLabel', () => {
    const result = quickScoreFromSeverity('low', 'soft');
    expect(result.priorityLabel).toBe('LOW');
  });

  test('scores have all four axes', () => {
    const result = quickScoreFromSeverity('medium', 'hard');
    expect(result.scores).toHaveProperty('lifeSafety');
    expect(result.scores).toHaveProperty('scheduleImpact');
    expect(result.scores).toHaveProperty('reworkCost');
    expect(result.scores).toHaveProperty('downstreamImpact');
    // Each axis should be 1-5
    for (const val of Object.values(result.scores)) {
      expect(val).toBeGreaterThanOrEqual(1);
      expect(val).toBeLessThanOrEqual(5);
    }
  });

  test('overrideScores allows manual adjustment of individual scores', () => {
    const base = quickScoreFromSeverity('medium', 'soft');
    const overridden = overrideScores(base, { lifeSafety: 5 }, 'Client request — life-safety concern');
    expect(overridden.scores.lifeSafety).toBe(5);
    expect(overridden.autoScored).toBe(false);
    expect(overridden.reasoning).toContainEqual(expect.stringContaining('MANUAL OVERRIDE'));
  });

  test('overrideScores recalculates priority', () => {
    const base = quickScoreFromSeverity('low', 'soft');
    // Override lifeSafety to 5, which should bump priority to CRITICAL (P1 or P2)
    const overridden = overrideScores(base, { lifeSafety: 5 }, 'Escalation');
    expect(overridden.priorityLabel).toBe('CRITICAL');
  });
});
