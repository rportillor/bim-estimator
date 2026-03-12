/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  SIMILARITY EVICT — Test Suite
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { evictByAge, evictToCap, evictProjectToCap } from '../similarity-evict';

describe('similarity-evict.ts', () => {
  test('evictByAge function exists', () => {
    expect(typeof evictByAge).toBe('function');
  });

  test('evictToCap function exists', () => {
    expect(typeof evictToCap).toBe('function');
  });

  test('evictProjectToCap function exists', () => {
    expect(typeof evictProjectToCap).toBe('function');
  });

  test('evictByAge returns a promise', () => {
    const result = evictByAge(30);
    expect(result).toBeInstanceOf(Promise);
    result.catch(() => {});
  });

  test('evictToCap returns a promise', () => {
    const result = evictToCap(10000);
    expect(result).toBeInstanceOf(Promise);
    result.catch(() => {});
  });
});
