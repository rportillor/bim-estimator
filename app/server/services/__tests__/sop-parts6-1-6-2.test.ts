/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  SOP PART 6.1 — Constructability Engine Tests
 *  (sequencing-4d.ts section removed — service deleted in v14.22 dead-code pass)
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ─── CONSTRUCTABILITY ENGINE (SOP Part 6.1) ─────────────────────────────────

import {
  storeAnalysis,
  getAnalysis,
  deleteAnalysis,
  validateConstructability,
  analyzeSafetyIssues,
  analyzeAccessRoutes,
  analyzeMaterialHandling,
} from '../constructability-engine';

import type { ConstructabilityAnalysis } from '../constructability-engine';

describe('constructability-engine.ts', () => {
  const sampleAnalysis: ConstructabilityAnalysis = {
    projectId: 'MOOR-TEST',
    timestamp: new Date().toISOString(),
    storeys: ['Level 1', 'Level 2'],
    safetyIssues: [],
    accessRoutes: [],
    materialConstraints: [],
    recommendations: [],
    overallScore: 0.85,
  };

  test('storeAnalysis stores and returns', () => {
    const stored = storeAnalysis(sampleAnalysis);
    expect(stored.projectId).toBe('MOOR-TEST');
  });

  test('getAnalysis retrieves stored analysis', () => {
    storeAnalysis(sampleAnalysis);
    const retrieved = getAnalysis('MOOR-TEST');
    expect(retrieved).toBeDefined();
    expect(retrieved!.projectId).toBe('MOOR-TEST');
  });

  test('getAnalysis returns undefined for non-existent', () => {
    expect(getAnalysis('FAKE-PROJECT')).toBeUndefined();
  });

  test('deleteAnalysis removes stored analysis', () => {
    storeAnalysis({ ...sampleAnalysis, projectId: 'DEL-TEST' });
    expect(deleteAnalysis('DEL-TEST')).toBe(true);
    expect(getAnalysis('DEL-TEST')).toBeUndefined();
  });

  test('deleteAnalysis returns false for non-existent', () => {
    expect(deleteAnalysis('NEVER-EXISTED')).toBe(false);
  });

  test('validateConstructability returns validation result', () => {
    const result = validateConstructability(sampleAnalysis);
    expect(result).toBeDefined();
    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('warnings');
  });

  test('analyzeSafetyIssues returns array', () => {
    const issues = analyzeSafetyIssues([
      { type: 'wall', discipline: 'ARCH', storey: 'Level 1', height: 12 },
    ]);
    expect(Array.isArray(issues)).toBe(true);
  });

  test('analyzeAccessRoutes returns array', () => {
    const routes = analyzeAccessRoutes({
      storeys: ['Level 1', 'Level 2'],
      buildingFootprint: { width: 20, depth: 15 },
    });
    expect(Array.isArray(routes)).toBe(true);
  });

  test('analyzeMaterialHandling returns constraints', () => {
    const constraints = analyzeMaterialHandling({
      storeys: ['Level 1'],
      elements: [{ type: 'beam', material: 'steel', weight_kg: 500 }],
    });
    expect(Array.isArray(constraints)).toBe(true);
  });
});
