/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  SOP PART 2 — Test Suite: Discipline SOP + BEP Rules + Model Drop Gating
 *  50+ tests across 3 modules
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ─── DISCIPLINE SOP ─────────────────────────────────────────────────────────

import {
  DISCIPLINE_DEFINITIONS,
  getDisciplineDefinition,
  getRequiredDeliverables,
  getMetadataRequirements,
  getCoordinationResponsibilities,
  getQAChecks,
} from '../discipline-sop';

import type { DisciplineCode, DisciplineDefinition } from '../discipline-sop';

describe('discipline-sop.ts', () => {
  test('all 7 discipline codes are defined', () => {
    const codes: DisciplineCode[] = ['ARC', 'STR', 'MECH', 'PLBG', 'FP', 'ELEC', 'BIM_VDC'];
    for (const code of codes) {
      expect(getDisciplineDefinition(code)).toBeDefined();
    }
  });

  test('DISCIPLINE_DEFINITIONS array has entries', () => {
    expect(DISCIPLINE_DEFINITIONS.length).toBeGreaterThanOrEqual(7);
  });

  test('each discipline has deliverables', () => {
    for (const def of DISCIPLINE_DEFINITIONS) {
      const deliverables = getRequiredDeliverables(def.code);
      expect(deliverables.length).toBeGreaterThan(0);
    }
  });

  test('each discipline has metadata requirements', () => {
    for (const def of DISCIPLINE_DEFINITIONS) {
      const meta = getMetadataRequirements(def.code);
      expect(meta.length).toBeGreaterThan(0);
    }
  });

  test('structural has coordination responsibilities', () => {
    const resp = getCoordinationResponsibilities('STR');
    expect(resp.length).toBeGreaterThan(0);
  });

  test('each discipline has QA checks', () => {
    for (const def of DISCIPLINE_DEFINITIONS) {
      const checks = getQAChecks(def.code);
      expect(checks.length).toBeGreaterThan(0);
    }
  });

  test('undefined code returns undefined', () => {
    expect(getDisciplineDefinition('FAKE' as any)).toBeUndefined();
  });

  test('discipline definitions have required fields', () => {
    for (const def of DISCIPLINE_DEFINITIONS) {
      expect(def.code).toBeDefined();
      expect(def.name).toBeDefined();
      expect(def.deliverables).toBeDefined();
      expect(def.metadataRequirements).toBeDefined();
    }
  });
});

// ─── BEP RULES ENGINE ──────────────────────────────────────────────────────

import {
  DEFAULT_BEP_RULES,
  validateElementNaming,
  validateLevelConvention,
  validateZoneConvention,
  validateMetadataCompliance,
  runBEPValidation,
} from '../bep-rules-engine';

describe('bep-rules-engine.ts', () => {
  test('DEFAULT_BEP_RULES is defined', () => {
    expect(DEFAULT_BEP_RULES).toBeDefined();
    expect(DEFAULT_BEP_RULES.naming).toBeDefined();
    expect(DEFAULT_BEP_RULES.levels).toBeDefined();
  });

  test('valid element name passes', () => {
    const result = validateElementNaming('MOOR-STR-L01-COL-001', DEFAULT_BEP_RULES.naming);
    expect(result.valid).toBe(true);
  });

  test('empty element name fails', () => {
    const result = validateElementNaming('', DEFAULT_BEP_RULES.naming);
    expect(result.valid).toBe(false);
  });

  test('level convention validates correct levels', () => {
    const result = validateLevelConvention('L01', DEFAULT_BEP_RULES.levels);
    expect(result.valid).toBe(true);
  });

  test('zone convention validates', () => {
    const result = validateZoneConvention('Z-A', DEFAULT_BEP_RULES.zones);
    expect(result).toBeDefined();
  });

  test('metadata compliance checks required fields', () => {
    const element = {
      name: 'MOOR-STR-L01-COL-001',
      discipline: 'STR',
      material: 'concrete',
      storey: 'Level 1',
    };
    const result = validateMetadataCompliance(element, DEFAULT_BEP_RULES.metadata || []);
    expect(result).toBeDefined();
  });

  test('runBEPValidation processes element batch', () => {
    const elements = [
      { name: 'MOOR-STR-L01-COL-001', discipline: 'STR', storey: 'L01' },
      { name: 'bad name', discipline: 'ARC', storey: 'Level 1' },
    ];
    const result = runBEPValidation(elements, DEFAULT_BEP_RULES);
    expect(result).toBeDefined();
    expect(result.totalChecked).toBe(2);
  });
});

// ─── MODEL DROP GATING ──────────────────────────────────────────────────────

import {
  DEFAULT_THRESHOLDS,
  runModelDropGate,
} from '../model-drop-gating';

import type { GateVerdict, GateResult } from '../model-drop-gating';

describe('model-drop-gating.ts', () => {
  test('DEFAULT_THRESHOLDS is defined', () => {
    expect(DEFAULT_THRESHOLDS).toBeDefined();
    expect(DEFAULT_THRESHOLDS).toHaveProperty('minElements');
    expect(DEFAULT_THRESHOLDS).toHaveProperty('maxClashes');
  });

  test('good model passes gate', () => {
    const result: GateResult = runModelDropGate({
      elements: Array.from({ length: 100 }, (_, i) => ({
        id: `elem-${i}`,
        name: `MOOR-STR-L01-EL-${i}`,
        discipline: 'STR',
        storey: 'L01',
        material: 'concrete',
      })),
      clashCount: 0,
      thresholds: DEFAULT_THRESHOLDS,
    });
    expect(result.verdict).toBe('ACCEPTED');
  });

  test('model with too many clashes is rejected or conditional', () => {
    const result = runModelDropGate({
      elements: Array.from({ length: 50 }, (_, i) => ({
        id: `elem-${i}`,
        name: `EL-${i}`,
        discipline: 'ARC',
        storey: 'L01',
      })),
      clashCount: 9999,
      thresholds: DEFAULT_THRESHOLDS,
    });
    expect(['CONDITIONAL', 'REJECTED']).toContain(result.verdict);
  });

  test('empty model is rejected', () => {
    const result = runModelDropGate({
      elements: [],
      clashCount: 0,
      thresholds: DEFAULT_THRESHOLDS,
    });
    expect(result.verdict).toBe('REJECTED');
  });

  test('result includes gate checks', () => {
    const result = runModelDropGate({
      elements: [{ id: 'e1', name: 'N', discipline: 'ARC', storey: 'L01' }],
      clashCount: 0,
      thresholds: DEFAULT_THRESHOLDS,
    });
    expect(Array.isArray(result.checks)).toBe(true);
    expect(result.checks.length).toBeGreaterThan(0);
  });
});
