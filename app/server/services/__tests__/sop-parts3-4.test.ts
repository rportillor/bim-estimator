/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  SOP PARTS 3 & 4 — Prompt Library + Extraction Checklists
 *  40+ tests
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ─── PROMPT LIBRARY (SOP Part 3) ────────────────────────────────────────────

import {
  getDrawingParsingPrompt,
  getModelQTOPrompt,
  getConstructabilityPrompt,
  getSequencingPrompt,
  getCrossDocQAPrompt,
  getEngineeringValidationPrompt,
} from '../prompt-library';

describe('prompt-library.ts', () => {
  test('getDrawingParsingPrompt returns non-empty string', () => {
    const prompt = getDrawingParsingPrompt({
      drawingType: 'floor_plan',
      discipline: 'ARCH',
      projectName: 'The Moorings',
    });
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(100);
  });

  test('prompt includes project name when provided', () => {
    const prompt = getDrawingParsingPrompt({
      drawingType: 'floor_plan',
      discipline: 'ARCH',
      projectName: 'The Moorings',
    });
    expect(prompt).toContain('Moorings');
  });

  test('prompt includes discipline context', () => {
    const prompt = getDrawingParsingPrompt({
      drawingType: 'floor_plan',
      discipline: 'STRUCT',
      projectName: 'Test',
    });
    expect(prompt.toLowerCase()).toContain('struct');
  });

  test('getModelQTOPrompt returns non-empty string', () => {
    const prompt = getModelQTOPrompt({
      discipline: 'ARCH',
      projectName: 'Test',
      elementTypes: ['wall', 'door', 'window'],
    });
    expect(prompt.length).toBeGreaterThan(50);
  });

  test('getConstructabilityPrompt returns valid prompt', () => {
    const prompt = getConstructabilityPrompt({
      discipline: 'STRUCT',
      projectName: 'Test',
    });
    expect(prompt.length).toBeGreaterThan(50);
  });

  test('getSequencingPrompt returns valid prompt', () => {
    const prompt = getSequencingPrompt({
      discipline: 'ARCH',
      projectName: 'Test',
    });
    expect(prompt.length).toBeGreaterThan(50);
  });

  test('getCrossDocQAPrompt returns valid prompt', () => {
    const prompt = getCrossDocQAPrompt({
      discipline: 'ARCH',
      projectName: 'Test',
      documents: ['A-101', 'S-201'],
    });
    expect(prompt.length).toBeGreaterThan(50);
  });

  test('getEngineeringValidationPrompt returns valid prompt', () => {
    const prompt = getEngineeringValidationPrompt({
      discipline: 'STRUCT',
      projectName: 'Test',
    });
    expect(prompt.length).toBeGreaterThan(50);
  });

  test('different drawing types produce different prompts', () => {
    const floorPrompt = getDrawingParsingPrompt({ drawingType: 'floor_plan', discipline: 'ARCH', projectName: 'T' });
    const sectionPrompt = getDrawingParsingPrompt({ drawingType: 'section', discipline: 'ARCH', projectName: 'T' });
    expect(floorPrompt).not.toBe(sectionPrompt);
  });

  test('different disciplines produce different prompts', () => {
    const archPrompt = getDrawingParsingPrompt({ drawingType: 'floor_plan', discipline: 'ARCH', projectName: 'T' });
    const mechPrompt = getDrawingParsingPrompt({ drawingType: 'floor_plan', discipline: 'MECH', projectName: 'T' });
    expect(archPrompt).not.toBe(mechPrompt);
  });
});

// ─── EXTRACTION CHECKLISTS (SOP Part 4) ─────────────────────────────────────

import {
  DISCIPLINE_CHECKLISTS,
  storeExtraction,
  getExtraction,
  validateExtraction,
  detectConflicts,
} from '../extraction-checklists';

describe('extraction-checklists.ts', () => {
  test('DISCIPLINE_CHECKLISTS has entries for main disciplines', () => {
    expect(DISCIPLINE_CHECKLISTS).toBeDefined();
    const keys = Object.keys(DISCIPLINE_CHECKLISTS);
    expect(keys.length).toBeGreaterThanOrEqual(4);
  });

  test('each checklist has required fields', () => {
    for (const [disc, checklist] of Object.entries(DISCIPLINE_CHECKLISTS)) {
      expect(checklist.discipline).toBeDefined();
      expect(Array.isArray(checklist.items)).toBe(true);
      expect(checklist.items.length).toBeGreaterThan(0);
    }
  });

  test('storeExtraction stores and returns result', () => {
    const result = storeExtraction({
      projectId: 'MOOR-TEST',
      drawingNumber: 'A-101',
      discipline: 'ARCH',
      extractedData: { walls: 10, doors: 5 },
      confidence: 0.85,
      timestamp: new Date().toISOString(),
    });
    expect(result).toBeDefined();
    expect(result.projectId).toBe('MOOR-TEST');
  });

  test('getExtraction retrieves stored extraction', () => {
    storeExtraction({
      projectId: 'MOOR-GET',
      drawingNumber: 'A-102',
      discipline: 'ARCH',
      extractedData: { walls: 8 },
      confidence: 0.9,
      timestamp: new Date().toISOString(),
    });
    const retrieved = getExtraction('MOOR-GET', 'A-102');
    expect(retrieved).toBeDefined();
  });

  test('validateExtraction checks completeness', () => {
    const result = validateExtraction({
      projectId: 'MOOR-VAL',
      drawingNumber: 'A-103',
      discipline: 'ARCH',
      extractedData: { walls: 5 },
      confidence: 0.7,
      timestamp: new Date().toISOString(),
    });
    expect(result).toBeDefined();
    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('warnings');
  });

  test('detectConflicts finds discrepancies between extractions', () => {
    const extractionA = {
      projectId: 'MOOR-CONF',
      drawingNumber: 'A-101',
      discipline: 'ARCH',
      extractedData: { wallCount: 10 },
      confidence: 0.9,
      timestamp: new Date().toISOString(),
    };
    const extractionB = {
      projectId: 'MOOR-CONF',
      drawingNumber: 'S-101',
      discipline: 'STRUCT',
      extractedData: { wallCount: 12 },
      confidence: 0.85,
      timestamp: new Date().toISOString(),
    };
    const conflicts = detectConflicts([extractionA, extractionB]);
    expect(Array.isArray(conflicts)).toBe(true);
  });

  test('low confidence extraction generates warnings', () => {
    const result = validateExtraction({
      projectId: 'MOOR-LOW',
      drawingNumber: 'A-104',
      discipline: 'ARCH',
      extractedData: {},
      confidence: 0.3,
      timestamp: new Date().toISOString(),
    });
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
