/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  SIMILARITY SUMMARY — Test Suite
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { buildProjectSimilaritySummary } from '../similarity-summary';
import type { ProjectSimilaritySummary } from '../similarity-summary';

describe('similarity-summary.ts', () => {
  test('buildProjectSimilaritySummary function exists', () => {
    expect(typeof buildProjectSimilaritySummary).toBe('function');
  });

  test('returns a promise', () => {
    const result = buildProjectSimilaritySummary('test-project');
    expect(result).toBeInstanceOf(Promise);
    result.catch(() => {});
  });

  test('ProjectSimilaritySummary type compliance', () => {
    const summary: ProjectSimilaritySummary = {
      projectId: 'MOOR',
      totalPairs: 10,
      avgSimilarity: 0.75,
      highSimilarityCount: 3,
    };
    expect(summary.avgSimilarity).toBeCloseTo(0.75);
  });
});
