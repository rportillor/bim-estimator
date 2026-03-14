/**
 * server/services/__tests__/qto-qa-engine.test.ts
 *
 * QTO QA Engine — full test suite (36 tests)
 * v14.26 complete rewrite — matches L-1-fixed engine API
 *
 * Standards: CIQS Standard Method, SOP Parts 5.1–5.3
 * Type system: bim-coordination/types (short Discipline codes, EvidenceReference with type field)
 */

import { describe, it, expect, beforeAll } from '@jest/globals';

// ─── Import guard ────────────────────────────────────────────────────────────
// If any import below fails, the error is surfaced as a test failure (not blank)
let importError: Error | null = null;
let engine: typeof import('../qto-qa-engine');

beforeAll(async () => {
  try {
    engine = await import('../qto-qa-engine');
  } catch (err) {
    importError = err as Error;
  }
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

import type { CoordinationElement } from '../../bim-coordination/types';

function makeElement(overrides: Partial<CoordinationElement> = {}): CoordinationElement {
  return {
    id: 'el-001',
    idType: 'IFC_GUID',
    category: 'Walls',
    familyType: 'Basic Wall:Generic - 200mm',
    discipline: 'ARC',
    level: 'Level 1',
    workset: 'Architecture',
    systemType: undefined,
    systemName: undefined,
    hostId: undefined,
    material: 'Concrete',
    fireRating: undefined,
    serviceClearanceMm: undefined,
    bbox: { minX: 0, minY: 0, minZ: 0, maxX: 5, maxY: 0.2, maxZ: 3 },
    connectors: [],
    hasLevel: true,
    hasSystemType: false,
    hasMaterial: true,
    hasHostId: false,
    isHosted: false,
    modelVersion: 'v1.0',
    rawProperties: {},
    ...overrides,
  };
}

function makeMEPElement(overrides: Partial<CoordinationElement> = {}): CoordinationElement {
  return makeElement({
    id: 'mep-001',
    category: 'Ducts',
    familyType: 'Round Duct:Standard',
    discipline: 'MECH',
    systemType: 'Supply Air',
    systemName: 'HVAC-S-01',
    hasSystemType: true,
    connectors: [
      { connectorId: 'c1', systemType: 'DuctAir', isConnected: true, connectedToId: 'mep-002', position: { x: 0, y: 0, z: 2 } },
      { connectorId: 'c2', systemType: 'DuctAir', isConnected: false, connectedToId: undefined, position: { x: 5, y: 0, z: 2 } },
    ],
    ...overrides,
  });
}

// ─── Import guard test ───────────────────────────────────────────────────────

describe('Module import', () => {
  it('should import without errors', () => {
    if (importError) {
      throw new Error(`qto-qa-engine.ts failed to import: ${importError.message}\n${importError.stack}`);
    }
    expect(engine).toBeDefined();
  });
});

// ─── buildElementIndex ───────────────────────────────────────────────────────

describe('buildElementIndex', () => {
  it('returns one entry per element', () => {
    const els = [makeElement({ id: 'a' }), makeElement({ id: 'b' })];
    const result = engine.buildElementIndex(els, 'v1.0');
    expect(result).toHaveLength(2);
  });

  it('populates elementId from element id', () => {
    const result = engine.buildElementIndex([makeElement({ id: 'wall-001' })], 'v1.0');
    expect(result[0].elementId).toBe('wall-001');
  });

  it('parses familyType into family and type', () => {
    const result = engine.buildElementIndex(
      [makeElement({ familyType: 'Basic Wall:Generic - 200mm' })],
      'v1.0',
    );
    expect(result[0].family).toBe('Basic Wall');
    expect(result[0].type).toBe('Generic - 200mm');
  });

  it('sets evidenceRef.type to "model"', () => {
    const result = engine.buildElementIndex([makeElement()], 'v1.0');
    expect(result[0].evidenceRef.type).toBe('model');
  });

  it('sets evidenceRef.modelVersionLabel', () => {
    const result = engine.buildElementIndex([makeElement()], 'v2.5');
    expect(result[0].evidenceRef.modelVersionLabel).toBe('v2.5');
  });

  it('returns empty array for empty input', () => {
    expect(engine.buildElementIndex([], 'v1.0')).toHaveLength(0);
  });
});

// ─── buildCategoryRollups ────────────────────────────────────────────────────

describe('buildCategoryRollups', () => {
  it('groups elements by category+type', () => {
    const els = [
      makeElement({ id: 'a', category: 'Walls', familyType: 'Basic Wall:100mm' }),
      makeElement({ id: 'b', category: 'Walls', familyType: 'Basic Wall:100mm' }),
      makeElement({ id: 'c', category: 'Floors', familyType: 'Floor:Concrete' }),
    ];
    const rollups = engine.buildCategoryRollups(els, 'v1.0');
    expect(rollups.length).toBe(2);
    const walls = rollups.find(r => r.category === 'Walls');
    expect(walls?.count).toBe(2);
  });

  it('sets correct unit for Walls', () => {
    const rollups = engine.buildCategoryRollups([makeElement()], 'v1.0');
    const wall = rollups.find(r => r.category === 'Walls');
    expect(wall?.unit).toBeDefined();
  });
});

// ─── buildMaterialsTable ─────────────────────────────────────────────────────

describe('buildMaterialsTable', () => {
  it('returns one entry per element', () => {
    const els = [makeElement({ id: 'a' }), makeElement({ id: 'b' })];
    const materials = engine.buildMaterialsTable(els, 'v1.0');
    expect(materials.length).toBe(2);
  });

  it('flags placeholder materials', () => {
    const el = makeElement({ material: 'Default' });
    const materials = engine.buildMaterialsTable([el], 'v1.0');
    expect(materials[0].isPlaceholder).toBe(true);
  });

  it('does not flag real materials as placeholder', () => {
    const el = makeElement({ material: 'Concrete - Cast in Place' });
    const materials = engine.buildMaterialsTable([el], 'v1.0');
    expect(materials[0].isPlaceholder).toBe(false);
  });
});

// ─── buildHostedDependencies ─────────────────────────────────────────────────

describe('buildHostedDependencies', () => {
  it('returns hosted elements only', () => {
    const hosted = makeElement({ id: 'door-001', isHosted: true, hostId: 'wall-001', category: 'Doors' });
    const wall = makeElement({ id: 'wall-001', isHosted: false });
    const result = engine.buildHostedDependencies([hosted, wall], 'v1.0');
    expect(result.length).toBe(1);
    expect(result[0].hostedElementId).toBe('door-001');
  });

  it('marks orphan when host not in element list', () => {
    const door = makeElement({ id: 'door-001', isHosted: true, hostId: 'wall-999', category: 'Doors' });
    const result = engine.buildHostedDependencies([door], 'v1.0');
    expect(result[0].isOrphan).toBe(true);
    expect(result[0].hostFound).toBe(false);
  });

  it('marks host found when host is in list', () => {
    const door = makeElement({ id: 'door-001', isHosted: true, hostId: 'wall-001', category: 'Doors' });
    const wall = makeElement({ id: 'wall-001', isHosted: false });
    const result = engine.buildHostedDependencies([door, wall], 'v1.0');
    expect(result[0].hostFound).toBe(true);
    expect(result[0].isOrphan).toBe(false);
  });
});

// ─── buildMEPConnectivity ────────────────────────────────────────────────────

describe('buildMEPConnectivity', () => {
  it('returns entries for MEP elements', () => {
    const result = engine.buildMEPConnectivity([makeMEPElement()], 'v1.0');
    expect(result.length).toBeGreaterThan(0);
  });

  it('counts unconnected connectors', () => {
    const result = engine.buildMEPConnectivity([makeMEPElement()], 'v1.0');
    const entry = result[0];
    expect(entry.unconnectedCount).toBe(1);
    expect(entry.connectedCount).toBe(1);
  });

  it('returns empty for non-MEP elements', () => {
    const wall = makeElement({ discipline: 'ARC', connectors: [] });
    const result = engine.buildMEPConnectivity([wall], 'v1.0');
    expect(result.length).toBe(0);
  });
});

// ─── QA Rule 1 — ID Stability ────────────────────────────────────────────────

describe('qaRule1_IDStability', () => {
  it('passes with no prior elements', () => {
    const result = engine.qaRule1_IDStability([makeElement()], null, 'v1.0');
    expect(result.pass).toBe(true);
    expect(result.comparedToPriorVersion).toBe(false);
  });

  it('passes when IDs are identical', () => {
    const els = [makeElement({ id: 'a' }), makeElement({ id: 'b' })];
    const result = engine.qaRule1_IDStability(els, els, 'v2.0', 'v1.0');
    expect(result.pass).toBe(true);
    expect(result.changePercentage).toBe(0);
  });

  it('fails when change percentage exceeds threshold', () => {
    const prior = Array.from({ length: 20 }, (_, i) => makeElement({ id: `el-${i}` }));
    const current = [makeElement({ id: 'el-new-1' }), makeElement({ id: 'el-new-2' })];
    const result = engine.qaRule1_IDStability(current, prior, 'v2.0', 'v1.0');
    expect(result.pass).toBe(false);
  });
});

// ─── QA Rule 2 — Level Assignment ────────────────────────────────────────────

describe('qaRule2_LevelAssignment', () => {
  it('passes when all elements have levels', () => {
    const els = [makeElement({ hasLevel: true }), makeElement({ id: 'b', hasLevel: true })];
    const result = engine.qaRule2_LevelAssignment(els, 'v1.0');
    expect(result.pass).toBe(true);
  });

  it('fails when elements are missing levels', () => {
    const els = [makeElement({ hasLevel: false, level: undefined })];
    const result = engine.qaRule2_LevelAssignment(els, 'v1.0');
    expect(result.pass).toBe(false);
  });
});

// ─── QA Rule 3 — System Metadata ─────────────────────────────────────────────

describe('qaRule3_SystemMetadata', () => {
  it('passes when MEP elements have system types', () => {
    const mep = makeMEPElement({ hasSystemType: true });
    const result = engine.qaRule3_SystemMetadata([mep], 'v1.0');
    expect(result.pass).toBe(true);
  });

  it('flags MEP elements missing system type', () => {
    const mep = makeMEPElement({ hasSystemType: false, systemType: undefined });
    const result = engine.qaRule3_SystemMetadata([mep], 'v1.0');
    expect(result.pass).toBe(false);
  });

  it('ignores non-MEP elements', () => {
    const wall = makeElement({ discipline: 'ARC', hasSystemType: false });
    const result = engine.qaRule3_SystemMetadata([wall], 'v1.0');
    expect(result.pass).toBe(true);
  });
});

// ─── QA Rule 4 — Placeholder Materials ───────────────────────────────────────

describe('qaRule4_PlaceholderMaterials', () => {
  it('passes when no placeholder materials', () => {
    const el = makeElement({ material: 'Concrete - Cast in Place' });
    const result = engine.qaRule4_PlaceholderMaterials([el], 'v1.0');
    expect(result.pass).toBe(true);
  });

  it('fails when placeholder materials found', () => {
    const el = makeElement({ material: 'Default' });
    const result = engine.qaRule4_PlaceholderMaterials([el], 'v1.0');
    expect(result.pass).toBe(false);
  });
});

// ─── QA Rule 5 — Orphan Detection ────────────────────────────────────────────

describe('qaRule5_OrphanDetection', () => {
  it('passes when no orphans', () => {
    const door = makeElement({ id: 'door-001', isHosted: true, hostId: 'wall-001', category: 'Doors' });
    const wall = makeElement({ id: 'wall-001' });
    const result = engine.qaRule5_OrphanDetection([door, wall], 'v1.0');
    expect(result.pass).toBe(true);
  });

  it('fails when orphaned hosted elements found', () => {
    const door = makeElement({ id: 'door-001', isHosted: true, hostId: 'wall-999', category: 'Doors' });
    const result = engine.qaRule5_OrphanDetection([door], 'v1.0');
    expect(result.pass).toBe(false);
  });
});

// ─── QA Rule 6 — Connectivity ────────────────────────────────────────────────

describe('qaRule6_Connectivity', () => {
  it('passes when all MEP connectors connected', () => {
    const mep = makeMEPElement({
      connectors: [
        { connectorId: 'c1', systemType: 'DuctAir', isConnected: true, connectedToId: 'mep-002', position: { x: 0, y: 0, z: 2 } },
      ],
    });
    const result = engine.qaRule6_Connectivity([mep], 'v1.0');
    expect(result.pass).toBe(true);
  });

  it('flags unconnected MEP connectors', () => {
    const result = engine.qaRule6_Connectivity([makeMEPElement()], 'v1.0');
    // makeMEPElement has 1 connected + 1 unconnected
    expect(result.unconnectedCount).toBeGreaterThan(0);
  });
});

// ─── runAllQARules ───────────────────────────────────────────────────────────

describe('runAllQARules', () => {
  it('returns results for all 6 rules', () => {
    const els = [makeElement()];
    const result = engine.runAllQARules(els, null, 'v1.0');
    expect(result.rule1_idStability).toBeDefined();
    expect(result.rule2_levelAssignment).toBeDefined();
    expect(result.rule3_systemMetadata).toBeDefined();
    expect(result.rule4_placeholderMaterials).toBeDefined();
    expect(result.rule5_orphanDetection).toBeDefined();
    expect(result.rule6_connectivity).toBeDefined();
  });

  it('overallPass is true when all rules pass', () => {
    const el = makeElement({ material: 'Concrete - Cast in Place', hasLevel: true });
    const result = engine.runAllQARules([el], null, 'v1.0');
    expect(result.overallPass).toBe(true);
  });

  it('totalIssueCount is 0 for clean elements', () => {
    const el = makeElement({ material: 'Concrete - Cast in Place', hasLevel: true });
    const result = engine.runAllQARules([el], null, 'v1.0');
    expect(result.totalIssueCount).toBe(0);
  });
});

// ─── calculateMaturityScores ─────────────────────────────────────────────────

describe('calculateMaturityScores', () => {
  it('returns one score per category', () => {
    const els = [
      makeElement({ category: 'Walls' }),
      makeElement({ id: 'b', category: 'Walls' }),
      makeElement({ id: 'c', category: 'Floors', familyType: 'Floor:100mm' }),
    ];
    const scores = engine.calculateMaturityScores(els);
    expect(scores.length).toBe(2);
  });

  it('score fields are within valid range', () => {
    const scores = engine.calculateMaturityScores([makeElement()]);
    for (const s of scores) {
      expect(s.overallMaturity).toBeGreaterThanOrEqual(0);
      expect(s.overallMaturity).toBeLessThanOrEqual(100);
    }
  });

  it('quantityMode is FULL or COUNTS_ONLY', () => {
    const scores = engine.calculateMaturityScores([makeElement()]);
    for (const s of scores) {
      expect(['FULL', 'COUNTS_ONLY']).toContain(s.quantityMode);
    }
  });
});

// ─── runQTOExtraction ────────────────────────────────────────────────────────

describe('runQTOExtraction', () => {
  it('returns QTOExtractionResult with all required sections', () => {
    const result = engine.runQTOExtraction([makeElement()], 'model-001', 'v1.0');
    expect(result.modelId).toBe('model-001');
    expect(result.modelVersion).toBe('v1.0');
    expect(result.elementIndex).toBeDefined();
    expect(result.categoryRollups).toBeDefined();
    expect(result.materialsTable).toBeDefined();
    expect(result.hostedDependencies).toBeDefined();
    expect(result.mepConnectivity).toBeDefined();
    expect(result.qaResults).toBeDefined();
    expect(result.maturityScores).toBeDefined();
    expect(result.gaps).toBeDefined();
    expect(result.extractionTimestamp).toBeDefined();
  });

  it('elementCount matches input', () => {
    const els = [makeElement(), makeElement({ id: 'b' })];
    const result = engine.runQTOExtraction(els, 'model-001', 'v1.0');
    expect(result.elementCount).toBe(2);
  });

  it('quantityReliability is one of the valid values', () => {
    const result = engine.runQTOExtraction([makeElement()], 'model-001', 'v1.0');
    expect(['FULL', 'LIMITED_TO_COUNTS', 'UNRELIABLE']).toContain(result.quantityReliability);
  });

  it('overallMaturity is a number between 0 and 100', () => {
    const result = engine.runQTOExtraction([makeElement()], 'model-001', 'v1.0');
    expect(result.overallMaturity).toBeGreaterThanOrEqual(0);
    expect(result.overallMaturity).toBeLessThanOrEqual(100);
  });
});

// ─── generateGapsFromQA ──────────────────────────────────────────────────────

describe('generateGapsFromQA', () => {
  it('returns an array (possibly empty for clean model)', () => {
    const el = makeElement({ material: 'Concrete - Cast in Place', hasLevel: true });
    const qaResults = engine.runAllQARules([el], null, 'v1.0');
    const gaps = engine.generateGapsFromQA(qaResults, 'v1.0');
    expect(Array.isArray(gaps)).toBe(true);
  });

  it('generates gaps when QA rules fail', () => {
    const el = makeElement({ material: 'Default', hasLevel: false });
    const qaResults = engine.runAllQARules([el], null, 'v1.0');
    const gaps = engine.generateGapsFromQA(qaResults, 'v1.0');
    expect(gaps.length).toBeGreaterThan(0);
  });
});
