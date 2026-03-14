/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  SOP PARTS 3 & 4 — Prompt Library + Extraction Checklists
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ─── PROMPT LIBRARY (SOP Part 3) ────────────────────────────────────────────

import {
  getDrawingParsingPrompt,
  getModelQTOPrompt,
  getConstructabilityPrompt,
  getSequencing4DPrompt,
  getCrossDocQAPrompt,
  getEngineeringValidationPrompt,
  listPrompts,
  validatePromptParams,
  getPromptById,
  getCorePrinciples,
} from '../prompt-library';

describe('prompt-library.ts', () => {
  test('getDrawingParsingPrompt returns non-empty string', () => {
    const prompt = getDrawingParsingPrompt({
      sheetIds: ['A-101'],
      discipline: 'ARC',
      projectName: 'The Moorings',
    });
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(100);
  });

  test('prompt includes project name when provided', () => {
    const prompt = getDrawingParsingPrompt({
      sheetIds: ['A-101'],
      discipline: 'ARC',
      projectName: 'The Moorings',
    });
    expect(prompt).toContain('Moorings');
  });

  test('prompt includes discipline context', () => {
    const prompt = getDrawingParsingPrompt({
      sheetIds: ['S-201'],
      discipline: 'STR',
      projectName: 'Test',
    });
    expect(prompt.toLowerCase()).toContain('str');
  });

  test('getModelQTOPrompt returns non-empty string', () => {
    const prompt = getModelQTOPrompt({
      modelId: 'model-001',
      projectName: 'Test',
      categoryFilter: ['wall', 'door', 'window'],
    });
    expect(prompt.length).toBeGreaterThan(50);
  });

  test('getConstructabilityPrompt returns valid prompt', () => {
    const prompt = getConstructabilityPrompt({
      projectName: 'Test',
      projectPhase: 'CD',
    });
    expect(prompt.length).toBeGreaterThan(50);
  });

  test('getSequencing4DPrompt returns valid prompt', () => {
    const prompt = getSequencing4DPrompt({
      projectName: 'Test',
    });
    expect(prompt.length).toBeGreaterThan(50);
  });

  test('getCrossDocQAPrompt returns valid prompt', () => {
    const prompt = getCrossDocQAPrompt({
      projectName: 'Test',
      documentPairs: [['A-101', 'S-201']],
    });
    expect(prompt.length).toBeGreaterThan(50);
  });

  test('getEngineeringValidationPrompt returns valid prompt', () => {
    const prompt = getEngineeringValidationPrompt({
      disciplines: ['STR'],
      projectName: 'Test',
    });
    expect(prompt.length).toBeGreaterThan(50);
  });

  test('different sheet IDs produce different prompts', () => {
    const prompt1 = getDrawingParsingPrompt({ sheetIds: ['A-101'], discipline: 'ARC', projectName: 'T' });
    const prompt2 = getDrawingParsingPrompt({ sheetIds: ['S-201'], discipline: 'ARC', projectName: 'T' });
    expect(prompt1).not.toBe(prompt2);
  });

  test('different disciplines produce different prompts', () => {
    const archPrompt = getDrawingParsingPrompt({ sheetIds: ['A-101'], discipline: 'ARC', projectName: 'T' });
    const mechPrompt = getDrawingParsingPrompt({ sheetIds: ['A-101'], discipline: 'MECH', projectName: 'T' });
    expect(archPrompt).not.toBe(mechPrompt);
  });

  test('listPrompts returns all 6 prompts', () => {
    const prompts = listPrompts();
    expect(prompts.length).toBe(6);
    expect(prompts[0]).toHaveProperty('id');
    expect(prompts[0]).toHaveProperty('name');
  });

  test('validatePromptParams detects missing projectName', () => {
    const result = validatePromptParams('3.1', { projectName: '', sheetIds: ['A-101'], discipline: 'ARC' } as any);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('getPromptById returns prompt for valid ID', () => {
    const prompt = getPromptById('3.3', { projectName: 'Test' });
    expect(prompt).not.toBeNull();
    expect(typeof prompt).toBe('string');
  });

  test('getPromptById returns null for invalid ID', () => {
    expect(getPromptById('9.9', { projectName: 'Test' })).toBeNull();
  });

  test('getCorePrinciples returns non-empty string', () => {
    const principles = getCorePrinciples();
    expect(principles.length).toBeGreaterThan(50);
    expect(principles).toContain('EVIDENCE');
  });
});

// ─── EXTRACTION CHECKLISTS (SOP Part 4) ─────────────────────────────────────

jest.mock('../document-control-register', () => ({
  validateEvidenceReference: jest.fn(() => ({ valid: true, errors: [] })),
}));

import {
  DISCIPLINE_CHECKLISTS,
  storeExtraction,
  getExtraction,
  validateExtraction,
  detectConflicts,
  createEmptyExtraction,
} from '../extraction-checklists';


describe('extraction-checklists.ts', () => {
  test('DISCIPLINE_CHECKLISTS has entries for main disciplines', () => {
    expect(DISCIPLINE_CHECKLISTS).toBeDefined();
    const keys = Object.keys(DISCIPLINE_CHECKLISTS);
    expect(keys.length).toBeGreaterThanOrEqual(4);
  });

  test('each checklist has required fields', () => {
    for (const [, checklist] of Object.entries(DISCIPLINE_CHECKLISTS)) {
      expect(checklist.discipline).toBeDefined();
      expect(Array.isArray(checklist.requiredTables)).toBe(true);
      expect(checklist.requiredTables.length).toBeGreaterThan(0);
      expect(Array.isArray(checklist.keyParameters)).toBe(true);
    }
  });

  test('storeExtraction stores and returns result', () => {
    const extraction = createEmptyExtraction('MOOR-TEST', 'ARC', ['A-101']);
    const result = storeExtraction(extraction);
    expect(result).toBeDefined();
    expect(result.projectId).toBe('MOOR-TEST');
  });

  test('getExtraction retrieves stored extraction', () => {
    const extraction = createEmptyExtraction('MOOR-GET', 'ARC', ['A-102']);
    storeExtraction(extraction);
    const retrieved = getExtraction('MOOR-GET', 'ARC');
    expect(retrieved).toBeDefined();
    expect(retrieved!.projectId).toBe('MOOR-GET');
  });

  test('getExtraction returns undefined for non-existent', () => {
    expect(getExtraction('NEVER-EXISTED', 'ARC')).toBeUndefined();
  });

  test('validateExtraction checks completeness', () => {
    const extraction = createEmptyExtraction('MOOR-VAL', 'ARC', ['A-103']);
    const result = validateExtraction(extraction);
    expect(result).toBeDefined();
    expect(result).toHaveProperty('isComplete');
    expect(result).toHaveProperty('gaps');
    expect(result).toHaveProperty('tablesPresent');
    expect(result).toHaveProperty('tablesMissing');
  });

  test('empty extraction generates missing-table gaps', () => {
    const extraction = createEmptyExtraction('MOOR-EMPTY', 'ARC', ['A-104']);
    const result = validateExtraction(extraction);
    expect(result.isComplete).toBe(false);
    expect(result.tablesMissing.length).toBeGreaterThan(0);
    expect(result.gaps.length).toBeGreaterThan(0);
  });

  test('detectConflicts returns array for extraction', () => {
    const extraction = createEmptyExtraction('MOOR-CONF', 'ARC', ['A-101', 'S-101']);
    const conflicts = detectConflicts(extraction);
    expect(Array.isArray(conflicts)).toBe(true);
  });

  test('createEmptyExtraction initializes all tables', () => {
    const extraction = createEmptyExtraction('MOOR-NEW', 'STR', ['S-201']);
    expect(extraction.dimensions).toEqual([]);
    expect(extraction.levels).toEqual([]);
    expect(extraction.materials).toEqual([]);
    expect(extraction.systems).toEqual([]);
    expect(extraction.constraints).toEqual([]);
    expect(extraction.conflicts).toEqual([]);
    expect(extraction.gaps).toEqual([]);
  });
});
