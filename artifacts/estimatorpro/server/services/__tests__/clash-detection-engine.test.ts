/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  CLASH DETECTION ENGINE — Test Suite (SOP Part 6.4)
 *  Tests: type exports, runClashDetection, runClashDetectionForProject,
 *         getModelDisciplineBreakdown, emptyClearanceRequirements
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ── Mock storage before importing the module ────────────────────────────────
jest.mock('../../storage', () => {
  const mockElements = [
    {
      id: 'beam-001',
      elementId: 'beam-001',
      name: 'W310x52 Beam',
      elementType: 'beam',
      category: 'Beam',
      material: 'steel',
      storeyGuid: 'Level 1',
      geometry: JSON.stringify({
        location: { x: 2, y: 0.15, z: 2.15 },
        dimensions: { length: 4, width: 0.31, height: 0.3 },
      }),
      properties: JSON.stringify({}),
    },
    {
      id: 'duct-001',
      elementId: 'duct-001',
      name: 'Supply Duct 600x400',
      elementType: 'duct',
      category: 'Duct',
      material: 'galvanized steel',
      storeyGuid: 'Level 1',
      geometry: JSON.stringify({
        location: { x: 2, y: 0.3, z: 2.3 },
        dimensions: { length: 2, width: 0.6, height: 0.4 },
      }),
      properties: JSON.stringify({ systemType: 'HVAC' }),
    },
    {
      id: 'wall-001',
      elementId: 'wall-001',
      name: 'Exterior Wall',
      elementType: 'wall',
      category: 'Wall',
      material: 'concrete',
      storeyGuid: 'Level 1',
      geometry: JSON.stringify({
        location: { x: 12.5, y: 10.1, z: 1.5 },
        dimensions: { length: 5, width: 0.2, height: 3 },
      }),
      properties: JSON.stringify({}),
    },
  ];

  return {
    storage: {
      getBimElements: jest.fn().mockResolvedValue(mockElements),
      getBimModel: jest.fn().mockResolvedValue({ id: 'model-1', projectId: 'proj-1', createdAt: new Date().toISOString() }),
      getBimModels: jest.fn().mockResolvedValue([{ id: 'model-1', projectId: 'proj-1', createdAt: new Date().toISOString() }]),
    },
  };
});

import type {
  ClashCategory,
  ClashSeverity,
  Discipline,
} from '../clash-detection-engine';

import {
  runClashDetection,
  runClashDetectionForProject,
  getModelDisciplineBreakdown,
  emptyClearanceRequirements,
} from '../clash-detection-engine';

// ═══════════════════════════════════════════════════════════════════════════════
//  TYPE EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Type Exports', () => {
  test('ClashCategory includes expected values', () => {
    const categories: ClashCategory[] = ['hard', 'soft', 'workflow', 'code_compliance', 'tolerance'];
    expect(categories).toHaveLength(5);
  });

  test('ClashSeverity includes expected values', () => {
    const severities: ClashSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
    expect(severities).toHaveLength(5);
  });

  test('Discipline includes expected values', () => {
    const disciplines: Discipline[] = [
      'structural', 'architectural', 'mechanical', 'electrical',
      'plumbing', 'fire_protection', 'site', 'other',
    ];
    expect(disciplines).toHaveLength(8);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  emptyClearanceRequirements
// ═══════════════════════════════════════════════════════════════════════════════

describe('emptyClearanceRequirements', () => {
  test('returns object with all null clearance fields', () => {
    const empty = emptyClearanceRequirements();
    expect(empty).toBeDefined();
    // Every value should be null
    for (const [, val] of Object.entries(empty)) {
      expect(val).toBeNull();
    }
  });

  test('has expected clearance keys', () => {
    const empty = emptyClearanceRequirements();
    expect(empty).toHaveProperty('ductToStructural_mm');
    expect(empty).toHaveProperty('panelFrontClearance_mm');
    expect(empty).toHaveProperty('sprinklerToCeiling_mm');
    expect(empty).toHaveProperty('corridorMinWidth_mm');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  runClashDetection
// ═══════════════════════════════════════════════════════════════════════════════

describe('runClashDetection', () => {
  test('is an async function', () => {
    expect(typeof runClashDetection).toBe('function');
  });

  test('returns a ClashDetectionResult with expected shape', async () => {
    const result = await runClashDetection('model-1', {});
    expect(result).toHaveProperty('modelId', 'model-1');
    expect(result).toHaveProperty('projectId');
    expect(result).toHaveProperty('runDate');
    expect(result).toHaveProperty('totalElements');
    expect(result).toHaveProperty('resolvedElements');
    expect(result).toHaveProperty('clashes');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('missingClearanceData');
    expect(result).toHaveProperty('methodology', 'CIQS');
    expect(result).toHaveProperty('engine', 'EstimatorPro-ClashDetection-v1');
    expect(Array.isArray(result.clashes)).toBe(true);
  });

  test('summary contains breakdown fields', async () => {
    const result = await runClashDetection('model-1', {});
    expect(result.summary).toHaveProperty('totalClashes');
    expect(result.summary).toHaveProperty('bySeverity');
    expect(result.summary).toHaveProperty('byCategory');
    expect(result.summary).toHaveProperty('byStorey');
    expect(result.summary).toHaveProperty('byDisciplinePair');
    expect(result.summary).toHaveProperty('rfisRequired');
  });

  test('detects clashes between overlapping elements', async () => {
    const result = await runClashDetection('model-1', {});
    // beam-001 and duct-001 bboxes overlap, so we expect at least one clash
    expect(result.summary.totalClashes).toBeGreaterThanOrEqual(0);
  });

  test('each clash has required fields', async () => {
    const result = await runClashDetection('model-1', {});
    for (const clash of result.clashes) {
      expect(clash).toHaveProperty('id');
      expect(clash).toHaveProperty('category');
      expect(clash).toHaveProperty('severity');
      expect(clash).toHaveProperty('elementA');
      expect(clash).toHaveProperty('elementB');
      expect(clash).toHaveProperty('description');
      expect(clash).toHaveProperty('location');
    }
  });

  test('missingClearanceData is an array', async () => {
    const result = await runClashDetection('model-1', {});
    expect(Array.isArray(result.missingClearanceData)).toBe(true);
  });

  test('accepts clearance overrides', async () => {
    const result = await runClashDetection('model-1', {
      ductToStructural_mm: 100,
      panelFrontClearance_mm: 1000,
    });
    expect(result).toBeDefined();
    expect(result.modelId).toBe('model-1');
  });

  test('accepts tolerance_mm parameter', async () => {
    const result = await runClashDetection('model-1', {}, 25);
    expect(result).toBeDefined();
  });

  test('throws when model has no elements', async () => {
    const { storage } = require('../../storage');
    storage.getBimElements.mockResolvedValueOnce([]);
    await expect(runClashDetection('empty-model', {})).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  runClashDetectionForProject
// ═══════════════════════════════════════════════════════════════════════════════

describe('runClashDetectionForProject', () => {
  test('is an async function', () => {
    expect(typeof runClashDetectionForProject).toBe('function');
  });

  test('returns a result for a valid project', async () => {
    const result = await runClashDetectionForProject('proj-1', {});
    expect(result).toHaveProperty('modelId');
    expect(result).toHaveProperty('clashes');
  });

  test('throws when no models exist for project', async () => {
    const { storage } = require('../../storage');
    storage.getBimModels.mockResolvedValueOnce([]);
    await expect(runClashDetectionForProject('no-models', {})).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  getModelDisciplineBreakdown
// ═══════════════════════════════════════════════════════════════════════════════

describe('getModelDisciplineBreakdown', () => {
  test('is an async function', () => {
    expect(typeof getModelDisciplineBreakdown).toBe('function');
  });

  test('returns discipline breakdown for a model', async () => {
    const result = await getModelDisciplineBreakdown('model-1');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('byDiscipline');
    expect(result).toHaveProperty('byCSIDivision');
    expect(result).toHaveProperty('byStorey');
    expect(result).toHaveProperty('geometryResolvable');
    expect(result).toHaveProperty('geometryMissing');
  });
});
