/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  FOOTPRINT EXTRACTOR — Test Suite
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { ensureFootprintForModel } from '../footprint-extractor';

describe('footprint-extractor.ts', () => {
  test('ensureFootprintForModel function exists', () => {
    expect(typeof ensureFootprintForModel).toBe('function');
  });

  test('returns a promise', () => {
    const result = ensureFootprintForModel({
      modelId: 'test-model',
      projectId: 'test-project',
    });
    expect(result).toBeInstanceOf(Promise);
    result.catch(() => {});
  });
});
