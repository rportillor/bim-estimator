/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  SIMILARITY CACHE — Test Suite
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { readSimilarityCache, writeSimilarityCache } from '../similarity-cache';
import type { SimilarityCachePayload } from '../similarity-cache';

describe('similarity-cache.ts', () => {
  test('readSimilarityCache function exists', () => {
    expect(typeof readSimilarityCache).toBe('function');
  });

  test('writeSimilarityCache function exists', () => {
    expect(typeof writeSimilarityCache).toBe('function');
  });

  test('readSimilarityCache returns a promise', () => {
    const result = readSimilarityCache('test-project');
    expect(result).toBeInstanceOf(Promise);
    result.catch(() => {});
  });

  test('SimilarityCachePayload type compliance', () => {
    const payload: SimilarityCachePayload = {
      projectId: 'MOOR',
      pairs: [],
      timestamp: new Date().toISOString(),
    };
    expect(payload.projectId).toBe('MOOR');
  });
});
