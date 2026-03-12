/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  SIMILARITY ANALYZER — Test Suite
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { similarityAnalyzer } from '../similarity-analyzer';

describe('similarity-analyzer.ts', () => {
  test('singleton exists', () => {
    expect(similarityAnalyzer).toBeDefined();
  });

  test('has analyze method', () => {
    expect(typeof similarityAnalyzer.analyze).toBe('function');
  });

  test('has computeSimilarity method or equivalent', () => {
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(similarityAnalyzer))
      .filter(m => m !== 'constructor');
    expect(methods.length).toBeGreaterThan(0);
  });
});
