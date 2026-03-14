/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  SOP PART 6.1 — Constructability Engine Tests
 *  (sequencing-4d.ts section removed — service deleted in v14.22 dead-code pass)
 * ══════════════════════════════════════════════════════════════════════════════
 */

// Mock dependencies before imports
jest.mock('../extraction-checklists', () => ({
  getAllConstraints: jest.fn(() => []),
  getAllSystems: jest.fn(() => []),
}));
jest.mock('../document-control-register', () => ({
  validateEvidenceReference: jest.fn(() => ({ valid: true, errors: [] })),
}));
jest.mock('../prompt-library', () => ({
  getConstructabilityPrompt: jest.fn(() => 'mock-prompt'),
}));

// ─── CONSTRUCTABILITY ENGINE (SOP Part 6.1) ─────────────────────────────────

import {
  storeAnalysis,
  getAnalysis,
  deleteAnalysis,
  validateAnalysis,
  createEmptyAnalysis,
  addSafetyIssue,
  getSafetyIssuesBySeverity,
} from '../constructability-engine';

import type { ConstructabilityAnalysis, SafetyIssue } from '../constructability-engine';

describe('constructability-engine.ts', () => {
  const makeAnalysis = (projectId: string = 'MOOR-TEST'): ConstructabilityAnalysis =>
    createEmptyAnalysis(projectId);

  test('storeAnalysis stores and returns', () => {
    const analysis = makeAnalysis('MOOR-STORE');
    const stored = storeAnalysis(analysis);
    expect(stored.projectId).toBe('MOOR-STORE');
  });

  test('getAnalysis retrieves stored analysis', () => {
    const analysis = makeAnalysis('MOOR-GET');
    storeAnalysis(analysis);
    const retrieved = getAnalysis('MOOR-GET');
    expect(retrieved).toBeDefined();
    expect(retrieved!.projectId).toBe('MOOR-GET');
  });

  test('getAnalysis returns undefined for non-existent', () => {
    expect(getAnalysis('FAKE-PROJECT')).toBeUndefined();
  });

  test('deleteAnalysis removes stored analysis', () => {
    const analysis = makeAnalysis('DEL-TEST');
    storeAnalysis(analysis);
    expect(deleteAnalysis('DEL-TEST')).toBe(true);
    expect(getAnalysis('DEL-TEST')).toBeUndefined();
  });

  test('deleteAnalysis returns false for non-existent', () => {
    expect(deleteAnalysis('NEVER-EXISTED')).toBe(false);
  });

  test('validateAnalysis returns validation result', () => {
    const analysis = makeAnalysis('VAL-TEST');
    const result = validateAnalysis(analysis);
    expect(result).toBeDefined();
    expect(result).toHaveProperty('isComplete');
    expect(result).toHaveProperty('missingItems');
    expect(result).toHaveProperty('coverage');
  });

  test('empty analysis is not complete', () => {
    const analysis = makeAnalysis('EMPTY-TEST');
    const result = validateAnalysis(analysis);
    expect(result.isComplete).toBe(false);
    expect(result.missingItems.length).toBeGreaterThan(0);
  });

  test('addSafetyIssue appends to analysis', () => {
    const analysis = makeAnalysis('SAFETY-TEST');
    const issue: SafetyIssue = {
      id: 'SAFETY-001',
      category: 'headroom',
      description: 'Insufficient headroom at Level 1 corridor',
      location: 'Level 1 / Zone A',
      severity: 'critical',
      affectedTrades: ['MECH', 'ELEC'],
    };
    const result = addSafetyIssue(analysis, issue);
    expect(result.id).toBe('SAFETY-001');
    expect(analysis.safetyIssues.length).toBe(1);
  });

  test('getSafetyIssuesBySeverity filters correctly', () => {
    const analysis = makeAnalysis('SEV-TEST');
    addSafetyIssue(analysis, {
      id: 'S1', category: 'headroom', description: 'Low headroom',
      location: 'L1', severity: 'critical', affectedTrades: [],
    });
    addSafetyIssue(analysis, {
      id: 'S2', category: 'egress', description: 'Blocked egress',
      location: 'L2', severity: 'minor', affectedTrades: [],
    });
    const critical = getSafetyIssuesBySeverity(analysis, 'critical');
    expect(critical.length).toBe(1);
    expect(critical[0].id).toBe('S1');
  });

  test('createEmptyAnalysis initializes all arrays', () => {
    const analysis = createEmptyAnalysis('INIT-TEST');
    expect(analysis.workAreas).toEqual([]);
    expect(analysis.tempWorks).toEqual([]);
    expect(analysis.tradeDependencies).toEqual([]);
    expect(analysis.safetyIssues).toEqual([]);
    expect(analysis.gaps).toEqual([]);
  });
});
