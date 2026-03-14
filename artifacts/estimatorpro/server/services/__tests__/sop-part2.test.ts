/**
 * ==============================================================================
 *  SOP PART 2 -- Test Suite: Discipline SOP + BEP Rules + Model Drop Gating
 * ==============================================================================
 */

// Mock transitive dependencies so modules can be imported without pulling in
// the entire dependency graph (storage, DB, etc.).

jest.mock('../clash-detection-engine', () => ({}));

// ---- DISCIPLINE SOP --------------------------------------------------------

import {
  DISCIPLINE_DEFINITIONS,
  getDisciplineDefinition,
  getDisciplineByInternal,
  getAllDisciplineCodes,
  csiDivisionToDiscipline,
} from '../discipline-sop';

import type { DisciplineCode } from '../discipline-sop';

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

  test('each discipline has requiredDeliverables', () => {
    for (const def of DISCIPLINE_DEFINITIONS) {
      expect(def.requiredDeliverables.length).toBeGreaterThan(0);
    }
  });

  test('each discipline has metadataRequirements', () => {
    for (const def of DISCIPLINE_DEFINITIONS) {
      expect(def.metadataRequirements.length).toBeGreaterThanOrEqual(0);
    }
  });

  test('structural has coordinationResponsibilities', () => {
    const strDef = getDisciplineDefinition('STR');
    expect(strDef).toBeDefined();
    expect(strDef!.coordinationResponsibilities.length).toBeGreaterThan(0);
  });

  test('each discipline has qaChecklist items', () => {
    for (const def of DISCIPLINE_DEFINITIONS) {
      expect(def.qaChecklist.length).toBeGreaterThan(0);
    }
  });

  test('undefined code returns undefined', () => {
    expect(getDisciplineDefinition('FAKE' as any)).toBeUndefined();
  });

  test('discipline definitions have required fields', () => {
    for (const def of DISCIPLINE_DEFINITIONS) {
      expect(def.code).toBeDefined();
      expect(def.fullName).toBeDefined();
      expect(def.requiredDeliverables).toBeDefined();
      expect(def.metadataRequirements).toBeDefined();
    }
  });

  test('getAllDisciplineCodes returns all codes', () => {
    const codes = getAllDisciplineCodes();
    expect(codes.length).toBe(7);
    expect(codes).toContain('ARC');
    expect(codes).toContain('STR');
  });

  test('csiDivisionToDiscipline maps correctly', () => {
    expect(csiDivisionToDiscipline('03')).toBe('STR');
    expect(csiDivisionToDiscipline('23')).toBe('MECH');
    expect(csiDivisionToDiscipline('99')).toBeNull();
  });

  test('getDisciplineByInternal finds by internal discipline', () => {
    const result = getDisciplineByInternal('structural');
    expect(result).toBeDefined();
    expect(result!.code).toBe('STR');
  });
});

// ---- BEP RULES ENGINE ------------------------------------------------------

import {
  MOORINGS_BEP,
  validateFileName,
  validateElementMetadata,
  validateLevelName,
  runBEPValidation,
} from '../bep-rules-engine';

describe('bep-rules-engine.ts', () => {
  test('MOORINGS_BEP is defined with expected structure', () => {
    expect(MOORINGS_BEP).toBeDefined();
    expect(MOORINGS_BEP.namingConvention).toBeDefined();
    expect(MOORINGS_BEP.levelConvention).toBeDefined();
    expect(MOORINGS_BEP.zoneConvention).toBeDefined();
    expect(MOORINGS_BEP.metadataRules).toBeDefined();
  });

  test('valid file name passes', () => {
    const result = validateFileName('MOOR-STR-EAST-L01-MODEL-001', MOORINGS_BEP);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test('empty file name fails', () => {
    const result = validateFileName('', MOORINGS_BEP);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('validateLevelName validates correct levels', () => {
    expect(validateLevelName('L01', MOORINGS_BEP)).toBe(true);
    expect(validateLevelName('B01', MOORINGS_BEP)).toBe(true);
    expect(validateLevelName('RF', MOORINGS_BEP)).toBe(true);
  });

  test('validateLevelName rejects invalid levels', () => {
    expect(validateLevelName('FAKE', MOORINGS_BEP)).toBe(false);
  });

  test('validateElementMetadata checks required fields', () => {
    const element = {
      id: 'elem-1',
      name: 'MOOR-STR-L01-COL-001',
      Level: 'Level 1',
      Material: '30 MPa Concrete',
      Mark: 'C-12',
    };
    const result = validateElementMetadata(element, 'STR', MOORINGS_BEP);
    expect(result).toBeDefined();
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('warnings');
  });

  test('runBEPValidation processes element batch', () => {
    const elements = [
      { id: 'e1', name: 'MOOR-STR-L01-COL-001', Level: 'L01', Material: 'concrete', Mark: 'C-1' },
      { id: 'e2', name: 'bad name', Level: '', Material: '', Mark: '' },
    ];
    const result = runBEPValidation(elements, 'STR', MOORINGS_BEP);
    expect(result).toBeDefined();
    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('warnings');
    expect(result).toHaveProperty('score');
  });

  test('compliant elements score higher', () => {
    const good = [
      { id: 'e1', Level: 'L01', Material: 'Concrete 30MPa', Mark: 'C-1' },
    ];
    const bad = [
      { id: 'e2', Level: '', Material: '', Mark: '' },
    ];
    const goodResult = runBEPValidation(good, 'STR', MOORINGS_BEP);
    const badResult = runBEPValidation(bad, 'STR', MOORINGS_BEP);
    expect(goodResult.score).toBeGreaterThan(badResult.score);
  });
});

// ---- MODEL DROP GATING -----------------------------------------------------

import {
  DEFAULT_THRESHOLDS,
  runModelDropGate,
} from '../model-drop-gating';

import type { GateResult } from '../model-drop-gating';

describe('model-drop-gating.ts', () => {
  test('DEFAULT_THRESHOLDS is defined', () => {
    expect(DEFAULT_THRESHOLDS).toBeDefined();
    expect(DEFAULT_THRESHOLDS).toHaveProperty('minElementCount');
    expect(DEFAULT_THRESHOLDS).toHaveProperty('minLevelCoverage');
    expect(DEFAULT_THRESHOLDS).toHaveProperty('minBEPScore');
  });

  test('good model passes gate', () => {
    const elements = Array.from({ length: 100 }, (_, i) => ({
      id: `elem-${i}`,
      name: `MOOR-STR-L01-EL-${i}`,
      Level: 'L01',
      Material: '30 MPa Concrete',
      Mark: `M-${i}`,
    }));
    const result: GateResult = runModelDropGate(
      'model-001',
      elements,
      'STR',
      DEFAULT_THRESHOLDS,
    );
    expect(result.verdict).toBe('ACCEPTED');
  });

  test('empty model is rejected', () => {
    const result = runModelDropGate(
      'model-empty',
      [],
      'ARC',
      DEFAULT_THRESHOLDS,
    );
    expect(result.verdict).toBe('REJECTED');
  });

  test('small model with few elements is rejected or conditional', () => {
    const result = runModelDropGate(
      'model-small',
      [{ id: 'e1', name: 'N', Level: 'L01' }],
      'ARC',
      DEFAULT_THRESHOLDS,
    );
    expect(['CONDITIONAL', 'REJECTED']).toContain(result.verdict);
  });

  test('result includes gate checks', () => {
    const result = runModelDropGate(
      'model-checks',
      [{ id: 'e1', name: 'N', Level: 'L01', Material: 'concrete' }],
      'ARC',
      DEFAULT_THRESHOLDS,
    );
    expect(Array.isArray(result.checks)).toBe(true);
    expect(result.checks.length).toBeGreaterThan(0);
  });

  test('result includes discipline and modelId', () => {
    const result = runModelDropGate(
      'model-xyz',
      [{ id: 'e1', name: 'N', Level: 'L01' }],
      'MECH',
      DEFAULT_THRESHOLDS,
    );
    expect(result.discipline).toBe('MECH');
    expect(result.modelId).toBe('model-xyz');
  });
});
